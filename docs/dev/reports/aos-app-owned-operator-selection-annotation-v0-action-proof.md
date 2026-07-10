# App-Owned Operator Selection/Annotation V0 Action Proof

Date: 2026-07-06

Status: passed for saved-ref action loop

## Scope

This proof closes the saved-ref/action gap left by
`docs/dev/reports/aos-app-owned-operator-selection-annotation-v0-live-proof.md`.
It used a guarded live AOS canvas target and did not use coordinate fallback.

## Run Authority

- HEAD: `383e869861a9ef17bbef06479b63c2adbd293174`
- Proof root:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z`
- Workspace: `operator-annotation-action-20260706T031919Z`
- Canvas: `operator-annotation-action-20260706T031919Z-56491`
- Binary rebuild: `false`
- Binary resign: `false`
- TCC touched: `false`

Preflight passed:

- `git status --short --branch`
- `git rev-parse HEAD`
- `./aos ready --json`
- `./aos permissions check --json`
- `node scripts/aos-dev-build.mjs build --no-restart --json`
- `./aos help see annotation --json`
- `./aos help see refs --json`
- `./aos help do --json`

## Selected Ref And Action

- Backend: `aos_canvas`
- Ref: `r2`
- Snapshot: `before`
- Action: `set-value`
- Requested value: `0.7`
- Selected target:
  `canvas:operator-annotation-action-20260706T031919Z-56491/action-contract:opacity`
- Selected-ref artifact:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/selected-ref.json`

The selected ref was captured from:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/before-capture.json`

It reported:

- `backend:"aos_canvas"`
- `resolution_class:"reacquirable"`
- `supported_actions:["set-value"]`
- `conformance.actionability:"reacquirable_saved_ref_mutation"`
- `conformance.no_foreground.fallback_used:false`

## Annotation Lifecycle

- Annotation ID: `ann-fd5365af-3516-4989-b54d-d4eb9cf64f08`
- Create artifact:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/annotation-create.json`
- Read-before artifact:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/annotation-read-before.json`
- Consume artifact:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/annotation-consume.json`

Creation from the saved capture/ref produced:

- `state:"pending"`
- `capability_status:"saved_ref"`
- `saved_ref.workspace_id:"operator-annotation-action-20260706T031919Z"`
- `saved_ref.snapshot_id:"before"`
- `saved_ref.ref:"r2"`
- `fallback_count:0`

The first consume succeeded with `status:"consumed"` and actor
`action-loop-proof`. A second consume failed closed with
`PENDING_ANNOTATION_NOT_CONSUMABLE`:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/annotation-consume-again.err`

## Saved-Ref Action

The action target was derived from the consumed annotation's
`target.saved_ref` fields:

`ref:before:r2 --workspace operator-annotation-action-20260706T031919Z`

Dry-run artifact:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/action-dry-run.json`

Dry-run result:

- `status:"dry_run"`
- `ref.backend:"aos_canvas"`
- `ref.resolution_class:"reacquirable"`
- `ref.conformance.actionability:"reacquirable_saved_ref_mutation"`
- `resolved_action.resolution_status:"resolved"`
- `ref.conformance.no_foreground.fallback_used:false`

Dispatch artifact:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/action-dispatch.json`

Dispatch result:

- `status:"success"`
- `underlying_result.execution.backend:"canvas"`
- `underlying_result.execution.strategy:"canvas_semantic_set_value"`
- `underlying_result.execution.fallback_used:false`
- `underlying_result.action_result.value:"0.7"`

## Re-Observation

- After capture:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/after-capture.json`
- Re-observation summary:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/reobserve-evidence.json`
- Refs diff:
  `/tmp/aos-operator-annotation-action-loop-20260706T031919Z/refs-diff.json`

`./aos see refs --workspace operator-annotation-action-20260706T031919Z --diff before..after --expect change --json`
returned `status:"success"` and
`diff.expectation.status:"passed"`.

The fresh capture observed the Opacity slider value changing from `0.25` to
`0.7`, and direct canvas readback returned `0.7`.

## Evidence Link

Link artifact:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/annotation-link-work-record.json`

Result:

- Work record: `work-record:operator-annotation-action-loop-20260706T031919Z`
- Relationship: `annotation_action_evidence`
- Status: `linked`
- Linked artifacts: `proof_summary`, `before_capture`, `selected_ref`,
  `action_dry_run`, `action_dispatch`, `after_capture`, `refs_diff`, and
  `reobserve_evidence`

## Verification

All required verification commands passed. Outputs were saved under:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/verification`

- `node --test tests/toolkit/pending-annotation-model.test.mjs tests/toolkit/pending-annotation-cli-lifecycle.test.mjs tests/toolkit/pending-annotation-store-index.test.mjs tests/toolkit/pending-annotation-lock.test.mjs`
- `node --test tests/toolkit/operator-annotation-menu.test.mjs tests/toolkit/operator-annotation-surface.test.mjs`
- `node --test tests/schemas/aos-pending-annotation-v0.test.mjs tests/schemas/aos-experience-v0.test.mjs`
- `bash tests/external-command-dispatch.sh`
- `bash tests/command-manifest-generation.sh`
- `git diff --check`
- `node scripts/aos-dev-build.mjs build --no-restart --json`

The final build gate also returned `binary_rebuilt:false` and
`binary_resigned:false`.

## Cleanup

The temporary proof canvas was removed:

`/tmp/aos-operator-annotation-action-loop-20260706T031919Z/cleanup/summary.json`

## Final Claim

Passed. A pending operator annotation carried a saved ref, was consumed exactly
once by an agent, drove a validated saved-ref `set-value` action, re-observed
changed state, and linked durable evidence. No coordinate fallback was used, no
hidden shell state was required, and TCC was not reset.
