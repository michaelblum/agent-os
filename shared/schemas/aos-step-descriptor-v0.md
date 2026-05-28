# AOS Step Descriptor v0 Sketch

Status: schema-backed design sketch. The JSON Schema in
[`aos-step-descriptor-v0.schema.json`](aos-step-descriptor-v0.schema.json)
validates example fixtures under
[`fixtures/aos-step-descriptor-v0/`](fixtures/aos-step-descriptor-v0/).

Transition note: ADR-0013 supersedes Playbook-as-executable language. This
`aos.step_descriptor` contract is the neutral v0 descriptor for one
Workflow-gated step/evidence bridge. It is not a Workflow engine, evidence log,
or autonomous replay contract.

## Purpose

A Step descriptor is a descriptor over the
`see -> resolve -> do -> see -> verify` shape. It describes what should be
perceived, how a target should be resolved, which AOS action adapter may be
called by a gated harness, which postconditions should be checked, and which
repair hints are safe to use under a Workflow gate.

A Work Record is different: it records one run. A Workflow-gated harness or
saved-evidence bridge can combine this descriptor with
before/action/after evidence to emit a Work Record with Claim Results, a
Verifier Report, and Health. The descriptor is not the evidence log, and a Work
Record is not the descriptor.

## Top-Level Shape

```json
{
  "type": "aos.step_descriptor",
  "schema_version": "2026-05-step-descriptor-v0",
  "id": "step-descriptor:<stable-id>",
  "label": "Human label",
  "workflow_ref": "workflow:<subject-handle>",
  "version": "v0",
  "target_dialect": "browser",
  "intent": {},
  "workflow_gates": {},
  "preconditions": [],
  "target_resolution": {},
  "action": {},
  "postconditions": [],
  "repair_hints": [],
  "claim_promotions": [],
  "evidence_requirements": []
}
```

The schema requires both `workflow_gates.replay_requires_workflow_gate` and
`workflow_gates.repair_requires_workflow_gate` to be `true`. This v0 sketch
does not authorize autonomous replay, repair, or macro playback.

## Target Resolution

`target_resolution` records the reusable strategy for resolving the action
target after a fresh `see`. For browser steps, it should prefer a semantic ref
and accessible candidate hints:

```json
{
  "strategy": "semantic_ref_then_role_name",
  "dialect": "browser",
  "target": "browser:work-record-live-action",
  "target_with_ref": "browser:work-record-live-action/e2",
  "ref": "e2",
  "semantic_ref": "work-record.live-action.commit"
}
```

The Work Record generated from a run stores the target that actually resolved,
the State IDs, and the immutable evidence refs. The descriptor stores
target-resolution metadata for the gated bridge.

## Claim Promotion

Postconditions live on the execution map. A step postcondition becomes a durable
Work Record Claim only through explicit `claim_promotions[]` metadata:

```json
{
  "id": "claim-promotion:status-changed",
  "postcondition_ref": "postcondition:aos-browser-click-status-after-status",
  "claim_text": "The bounded AOS browser click changed the live action status to Action recorded.",
  "scope": "run",
  "acceptance": "After perception semantic target e3 contains Action recorded."
}
```

This keeps repairable checks separate from durable intent. If a selector, ref,
or postcondition path drifts, patch the execution map; do not rewrite the Claim
text to hide target drift.

## Bridge To Work Record v0

The narrow toolkit bridge is
`buildWorkRecordV0FromStepDescriptorEvidence(stepDescriptor, evidenceSource)` in
`packages/toolkit/workbench/work-record-capture.js`. It combines one
`aos.step_descriptor` descriptor with one saved AOS `see -> do -> see` action
evidence source and emits Work Record v0. The generated Work Record uses the
containing Workflow as origin, preserves immutable evidence refs, keeps replay
and repair Workflow-gated, and reuses `aos.verifier.work-record.v0.report-only`.

The bridge remains saved-evidence only. It does not execute the step, replay a
macro, repair refs, or add a broad CLI command surface.

## One-Step Harness Boundary

The first explicit-gate harness is
`runOneStepStepDescriptorHarness()` in
`packages/toolkit/workbench/step-descriptor-harness.js`. It is a toolkit module
above the daemon, not a new public command group. The harness accepts exactly
one `aos.step_descriptor` descriptor and either simulates a run from one saved AOS
action evidence source or calls one caller-supplied execution adapter that
returns the same evidence shape.

The harness checks the Workflow gate before it reaches either path. A run must
provide both a gate ref declared in `workflow_gates.gate_refs[]` and an explicit
gate token. Ungated simulation or execution is rejected without producing a Work
Record and, for execute mode, before the adapter can run.

A gated harness run still does not make the Step descriptor the evidence log or
the preferred executable substrate. The descriptor supplies intent,
target-resolution, precondition, postcondition, repair-hint, and
Claim-promotion metadata. The harness supplies the run boundary and gate. The
Work Record emitted through
`buildWorkRecordV0FromStepDescriptorEvidence()` owns the immutable before/action/
after evidence, Claim Results, Verifier Report, and Health for that run.

Verifier diagnostics remain report-only. They classify drift or failure in the
Work Record without replaying the action, repairing refs, mutating historical
evidence, or patching guidance templates. Future replay or repair work must
use a separate Workflow-gated path that creates a new run or an explicit
execution-map patch.

## Examples

- [`valid/browser-click-status.json`](fixtures/aos-step-descriptor-v0/valid/browser-click-status.json)
  describes the browser click/status step with preconditions, target
  resolution, action, postconditions, repair hints, and claim promotion.
- [`invalid/missing-target-resolution.json`](fixtures/aos-step-descriptor-v0/invalid/missing-target-resolution.json)
  is rejected because a descriptor without target resolution
  cannot support the gated `see -> resolve -> do` bridge.
- [`invalid/replay-without-workflow-gate.json`](fixtures/aos-step-descriptor-v0/invalid/replay-without-workflow-gate.json)
  is rejected because v0 replay and repair must remain gated by a Workflow.
