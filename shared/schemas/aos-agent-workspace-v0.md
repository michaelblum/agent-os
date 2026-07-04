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

## Workspace Selection

Workspace selection is command-scoped. For saved workspace reads and actions,
`--workspace <id>` wins; otherwise `AOS_AGENT_WORKSPACE` selects a workspace;
otherwise AOS uses `default`.

No daemon-held current workspace exists, and `aos see workspace use <id>` is not
a current command. `aos see workspaces` lists all local workspaces without
consulting `AOS_AGENT_WORKSPACE`; cleanup commands require explicit workspace
or snapshot ids. This avoids hidden global state across parallel agents. Any
future session-bound default must define a multi-agent-safe contract before it
becomes public.

## Wait And Assertion Boundary

Current wait/assertion boundary: saved workspaces do not expose
`aos see capture --wait-for-change`, `aos see capture --until-stable`,
or `aos see assert`.

Use structured `recommended_next` descriptors and `recommended_next_command`
plus a fresh saved capture for re-perception. Use
`aos see refs --diff <from>..<to>` only for compact saved-ref comparison between
two existing snapshots. `--expect change|no-change` makes that compact diff a
machine-checkable gate with `REF_DIFF_EXPECTATION_FAILED` on mismatch;
`--expect-ref <ref>=added|removed|changed|unchanged|present|missing` gates one
saved ref inside the same compact diff and can be repeated. A single ref gate
reports `diff.ref_expectation`; multiple ref gates report
`diff.ref_expectations[]`. These expectations are still not a wait loop or full
assertion engine. Use
`aos show wait` only for canvas readiness, Recipe assertions only for command
JSON checks, and Work Record postconditions for durable evidence checks. Future
saved wait/assert commands need manifest help, parser, schema/doc, and drift
tests before public use.

`capture.json` intentionally preserves the primitive output shape. The workspace
schema validates the saved workspace files around that payload, not every
primitive capture field.

## Capture Source

Saved capture uses the same source contract as ordinary capture: a positional
target such as `browser:work`, a source flag such as `--region <rect>`,
`--canvas <id>`, or `--channel <id>`, or the default `main` target when no
source is supplied. Positional target and source-flag forms are mutually
exclusive. New saved captures persist a compact `capture_source` object with
`kind`, `argv`, and `display`; `argv` is the reconstructable source argument
vector used by post-action refresh recommendations. Older v0 records without
`capture_source` fall back to `capture_target`.

## Capture Modes

`aos see capture --save` supports these explicit modes:

- `ax`: tree-oriented capture. Browser targets use xray refs; non-browser
  targets currently use the native capture path and report native limits.
- `vision`: screenshot-oriented capture. Image/base64 data is saved under
  `artifacts/` and represented in compact output by artifact refs.
- `som`: screen-object mode. This slice uses xray-backed refs where available
  and records the same limits as the originating backend.

Compact stdout includes `capture_mode`, `capture_source`, `capture_target`,
`runtime_mode`, `state_id`, counts, artifact refs, compact refs, omitted heavy
payload classes, and known limits. It must not include full `elements`,
`semantic_targets`, `perceptions`, or base64 payloads.

`aos see snapshots` and workspace `index_health.current_snapshot` expose compact
snapshot discovery fields: `snapshot_id`, `created_at`, `capture_mode`,
`capture_source`, `capture_target`, `target`, `query`, ref/artifact counts, and
file paths. These readbacks are enough to choose a saved snapshot or recover the
saved source/query without opening `capture.json` or other heavy payload files.
Each committed `snapshot.json` record stores `query` as a nullable field, and
the workspace index derives its compact query readback from that durable record.

## Ref Grammar

Saved refs are scoped to a snapshot.

```text
ref:<snapshot-id>:<ref-id>
ref:<ref-id>
```

The scoped form is always preferred. The bare form resolves only when exactly
one saved snapshot in the workspace contains that ref id. Multiple matches fail
with `REF_AMBIGUOUS` and candidate snapshot refs plus safe next commands;
missing refs fail with `REF_NOT_FOUND` and a safe `aos see refs ... --json`
inspection command. Neither resolver failure requires user approval because no
mutation is attempted.

