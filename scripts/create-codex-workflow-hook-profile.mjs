#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsRoot = path.join(repoRoot, '.aos-test-tmp', 'workflows');
const roles = ['gdi', 'foreman'];

function usage() {
  return `Usage: node scripts/create-codex-workflow-hook-profile.mjs [--id <workflow-id>] [--gdi-handoff] [--tts]

Creates an ephemeral Codex hook profile under .aos-test-tmp/workflows/<workflow-id>/.
The generated profile contains isolated gdi/ and foreman/ role directories, each
with its own .codex/hooks.json.`;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function parseArgs(argv) {
  const args = {
    id: null,
    gdiHandoff: false,
    tts: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--id') {
      args.id = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === '--gdi-handoff') {
      args.gdiHandoff = true;
    } else if (arg === '--tts') {
      args.tts = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function timestampForId(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function defaultWorkflowId(date = new Date(), pid = process.pid) {
  return `codex-${timestampForId(date)}-${pid}`;
}

export function sanitizeWorkflowId(raw) {
  const sanitized = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!sanitized) {
    throw new Error('Workflow id must contain at least one alphanumeric, dot, underscore, or hyphen character.');
  }
  if (sanitized === '.' || sanitized === '..' || sanitized.includes('..')) {
    throw new Error(`Unsafe workflow id: ${raw}`);
  }
  return sanitized;
}

function assertInside(child, parent) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${parent}: ${child}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function stopMarkerScriptTemplate() {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="\${AOS_WORKFLOW_REPO_ROOT:-${repoRoot}}"
EXPECTED_ROOT="$REPO_ROOT/.aos-test-tmp/workflows"
ROLE="\${AOS_WORKFLOW_ROLE:-unknown}"

python3 - "$WORKFLOW_DIR" "$EXPECTED_ROOT" <<'PY'
import pathlib
import sys

workflow_dir = pathlib.Path(sys.argv[1]).resolve()
expected_root = pathlib.Path(sys.argv[2]).resolve()
try:
    workflow_dir.relative_to(expected_root)
except ValueError:
    print(f"workflow dir outside expected temp root: {workflow_dir}", file=sys.stderr)
    raise SystemExit(1)
PY

INPUT_PATH="$(mktemp "$WORKFLOW_DIR/.stop-input.XXXXXX")"
trap 'rm -f "$INPUT_PATH"' EXIT
cat >"$INPUT_PATH" || true

python3 - "$WORKFLOW_DIR" "$ROLE" "$INPUT_PATH" <<'PY'
import datetime
import hashlib
import json
import pathlib
import sys

workflow_dir = pathlib.Path(sys.argv[1]).resolve()
role = sys.argv[2] or "unknown"
input_path = pathlib.Path(sys.argv[3])
payload = input_path.read_bytes()
event = {
    "type": "codex.workflow_hook.stop_marker.v0",
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "role": role,
    "hook": "Stop",
    "input_bytes": len(payload),
    "input_sha256": hashlib.sha256(payload).hexdigest(),
}
with (workflow_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

printf '{"continue":true}\\n'
`;
}

function gdiHandoffScriptTemplate() {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="\${AOS_WORKFLOW_REPO_ROOT:-${repoRoot}}"
EXPECTED_ROOT="$REPO_ROOT/.aos-test-tmp/workflows"
PACKET_SCRIPT="\${AOS_GDI_HANDOFF_PACKET_SCRIPT:-$REPO_ROOT/scripts/aos-gdi-handoff-packet.mjs}"

python3 - "$WORKFLOW_DIR" "$EXPECTED_ROOT" <<'PY'
import pathlib
import sys

workflow_dir = pathlib.Path(sys.argv[1]).resolve()
expected_root = pathlib.Path(sys.argv[2]).resolve()
try:
    workflow_dir.relative_to(expected_root)
except ValueError:
    print(f"workflow dir outside expected temp root: {workflow_dir}", file=sys.stderr)
    raise SystemExit(1)
PY

INPUT_PATH="$(mktemp "$WORKFLOW_DIR/.gdi-handoff-input.XXXXXX")"
PACKET_JSON_PATH="$(mktemp "$WORKFLOW_DIR/.gdi-handoff-output.XXXXXX")"
trap 'rm -f "$INPUT_PATH" "$PACKET_JSON_PATH"' EXIT
cat >"$INPUT_PATH" || true

OUT_DIR="$WORKFLOW_DIR/gdi/handoffs"
mkdir -p "$OUT_DIR"
node "$PACKET_SCRIPT" --write --out-dir "$OUT_DIR" <"$INPUT_PATH" >"$PACKET_JSON_PATH"
PACKET_PATH="$(python3 - "$PWD" "$PACKET_JSON_PATH" <<'PY'
import json
import os
import sys

cwd = sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as handle:
    packet = json.load(handle)
packet_path = packet.get("output_path") or ""
if packet_path:
    print(os.path.abspath(os.path.join(cwd, packet_path)))
PY
)"

printf '%s\\n' "$PACKET_PATH" >"$WORKFLOW_DIR/gdi/latest-handoff-path.txt"
HANDOFF_DIR="$WORKFLOW_DIR/handoff"
mkdir -p "$HANDOFF_DIR"
python3 - "$HANDOFF_DIR/ready-for-foreman.json" "$PACKET_PATH" <<'PY'
import datetime
import json
import pathlib
import sys

ready_path = pathlib.Path(sys.argv[1])
packet_path = sys.argv[2]
payload = {
    "type": "codex.workflow_handoff.ready_for_foreman.v0",
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "packet_path": packet_path,
}
ready_path.write_text(json.dumps(payload, indent=2) + "\\n", encoding="utf-8")
PY

COPIED=false
if [[ "\${AOS_WORKFLOW_COPY_PACKET_PATH:-0}" == "1" ]] && command -v pbcopy >/dev/null 2>&1; then
  if printf '%s' "$PACKET_PATH" | pbcopy >/dev/null 2>&1; then
    COPIED=true
  fi
fi

python3 - "$WORKFLOW_DIR" "$PACKET_PATH" "$COPIED" <<'PY'
import datetime
import json
import pathlib
import sys

workflow_dir = pathlib.Path(sys.argv[1]).resolve()
event = {
    "type": "codex.workflow_hook.gdi_handoff_packet.v0",
    "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
    "role": "gdi",
    "hook": "Stop",
    "packet_path": sys.argv[2],
    "clipboard_attempted": sys.argv[3] == "true",
}
with (workflow_dir / "events.jsonl").open("a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

printf '{"continue":true}\\n'
`;
}

function workflowTtsScriptTemplate() {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="\${AOS_WORKFLOW_REPO_ROOT:-${repoRoot}}"
EXPECTED_ROOT="$REPO_ROOT/.aos-test-tmp/workflows"
ROLE="\${AOS_WORKFLOW_ROLE:-unknown}"
AOS_BIN="\${AOS_WORKFLOW_AOS_BIN:-$REPO_ROOT/aos}"

python3 - "$WORKFLOW_DIR" "$EXPECTED_ROOT" <<'PY'
import pathlib
import sys

workflow_dir = pathlib.Path(sys.argv[1]).resolve()
expected_root = pathlib.Path(sys.argv[2]).resolve()
try:
    workflow_dir.relative_to(expected_root)
except ValueError:
    print(f"workflow dir outside expected temp root: {workflow_dir}", file=sys.stderr)
    raise SystemExit(1)
PY

case "$ROLE" in
  gdi) MESSAGE="GDI finished, foreman starting." ;;
  foreman) MESSAGE="Foreman finished." ;;
  *) printf '{"continue":true}\\n'; exit 0 ;;
esac

INPUT_PATH="$(mktemp "$WORKFLOW_DIR/.tts-input.XXXXXX")"
PAYLOAD_PATH="$(mktemp "$WORKFLOW_DIR/.tts-payload.XXXXXX")"
trap 'rm -f "$INPUT_PATH" "$PAYLOAD_PATH"' EXIT
cat >"$INPUT_PATH" || true

if [[ ! -x "$AOS_BIN" ]]; then
  printf '{"continue":true}\\n'
  exit 0
fi

SESSION_ID="$(python3 - "$INPUT_PATH" "$PAYLOAD_PATH" "$MESSAGE" <<'PY'
import json
import pathlib
import sys

input_path = pathlib.Path(sys.argv[1])
payload_path = pathlib.Path(sys.argv[2])
message = sys.argv[3]
raw = input_path.read_text(encoding="utf-8", errors="replace").strip()
try:
    hook = json.loads(raw) if raw else {}
except json.JSONDecodeError:
    hook = {}

session_id = (
    hook.get("session_id")
    or hook.get("thread_id")
    or (hook.get("payload") or {}).get("session_id")
    or (hook.get("payload") or {}).get("thread_id")
    or ""
)
hook["last_assistant_message"] = message
hook["harness"] = hook.get("harness") or "codex"
payload_path.write_text(json.dumps(hook, separators=(",", ":")) + "\\n", encoding="utf-8")
print(session_id)
PY
)"

if [[ -n "$SESSION_ID" ]]; then
  "$AOS_BIN" voice final-response --harness codex --session-id "$SESSION_ID" <"$PAYLOAD_PATH" >/dev/null 2>&1 || true
else
  "$AOS_BIN" voice final-response --harness codex <"$PAYLOAD_PATH" >/dev/null 2>&1 || true
fi

printf '{"continue":true}\\n'
`;
}

function hookCommand(workflowDir, role, scriptName) {
  return [
    `AOS_WORKFLOW_ROLE=${shellQuote(role)}`,
    `AOS_WORKFLOW_REPO_ROOT=${shellQuote(repoRoot)}`,
    'bash',
    shellQuote(path.join(workflowDir, 'hooks', scriptName)),
  ].join(' ');
}

export function buildHookConfig(options) {
  const stopHooks = [
    {
      type: 'command',
      command: hookCommand(options.workflowDir, options.role, 'stop-marker.sh'),
      statusMessage: 'Recording workflow Stop marker',
      timeout: 10,
    },
  ];

  if (options.role === 'gdi' && options.gdiHandoff) {
    stopHooks.push({
      type: 'command',
      command: hookCommand(options.workflowDir, options.role, 'gdi-stop-handoff.sh'),
      statusMessage: 'Writing GDI handoff packet',
      timeout: 45,
    });
  }

  if (options.tts) {
    stopHooks.push({
      type: 'command',
      command: hookCommand(options.workflowDir, options.role, 'workflow-tts.sh'),
      statusMessage: 'Speaking workflow role completion',
      timeout: 20,
    });
  }

  return {
    hooks: {
      Stop: [
        {
          hooks: stopHooks,
        },
      ],
    },
  };
}

function readmeTemplate(options) {
  const workflowDirRelative = path.relative(repoRoot, options.workflowDir);
  return `# Ephemeral Codex Workflow Hook Profile

Workflow id: \`${options.workflowId}\`

This directory is a repo-local, ignored Codex hook profile for a two-role GDI
pilot. It is not a workflow engine, daemon pub/sub surface, public \`aos\`
command, or Codex TUI automation harness.

## Manual Launch

Open one terminal per role:

\`\`\`bash
cd ${shellQuote(path.join(options.workflowDir, 'gdi'))}
AOS_WORKFLOW_REPO_ROOT=${shellQuote(repoRoot)} codex
\`\`\`

\`\`\`bash
cd ${shellQuote(path.join(options.workflowDir, 'foreman'))}
AOS_WORKFLOW_REPO_ROOT=${shellQuote(repoRoot)} codex
\`\`\`

Keep the working repo path explicit in the prompt or session context:

\`\`\`text
We are working in ${repoRoot}.
\`\`\`

Do not automate \`/goal\`, \`/model\`, \`/clear\`, keyboard input, terminal
control, Codex TUI driving, or AppleScript shortcuts around this profile.

Each role directory has its own \`.codex/hooks.json\`. Codex CLI 0.128.0 loads
project-local hook configuration from the launch CWD's project configuration
stack, so launching from this role directory discovers this hook profile. Stop
hooks append marker events to \`${workflowDirRelative}/events.jsonl\`.

${options.gdiHandoff ? `The GDI role also has an optional Stop hook that pipes hook stdin into
\`${repoRoot}/scripts/aos-gdi-handoff-packet.mjs --write\`, stores packets under
\`${workflowDirRelative}/gdi/handoffs/\`, and writes the latest packet path to
\`${workflowDirRelative}/gdi/latest-handoff-path.txt\`. Set
\`AOS_WORKFLOW_COPY_PACKET_PATH=1\` before launching Codex to attempt a
best-effort clipboard copy of that packet path.` : `The optional GDI handoff hook was not enabled for this profile. Regenerate with
\`--gdi-handoff\` when you want the GDI Stop hook to write a handoff packet.`}

