---
name: aos-agent-workspace
description: Use saved AOS perception workspaces and compact refs for agent UI work. Trigger when a task needs repeated observe-act loops, saved `aos see capture --save` snapshots, `aos see snapshots`, `aos see refs`, or `aos do ... ref:<snapshot-id>:<ref>` actions without carrying full screenshots or AX/browser payloads in context.
---

# AOS Agent Workspace

Use this skill when an agent needs durable local perception state for normal
AOS verbs. The goal is a compact, inspectable loop:

```bash
aos see capture browser:work --save --mode som --workspace default
aos see snapshots --workspace default --json
aos see refs --workspace default --query Save --json
aos do click ref:<snapshot-id>:r2 --workspace default --dry-run
aos do click ref:<snapshot-id>:r2 --workspace default
aos see capture <capture_source> --save --mode <capture_mode> --workspace default
aos see capture --canvas surface-inspector --save --mode som --workspace default
aos do set-value ref:<snapshot-id>:r3 --workspace default --value "42" --dry-run
aos do fill ref:<snapshot-id>:r4 "updated text" --workspace default --dry-run
aos do type ref:<snapshot-id>:r4 "more text" --workspace default --dry-run
aos do key ref:<snapshot-id>:r4 "Enter" --workspace default --dry-run
aos do hover ref:<snapshot-id>:r5 --workspace default --dry-run
aos do scroll ref:<snapshot-id>:r5 0,-200 --workspace default --dry-run
aos do drag ref:<snapshot-id>:r5 ref:<snapshot-id>:r6 --workspace default --dry-run
aos do press ref:<snapshot-id>:r7 --workspace default --dry-run
aos do focus ref:<snapshot-id>:r7 --workspace default --dry-run
```

The `press` and `focus` examples require stable `native_ax` refs with durable
native identity facts and an actionable producer verdict; browser and AOS canvas
refs fail closed for those actions.

## Fresh-Agent Quickstart

If you only have a shell and this skill, discover the command shape first, then
run the saved observe-act-verify loop:

```bash
aos help see --json
aos help do --json
aos see capture browser:work --save --mode som --workspace default
aos see snapshots --workspace default --json
aos see refs --workspace default --query Save --json
aos see refs --workspace default --snapshot <snapshot-id> --json
aos do click ref:<snapshot-id>:<ref-id> --workspace default --dry-run
aos do click ref:<snapshot-id>:<ref-id> --workspace default
aos see capture browser:work --save --mode som --workspace default --name after-action
```

Use `aos see refs` output and action responses as the compact model-facing
payload. Do not load screenshots, base64, full AX trees, browser element dumps,
or canvas semantic target arrays into model context unless a compact ref,
summary, path, or `recommended_next_command` is insufficient. When an action is
unsupported, blocked, stale, ambiguous, or validation-required, stop and follow
the returned `recommended_next`, `recommended_next_commands`, or
`recommended_next_command`; do not guess a coordinate workaround.

## Contract

- Use `aos see capture --save` to persist perception into the active runtime
  mode state root: `${AOS_STATE_ROOT:-~/.config/aos}/{repo|installed}/agent-workspaces/`.
  Read `workspace_id`, `snapshot_id`, `capture_target`, `capture_source`,
  `query`, `paths`, `refs[]`, `known_limits`, `recommended_next`, and
  `recommended_next_commands`.
- A saved capture source can be a positional target such as `browser:work` or a
  source flag such as `--region <rect>`, `--canvas <id>`, or `--channel <id>`.
  These source forms are mutually exclusive. If no positional target or source
  flag is supplied, capture defaults to `main`. New saved captures persist
  compact `capture_source.argv` so refresh recommendations reuse the original
  positional or source-flag scope. `--save` is the state mutation boundary.
- Workspace selection is command-scoped: `--workspace <id>` overrides
  `AOS_AGENT_WORKSPACE`; absent both, AOS uses `default`. No daemon-held current
  workspace exists, and `aos see workspace use <id>` is not a current command.
  Keep parallel agents isolated by passing explicit workspaces or setting the
  environment per process.
