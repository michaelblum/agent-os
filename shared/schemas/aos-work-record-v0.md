# AOS Work Record v0 Sketch

Status: schema-backed v0 contract with fixture-backed toolkit producers. The JSON Schema in
[`aos-work-record-v0.schema.json`](aos-work-record-v0.schema.json) validates the
example fixtures under
[`fixtures/aos-work-record-v0/`](fixtures/aos-work-record-v0/), and the
toolkit builders/verifier in `packages/toolkit/workbench/` produce and inspect
the current deterministic fixtures. This remains report-only: it records and
verifies bounded runs, but it does not authorize autonomous replay, repair, or
macro recording.

## Purpose

A Work Record is the durable AOS artifact for one run of work. It is itself a
Subject, but this sketch defines the persisted run payload rather than the
`aos.workbench.subject` descriptor used to browse it.

The v0 shape follows `CONTEXT.md` and ADR-0001 through ADR-0010:

- `origin` bridges a run back to the executable artifact or v0 compatibility
  descriptor associated with it, if any.
- `references[]` cites related Subjects, transitional Markdown Guides/SOPs,
  artifacts,
  or external resources without making them the run origin.
- `claims[]` live on the durable intent spine.
- `execution_map.postconditions[]` live in the repairable execution map.
- `evidence[]` is immutable and is referenced by id.
- `claim_results[]` are verifier output, one result per Claim.
- `verifier_report` summarizes one verifier pass and derives indexes from
  `claim_results[]`.
- `health` stores the embedded verifier health written with the Work Record.
  Consumers must treat fresh report-only verifier status and diagnostics as the
  current health authority.

## Top-Level Shape

```json
{
  "type": "aos.work_record",
  "schema_version": "2026-05-work-record-v0",
  "id": "work-record:<stable-id>",
  "label": "Human label",
  "created_at": "2026-05-05T16:00:00Z",
  "origin": {},
  "references": [],
  "intent": {},
  "execution_map": {
    "targets": [],
    "steps": [],
    "postconditions": [],
    "artifact_routes": [],
    "replay_policy": {}
  },
  "evidence": [],
  "claims": [],
  "claim_results": [],
  "verifier_report": {},
  "health": {},
  "metadata": {}
}
```

`execution_map.postconditions[]` is the canonical location for Postconditions.
This keeps selector, ref, command, or artifact-route drift in the repairable
map instead of on the durable Claim text.

## Origin

`origin` names the executable artifact that emitted the Work Record.

```json
{
  "origin": {
    "kind": "workflow",
    "ref": "workflow:browser-hosted-wiki-open-sigil",
    "run_id": "run:2026-05-05T16-20-00Z"
  }
}
```

Allowed origin kinds are `ad_hoc`, `recipe`, and `workflow`. Playbooks and
Guides/SOPs that shape a run without executing are cited through
`references[]`.
`ad_hoc` records use `ref: null` because no reusable origin emitted the run:

```json
{
  "origin": {
    "kind": "ad_hoc",
    "ref": null,
    "description": "One-off schema/documentation edit."
  }
}
```

Markdown Guides/SOPs under `docs/guides/` that guided a run are not origins.
Cite them in `references[]` with `relationship: "guided_by"` instead.

## References

`references[]` is for typed relationships to other Subjects, Facets, artifacts,
or documentation. These references do not change the Work Record identity and do
not replace internal ids such as `claim_id` or `postcondition_id`.

```json
{
  "id": "guided-by-entry-path-recipe",
  "relationship": "guided_by",
  "ref": "repo:docs/guides/agent-entry-paths-and-verification.md",
  "subject_type": "docs.guide",
  "layer": "narrative",
  "role": "operator_guidance"
}
```

Use relationship values that describe the role clearly, such as `guided_by`,
`origin_subject`, `input_to`, `output_artifact`, `derived_from`,
`superseded_by`, or `evidence_for`. The schema keeps relationship values open
for this sketch so the first producers are not over-fitted prematurely.

## Claims And Postconditions

Claims are the durable assertions about what the run accomplished. A Claim may
reference zero or more Postconditions:

```json
{
  "id": "claim:sigil-subject-opened",
  "text": "The Sigil wiki Subject was opened in the Browser-Hosted Wiki Subject Browser.",
  "scope": "run",
  "postcondition_refs": [
    "postcondition:sigil-heading-visible"
  ]
}
```

