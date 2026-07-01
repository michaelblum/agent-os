# AOS Agent Workspace v0

Version: `aos.agent-workspace.v0`

Agent workspaces are local, mode-isolated saved perception state for normal AOS
verbs. They let an agent keep compact action handles from `aos see capture`
without placing screenshots, base64 payloads, AX trees, or full primitive output
on stdout.

The JSON schema is `shared/schemas/aos-agent-workspace-v0.schema.json`.

## Storage

Saved data lives under:

```text
${AOS_STATE_ROOT:-~/.config/aos}/{repo|installed}/agent-workspaces/<workspace>/
```

Each workspace contains:

- `workspace.json`: workspace metadata and retention policy.
- `index.json`: compact snapshot list and the only current snapshot pointer.
- `snapshots/<snapshot>/summary.json`: compact stdout-equivalent summary.
- `snapshots/<snapshot>/snapshot.json`: snapshot metadata and known limits.
- `snapshots/<snapshot>/capture.json`: full primitive capture JSON.
- `snapshots/<snapshot>/refs.json`: full saved ref records.
- `snapshots/<snapshot>/artifacts/`: file-backed screenshots or base64 payloads.

Mutating commands may create a transient `.write-lock/` directory under the
workspace. This is local contention control state, not part of the persisted
schema contract.

`capture.json` intentionally preserves the primitive output shape. The workspace
schema validates the saved workspace files around that payload, not every
primitive capture field.

## Capture Modes

`aos see capture --save` supports these explicit modes:

- `ax`: tree-oriented capture. Browser targets use xray refs; non-browser
  targets currently use the native capture path and report native limits.
- `vision`: screenshot-oriented capture. Image/base64 data is saved under
  `artifacts/` and represented in compact output by artifact refs.
- `som`: screen-object mode. This slice uses xray-backed refs where available
  and records the same limits as the originating backend.

Compact stdout includes `capture_mode`, `runtime_mode`, `state_id`, counts,
artifact refs, compact refs, omitted heavy payload classes, and known limits.
It must not include full `elements`, `semantic_targets`, `perceptions`, or
base64 payloads.

## Ref Grammar

Saved refs are scoped to a snapshot.

```text
ref:<snapshot-id>:<ref-id>
ref:<ref-id>
```

The scoped form is always preferred. The bare form resolves only when exactly
one saved snapshot in the workspace contains that ref id. Multiple matches fail
with `REF_AMBIGUOUS`; missing refs fail with `REF_NOT_FOUND`.

## Resolution Classes

Each saved ref records:

- `backend`: `aos_canvas`, `browser`, or `native_ax`.
- `resolution_class`: `reacquirable`, `snapshot_scoped`, `volatile`,
  `stable`, or `unsupported`.
- `confidence`: `high`, `medium`, or `low`.
- `supported_actions`, `warnings`, `known_limits`, identity facts, and current
  address facts. `identity_facts.state_id`, `identity_facts.source_ref`,
  `action_target`, and `current_address.action_target` are required even when
  their value is `null` for an unsupported or inspection-only ref.

Mutation is fail-closed. V0 saved refs publicly support only
`aos do click ref:<...>`. Browser `snapshot_scoped` refs may dry-run click to
show the resolved command, but real mutation returns
`REF_REVALIDATION_REQUIRED` until a current-target validation path exists. AOS
canvas `reacquirable` click refs may route through the current canvas resolver.
Native AX `volatile` refs are inspection-only. Other producer actions may still
be captured as facts, but `supported_actions` on saved refs is the intersection
of producer actions and V0 saved-ref support; non-click saved-ref actions return
`ACTION_INCOMPATIBLE`.

`state_id` remains provenance for a perception state. It is carried into
resolved AOS canvas actions when available, but it is not durable identity.

Malformed, unreadable, or schema-invalid existing workspace files fail closed
with `AGENT_WORKSPACE_STATE_CORRUPT` and include the state file path. Missing
workspaces and missing snapshots keep using `WORKSPACE_NOT_FOUND` and
`SNAPSHOT_NOT_FOUND`. Concurrent local mutations fail fast with
`AGENT_WORKSPACE_LOCKED`.

## Cleanup

Workspaces are local control state, not Work Recording evidence storage.
Cleanup is explicit:

```bash
aos see workspace prune <id> --older-than <duration> --dry-run --json
aos see snapshot delete <snapshot-id> --workspace <id> --i-understand-local-artifacts --json
aos see workspace delete <id> --i-understand-local-artifacts --json
```

Destructive cleanup requires `--i-understand-local-artifacts`. Prune also
accepts `--dry-run` for non-mutating preview.
