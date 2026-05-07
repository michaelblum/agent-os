# Legacy Recipe: Docked Codex Session Supervisor V0

This is legacy compatibility documentation for the older GDI/foreman supervisor
experiment. The canonical dock model is now direct Codex session roots under
`.docks/`; see `docs/recipes/codex-dock-session-profiles.md`.

Do not use this recipe as the conceptual model for AOS Workflows. A Workflow is
an AOS/domain orchestration Subject. This legacy supervisor only coordinates
Codex role sessions.

Use this recipe only when role/persona/agent work must run through the legacy
two-role supervisor.
The durable repo-local launch/control surface is `.docks/`: each dock template
defines role directories, role-local hooks, sentinel contracts, and launch
metadata. The launcher copies the dock template into generated per-run state
under `.aos-test-tmp/workflows/<id>/` and starts each role from its generated
role directory. This is a repo-local helper pattern, not a public `aos` command,
workflow engine, mission runtime, daemon pub/sub surface, Codex TUI automation
harness, or GDI exit interview.

## Create A Profile

From the repo root:

```bash
node scripts/create-codex-workflow-hook-profile.mjs --run-id pilot-001
```

To also add the optional GDI Stop hook that writes a handoff packet:

```bash
node scripts/create-codex-workflow-hook-profile.mjs --run-id pilot-001 --gdi-handoff
```

To opt into role-local TTS for a profile:

```bash
node scripts/create-codex-workflow-hook-profile.mjs --run-id pilot-001 --tts
```

The helper creates:

```text
.aos-test-tmp/workflows/pilot-001/
  README.md
  events.jsonl
  hooks/
    stop-marker.sh
    gdi-stop-handoff.sh
  gdi/
    .codex/hooks.json
  foreman/
    .codex/hooks.json
```

The generated role directories are intentionally ignored local run state. They
exist only so Codex discovers role-local hooks and role-specific guidance. Do
not write source edits, durable docs, or generated run state into `.docks/`.

## Docked GDI/Foreman Launcher

The reusable dock template is checked in at `.docks/gdi-foreman/`. A dock
template is a durable launch/control template, not a source workspace,
scratchpad, or generated artifact directory.

Start the legacy docked GDI/foreman supervisor from the repo root:

```bash
node scripts/run-workflow.mjs --run-id pilot-001
```

The launcher creates `.aos-test-tmp/workflows/pilot-001/`, generates the
role-local hook profile, snapshots the dock template into `dock-template/`,
copies rendered `gdi/` and `foreman/` role guidance into the generated role
directories, registers the GDI role session with AOS, launches GDI, waits for
both `handoff/ready-for-foreman.json` and the GDI Codex process exit,
unregisters GDI, registers the foreman role session with AOS, launches foreman,
then waits for both `handoff/done.json` and the foreman Codex process exit
before unregistering foreman.

The supervisor launches each role as a one-shot `codex exec` run from that
role's generated directory. It does not pass `--cd`: the role-local cwd is what
lets Codex discover the generated `.codex/hooks.json`. The real repo root is
available through `AOS_WORKFLOW_REPO_ROOT` and the rendered role prompt. Role
launches are pinned to `gpt-5.5` with reasoning effort `high` by default. The
GDI role receives its assembled role/task prompt with a literal `/goal ` prefix;
the foreman role receives its prompt without `/goal` because it is an
integration/review pass, not a new goal-driving implementation session. Use
`--model <id>` or `--reasoning-effort <level>` only for an intentional role
profile override.

To append a concrete task body to the launched GDI prompt without editing the
dock template:

```bash
node scripts/run-workflow.mjs --run-id pilot-001 --gdi-task-file /path/to/task.md
```

Role identity and task text are intentionally split. `role.md` carries stable
role identity, sentinels, and guardrails. `task.md` carries per-run task text.
The supervisor concatenates `role.md` and rendered `task.md` at launch time;
`--gdi-task-file` fills the GDI `task.md` body.