Postconditions are structured checks inside the execution map:

```json
{
  "id": "postcondition:sigil-heading-visible",
  "kind": "browser_dom",
  "description": "The after-capture exposes a visible Sigil subject heading.",
  "target": "browser:wiki-browser/heading.sigil",
  "check": {
    "kind": "text_contains",
    "ref": "heading.sigil",
    "expected": "Sigil"
  },
  "repair_policy": {
    "mode": "patch_execution_map",
    "notes": "Patch refs or locator candidates, not the Claim text."
  }
}
```

Step-local gates can remain Postconditions without being promoted into Claims.
Run-wide outcomes become Claims that reference the relevant Postconditions.

## Claim Results And Verifier Report

Claim Results are verifier output. Each item points back to one Claim and may
include per-Postcondition results:

```json
{
  "id": "claim-result:sigil-subject-opened",
  "claim_id": "claim:sigil-subject-opened",
  "status": "verified",
  "confidence": 0.96,
  "reason": "The after-capture evidence shows the expected subject heading.",
  "evidence_refs": ["evidence:after-see"],
  "postcondition_results": [
    {
      "postcondition_id": "postcondition:sigil-heading-visible",
      "status": "passed",
      "evidence_refs": ["evidence:after-see"],
      "reason": "The expected heading was present."
    }
  ]
}
```

`verifier_report` is report metadata and derived indexes. The embedded report
does not repeat the full `claims[]` list; `claim_results[]` is the source of
truth.

```json
{
  "verifier_report": {
    "id": "verifier-report:wiki-open-sigil",
    "generated_at": "2026-05-05T16:22:00Z",
    "verifier": {
      "id": "aos.verifier.work-record.v0",
      "kind": "schema-example",
      "version": "v0"
    },
    "claim_results_ref": "claim_results",
    "derived_indexes": {
      "verified": ["claim:sigil-subject-opened"],
      "failed": [],
      "unverified": []
    },
    "evidence_refs": ["evidence:after-see"],
    "feedback": []
  }
}
```

If a Verifier Report travels as a standalone artifact later, it can include a
`claims_digest` without becoming a second source of Claim text.

## Verifier Health

`health` is the current health Layer verdict written from the verifier pass.
The field uses `verdict` to avoid overloading generic `status` or `state`.

```json
{
  "health": {
    "verdict": "valid",
    "reason": "All run Claims verified against immutable evidence.",
    "evaluated_at": "2026-05-05T16:22:00Z",
    "verifier_report_id": "verifier-report:wiki-open-sigil",
    "confidence": 0.96,
    "repair_gate_refs": [],
    "replay_gate_refs": []
  }
}
```

Allowed verdicts are `valid`, `stale`, `repairable`, `blocked`, `impossible`,
`superseded`, and `retired`.

## Replay And Repair Gates

The execution map carries explicit replay policy:

```json
{
  "replay_policy": {
    "mode": "report_only",
    "replay_requires_workflow_gate": true,
    "repair_requires_workflow_gate": true,
    "gate_refs": [],
    "notes": "No autonomous replay or repair in v0."
  }
}
```

The schema requires both `replay_requires_workflow_gate` and
`repair_requires_workflow_gate` to be `true`. That encodes the v0 rule that
evidence-backed replay or repair loops need an explicit Workflow gate even when
the record has an executable or compatibility origin.

## Repair Plan V0

A Work Record Repair Plan is a read-only planning envelope over a source Work
Record and a fresh report-only verifier result. It proposes next steps; it is
not a repaired Work Record, verifier result, patch artifact, or proof that a
repair happened.

The current planner emits:

```json
{
  "type": "work_record.repair_plan",
  "schema_version": "2026-07-work-record-repair-plan-v0",
  "status": "planned",
  "source_work_record": {},
  "current_report": {},
  "current_health": "repairable",
  "embedded_health": "repairable",
  "health_verdict": "repairable",
  "historical_results": {},
  "failure_classes": [],
  "blockers": {},
  "mutates_record": false,
  "executes_actions": false,
  "automatic_replay_allowed": false,
  "workflow_gates": [],
  "plan_steps": [],
  "candidate_patches": [],
  "recommended_commands": [],
  "evidence_refs": [],
  "diagnostics": [],
  "followup": {}
}
```