- Current wait/assertion boundary: saved workspaces do not expose
  `aos see capture --wait-for-change`, `aos see capture --until-stable`,
  or `aos see assert`. Use structured `recommended_next` descriptors and
  `recommended_next_command` plus a fresh saved capture for re-perception. Use
  `aos see refs --diff <from>..<to>` only for compact saved-ref comparison
  between two existing snapshots. `--expect change|no-change` gates the whole
  compact diff, and repeatable
  `--expect-ref <ref>=added|removed|changed|unchanged|present|missing` gates
  saved refs inside the diff. Neither is a wait loop or full assertion engine.
  Use `aos show wait` only for canvas readiness, Recipe assertions only for
  command JSON checks, and Work Record postconditions for durable evidence
  checks.
- Prefer scoped refs: `ref:<snapshot-id>:<ref-id>`.
- Use bare `ref:<ref-id>` only when one snapshot in the workspace contains that
  ref. `aos see refs` returns structured `recommended_next` descriptors and
  `recommended_next_commands` for scoped dry-runs. If a saved-ref command
  returns `REF_AMBIGUOUS`, use its candidate snapshots and
  `recommended_next_commands` to choose a scoped ref. If it returns
  `REF_NOT_FOUND`, run the returned refs inspection command before retrying.
- Treat compact stdout as the model-facing payload. Full capture JSON,
  screenshots, base64, AX trees, browser elements, and semantic target arrays
  stay file-backed under the snapshot directory.
- Use `aos see snapshots --workspace <id> --json` to choose prior snapshots.
  Snapshot entries include compact `capture_source`, `capture_target`, `target`,
  and saved `query` fields so you do not need to open heavy capture payloads
  just to recover the saved scope.
- Use `aos see refs --workspace <id> --diff <from>..<to> --json` for compact
  ref-level snapshot comparison after a verification capture. Add
  `--expect change|no-change` when a recipe or shell should fail with
  `REF_DIFF_EXPECTATION_FAILED` on whole-diff mismatch. Repeat
  `--expect-ref <ref>=changed` or another ref state when postconditions are
  about specific handles. Treat these as saved-ref diff gates, not complete
  visual assertions.
- The saved file contract is `aos.agent-workspace.v0`; see
  `shared/schemas/aos-agent-workspace-v0.md`.
- Workspace write locks are transient local control state. If a mutation returns
  `AGENT_WORKSPACE_LOCKED`, refresh or retry after the other local writer exits.

## Capture Modes

- `--mode ax`: use when you need tree/ref facts. Browser targets use xray refs;
  non-browser native AX refs are inspection-first unless the capture includes
  the full durable native identity facts and actionable producer verdict needed
  for a stable direct AX saved ref.
- `--mode vision`: use when image inspection matters. Screenshots/base64 are
  stored as artifacts and summarized by path.
- `--mode som`: use for general screen-object loops. It uses xray-backed refs
  where available.

Always read the returned `backend`, `resolution_class`, `confidence`,
`capture_target`, `capture_mode`, `identity_facts`, `hint_facts`,
`current_address`, `artifact_refs`, `conformance`, `warnings`, and
`known_limits` before acting. `conformance` records the saved ref's
`actionability`, `mutation`, `validation`, `proof_level`, `proof`, and
`no_foreground` claim fields. Read `conformance.proof.status` and
`conformance.target_uncertainty` before mutating; they name what evidence exists,
what approval gates remain, and why a ref needs current validation, current
resolution, or is blocked.
Treat `confidence: low` refs as readback-only for saved-ref mutation. Saved-ref
actions fail closed with `REF_UNSUPPORTED` and
`reason: low_confidence_target` before dry-run validation or dispatch.

Backend proof quick read:

- `aos_canvas` uses `deterministic_contract_tests` /
  `deterministic_contract_tests_passed`.
- `browser` uses `deterministic_contract_tests` /
  `deterministic_contract_tests_passed`.
- Stable `native_ax` saved refs use
  `native_saved_ref_contract_tests_plus_approval_gates`
  / `approval_gated_live_proof_not_run`.
- Direct AX one-shot wrappers use
  `native_primitive_response_plus_wrapper_contract`
  / `approval_gated_live_proof_not_run`.
- `coordinate_fallback` uses `known_limit_contract` /
  `known_limit_refusal_tested`, with
  `tests/agent-workspace-browser-refs.sh`,
  `tests/agent-workspace-canvas-refs.sh`, and
  `tests/agent-workspace-native-refs.sh` refusing dispatch before mutation.

## Acting On Refs

Start with dry-run:

```bash
aos do click ref:<snapshot-id>:r2 --workspace default --dry-run
```

Dry-run reports the resolved underlying command and whether validation is
required. After a dry-run returns a safe status such as `reacquired`,
`resolved`, or `direct_ax_ready`, dispatch by rerunning the exact saved-ref
command without `--dry-run`; do not remove `--dry-run` for validation-required,
blocked, unsupported, or low-confidence refs. Saved refs use a backend action
matrix:

- AOS canvas `reacquirable` refs may route `click` and `set-value` through the
  current canvas resolver. Supported canvas refs report
  `conformance.proof.status: deterministic_contract_tests_passed`.
- Saved AOS canvas `drag` is not supported in the saved-ref action matrix.
  Direct current-host canvas drag uses `canvas:<canvas-id>/<ref>` with `--by`
  or `--to-value`; do not turn a saved canvas ref into a saved drag target.
- Browser `snapshot_scoped` click, fill, hover, scroll, and drag refs use fresh
  xray plus page, frame, navigation, role, title, label, context, and
  enabled-state validation. `current_validation.current_target` includes current
  bounds when xray provides them; bounds movement alone is tolerated when saved
  page/frame/navigation and element identity facts still validate. Dry-run
  reports `reacquired` when validation is sufficient for real dispatch.
  Non-dry-run routes through the underlying `browser:<session>/<ref>` target
  only after validation passes, then returns a saved-ref execution envelope with
  `current_validation`, `underlying_result`, `post_action`, and
  `post_action.recommended_next` plus `recommended_next_command`. Drag
  validates both endpoints and requires the same saved snapshot and browser
  session. Missing, stale, ambiguous, disabled, unsupported, or changed current
  targets fail closed with
  `REF_NOT_FOUND`, `REF_STALE`, `REF_AMBIGUOUS`, `REF_UNSUPPORTED`, or
  `ACTION_INCOMPATIBLE`. Supported browser refs report `conformance.proof.status:
  deterministic_contract_tests_passed`.
- Saved-ref grammar rejects missing, invalid, extra, or unknown action arguments
  and flags before mutation with `MISSING_ARG`, `INVALID_ARG`, `UNKNOWN_ARG`, or
  `UNKNOWN_FLAG`.
- Native AX `volatile` refs are inspection-only and report known limits instead
  of claiming no-foreground saved-action safety. This V0 foundation is not
  completion of the full native saved-ref proof or native no-foreground
  conformance.
  Expect `conformance.no_foreground.claim` to be `not_claimed`; focus, cursor,
  and Space preservation to be `unverified`; permission state to be the captured
  native permission value when present, otherwise `unknown`; and fallback flags
  to be false because volatile native refs do not attempt saved-ref mutation.
  Expect
  `conformance.target_uncertainty.status` to be
  `blocked_missing_native_identity` until saved capture records enough durable
  facts, including app PID, window id, an actual AX identifier, enabled
  state, action names, permission state, a captured baseline for focus, cursor,
  and Space state, and an actionable `native_saved_ref_evidence` producer
  verdict. The
  `identity_facts` still preserve the strongest available captured native hints
  such as `role`, `title`, `label`, `value`, `enabled`, `bounds`,
  `context_path`, `app_pid`, `app_name`, `window_id`,
  `ax_identifier_or_stable_path`, `action_names`, `permission_state`,
  `app_hint`, and `window_hint`; treat those as inspection evidence, not durable
  saved-ref identity when the focus/cursor/Space baseline or producer verdict is
  missing. The
  machine-readable missing facts are `app_pid`, `window_id`,
  `ax_identifier`, `enabled`, `action_names`,
  `permission_state`, `focus_cursor_space_baseline`, and
  `native_saved_ref_evidence`; `enabled` is unsatisfied unless the captured value
  is `true`, `permission_state` is unsatisfied unless the captured value is
  `granted`, and `native_saved_ref_evidence` is unsatisfied unless the producer
  marks it actionable with complete known-limit facts. Native AX refs report
  `conformance.proof.status: approval_gated_live_proof_not_run`; do not count
  native saved-ref proof complete until the proof `approval_gates` are run.
