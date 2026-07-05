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
- Use
  `aos work-record list/read/verify/status/plan-repair/plan-attempt/repair guide/repair bundle/repair bundle status/repair bundle inspect/repair execute/repair finalize/attempt-artifact validate/attempt-artifact build/replacement-proposal build/replacement-proposal validate/replacement-proposal write/supersession write/supersession lookup/supersession validate/gate-request/gate-check/export --json`
  when the task is consuming an existing Work Record rather than operating saved
  perception state. Most of that command family is report-only: it
  distinguishes historical `claim_results[]` from the current verifier report,
  returns conservative recovery guidance, emits read-only repair plans through
  `plan-repair`, builds Workflow Gate requests through `gate-request`, checks
  terminal gate records or resume events through `gate-check`, packages
  authorized or blocked future-attempt descriptors through `plan-attempt`, and
  validates or fixture-builds Repair Attempt Artifacts through
  `attempt-artifact`, guides the current recovery stage through non-executing
  `repair guide`, and derives non-writing Replacement Proposals through
  `replacement-proposal build/validate`. The narrow executing exception is
  `repair execute --attempt-plan <path> --execution-root <dir> --artifact-root
  <dir> [--dry-run] --json`: it consumes only a `ready` Repair Attempt Plan,
  runs only the named deterministic file-fixture registry under the explicit
  execution root, writes a Repair Attempt Artifact with explicit phase evidence
  under the explicit artifact root, and still rejects browser, native AX, canvas, live UI,
  coordinate, screenshot, image matching, arbitrary shell, generic patch,
  Workflow engine, source-record mutation, and auto-resume behavior.
  `gate-check` authorization only permits a future gated attempt;
  `plan-attempt` is not proof that repair happened and is only safe to hand to a
  future explicit executor when it reports `ready`. `repair guide` reports one
  `work_record.repair_guided_recovery` envelope with stage, blockers, missing
  inputs, artifact path recommendations, and exact command descriptors; it does
  not execute those descriptors, repair, finalize, replay, run `aos gate`
  commands, apply patches, write replacement/supersession outputs, start a
  Workflow engine, use live UI, or auto-resume agents. Guide stages are
  `valid_no_repair_needed`, `superseded`, `retired_or_impossible`,
  `repair_plan_unavailable`, `gate_required`, `authorization_pending`,
  `authorization_denied`, `authorization_insufficient`, `attempt_plan_blocked`,
  `ready_to_plan_attempt`, `ready_to_execute`, `attempt_artifact_invalid`,
  `ready_to_finalize`, `finalization_blocked`, `finalized`, and `unsupported`.
  A `ready_to_execute` guide report is ready only when `--attempt-plan`,
  `--execution-root`, and `--artifact-root` are all supplied; descriptors that
  need JSON stdout saved expose `stdout_artifact`, `save_stdout_to`, and
  `requires_saved_output_from` instead of hidden shell inference. For
  `repair guide`, `repair bundle`, `repair bundle inspect`, and each
  `repair bundle status` row, read `recovery_summary` first. It is the compact
  scan/continuation object with state, why, important files, exact
  `next.argv`, missing inputs, missing saved outputs, mutating/approval flags,
  safety flags, and diagnostic codes. Execute only structured `next.argv`, not
  display strings; use full envelopes only for evidence detail. Invalid,
  missing, unsupported, unknown, or blocked summaries are not authorization to
  continue unsafe work. Bundle/status/inspect remain read-only and
  non-executing. Use
  `repair bundle <id-or-path> --output-root <dir> [--dry-run] --json` when a
  future session needs an explicit handoff root containing `bundle-manifest`,
  `guide-report`, `commands/*.json`, and safe non-mutating guide/planning
  artifacts. The bundle writes only under `--output-root`, dry-run writes
  nothing, descriptors are rebound to bundle-local artifact paths, and every
  artifact reports path, digest, producer, and downstream consumers. It is not
  repair execution, finalization, supersession lookup, gate submission, replay,
  auto-resume, `aos do`, live UI, browser, native AX, canvas, patch
  application, replacement writing, supersession writing, or source-record
  mutation. Finalization dry-run and supersession lookup remain explicit
  follow-up command descriptors only, not bundle-generated reports. Recovery
  Bundle V0 is greenfield with no legacy compatibility contract: current writer
  output is the contract, same-schema manifests missing canonical required
  `non_execution_flags` such as `mutates_record`, `writes_bundle`, or
  `repairs_bundle` are invalid, and old generated smoke/test bundle directories
  should be regenerated. Any future compatibility support requires an explicit
  schema/versioned migration stance. A Repair Attempt Artifact records attempted
  outcome data; it is not a replacement writer. A Replacement Proposal proposes
  carried-forward evidence, new evidence, per-postcondition evidence mapping,
  supersession metadata, and final proposed health; it is not itself a writer.
