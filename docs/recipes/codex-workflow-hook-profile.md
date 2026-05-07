# Recipe: Ephemeral Codex Workflow Hook Profile V0

Use this recipe when a GDI pilot needs role-local Codex Stop hooks without
changing the repo-wide `.codex/hooks.json`. This is a repo-local helper pattern,
not a public `aos` command, workflow engine, mission runtime, daemon pub/sub
surface, Codex TUI automation harness, or GDI exit interview.

## Create A Profile

From the repo root:

```bash
node scripts/create-codex-workflow-hook-profile.mjs --id pilot-001
```

To also add the optional GDI Stop hook that writes a handoff packet:

```bash
node scripts/create-codex-workflow-hook-profile.mjs --id pilot-001 --gdi-handoff
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

The generated role directories are intentionally ignored local scratch space.
There is no automatic cleanup in V0.

## Docked GDI/Foreman Launcher

The reusable docking-station path is checked in at `.docks/gdi-foreman/`. A dock
is a launch/control template, not a source workspace. Do not put generated run
state or task source edits inside `.docks/`.

Start the docked GDI/foreman workflow from the repo root:

```bash
node scripts/run-workflow.mjs --workflow-id pilot-001
```

The launcher creates `.aos-test-tmp/workflows/pilot-001/`, generates the
role-local hook profile, snapshots the dock template into `dock-template/`,
copies rendered `gdi/` and `foreman/` role guidance into the generated role
directories, launches GDI, waits for both `handoff/ready-for-foreman.json` and
the GDI Codex process exit, then launches foreman and waits for both
`handoff/done.json` and the foreman Codex process exit.

The supervisor launches each role as a one-shot `codex exec` run from that
role's generated directory. It does not pass `--cd`: the role-local cwd is what
lets Codex discover the generated `.codex/hooks.json`. The real repo root is
available through `AOS_WORKFLOW_REPO_ROOT` and the rendered role prompt.

To append a concrete task body to the launched GDI prompt without editing the
dock template:

```bash
node scripts/run-workflow.mjs --workflow-id pilot-001 --gdi-task-file /path/to/task.md
```

Run state is kept by default for inspection. Add `--clean` to remove the
generated workflow directory after completion or interruption.

## What The Hooks Do

Both roles get a harmless Stop marker hook. The script reads hook stdin, writes
a compact marker event to `.aos-test-tmp/workflows/<id>/events.jsonl`, and
returns Codex-compatible success JSON.

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