## Resolution Classes

Each saved ref records:

- `backend`: `aos_canvas`, `browser`, or `native_ax`.
- `resolution_class`: `reacquirable`, `snapshot_scoped`, `volatile`,
  `coordinate_fallback`, `stable`, or `unsupported`.
- `confidence`: `high`, `medium`, or `low`.
- `ref_scope`, `workspace_id`, `snapshot_id`, `capture_source`, `capture_target`,
  `capture_mode`, `supported_actions`, `warnings`, `known_limits`,
  `identity_facts`, `hint_facts`, `current_address`, `artifact_refs`, and
  `conformance`.
  `identity_facts.state_id`, `identity_facts.source_ref`, `action_target`, and
  `current_address.action_target` are required even when their value is `null`
  for an unsupported or inspection-only ref. Compact summaries from
  `aos see capture --save`, `aos see refs`, saved-ref action envelopes, and
  ambiguous-ref errors expose the same lightweight model-facing fields while
  heavy payloads stay file-backed. Compact capture and refs readbacks include
  `recommended_next` descriptors with reconstructable `argv` plus legacy
  `recommended_next_commands` strings so agents can continue the
  capture/refs/dry-run loop without parsing shell text.

Mutation is fail-closed. Saved-ref actions are the intersection of producer
actions, backend durability, confidence, and existing `aos do` command behavior.
Refs with `confidence: low` are readback-only for saved-ref mutation and fail
closed with `REF_UNSUPPORTED` and `reason: low_confidence_target` before dry-run
validation or dispatch. Browser `snapshot_scoped` `click`, `fill`, `hover`,
`scroll`, `drag`, `type`, and `key` refs run fresh xray plus page, frame,
navigation, role, title, label, context, and enabled-state validation before
real dispatch through the underlying `browser:<session>/<ref>` target.
Text-compatible `type` and `key` refs use the same current-target validation as
browser `fill`. Current-target `bounds` are
returned in the validation payload as evidence; bounds movement alone is
tolerated when the saved page/frame/navigation and element identity facts still
validate. Dry-run reports `reacquired` when that validation is sufficient for
real dispatch. AOS canvas `reacquirable` click and set-value refs may route
through the current canvas resolver. Native AX
`volatile` refs are inspection-only and explicitly report that no saved-action
no-foreground guarantee is made.

`conformance` is the structured proof and safety summary for a saved ref. It
records `actionability`, `mutation`, `validation`, `proof_level`, a
`proof` object, a `no_foreground` object, and `target_uncertainty`. The
`proof` object records `level`, `status`, deterministic test `evidence`, and
approval-only `approval_gates`. Browser and AOS canvas supported refs report
`deterministic_contract_tests_passed`; native AX refs report
`approval_gated_live_proof_not_run` with gates such as HITL live smoke,
TCC/manual runtime flow, native repo-mode artifact rebuild, and explicit
no-foreground/focus/cursor/Space baseline verification. The uncertainty block
records `status`, human-readable `reasons`, `missing_identity_facts`, and
`available_identity_facts` so an agent can see why a ref is or is not safe to
mutate before trying an action. For native AX refs in this V0 slice,
`conformance.no_foreground.claim` is `not_claimed`; focus, cursor, and Space
preservation are `unverified`; permission state is the captured native
permission value when present, otherwise `unknown`; and fallback flags are false
for volatile native refs because they do not attempt saved-ref mutation. Browser and
AOS canvas refs use `not_applicable` for native no-foreground fields and state
their deterministic contract-test proof level when mutation is supported after
validation or current resolution. Native AX refs report
`target_uncertainty.status` as `blocked_missing_native_identity` until saved
captures include enough durable current-target facts such as app PID, window id,
an actual AX identifier, enabled state, action names, permission state, and a
captured baseline for focus, cursor, and Space state, plus an actionable
`native_saved_ref_evidence` producer verdict.
Native AX `identity_facts` still preserve the strongest available captured
facts as inspection hints, including `role`, `title`, `label`, `value`,
`enabled`, `focused`, `bounds`, `context_path`, `app_pid`, `app_name`, `window_id`,
`ax_identifier_or_stable_path`, `action_names`, `permission_state`, `app_hint`,
and `window_hint`, and those fields may appear in `available_identity_facts`;
they do not satisfy the durable identity prerequisites by themselves when the
focus/cursor/Space baseline or producer verdict is missing.
The machine-readable missing-fact identifiers are `app_pid`, `window_id`,
`ax_identifier`, `enabled`, `action_names`,
`permission_state`, `focus_cursor_space_baseline`, and
`native_saved_ref_evidence`; `enabled` is unsatisfied unless the captured value
is `true`, `permission_state` is unsatisfied unless the captured value is
`granted`, and `native_saved_ref_evidence` is unsatisfied unless the producer
marks it actionable with complete known-limit facts.