- `aos work-record repair bundle status --bundle-root <dir> [--bundle-root <dir> ...] [--bundle-parent <dir> ...] --json`
  summarizes one or more explicit Recovery Bundle roots without writing,
  repairing, executing, replaying, touching live UI/TCC surfaces, or discovering
  global state. `--bundle-parent` is bounded and non-recursive: only immediate
  children containing `bundle-manifest.json` are inspected. Every bundle is
  validated through the bundle inspector, then reported as ready, blocked,
  invalid, missing, unsupported, finalized, or unknown with source Work Record
  identity, guide stage, saved-output readiness, missing saved outputs, and the
  exact next command id/`argv`; each row repeats the scan-first contract in
  `recovery_summary`. Aggregate counts include `ready_count`,
  `blocked_count`, `invalid_count`, `missing_count`, `unsupported_count`,
  `finalized_count`, and `unknown_count`.
- `aos work-record repair bundle inspect <bundle-root> --json` validates an
  existing Recovery Bundle root without writing, repairing, re-running guide or
  planning, submitting gates, executing repair, finalizing, replacing,
  superseding, replaying, or touching live UI/TCC surfaces. It reads only the
  explicit bundle root by default, checks manifest/guide/descriptors/artifacts,
  exact manifest artifact path identity, manifest non-execution flags, path
  containment, symlinks, digests, forbidden bundle-owned outputs, and saved
  output readiness, then reports `recovery_summary`, the exact next `argv`, and
  whether required saved outputs are present.
- `aos work-record repair finalize --source <id-or-path> --attempt-plan
  <plan-path> --attempt-artifact <artifact-path> --replacement-root <dir>
  --index-root <dir> [--proposed-id-seed id] [--replacement-output-path path]
  [--dry-run] --json` is the bounded finalization composition step for the
  common successful case. It internally builds the Replacement Proposal,
  preflights the Replacement Writer and Source Supersession Index outputs,
  writes the replacement, writes the Source Supersession Index entry with the
  in-memory Replacement Writer Result provenance, and returns one
  `work_record.repair_finalization_result`. Dry-run writes nothing. Execute
  mode writes only under the explicit replacement and index roots, preserves
  source Work Record bytes, is idempotent for matching existing outputs, and
  reports `partial_finalized` only for post-preflight durable failures after
  replacement writing succeeds but supersession writing does not. For
  `finalized`/`already_finalized`, execute recovery follow-ups from
  `recommended_next.recommendations[].argv`; for `partial_finalized`, use the
  argv-backed `supersession write` recovery recommendation. Treat every
  `command_hint` as display-only shell-quoted text. It does not execute repair,
  replay actions, run recommended commands, apply patches, use browser/native
  AX/canvas/live UI surfaces, start a Workflow engine, mutate the source Work
  Record, or auto-resume agents.
- `aos work-record replacement-proposal write <proposal-path> --output-root
  <dir> [--dry-run] --json` is the narrow Replacement Writer. It validates the
  proposal, materializes a new replacement Work Record under the explicit output
  root with per-postcondition evidence refs preserved, writes
  atomically/idempotently, and leaves the source Work Record unchanged. Dry-run
  reports the exact path, id, digest, idempotency, source
  immutability check, and planned side effects without writing. Write results
  still report `mutates_source_record:false`, `executes_repair:false`,
  `executes_actions:false`, `applies_patches:false`, and
  `automatic_replay_allowed:false`; do not treat a written replacement record as
  evidence that repair execution happened. Successful writes return
  `recommended_next.argv` for reading the written replacement; treat
  `recommended_next.command_hint` as display-only shell-quoted text.
