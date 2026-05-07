# GDI/Foreman Dock

This dock is a durable, repo-local launch/control context for the GDI/foreman
workflow. It is not a source workspace, scratchpad, run log, or generated
artifact directory.

Docks describe how to start and coordinate a workflow. The launcher copies this
template into disposable per-run state under `.aos-test-tmp/workflows/<id>/` and
launches Codex from the generated role directories there. Source edits and tests
still happen in the real repo root.

## Roles

- `gdi/` contains the role-local guidance for the GDI pass.
- `foreman/` contains the role-local guidance for the foreman integration pass.

## Sentinel Contract

The workflow keeps the existing two-file handoff contract:

- GDI writes `handoff/ready-for-foreman.json`.
- Foreman writes `handoff/done.json`.

## Launch

From the repo root:

```bash
node scripts/run-workflow.mjs --workflow-id pilot-001
```

Run state is kept by default for inspection. Add `--clean` when the generated
state should be removed after completion or interruption.