## Backend Conformance Levels

| backend/path | supported saved-ref surface | conformance level | proof status | evidence or gate |
| --- | --- | --- | --- | --- |
| `aos_canvas` | `reacquirable` `click` and `set-value` | `deterministic_contract_tests` | `deterministic_contract_tests_passed` | `tests/agent-workspace-canvas-refs.sh` and `tests/agent-workspace-saved-ref.sh` |
| `browser` | `snapshot_scoped` `click`, `fill`, `hover`, `scroll`, `drag`, `type`, and `key` | `deterministic_contract_tests` | `deterministic_contract_tests_passed` | `tests/agent-workspace-browser-refs.sh` and `tests/agent-workspace-saved-ref.sh` |
| `native_ax` stable saved refs | durable-identity plus producer-verdict `press`, `focus`, and `set-value` | `native_saved_ref_contract_tests_plus_approval_gates` | `live_dispatch_proven_no_foreground_not_claimed` | `tests/agent-workspace-native-refs.sh` and `tests/manual/native-ax-saved-ref-live-proof.sh` and `docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md` |
| direct AX one-shot wrappers | `--pid` / `--role` `press`, `focus`, and `set-value` | `native_primitive_response_plus_wrapper_contract` | `live_dispatch_proven_no_foreground_not_claimed` | `tests/agent-workspace-native-refs.sh` and `tests/manual/native-ax-saved-ref-live-proof.sh` and `docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md` |
| `native_ax` volatile or known-limit refs | inspection/readback only | `known_limit_contract` | `approval_gated_live_proof_not_run` | known-limit assertions in `tests/agent-workspace-native-refs.sh` plus HITL live smoke, TCC/manual runtime flow, native repo-mode artifact rebuild, explicit no-foreground/focus/cursor/Space baseline verification |
| `coordinate_fallback` | diagnostic/fallback-only refs | `known_limit_contract` | `known_limit_refusal_tested` | refused-before-dispatch assertions in `tests/agent-workspace-browser-refs.sh` and `tests/agent-workspace-canvas-refs.sh` and `tests/agent-workspace-native-refs.sh` |

Non-dry-run saved-ref mutations return a saved-ref execution envelope rather
than raw adapter output. The envelope includes the resolved command,
`current_validation` when a backend performs current-target validation,
`underlying_result` for the adapter response, `post_action`,
`post_action.recommended_next` for a structured fresh-capture descriptor, and
`recommended_next_command` when a fresh saved capture is the safe next
verification step. `resolved_action.saved_state_id` preserves saved provenance
from the original ref, while `resolved_action.validation_state_id` names the
fresh validation capture when reacquisition runs. Browser saved-ref dispatch
passes the validation state to the underlying browser action after reacquiring
the target instead of reusing stale saved provenance as current state. After a
dry-run returns a safe status such as `reacquired`, `resolved`, or
`direct_ax_ready`, dispatch by rerunning the exact saved-ref command without
`--dry-run`; do not remove `--dry-run` for validation-required, blocked,
unsupported, or low-confidence refs. Refresh
recommendations point back to the originating capture source and mode:

```bash
aos see capture <capture_source...> --save --workspace <workspace> --mode <capture_mode>
```

When the originating saved capture stored a query, the recommendation carries
that query as `--query <query>`.