The planner must keep `current_health` derived from the fresh report-only
verifier result. `embedded_health` is historical Work Record data and never
overrides the current report diagnostics. `historical_results` points at
embedded `claim_results[]` as record contents, not current proof.

Repair Plans are intentionally conservative:

- `valid`: no repair plan; recommend read/export/verify only.
- `stale`: plan fresh perception or re-resolution and a follow-up Work Record;
  any mutation remains workflow-gated.
- `repairable`: plan fresh perception or re-resolution plus a descriptive
  execution-map `candidate_patch` under an explicit workflow gate; the patch is
  not applied by the plan.
- `blocked`: classify missing evidence, permission, runtime, cleanup, or
  postcondition blockers and name the required external action or gate.
- `impossible`: explain why the known target class cannot satisfy the intent
  and prohibit replay.
- `superseded`: point at replacement records when available and avoid repair.
- `retired`: preserve the record as historical-only evidence and avoid repair.

Every `candidate_patches[]` entry is descriptive and must carry
`applied:false`. Recommended commands must report `executes_in_plan:false`.
Commands or steps that could mutate state must be marked
`requires_workflow_gate:true`; the planner does not create, satisfy, or bypass
that gate. A future repair attempt should emit a new Work Record or an explicit
patch artifact instead of rewriting `evidence[]`, `claims[]`, historical
`claim_results[]`, or the source Work Record.

## Workflow Gate Authorization V0

Workflow Gate Authorization is the read-only bridge between a Repair Plan and
the existing AOS gate contracts:

- `repair_plan`: read-only Work Record repair planning output.
- `workflow_gate`: a required approval/orchestration boundary named by the
  Repair Plan.
- `gate_request`: an `aos.gate.request.v1` request generated from one
  Repair Plan gate.
- `gate_record`: a terminal `aos.gate.record.v1` outcome.
- `resume_event`: a terminal `aos.gate.resume-event.v1` outcome created from a
  deferred gate continuation.
- `authorization`: report-only evaluation of whether the terminal outcome
  satisfies the Repair Plan gate.
- `future_attempt`: a later repair or re-run attempt that must produce a new
  Work Record or explicit patch artifact.

The toolkit contract is
`work_record.workflow_gate_authorization` with schema version
`2026-07-work-record-workflow-gate-authorization-v0`. It reports
`authorizes_future_attempt:true|false`, `executes_repair:false`,
`mutates_record:false`, and `automatic_replay_allowed:false`. Authorization is
not evidence that repair happened, does not run recommended commands, does not
apply candidate patches, does not replay actions, and does not mutate the source
Work Record or Repair Plan.

`gate-request` generation is allowed only when current Repair Plan output names
a mutating gated step or candidate patch. Valid, impossible, retired, and
superseded records return `not_required` unless the current Repair Plan itself
contains such a gated mutating candidate. Generated requests use
`aos.gate.request.v1`, `ui.variant:"approve_deny"`, a stable request id derived
from source Work Record identity, Repair Plan identity, and Workflow gate id,
and metadata that links the request back to Work Record repair planning. Prompt
bodies stay compact and do not embed heavy evidence payloads.

Authorization checking fails closed. Supported statuses are `not_required`,
`pending`, `authorized`, `denied`, `dismissed`, `timeout`, `stale`,
`mismatch`, `insufficient_evidence`, and `unsupported`. Positive authorization
requires a matching terminal gate outcome and an inspectable affirmative answer
payload. A terminal `answered` record without stored response data is
`insufficient_evidence`; callers that need later authorization proof must use
`--store-response` or `metadata.record_response:true` on the gate path that
stores the answer payload. Denied, dismissed, timeout, stale plan identity,
wrong Work Record, wrong plan, wrong gate, missing response, and unsupported
outcomes do not authorize a future attempt.

## Repair Attempt Plan V0

A Work Record Repair Attempt Plan packages a current Repair Plan and optional
Workflow Gate Authorization into a deterministic, non-executing descriptor for
a future explicit executor. It answers what a future repair attempt would need
to do, what it may touch, what proof it must emit, how cleanup or rollback
would be recorded, and why the attempt is or is not currently authorized. It is
not the executor.

The toolkit contract is `work_record.repair_attempt_plan` with schema version
`2026-07-work-record-repair-attempt-plan-v0`. The envelope includes:

```json
{
  "type": "work_record.repair_attempt_plan",
  "schema_version": "2026-07-work-record-repair-attempt-plan-v0",
  "status": "blocked_authorization_required",
  "source_work_record": {},
  "repair_plan": {},
  "workflow_gate_authorizations": [],
  "attempt_identity": {},
  "preconditions": [],
  "planned_operations": [],
  "candidate_patches": [],
  "recommended_commands": [],
  "evidence_requirements": [],
  "postconditions": [],
  "cleanup_expectations": [],
  "rollback_expectations": [],
  "risk": {},
  "known_limits": [],
  "executes_repair": false,
  "executes_actions": false,
  "applies_patches": false,
  "mutates_record": false,
  "automatic_replay_allowed": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported statuses are `not_required`, `ready`,
`blocked_authorization_required`, `blocked_authorization_denied`,
`blocked_authorization_insufficient`, `blocked_precondition`, `stale`,
`mismatch`, and `unsupported`. `ready` means only that the descriptor is safe
to hand to a future explicit executor; it does not mean repair happened.

Positive readiness requires the current Repair Plan to validate, source Work
Record identity to match, Repair Plan identity to match any supplied
authorization, every mutating planned operation to have an authorized matching
Workflow gate, all required preconditions to be representable as explicit
checks, no candidate patch to be marked applied, and no recommended command to
be marked executed.

Missing, denied, dismissed, timeout, insufficient, stale, wrong-record,
wrong-plan, wrong-gate, unsupported, and invalid authorization cases fail
closed. `valid`, `impossible`, `retired`, and `superseded` records produce
`not_required` unless the current Repair Plan itself contains a gated mutating
candidate that needs a future attempt.

`attempt_identity` is derived from source Work Record identity, Repair Plan
schema/version/digest, Workflow Gate Authorization identities when supplied,
Workflow gate ids, gated step ids, candidate patch ids, and planned operation
ids. `planned_operations[]` are typed descriptors, not live execution. Each
operation carries `executes_in_plan:false`, authorization status, target
boundary, precondition refs, evidence requirement refs, postcondition refs,
cleanup refs, and rollback refs. Patch-like candidates preserve
`applied:false`; command-like recommendations preserve
`executes_in_plan:false`.

The planner must not execute repair, replay actions, apply candidate patches,
run recommended commands, patch execution maps, auto-resume agents, mutate the
source Work Record, or treat authorization as proof that repair happened.
Future execution must emit a new Work Record or explicit patch artifact, plus
the evidence required by the attempt plan.

## Repair Attempt Artifact V0

A Work Record Repair Attempt Artifact records outcome data after a future
explicit repair attempt. It is the receiving artifact for what was attempted,
what actually happened, which evidence was produced, what cleanup or rollback
reported, and what the current verifier health says before and after the
attempt. It is not an executor, replay engine, patch applier, replacement Work
Record minter, or proof by itself.

The toolkit contract is `work_record.repair_attempt_artifact` with schema
version `2026-07-work-record-repair-attempt-artifact-v0`. The envelope includes:

```json
{
  "type": "work_record.repair_attempt_artifact",
  "schema_version": "2026-07-work-record-repair-attempt-artifact-v0",
  "status": "succeeded",
  "source_work_record": {},
  "repair_plan": {},
  "workflow_gate_authorizations": [],
  "repair_attempt_plan": {},
  "attempt_artifact_identity": {},
  "executor": {},
  "timing": {},
  "planned_operations": [],
  "operation_outcomes": [],
  "candidate_patch_outcomes": [],
  "recommended_command_outcomes": [],
  "evidence_refs": [],
  "verifier_before": {},
  "verifier_after": {},
  "final_health": {},
  "postcondition_results": [],
  "cleanup_results": [],
  "rollback_results": [],
  "source_work_record_mutation_check": {},
  "source_work_record_mutated": false,
  "rewrites_historical_evidence": false,
  "automatic_replay_allowed": false,
  "executor_implemented": false,
  "diagnostics": [],
  "recommended_next": {}
}
```

Supported artifact statuses are `succeeded`, `failed`, `partial`,
`aborted_precondition`, `blocked_authorization`, `blocked_plan_mismatch`,
`cleanup_failed`, `rollback_failed`, `invalid_artifact`, and `unsupported`.
Operation outcomes are data records with `planned_operation_id`, `status`,
timing, mutation boundary, authorization ref, evidence refs, stdout/stderr or
exit-status refs when relevant, cleanup flags, rollback flags, and diagnostics.
Candidate patch outcomes must distinguish described, applied, rejected, failed,
rolled-back, and validation evidence states. Recommended command outcomes must
distinguish command identity, executed/skipped status, exit code or signal,
stdout/stderr artifact refs, duration, mutation boundary, and cleanup or
rollback expectations.

The validator fails closed. Success requires matching source Work Record
identity, matching Repair Plan and Repair Attempt Plan digests, planned-vs-actual
operation matching, required evidence refs, passed postconditions, passed or
not-required cleanup, unchanged source Work Record, and final health derived
from `verifier_after` when present. Partial, cleanup-failed, rollback-failed,
missing-evidence, verifier-failed, mismatched-operation, stale-plan,
wrong-record, wrong-authorization, and source-record-mutated cases cannot be
reported as success.

Repair Attempt Artifacts must report the non-execution facts honestly:
`source_work_record_mutated:false`, `rewrites_historical_evidence:false`,
`automatic_replay_allowed:false`, and `executor_implemented:false` for this V0
slice. The deterministic fixture builder consumes explicit outcome JSON and
emits an artifact; it does not execute repair, replay actions, apply patches,
run recommended commands, auto-resume, mutate source Work Records, or mint
replacement Work Records. Replacement Work Record minting remains a separate
future product surface.

## Work Recording Frame Packs

Work Recording frame packs are an additive recording layer over this Work
Record shape. The frame contract is defined in
[`docs/design/aos-work-recording-frame-contract-v0.md`](../../docs/design/aos-work-recording-frame-contract-v0.md).

Baseline, delta, and keyframe records relate to the existing model as follows:

- `recording_baseline` captures the initial surface state, state ids, target
  descriptors, environment metadata, and Work Record/replay policy context.
- `recording_delta_frame` stores typed #430 interaction records: action
  intents, execution results, optional gesture frames, observed input evidence,
  state patches, observations, and artifact refs.
- `recording_keyframe` is a periodic recovery snapshot. It does not replace the
  semantic action/state delta records.
- `recording_evidence_ref` points to existing immutable `evidence[]` entries
  and artifact routes.
- `recording_replay_policy` re-perceives, resolves target descriptors, reissues
  semantic action intents, and verifies state patches under the same replay and
  repair gates required by `execution_map.replay_policy`.

The v0 JSON Schema does not add a top-level frame-pack slot yet. Fixtures keep
the recording contract beside Work Records until a runtime producer needs an
additive persisted field.

## Capture Builder And Report-Only Profile

The first runtime producer is intentionally narrow:
`buildWorkRecordV0FromCommandEvidence()` in
`packages/toolkit/workbench/work-record-capture.js` turns one bounded repo
command evidence source into a completed Work Record v0. The source still looks
like AOS evidence: it carries a command Target, optional State ID, immutable
output evidence, expected command postconditions, and references back to the
issue or test file that shaped the run.

The first named verifier profile is
`aos.verifier.work-record.v0.report-only`, exposed by
`runWorkRecordVerifierProfile()` in
`packages/toolkit/workbench/work-record-verifier.js`. The profile wraps the
deterministic report-only checker. It validates internal Work Record integrity,
derives claim indexes from `claim_results[]`, confirms replay and repair remain
workflow-gated, and reports diagnostics without mutating the record.

This command-evidence path is deliberately above the daemon. It is the smallest
proof that Work Records can be generated from bounded evidence instead of only
hand-authored fixtures. Future browser/canvas evidence producers or
transitional Step Descriptor bridges should reuse the same shape by swapping the
evidence source from repo-command output to `see/do/see` captures, browser
traces, screenshots, or artifact bundles. They should still emit Claims,
Postconditions, Claim Results, Verifier Report, and Health through a named
report-only profile before any replay or repair behavior is introduced.

The second producer is also narrow:
`buildWorkRecordV0FromAosActionEvidence()` turns one saved AOS action evidence
source into the same completed v0 shape. Its source records one
`see -> do -> see` slice with before perception, AOS action metadata, after
perception, target dialect, selected action target, State IDs where available,
and immutable artifact refs. For saved-ref evidence it may also record the
full `see --save -> do ref --dry-run -> do ref -> see --save ->
diff/readback -> cleanup` bridge. Direct browser/canvas evidence may store a
Target-with-Ref, saved-ref evidence preserves the Saved Ref plus resolved
underlying target and current-validation metadata, and native AX evidence
preserves its selector bridge descriptor. The builder stores the selected
action target in `execution_map.steps[].action`, stores before/dry-run/action/
after/cleanup receipts in `evidence[]` when present, and ties the post-action
Postcondition to the after-perception evidence.

### Saved Refs, Evidence, And Post-Action Proof

Saved Ref is evidence provenance, not Work Record object identity. When an
action comes from `ref:<snapshot-id>:<ref-id>`, the Work Record should preserve
both the Saved Ref and resolved underlying target metadata in the selected
action target, evidence metadata, or adjacent execution-map metadata. The Saved
Ref proves which saved perception workspace supplied the action candidate; the
resolved target metadata records what was actually dispatched through browser,
canvas, or native bridge action code.

Post-action proof is the after-perception evidence evaluated through a
post-action Postcondition and its `claim_results[]` entry. Do not invent a raw
JSON diff protocol to prove the result. If a ref, selector,
Postcondition check, or artifact route drifts, repair the execution map under an
explicit workflow/repair gate and keep the evidence immutable. Do not rewrite
Claim text to chase selector drift, do not mutate `evidence[]`, and do not
replay, repair, or macro-play back from a Work Record unless
`execution_map.replay_policy` authorizes that behavior through the required
workflow gates. The v0 verifier and harness remain report-only.

When a source-backed recipe uses repeatable
`aos see refs --diff <from>..<to> --expect-ref <ref>=...` as a compact
postcondition step, the Work Record boundary stays the same. The recipe result
or command stdout can be stored as immutable evidence, the Postcondition can
reference the expected `diff.ref_expectation` or `diff.ref_expectations[]`
fields, and the Claim Result can cite that evidence. The Work Record must not
treat the recipe step as a
portable replay instruction, repair a stale ref automatically, or replace
after-perception evidence with an untracked assertion string.

This is the bridge for the Step Descriptor contract:
a gated harness can emit the same saved evidence envelope after it runs `see`,
resolves a target, executes `do`, and captures `see` again. The
`aos.step_descriptor` descriptor owns target-resolution metadata and
repair hints; the Work Record owns what actually happened. This slice does not
replay the action, repair refs, or add a broad recorder/verifier command.
Replay and repair remain gated by `execution_map.replay_policy`.

The Step Descriptor bridge keeps that split explicit:
`buildWorkRecordV0FromStepDescriptorEvidence()` combines one
`aos.step_descriptor` descriptor with one saved AOS action evidence source. The
gated harness or containing Workflow contributes `origin.kind: "workflow"` and
`origin.ref`; the step descriptor contributes target-resolution metadata, step
repair hints, workflow gate refs, and claim-promotion metadata. The action
evidence still contributes the immutable before/action/after receipts, State
IDs, selected action target, Claim Results, Verifier Report, and Health. This
bridge does not make Playbook
the executable substrate and does not execute or replay the descriptor.

The first harness layer above that bridge is
`runOneStepStepDescriptorHarness()` in
`packages/toolkit/workbench/step-descriptor-harness.js`. It is intentionally a
module API above the daemon instead of a broad public CLI. Its boundary is:

- **Step descriptor:** target-resolution,
  preconditions, action shape, postconditions, repair hints, and Claim
  promotions for the gated bridge.
- **Harness run:** one explicit Workflow-gated attempt to simulate from saved
  evidence or call a caller-supplied adapter that returns saved AOS action
  evidence. The harness rejects missing or undeclared gates before action code
  runs.
- **Work Record evidence:** immutable before/action/after receipts and the
  selected action target for what actually happened during the run. A selected
  action target may be a direct Target-with-Ref, a Saved Ref with resolved
  underlying target metadata, or a native bridge descriptor.
- **Verifier diagnostics:** report-only classifications such as target/ref
  drift, precondition failure, action failure, postcondition failure, evidence
  ref drift, and State ID inconsistency. Diagnostics do not mutate the Work
  Record.
- **Future replay/repair:** separate Workflow-gated work that may produce a new
  run or an explicit execution-map patch. It is not performed by the v0 harness
  or the report-only verifier.

## Evidence Adapter Boundary

The first richer verifier evidence adapters live in
`packages/toolkit/workbench/work-record-evidence-adapters.js`. They are pure
toolkit helpers above the daemon: callers pass a Work Record object, and the
helpers inspect only structured payloads already embedded in `evidence[]` and
`execution_map.postconditions[]`. They do not call `./aos`, inspect live
canvases, open browsers, read files from artifact URIs, mutate Work Records,
patch execution maps, replay actions, or repair refs.

`aos.verifier.work-record.v0.report-only` now composes those helpers with the
existing internal-integrity checker. The old checks still validate ids, derived
indexes, workflow gates, State IDs, action target refs, immutable evidence, and
failed postcondition result classifications. The evidence adapters add
report-only diagnostics when a supported postcondition can be checked directly
against payload evidence:

- Browser DOM/ARIA-style payloads use semantic target arrays such as
  `evidence[].metadata.semantic_targets[]` with `ref`, `target`, `role`,
  `name`, `value`, and `data_aos_ref` fields.
- Canvas/AX-like payloads use the same semantic target contract with canvas or
  AX target dialects and may include bounds, canvas ids, or AX paths as
  metadata. The adapter still verifies only deterministic semantic fields.
- Screenshot and artifact evidence is metadata-only in this slice. The adapter
  may check URI, digest, content type, dimensions, attachment metadata, or
  similar deterministic fields. It must not claim that pixels contain a visual
  object, text, layout, or state unless a future deterministic image-check
  contract is added.

Supported adapter-backed failure classes include `target_ref_drift`,
`semantic_target_missing`, `semantic_value_mismatch`,
`semantic_role_name_mismatch`, and `artifact_metadata_mismatch`. These are
diagnostics on the verifier report, not automatic Work Record edits. A record
can remain schema-valid and keep optimistic historical `claim_results[]` while
the current report-only verifier flags the embedded evidence as no longer
supporting the claim.

## Consumption And Recovery

`packages/toolkit/workbench/work-record-consumer.js` and the public
`aos work-record` command provide the first model-facing Work Record consumer.
The surface is read-only and supports:

- `list` over canonical fixtures or explicit `--root` files/directories;
- `read` by Work Record id, Subject Entry Handle, or JSON path;
- `verify` with `aos.verifier.work-record.v0.report-only`;
- `status` for current report-only health, diagnostics, evidence refs, and
  recovery guidance;
- `plan-repair` for read-only Repair Plan output;
- `gate-request` and `gate-check` for Workflow Gate Authorization;
- `plan-attempt` for non-executing Repair Attempt Plan output;
- `attempt-artifact validate` and `attempt-artifact build` for read-only Repair
  Attempt Artifact validation and fixture/outcome artifact generation;
- `export` for a compact read-only evidence bundle manifest.

The consumer distinguishes embedded historical `claim_results[]` and
`health.verdict` from the fresh report-only verifier output. `status` exposes
`embedded_record_health`, `current_report_status`, and report-derived
`health_verdict`; failed current diagnostics cannot report current health as
`valid` merely because embedded health was optimistic. It fails closed for
unsupported schema versions, invalid V0 contract shapes, missing roots, invalid
JSON, and id-based
consumption when duplicate ids make a ref ambiguous. It does not mutate Work
Records, patch execution maps, repair refs, rewrite Claims, replay actions, or
inline heavy UI payloads.

`attempt-artifact validate` validates existing
`work_record.repair_attempt_artifact` JSON. `attempt-artifact build` consumes
explicit fixture/outcome input and emits deterministic artifact JSON. Both
surfaces report `read_only:true`, `mutates_state:false`,
`executes_repair:false`, `executes_actions:false`, `applies_patches:false`, and
`automatic_replay_allowed:false`.

Recovery guidance covers all Verifier Health verdicts. `valid` recommends no
repair or redundant proof loop; `stale` and `repairable` point to
re-perception/re-resolution or explicit workflow gates; `blocked` names missing
evidence, permission, runtime, cleanup, or postcondition blockers; and
`impossible`, `superseded`, and `retired` do not offer replay as the next step.

## Examples

The canonical examples for this sketch are JSON fixtures:

- [`valid/ad-hoc.json`](fixtures/aos-work-record-v0/valid/ad-hoc.json) shows an
  ad-hoc Work Record with `origin.kind: "ad_hoc"` and no reusable origin.
- [`valid/workflow-origin.json`](fixtures/aos-work-record-v0/valid/workflow-origin.json)
  shows an `origin.kind: "workflow"` shape with Claims linked
  to Postconditions, Claim Results linked back to Claims, and a Verifier Report
  that derives indexes from `claim_results[]`.
- [`valid/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/valid/repo-command-adapter-test.json)
  is generated from
  [`evidence/repo-command-adapter-test.json`](fixtures/aos-work-record-v0/evidence/repo-command-adapter-test.json)
  by the command-evidence builder, then checked with the named report-only
  verifier profile.