Run state is kept by default for inspection. Add `--clean` to remove the
generated docked session directory after completion or interruption.

The docked launcher enables role-local TTS by default. Add `--no-tts` for a
quiet run. Each role gets a stable role session id: `<run-id>:gdi` and
`<run-id>:foreman`. Before launching a role, the supervisor registers that
role session with `./aos tell --register --session-id <id> --role <role>
--harness codex`; after the role completes, it unregisters the same session.
When TTS is enabled, the supervisor and role-local Stop hook both use the
registered role session id. GDI binds with `./aos voice bind --quality-tier
premium --language en --gender female`; foreman binds with `./aos voice bind
--quality-tier premium --language en --gender male`. The concrete voices can
vary by run, but the role voices remain distinct when the registry has speakable
premium voices for both filters. TTS failures are appended to run-local
`events.jsonl` instead of being silently swallowed.

Inspect active or retained legacy docked session runs without starting a new run:

```bash
node scripts/run-workflow.mjs --list
node scripts/run-workflow.mjs --status --run-id pilot-001
```

Add `--json` to either inspection command for machine-readable output. The
status payload reports the run state, active role, sentinel presence,
run-local TTS hooks, role session ids, latest register/bind/TTS/unregister
events per role, latest handoff packet path, latest hook event, and matching
supervisor/role process ids when those processes are still alive. This is a
repo-local supervisor inspection surface, not a public `aos` command.

## What The Hooks Do

Both roles get a harmless Stop marker hook. The script reads hook stdin, writes
a compact marker event to `.aos-test-tmp/workflows/<id>/events.jsonl`, and
returns Codex-compatible success JSON.

When role-local TTS is enabled, both roles also get a Stop hook that speaks a
short completion message through `./aos voice final-response --harness codex
--session-id <run-id>:<role>`. The hook does not use the provider hook
payload's transient session id for speech. It appends a
`codex.workflow_hook.tts.v0` event with success or failure details for the
bind and final-response calls.

When `--gdi-handoff` is enabled, only the GDI role gets a second Stop hook. It
pipes hook stdin into:

```bash
node /Users/Michael/Code/agent-os/scripts/aos-gdi-handoff-packet.mjs --write
```

The hook stores packets under the generated workflow directory at
`gdi/handoffs/` and writes the latest packet path to
`gdi/latest-handoff-path.txt`. Clipboard support is optional and best-effort:
set `AOS_WORKFLOW_COPY_PACKET_PATH=1` before launching Codex if you want the
hook to attempt `pbcopy`.

## Manual Launch Pattern

Open one terminal per role. The terminal working directory is the generated role
directory so Codex discovers the role-local `.codex/hooks.json` from its
project-local configuration stack. The actual repo under work remains
`/Users/Michael/Code/agent-os`; include that repo path in the session prompt and
`cd` there for file edits and tests.

GDI terminal:

```bash
cd /Users/Michael/Code/agent-os/.aos-test-tmp/workflows/pilot-001/gdi
AOS_WORKFLOW_REPO_ROOT=/Users/Michael/Code/agent-os codex
```

Foreman terminal:

```bash
cd /Users/Michael/Code/agent-os/.aos-test-tmp/workflows/pilot-001/foreman
AOS_WORKFLOW_REPO_ROOT=/Users/Michael/Code/agent-os codex
```

Do not automate `/goal`, `/model`, `/clear`, keyboard input, terminal control,
Codex TUI driving, or AppleScript shortcuts around this launch. The V0 profile
only prepares files for a human-operated two-terminal pilot.

## Verification Boundary

Codex CLI 0.128.0 supports project-local hook discovery: `.codex/hooks.json`
is loaded from project configuration layers associated with the launch CWD. The
checked-in smoke test launches a mock `codex` process from the generated GDI
role directory, has it discover that role's `.codex/hooks.json`, and verifies
the discovered Stop hook writes under the workflow directory.
