# GDI/Foreman Dock

This dock is a durable, repo-local launch/control context for the GDI/foreman
workflow. It is not a source workspace, scratchpad, run log, or generated
artifact directory.

Docks describe how to start and coordinate a workflow. The launcher copies this
template into disposable per-run state under `.aos-test-tmp/workflows/<id>/` and
launches each role with one-shot `codex exec` from the generated role
directories there. The supervisor does not pass `--cd`; the generated role cwd
is what lets Codex discover the role-local hooks. Source edits and tests still
happen in the real repo root named in the role prompt and `AOS_WORKFLOW_REPO_ROOT`.

## Roles

- `gdi/` contains the role-local guidance for the GDI pass.
- `foreman/` contains the role-local guidance for the foreman integration pass.

Each role keeps stable identity and sentinel guidance in `role.md`. The
per-invocation task body lives in `task.md`; the launcher concatenates both at
role start.

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
state should be removed after completion or interruption. Add
`--gdi-task-file <path>` to append a concrete task body to the launched GDI
prompt for a specific run.