- [`valid/aos-browser-click-status.json`](fixtures/aos-work-record-v0/valid/aos-browser-click-status.json)
  is generated from
  [`evidence/aos-browser-click-status.json`](fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json)
  by the AOS action evidence builder. It records one browser Target-with-Ref
  click with before perception, action metadata, after perception, a
  post-action Postcondition, immutable evidence refs, and the same report-only
  verifier profile.
- [`valid/saved-ref-browser-fill-or-canvas-set-value.json`](fixtures/aos-work-record-v0/valid/saved-ref-browser-fill-or-canvas-set-value.json)
  is generated from
  [`evidence/saved-ref-browser-fill-or-canvas-set-value.json`](fixtures/aos-work-record-v0/evidence/saved-ref-browser-fill-or-canvas-set-value.json).
  It records a saved-ref browser fill with before saved capture, dry-run,
  dispatch, after saved capture/readback, cleanup evidence, backend/strategy/
  fallback metadata, selected Saved Ref, resolved target, recommended next
  capture command, and health `valid`.
- [`valid/repairable-stale-saved-ref.json`](fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json)
  preserves stale saved-ref dry-run/action evidence and classifies health
  `repairable`; repair policy points to re-perceive and re-resolve under an
  explicit workflow gate.
- [`valid/cleanup-or-postcondition-failed.json`](fixtures/aos-work-record-v0/valid/cleanup-or-postcondition-failed.json)
  preserves successful action evidence plus failed cleanup evidence and
  classifies health as `blocked` without rewriting historical evidence.
