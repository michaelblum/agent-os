#!/usr/bin/env bash
# agent-sync — sync agent-os agent roster → ~/.codex/agents/ + ~/.codex/config.toml
#
# Usage:
#   ./scripts/agent-sync.sh                          # auto-detect agent-os path
#   ./scripts/agent-sync.sh --dry-run                # preview changes, write nothing
#   ./scripts/agent-sync.sh --agent-os-path <path>   # explicit path override
#   AGENT_OS_PATH=/path/to/agent-os ./scripts/agent-sync.sh
#
# Source of truth: ai-agents/providers/codex/*.toml
# Writes:          ~/.codex/agents/<name>.toml
#                  ~/.codex/config.toml [agents.*] blocks
#
# Invokable as $agent-sync from the Codex CLI.
# See ai-agents/providers/codex/SKILL.md for full documentation.

set -euo pipefail

DRY_RUN=false
AGENT_OS_PATH="${AGENT_OS_PATH:-}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-os-path) AGENT_OS_PATH="$2"; shift 2 ;;
    --dry-run)       DRY_RUN=true; shift ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# ── 1. Resolve agent-os root ────────────────────────────────────────────────
if [[ -z "$AGENT_OS_PATH" ]]; then
  for candidate in \
    "$HOME/Documents/GitHub/agent-os" \
    "$HOME/Code/agent-os" \
    "$HOME/code/agent-os" \
    "$HOME/projects/agent-os"; do
    if [[ -d "$candidate/ai-agents/providers/codex" ]]; then
      AGENT_OS_PATH="$candidate"
      break
    fi
  done
fi

# Fallback: are we already inside agent-os?
if [[ -z "$AGENT_OS_PATH" && -d "ai-agents/providers/codex" ]]; then
  AGENT_OS_PATH="$(pwd)"
fi

if [[ -z "$AGENT_OS_PATH" ]]; then
  echo "ERROR: Cannot locate agent-os." >&2
  echo "       Set AGENT_OS_PATH env var or run from inside the repo." >&2
  exit 1
fi

AGENTS_DIR="$AGENT_OS_PATH/ai-agents/providers/codex"
GLOBAL_CONFIG="$HOME/.codex/config.toml"
LOCAL_AGENTS_DIR="$HOME/.codex/agents"

# ── 2. Ensure target directories and global config exist ────────────────────
mkdir -p "$LOCAL_AGENTS_DIR"

if [[ ! -f "$GLOBAL_CONFIG" ]]; then
  mkdir -p "$(dirname "$GLOBAL_CONFIG")"
  cat > "$GLOBAL_CONFIG" <<'EOF'
# ~/.codex/config.toml — created by agent-sync
model = "gpt-5.5"
model_reasoning_effort = "medium"
approval_policy = "on-failure"
sandbox_mode = "workspace-write"

[features]
multi_agent_v2 = true
guardian_approval = true
EOF
  echo "agent-sync: created $GLOBAL_CONFIG with safe defaults"
fi

# ── 3. Sync via Python 3 ────────────────────────────────────────────────────
python3 - "$AGENTS_DIR" "$GLOBAL_CONFIG" "$LOCAL_AGENTS_DIR" "$DRY_RUN" <<'PYEOF'
import sys, os, re, pathlib, shutil, datetime, json

try:
    import tomllib
except ImportError:
    try:
        import tomli as tomllib
    except ImportError:
        print("ERROR: Python 3.11+ required (or: pip install tomli)", file=sys.stderr)
        sys.exit(1)

agents_dir       = pathlib.Path(sys.argv[1])
global_cfg       = pathlib.Path(sys.argv[2])
local_agents_dir = pathlib.Path(sys.argv[3])
dry_run          = sys.argv[4] == "true"
run_ts           = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

# ── Read source agent TOMLs ──────────────────────────────────────────────────
source = {}
for toml_file in sorted(agents_dir.glob("*.toml")):
    try:
        with open(toml_file, "rb") as f:
            data = tomllib.load(f)
        name = data.get("name") or toml_file.stem
        source[name] = {
            "name":                name,
            "description":         data.get("description", "").strip(),
            "nickname_candidates": data.get("nickname_candidates", []),
            "model":               data.get("model", ""),
            "model_reasoning_effort": data.get("model_reasoning_effort", ""),
            "source_file":         str(toml_file.resolve()),
            "target_file":         str((local_agents_dir / toml_file.name).resolve()),
        }
    except Exception as e:
        print(f"  WARN: skipping {toml_file.name} — parse error: {e}", flush=True)