V0 is a foundation slice, not completion of the full native driver posture.
Native AX saved refs without the required durable facts remain `volatile`, have
no supported saved-ref actions, and must not claim no-foreground saved-action
conformance. A native AX ref may become `stable` only when the saved capture
already supplies `app_pid`, `window_id`, `ax_identifier`,
`enabled: true`, `action_names`, `permission_state: granted`, and
`focus_cursor_space_baseline` as a captured baseline, plus
`native_saved_ref_evidence` as an actionable verdict. The Swift producer emits
native known-limit facts for visible native AX captures, including concrete
off-Space, minimized-window, custom-control, canvas/game-surface, and
focus-mismatch signals. Without that complete known-limit evidence, or when
those facts contain a blocker, saved refs remain `volatile`. Stable native refs support
only explicit `press`, `focus`, and `set-value` actions declared by the capture;
dispatch converts the saved facts to the existing direct AX selector flags and
reports `direct_ax_ready` / `requires_direct_ax_current_matching`.
`stable_path` and the derived `ax_identifier_or_stable_path` field are preserved
as inspection/readback evidence, but v0 direct AX saved-ref dispatch requires a
real `ax_identifier` because the current native selector surface matches
`--identifier` against AXIdentifier.
If those durable identity facts are present but the captured native
`action_names` do not map to v0 `press`, `focus`, or `set-value`, the ref
remains `volatile` with `validation: native_action_matrix_unsupported`,
`target_uncertainty.status: blocked_unsupported_native_action`, and no missing
identity facts. That is an explicit unsupported-action state, not a
missing-identity state.
If those durable identity facts are present but the capture reports an
off-Space window, minimized window, custom control, canvas/game surface, or
focus mismatch, the ref remains `volatile` with
`validation: native_known_limit_blocked` and
`target_uncertainty.status: blocked_native_known_limit`. These captured native
known-limit signals are preserved as `identity_facts` such as `space_state`,
`off_space`, `window_state`, `minimized`, `control_kind`, `custom_control`,
`surface_kind`, `canvas_surface`, `focus_state`, and
`focus_cursor_space_baseline.focus`; they block saved-ref mutation until a
backend-owned validation path and approval-gated live proof can defend them.
Stable native refs report `live_dispatch_proven_no_foreground_not_claimed` for
live dispatch proof, while still reporting `not_claimed` no-foreground safety.
Volatile and known-limit native refs remain `approval_gated_live_proof_not_run`.
Stable native saved-ref dispatch preserves `fallback_used` and
`foreground_fallback_required` from the direct AX wrapper inside
`underlying_result.conformance.no_foreground`; fallback success remains
foreground fallback evidence, not no-foreground proof.
Native `focus` and `set-value` direct wrapper responses include post-action AX
readback fields such as `execution.ax_focused_after`,
`execution.ax_value_after`, and `execution.ax_value_matches_request` when the
primitive can read the resulting state.
Direct AX one-shot actions such as `aos do press --pid ...`, `aos do focus
--pid ... --role ...`, and `aos do set-value --pid ... --role ... --value ...`
attach the same no-foreground object shape. Those responses report
`direct_ax_current_matching` with `direct_ax_current_matching_semantics`,
`not_claimed` no-foreground safety,
`live_dispatch_proven_no_foreground_not_claimed`, and current pid/role/filter
matching rather than browser-style current validation.
If the underlying native payload reports `fallback_used` or
`foreground_fallback_required`, the wrapper preserves those flags in
`conformance.no_foreground` and still keeps `claim: not_claimed`; fallback
success is not no-foreground proof.
Their `target_uncertainty.missing_identity_facts` keeps saved-ref-only gaps such
as `enabled`, `action_names`, `permission_state`, and
`focus_cursor_space_baseline`, and `native_saved_ref_evidence` explicit when the
direct call did not prove them.
`coordinate_fallback` is reserved for diagnostic/fallback-only refs. Normal V0
saved capture generation must not emit coordinate fallback refs, and saved-ref
mutation must warn or refuse before dispatching any coordinate-backed action.

## Saved-Ref Action Grammar Matrix

The `press` and `focus` examples require stable `native_ax` refs with durable
native identity facts and an actionable producer verdict; browser and AOS canvas
refs fail closed for those actions.

