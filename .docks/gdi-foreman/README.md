# GDI/Foreman Dock

This dock template is the durable, repo-local launch/control surface for the
GDI/foreman docked workflow. It is not a source workspace, scratchpad, run log,
or generated artifact directory.

Docks describe how to start and coordinate a workflow. The launcher copies this
template into disposable per-run state under `.aos-test-tmp/workflows/<id>/` and
launches each role with one-shot `codex exec` from the generated role
directories there. The supervisor does not pass `--cd`; the generated role cwd
is what lets Codex discover the role-local hooks. Source edits and tests still
happen in the real repo root named in the role prompt and `AOS_WORKFLOW_REPO_ROOT`.
The supervisor pins role launches to `gpt-5.5` with reasoning effort `high` by
default. GDI receives the assembled role/task prompt with a literal `/goal `
prefix. Foreman receives the assembled prompt without `/goal`, because foreman
is an integration/review pass rather than a goal-driving implementation role.

Each launched role is registered with AOS as a role session before `codex exec`
starts and unregistered after the role completes. Stable role session ids are
`<workflow-id>:gdi` and `<workflow-id>:foreman`; the registered metadata uses
the role id and `codex` harness. Role-local TTS uses those registered role
session ids, not provider-transient hook ids.

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
prompt for a specific run. Use `--model <id>` or `--reasoning-effort <level>`
only when a run deliberately needs a different Codex role profile.

Use `node scripts/run-workflow.mjs --list` or `--status --workflow-id <id>` to
inspect the current role/session, role-local TTS configuration, and latest TTS
success or failure event.