if not source:
    print("  WARN: no agent .toml files found in", agents_dir, flush=True)
    sys.exit(0)

# ── Step A: Write/update ~/.codex/agents/<name>.toml ────────────────────────
toml_results = []  # (name, action, path)
for name, agent in source.items():
    target = pathlib.Path(agent["target_file"])
    # Read source toml as raw text and write verbatim to target
    src_text = pathlib.Path(agent["source_file"]).read_text()
    if dry_run:
        action = "would-write" if not target.exists() else "would-update"
    else:
        action = "created" if not target.exists() else "updated"
        target.write_text(src_text)
    toml_results.append((name, action, str(target)))

# ── Step B: Patch ~/.codex/config.toml [agents.*] blocks ────────────────────
raw = global_cfg.read_text()

# Detect existing [agents.<name>] blocks
existing_agents = set(re.findall(r'^\[agents\.(\w[\w-]*)\]', raw, re.MULTILINE))

added, updated, skipped, noticed = [], [], [], []
new_blocks = []

for name, agent in source.items():
    desc      = agent["description"].replace('"', '\\"')
    cfg_path  = agent["target_file"]   # ~/.codex/agents/<name>.toml
    nicks     = agent["nickname_candidates"]

    lines = [f'[agents.{name}]']
    lines.append(f'description         = "{desc}"')
    if nicks:
        nicks_str = ", ".join(f'"{n}"' for n in nicks)
        lines.append(f'nickname_candidates = [{nicks_str}]')
    lines.append(f'config_file         = "{cfg_path}"')
    new_block = "\n".join(lines) + "\n"

    if name not in existing_agents:
        new_blocks.append((name, new_block))
        added.append(name)
    else:
        # Check if config_file path needs updating (stale path check)
        stale = cfg_path not in raw
        desc_stale = agent["description"] and f'"{agent["description"]}"' not in raw
        if stale or desc_stale:
            pattern = rf'\[agents\.{re.escape(name)}\][^\[]*'
            raw = re.sub(pattern, new_block, raw, flags=re.DOTALL)
            updated.append(name)
        else:
            skipped.append(name)

# Agents in global config not in agent-os (do not touch)
for name in existing_agents:
    if name not in source:
        noticed.append(name)

# Append new blocks
if new_blocks:
    raw = raw.rstrip() + "\n\n" + "\n\n".join(blk for _, blk in new_blocks) + "\n"

# ── Write global config (with backup) ───────────────────────────────────────
backup_path = None
if not dry_run and (added or updated):
    ts          = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
    backup_path = str(global_cfg) + ".bak-" + ts
    shutil.copy2(global_cfg, backup_path)
    global_cfg.write_text(raw)

# ── Telemetry block ──────────────────────────────────────────────────────────
telem = {
    "agent_sync_telemetry": {
        "run_at":          run_ts,
        "dry_run":         dry_run,
        "agent_os_path":   str(agents_dir.parent.parent),
        "source_dir":      str(agents_dir),
        "global_config":   str(global_cfg),
        "local_agents_dir": str(local_agents_dir),
        "backup":          backup_path,
        "config_changes": {
            "added":   added,
            "updated": updated,
            "skipped": skipped,
            "noticed": noticed,
        },
        "toml_files": [
            {"agent": name, "action": action, "path": path}
            for name, action, path in toml_results
        ],
        "errors": [],
    }
}

print("\n" + "=" * 64)
print("AGENT-SYNC TELEMETRY — paste this back for validation")
print("=" * 64)
print(json.dumps(telem, indent=2))
print("=" * 64 + "\n")

# Human summary
if added:   print(f"  added:   {', '.join(added)}")
if updated: print(f"  updated: {', '.join(updated)}")
if skipped: print(f"  skipped: {', '.join(skipped)} (no change)")
if noticed: print(f"  noticed: {', '.join(noticed)} (foreign agents — not modified)")
if dry_run: print("  [dry-run — no files written]")
else:       print(f"  global config: {global_cfg}")

PYEOF