- Native AX `stable` refs are actionable only when the saved capture already
  includes the full durable identity contract: `app_pid`, `window_id`,
  `ax_identifier`, `enabled: true`, `action_names`,
  `permission_state: granted`, `focus_cursor_space_baseline` as a captured
  baseline, and `native_saved_ref_evidence` as an actionable verdict. The
  current Swift producer emits an inspection-only verdict until it can prove
  complete known-limit facts, so live native captures remain `volatile` unless a
  native producer explicitly emits an actionable verdict. Stable refs support
  only capture-declared `press`, `focus`, and `set-value`, convert saved facts to
  direct AX selector flags, and report `direct_ax_ready` plus
  `requires_direct_ax_current_matching`. Treat their `underlying_result` as a
  direct AX wrapper response, not as browser-style current validation. They
  still report `not_claimed` no-foreground safety and
  `approval_gated_live_proof_not_run`.
  Stable native saved-ref dispatch preserves `fallback_used` and
  `foreground_fallback_required` from the direct AX wrapper inside
  `underlying_result.conformance.no_foreground`; fallback success remains
  foreground fallback evidence, not no-foreground proof.
  Path-only `stable_path` evidence remains inspection/readback evidence in v0
  and does not make a native saved ref stable without an actual AX identifier.
  If durable native identity facts are present but captured native
  `action_names` do not map to v0 `press`, `focus`, or `set-value`, expect
  `native_action_matrix_unsupported`,
  `blocked_unsupported_native_action`, no missing identity facts, and no
  saved-ref mutation.
  If durable native identity facts are present but captured state names an
  off-Space window, minimized window, custom control, canvas/game surface, or
  focus mismatch, expect `native_known_limit_blocked`,
  `blocked_native_known_limit`, no saved-ref mutation, and preserved
  `identity_facts` such as `space_state`, `off_space`, `window_state`,
  `minimized`, `control_kind`, `custom_control`, `surface_kind`,
  `canvas_surface`, `focus_state`, or `focus_cursor_space_baseline.focus`.
- Direct AX actions such as `aos do press --pid ...`, `aos do focus --pid ...
  --role ...`, and `aos do set-value --pid ... --role ... --value ...` include
  wrapper-added `conformance` with `direct_ax_current_matching`,
  `direct_ax_current_matching_semantics`, `not_claimed` no-foreground safety,
  `approval_gated_live_proof_not_run`, and current pid/role/filter matching
  limits. If the underlying result reports `fallback_used` or
  `foreground_fallback_required`, those flags remain visible in
  `conformance.no_foreground`; a foreground fallback success is not
  no-foreground proof. Treat saved-ref-only gaps in `missing_identity_facts`,
  including `enabled`, `action_names`, `permission_state`, and
  `focus_cursor_space_baseline`, and `native_saved_ref_evidence`, as explicit
  uncertainty rather than proof.
- `coordinate_fallback` is diagnostic/fallback-only in this slice. Do not treat
  coordinate fallback refs as normal saved-ref mutation targets; mutation should
  warn or refuse before dispatch.
- Native `open`/`toggle` and other unsupported saved-ref actions fail closed
  with structured JSON. Browser saved refs support `type` and `key` only when
  the ref advertises those actions in `supported_actions`; non-text refs still
  fail closed with `ACTION_INCOMPATIBLE`.
- Unsafe resolution classes that have no current validation path still return
  `REF_REVALIDATION_REQUIRED` rather than mutating.
- Unsupported or incompatible actions return `REF_UNSUPPORTED` or
  `ACTION_INCOMPATIBLE`.

After any successful mutation, read `post_action.recommended_next_command`. Run
the recommended fresh source-aware `aos see capture <capture_source> --save
--workspace <workspace> --mode <capture_mode>` before using the next ref from
that surface when the response says fresh capture is recommended. If the saved
capture stored a query, the recommendation should include `--query <query>`.

## Cleanup

Workspace artifacts are local control state, not Work Recording evidence. Use
explicit cleanup:

```bash
aos see workspace prune default --older-than 7d --dry-run --json
aos see snapshot delete <snapshot-id> --workspace default --i-understand-local-artifacts --json
aos see workspace delete default --i-understand-local-artifacts --json
```

Never delete without the acknowledgement flag unless you are only doing a
`--dry-run` prune.

## References

- CLI API: `docs/api/aos.md`
- Schema contract: `shared/schemas/aos-agent-workspace-v0.md`
- Saved-ref regression: `tests/agent-workspace-saved-ref.sh`