- [`valid/evidence-adapter-browser-canvas.json`](fixtures/aos-work-record-v0/valid/evidence-adapter-browser-canvas.json)
  shows adapter-backed browser semantic target, canvas/AX-like semantic target,
  and screenshot metadata checks that pass deterministically.
- [`report-only-failures/evidence-adapter-failures.json`](fixtures/aos-work-record-v0/report-only-failures/evidence-adapter-failures.json)
  remains schema-valid but intentionally fails adapter-backed report-only
  diagnostics for target/ref drift, missing semantic targets, value mismatch,
  role/name mismatch, and artifact metadata mismatch.
- [`valid/workflow-browser-click-status.json`](fixtures/aos-work-record-v0/valid/workflow-browser-click-status.json)
  is generated from the same AOS action evidence plus
  [`../aos-step-descriptor-v0/valid/browser-click-status.json`](fixtures/aos-step-descriptor-v0/valid/browser-click-status.json)
  by the Step Descriptor bridge. It preserves `origin.kind: "workflow"`,
  `origin.ref`, the promoted Claim metadata, evidence refs, postcondition refs,
  Claim Results, Verifier Report, Health, and workflow-gated replay/repair
  policy.

The fixture validation test also checks internal reference integrity that JSON
Schema cannot express alone: every Claim Result must reference an existing
Claim, every Claim Postcondition reference must resolve inside
`execution_map.postconditions[]`, and derived verifier indexes must point to
known Claims.

The guarded-live proof harness
`tests/manual/cross-backend-saved-ref-regression-proof.sh` emits the same
record shape for a controlled browser saved-ref fill when
`AOS_SAVED_REF_PROOF_MODE=guarded-live`. The Work Record lives under the proof
root at `browser/work-record/fill-work-record.json`; companion source,
verifier, and summary artifacts stay beside it. That harness is proof
production, not a public recorder command.

## Migration Notes

The toolkit now has a compatibility reader for v0 records in
`packages/toolkit/workbench/work-record-adapter.js`, projects v0 records through
`packages/toolkit/workbench/work-record-subject.js`, and opens them read-only in
the stock Work Record workbench. Older helper-shaped records keep their existing
manual edit and patch-request path. The current capture boundary has two
source-specific producers plus one bridge: bounded repo command evidence,
bounded AOS action evidence, and Step Descriptor-plus-action-evidence. Future
browser/canvas producers or transitional Step Descriptor bridges should continue
to emit this v0 shape from bounded `see/do/see` evidence while preserving the
same report-only verifier gate.