- `aos work-record supersession write --source <id-or-path> --replacement
  <id-or-path> --index-root <dir> [--replacement-root <dir>] [--writer-result
  <path>] [--dry-run] --json` is the external Source Supersession Index writer.
  It writes only a relationship entry under the explicit index root, validates
  source and replacement identities, checks replacement supersession
  provenance, writes atomically/idempotently, and leaves both Work Records
  unchanged. `supersession lookup --source <id-or-path> --index-root <dir>
  [--replacement-root <dir>] --json` is read-only external discovery metadata;
  it scans only the explicit index root and does not mean the source record was
  mutated. Without replacement roots, lookup may report
  `replacement_readback.status:index_only`; that is index metadata, not
  readability proof. With replacement roots, inspect
  `replacement_readback.status`, `read_proven`, resolved root/path, and
  diagnostics. When a follow-up is returned, execute structured
  `recommended_next.argv`; treat `recommended_next.command_hint` only as
  shell-quoted display text. `supersession validate <entry-path> --json`
  validates one entry file without repair, replay, patch application,
  recommended-command execution, or auto-resume.
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
  / `live_dispatch_proven_no_foreground_not_claimed`.
- Direct AX one-shot wrappers use
  `native_primitive_response_plus_wrapper_contract`
  / `live_dispatch_proven_no_foreground_not_claimed`.
  The focus/set-value live harness is
  `tests/manual/native-ax-saved-ref-live-proof.sh`; prior native press live
  evidence is recorded in
  `docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md`.
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
- Browser `snapshot_scoped` `click`, `fill`, `hover`, `scroll`, `drag`, `type`,
  and `key` refs use fresh xray plus page, frame, navigation, role, title,
  label, context, and enabled-state validation. Text-compatible `type` and
  `key` refs use the same current-target validation as browser `fill`.
  `current_validation.current_target` includes current bounds when xray provides
  them; bounds movement alone is tolerated when saved page/frame/navigation and
  element identity facts still validate. Dry-run reports `reacquired` when
  validation is sufficient for real dispatch.
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
  marks it actionable with complete known-limit facts. Volatile or known-limit
  native AX refs report
  `conformance.proof.status: approval_gated_live_proof_not_run`.
- Native AX `stable` refs are actionable only when the saved capture already
  includes the full durable identity contract: `app_pid`, `window_id`,
  `ax_identifier`, `enabled: true`, `action_names`,
  `permission_state: granted`, `focus_cursor_space_baseline` as a captured
  baseline, and `native_saved_ref_evidence` as an actionable verdict. The
  Swift producer emits native known-limit facts for visible native AX captures;
  live native captures remain `volatile` when those facts are incomplete or
  contain a blocker. Stable refs support
  only capture-declared `press`, `focus`, and `set-value`, convert saved facts to
  direct AX selector flags, and report `direct_ax_ready` plus
  `requires_direct_ax_current_matching`. Treat their `underlying_result` as a
  direct AX wrapper response, not as browser-style current validation. They
  report `live_dispatch_proven_no_foreground_not_claimed` after live
  focus/set-value proof, while still reporting `not_claimed` no-foreground
  safety.
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
  `live_dispatch_proven_no_foreground_not_claimed`, and current
  pid/role/filter matching limits. If the underlying result reports `fallback_used` or
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

Saved refs can feed a Work Record only through structured evidence above the
workspace layer: before saved capture, saved-ref dry-run, dispatch, after saved
capture/readback or diff, and cleanup. Preserve the selected Saved Ref and the
resolved target, but let the Work Record own immutable evidence, verifier
health, and repair/replay policy. Do not treat workspace snapshots as durable
Work Record storage, do not rewrite evidence during repair, and do not describe
`aos do` as a macro recorder.

## References

- CLI API: `docs/api/aos.md`
- Schema contract: `shared/schemas/aos-agent-workspace-v0.md`
- Saved-ref regression: `tests/agent-workspace-saved-ref.sh`
