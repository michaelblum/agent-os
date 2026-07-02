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
- `snapshots/<snapshot>/committed.json`: commit marker written last before the
  staged snapshot directory is atomically renamed into place.

Snapshot writes stage under `snapshots/.staging/`. Read paths and `index.json`
rebuilds only consider final snapshot directories with a valid
`committed.json`; staged or partial directories are ignored. `index.json` is a
derived compact index and can be rebuilt from committed snapshots.

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

Mutation is fail-closed. Saved-ref actions are the intersection of producer
actions, backend durability, and existing `aos do` command behavior. Browser
`snapshot_scoped` click, fill, hover, scroll, and drag refs can run a fresh
xray validation as advisory dry-run evidence, but real browser saved-ref
mutation returns `REF_REVALIDATION_REQUIRED` until page, frame, and navigation
identity are persisted and checked. AOS canvas `reacquirable` click and
set-value refs may route through the current canvas resolver. Native AX
`volatile` refs are inspection-only and explicitly report that no saved-action
no-foreground guarantee is made.

## Saved-Ref Action Grammar Matrix

| action | command form | backend(s) | resolution classes | required args | dry-run | mutation risk | validation / reacquisition | statuses | post-action evidence | known limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `click` | `aos do click ref:<snapshot-id>:<ref> --workspace <id>` | `aos_canvas`; browser | `reacquirable` for canvas, `snapshot_scoped` for browser | ref target; optional `--right`, `--double`, `--dwell` | yes | medium; pointer activation | load saved ref, require unambiguous scope, require supported action, resolve current canvas target; browser refs may run advisory xray validation but real browser mutation returns `REF_REVALIDATION_REQUIRED` | `dry_run`, `success`, `REF_STALE`, `REF_REVALIDATION_REQUIRED`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED` | canvas action response includes execution metadata and state id when available; browser dry-run includes advisory current validation | browser xray/ref matching is not durable page identity; native AX refs are not click-actionable and make no saved-action no-foreground guarantee |
| `set-value` | `aos do set-value ref:<snapshot-id>:<ref> --workspace <id> --value <value>` | `aos_canvas` | `reacquirable` | ref target plus `--value <value>` or positional value | yes | high; edits control state | load saved ref, require unambiguous scope, require producer `set-value`, resolve current canvas target, dispatch existing canvas semantic value action | `dry_run`, `success`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, direct canvas errors such as `TARGET_DISABLED` or `UNSUPPORTED_ACTION` | action response includes execution metadata and post-target state when current infrastructure can read it | only current single-value canvas controls with existing semantic value handling are supported |
| `fill` | `aos do fill ref:<snapshot-id>:<ref> <text> --workspace <id>` | browser | `snapshot_scoped` | browser textbox/searchbox/combobox/input ref plus text | yes | high; edits browser field state | load saved ref, require unambiguous scope, require supported action, run advisory current browser xray validation, then return `REF_REVALIDATION_REQUIRED` for real mutation | `dry_run`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG` | dry-run includes advisory current validation; no real browser fill dispatch occurs through saved refs in v0 | validation does not prove semantic intent after navigation or DOM replacement; stale, missing, ambiguous, disabled, or changed targets fail closed |
| `hover` | `aos do hover ref:<snapshot-id>:<ref> --workspace <id>` | browser | `snapshot_scoped` | ref target | yes | low-to-medium; can reveal hover state | load saved ref, require unambiguous scope, require supported action, run advisory current browser xray validation, then return `REF_REVALIDATION_REQUIRED` for real mutation | `dry_run`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED` | dry-run includes advisory current validation; no real browser hover dispatch occurs through saved refs in v0 | validation is xray/ref based and fails closed after navigation, DOM replacement, disabled targets, or role/title/label/context drift |
| `scroll` | `aos do scroll ref:<snapshot-id>:<ref> <dx,dy> --workspace <id>` | browser | `snapshot_scoped` | ref target plus `dx,dy` delta | yes | medium; can change viewport/state | load saved ref, require unambiguous scope, require supported action, run advisory current browser xray validation, then return `REF_REVALIDATION_REQUIRED` for real mutation | `dry_run`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `INVALID_ARG` | dry-run includes advisory current validation; no real browser scroll dispatch occurs through saved refs in v0 | browser scroll direct adapter semantics are not durable saved-ref identity |
| `drag` | `aos do drag ref:<snapshot-id>:<from-ref> ref:<snapshot-id>:<to-ref> --workspace <id>` | browser | `snapshot_scoped` | two browser refs from the same saved snapshot and browser session | yes | medium; can mutate page state through pointer drag | load both saved refs, require unambiguous scope, require both support `drag`, require same snapshot and browser session, run advisory xray validation for both endpoints, then return `REF_REVALIDATION_REQUIRED` for real mutation | `dry_run`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `INVALID_REF_TARGET` | dry-run includes primary and secondary current validation; no real browser drag dispatch occurs through saved refs in v0 | browser drag endpoint xray matching does not prove semantic intent after navigation or DOM replacement, and stale, missing, ambiguous, disabled, changed, cross-snapshot, or cross-session endpoints fail closed |
| `focus` | `aos do focus ref:<snapshot-id>:<ref> --workspace <id>` | none for saved refs in this slice | none | ref target | no supported mutation | high; can redirect keyboard input | fail closed before AX fallback or label-based targeting | `REF_UNSUPPORTED` or `ACTION_INCOMPATIBLE` | recommended next command is a fresh saved capture | direct `aos do focus --pid ... --role ...` remains AX-only; canvas focus needs a separate public command contract before saved refs can use it; native AX saved refs remain inspection-only until durable identity and no-foreground validation exist |
| `press` / `open` / `toggle` | `aos do press ref:<snapshot-id>:<ref> --workspace <id>` where a top-level command exists; no public `do open` or `do toggle` saved-ref command exists | none for saved refs in this slice | none | ref target | no supported mutation | high; activation aliases can hide product semantics | fail closed unless a future command defines a backend-owned semantic action | `REF_UNSUPPORTED` or `ACTION_INCOMPATIBLE` | recommended next command is a fresh saved capture or an owner-specific direct command | do not silently map same-label `open` or `toggle` facts to click |
| `type`, `key` | command-specific `aos do ... ref:<...>` | none for saved refs in this slice, except future matrix entries | none | command-specific | no supported mutation | varies; can silently affect the wrong surface | fail closed through the saved-ref resolver when a ref target is supplied | `ACTION_INCOMPATIBLE` or `REF_UNSUPPORTED` | recommended next command is a fresh saved capture | browser `type`/`key` need a separate grammar decision because `ref:*` can be literal typed text in the native command surface |

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
