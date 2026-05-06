# AOS Playbook Step v0 Sketch

Status: schema-backed design sketch. The JSON Schema in
[`aos-playbook-step-v0.schema.json`](aos-playbook-step-v0.schema.json)
validates example fixtures under
[`fixtures/aos-playbook-step-v0/`](fixtures/aos-playbook-step-v0/).

## Purpose

A Playbook step is reusable execution knowledge over the
`see -> resolve -> do -> see -> verify` shape. It describes what should be
perceived, how a target should be resolved, which AOS action should be taken,
which postconditions should be checked, and which repair hints are safe to use
under a workflow gate.

A Work Record is different: it records one run. Running a Playbook step can emit
a Work Record with immutable before/action/after evidence, Claim Results, a
Verifier Report, and Health. The Playbook step is not the evidence log, and a
Work Record is not the reusable template.

## Top-Level Shape

```json
{
  "type": "aos.playbook_step",
  "schema_version": "2026-05-playbook-step-v0",
  "id": "playbook-step:<stable-id>",
  "label": "Human label",
  "playbook_ref": "playbook:<subject-handle>",
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
the State IDs, and the immutable evidence refs. The Playbook step stores the
reusable resolution knowledge.

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
`buildWorkRecordV0FromPlaybookStepEvidence(playbookStep, evidenceSource)` in
`packages/toolkit/workbench/work-record-capture.js`. It combines one Playbook
step descriptor with one saved AOS `see -> do -> see` action evidence source and
emits Work Record v0. The generated Work Record uses
`origin.kind: "playbook"` and `origin.ref` from the Playbook step, preserves
immutable evidence refs, keeps replay and repair workflow-gated, and reuses
`aos.verifier.work-record.v0.report-only`.

The bridge remains saved-evidence only. It does not execute the step, replay a
macro, repair refs, or add a broad CLI command surface.

## Examples

- [`valid/browser-click-status.json`](fixtures/aos-playbook-step-v0/valid/browser-click-status.json)
  describes the browser click/status step with preconditions, target
  resolution, action, postconditions, repair hints, and claim promotion.
- [`invalid/missing-target-resolution.json`](fixtures/aos-playbook-step-v0/invalid/missing-target-resolution.json)
  is rejected because a Playbook step without target resolution cannot produce a
  reusable `see -> resolve -> do` plan.
- [`invalid/replay-without-workflow-gate.json`](fixtures/aos-playbook-step-v0/invalid/replay-without-workflow-gate.json)
  is rejected because v0 replay and repair must remain gated by a Workflow.