${options.tts ? `Role-local TTS is enabled for this profile. The GDI Stop hook speaks
\`GDI finished, foreman starting.\`; the foreman Stop hook speaks
\`Foreman finished.\` Both calls go through \`${repoRoot}/aos voice final-response\`.` : `Role-local TTS is disabled for this profile. Regenerate with \`--tts\` when you
want the GDI and foreman Stop hooks to speak completion messages.`}
`;
}

export function createWorkflowProfile(options = {}) {
  const workflowId = sanitizeWorkflowId(options.id ?? defaultWorkflowId(options.now));
  const workflowDir = path.join(workflowsRoot, workflowId);
  assertInside(workflowDir, workflowsRoot);

  if (fs.existsSync(workflowDir)) {
    throw new Error(`Workflow directory already exists: ${path.relative(repoRoot, workflowDir)}`);
  }

  fs.mkdirSync(path.join(workflowDir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(workflowDir, 'events.jsonl'), '');
  for (const role of roles) {
    fs.mkdirSync(path.join(workflowDir, role, '.codex'), { recursive: true });
  }

  const scripts = {
    'stop-marker.sh': stopMarkerScriptTemplate(),
    'gdi-stop-handoff.sh': gdiHandoffScriptTemplate(),
    'workflow-tts.sh': workflowTtsScriptTemplate(),
  };
  for (const [name, content] of Object.entries(scripts)) {
    const scriptPath = path.join(workflowDir, 'hooks', name);
    fs.writeFileSync(scriptPath, content, { mode: 0o755 });
    fs.chmodSync(scriptPath, 0o755);
  }

  const roleOutputs = {};
  for (const role of roles) {
    const hookConfig = buildHookConfig({
      workflowDir,
      role,
      gdiHandoff: Boolean(options.gdiHandoff),
      tts: Boolean(options.tts),
    });
    const hookConfigPath = path.join(workflowDir, role, '.codex', 'hooks.json');
    fs.writeFileSync(hookConfigPath, `${JSON.stringify(hookConfig, null, 2)}\n`);
    roleOutputs[role] = {
      dir: role,
      hooks: path.join(role, '.codex', 'hooks.json'),
    };
  }

  fs.writeFileSync(path.join(workflowDir, 'README.md'), readmeTemplate({
    workflowId,
    workflowDir,
    gdiHandoff: Boolean(options.gdiHandoff),
    tts: Boolean(options.tts),
  }));

  return {
    type: 'aos.codex_workflow_hook_profile.v0',
    workflow_id: workflowId,
    workflow_dir: path.relative(repoRoot, workflowDir),
    gdi_handoff_enabled: Boolean(options.gdiHandoff),
    tts_enabled: Boolean(options.tts),
    roles: roleOutputs,
    events: path.relative(repoRoot, path.join(workflowDir, 'events.jsonl')),
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const profile = createWorkflowProfile({
    id: args.id,
    gdiHandoff: args.gdiHandoff,
    tts: args.tts,
  });
  console.log(JSON.stringify(profile, null, 2));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (caught) {
    console.error(caught.message);
    process.exitCode = 1;
  }
}