| action | command form | backend(s) | resolution classes | required args | dry-run | mutation risk | validation / reacquisition | statuses | post-action evidence | known limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `click` | `aos do click ref:<snapshot-id>:<ref> --workspace <id>` | `aos_canvas`; browser | `reacquirable` for canvas, `snapshot_scoped` for browser | ref target; optional `--right`, `--double`; `aos_canvas` also accepts `--dwell` | yes | medium; pointer activation | load saved ref, require unambiguous scope, require supported action, resolve current canvas target; browser refs require page/frame/navigation identity and exactly one enabled matching current xray element before dispatch | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_STALE`, `REF_REVALIDATION_REQUIRED`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | real dispatch returns a saved-ref execution envelope with adapter output nested under `underlying_result` and a fresh-capture `recommended_next_command` | browser validation fails closed on page, frame, navigation, role, title, label, context, enabled-state, or uniqueness drift; native AX refs are not click-actionable and make no saved-action no-foreground guarantee |
| `set-value` | `aos do set-value ref:<snapshot-id>:<ref> --workspace <id> --value <value>` | `aos_canvas`; `native_ax` | `reacquirable` for canvas, `stable` for native AX | ref target plus `--value <value>` or positional value | yes | high; edits control state | canvas refs resolve current canvas target; stable native AX refs convert durable saved native facts plus an actionable producer verdict to direct AX selector flags and rely on direct AX current matching semantics | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `MISSING_ARG`, `INVALID_ARG`, `UNKNOWN_ARG`, `UNKNOWN_FLAG`, direct canvas errors such as `TARGET_DISABLED` or `UNSUPPORTED_ACTION`, direct AX errors such as `AX_TARGET_NOT_FOUND` | real dispatch returns a saved-ref execution envelope with adapter output nested under `underlying_result`, including `execution.ax_value_after` and `execution.ax_value_matches_request` when readable, plus a fresh-capture `recommended_next_command` | native AX support requires `app_pid`, `window_id`, `ax_identifier`, enabled state, `action_names`, granted permission state, a focus/cursor/Space baseline, and actionable `native_saved_ref_evidence`; path-only stable evidence remains inspection-only until a native path selector exists; it still does not claim no-foreground proof |
| `fill` | `aos do fill ref:<snapshot-id>:<ref> <text> --workspace <id>` | browser | `snapshot_scoped` | browser textbox/searchbox/combobox/input ref plus text | yes | high; edits browser field state | load saved ref, require unambiguous scope, require supported action, validate page/frame/navigation identity, require exactly one enabled action-compatible current xray element, then dispatch `browser:<session>/<ref>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes current validation; real dispatch returns a saved-ref execution envelope with `current_validation`, `underlying_result`, and `recommended_next_command` | stale, missing, ambiguous, disabled, page/frame/navigation drift, or role/title/label/context drift fail closed |
| `hover` | `aos do hover ref:<snapshot-id>:<ref> --workspace <id>` | browser | `snapshot_scoped` | ref target | yes | low-to-medium; can reveal hover state | load saved ref, require unambiguous scope, require supported action, validate page/frame/navigation identity, require exactly one enabled action-compatible current xray element, then dispatch `browser:<session>/<ref>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes current validation; real dispatch returns a saved-ref execution envelope with `current_validation`, `underlying_result`, and `recommended_next_command` | stale, missing, ambiguous, disabled, page/frame/navigation drift, or role/title/label/context drift fail closed |
| `scroll` | `aos do scroll ref:<snapshot-id>:<ref> <dx,dy> --workspace <id>` | browser | `snapshot_scoped` | ref target plus `dx,dy` delta | yes | medium; can change viewport/state | load saved ref, require unambiguous scope, require supported action, validate page/frame/navigation identity, require exactly one enabled action-compatible current xray element, then dispatch `browser:<session>/<ref>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `INVALID_ARG`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes current validation; real dispatch returns a saved-ref execution envelope with `current_validation`, `underlying_result`, and `recommended_next_command` | stale, missing, ambiguous, disabled, page/frame/navigation drift, or role/title/label/context drift fail closed |
| `drag` | `aos do drag ref:<snapshot-id>:<from-ref> ref:<snapshot-id>:<to-ref> --workspace <id>` | browser | `snapshot_scoped` | two browser refs from the same saved snapshot and browser session | yes | medium; can mutate page state through pointer drag | load both saved refs, require unambiguous scope, require both support `drag`, require same snapshot and browser session, validate page/frame/navigation identity and exactly one enabled action-compatible current xray element for both endpoints, then dispatch `browser:<session>/<from>` to `browser:<session>/<to>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `INVALID_REF_TARGET`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes primary and secondary current validation; real dispatch returns a saved-ref execution envelope with primary and secondary validation plus `underlying_result` and `recommended_next_command` | stale, missing, ambiguous, disabled, changed, cross-snapshot, cross-session, or page/frame/navigation drift endpoints fail closed |
| `type` | `aos do type ref:<snapshot-id>:<ref> <text> --workspace <id>` | browser | `snapshot_scoped` | text-compatible browser ref plus text | yes | high; edits browser text state | load saved ref, require unambiguous scope, require supported action, validate page/frame/navigation identity, require exactly one enabled text-compatible current xray element, then dispatch `browser:<session>/<ref>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes current validation; real dispatch returns a saved-ref execution envelope with `current_validation`, `underlying_result`, and `recommended_next_command` | non-text refs remain `ACTION_INCOMPATIBLE`; stale, missing, ambiguous, disabled, page/frame/navigation drift, or role/title/label/context drift fail closed |
| `key` | `aos do key ref:<snapshot-id>:<ref> <combo> --workspace <id>` | browser | `snapshot_scoped` | text-compatible browser ref plus key combo | yes | high; can trigger focused browser behavior | load saved ref, require unambiguous scope, require supported action, validate page/frame/navigation identity, require exactly one enabled text-compatible current xray element, then dispatch `browser:<session>/<ref>` | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_REVALIDATION_REQUIRED`, `REF_STALE`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `REF_REVALIDATION_FAILED`, `MISSING_ARG`, `UNKNOWN_ARG`, `UNKNOWN_FLAG` | dry-run includes current validation; real dispatch returns a saved-ref execution envelope with `current_validation`, `underlying_result`, and `recommended_next_command` | non-text refs remain `ACTION_INCOMPATIBLE`; stale, missing, ambiguous, disabled, page/frame/navigation drift, or role/title/label/context drift fail closed |
| `focus` | `aos do focus ref:<snapshot-id>:<ref> --workspace <id>` | `native_ax` | `stable` | ref target | yes | high; can redirect keyboard input | stable native AX refs convert durable saved native facts plus an actionable producer verdict to direct AX selector flags and rely on direct AX current matching semantics | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `UNKNOWN_ARG`, `UNKNOWN_FLAG`, direct AX errors such as `AX_TARGET_NOT_FOUND` | real dispatch returns a saved-ref execution envelope with `underlying_result.execution.ax_focused_after` when readable and a fresh-capture `recommended_next_command` | only refs with the full durable native identity contract and actionable producer verdict support focus; no saved-ref no-foreground proof is claimed |
| `press` / `open` / `toggle` | `aos do press ref:<snapshot-id>:<ref> --workspace <id>` where a top-level command exists; no public `do open` or `do toggle` saved-ref command exists | `native_ax` for `press` only | `stable` | ref target | yes for `press` | high; activation aliases can hide product semantics | stable native AX `press` refs convert durable saved native facts plus an actionable producer verdict to direct AX selector flags and rely on direct AX current matching semantics; `open` and `toggle` remain unsupported aliases | `dry_run`, `success`, `REF_NOT_FOUND`, `REF_UNSUPPORTED`, `ACTION_INCOMPATIBLE`, `REF_AMBIGUOUS`, `UNKNOWN_ARG`, `UNKNOWN_FLAG`, direct AX errors such as `AX_TARGET_NOT_FOUND` | real dispatch returns a saved-ref execution envelope with `underlying_result` and a fresh-capture `recommended_next_command` | do not silently map same-label `open` or `toggle` facts to click; native AX press still does not claim no-foreground proof |

Browser current-xray validation failure payloads include machine-readable
`reason` values. When the saved browser source ref is missing from the current
xray, the reason is `current_target_not_found`; when the current xray has more
than one matching source ref, the reason is `current_target_ambiguous`.

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
