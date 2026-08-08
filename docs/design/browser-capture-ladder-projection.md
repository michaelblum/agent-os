# Browser Capture Ladder Projection

**Status:** active Step Descriptor V1 projection note
**Tracked by:** https://github.com/michaelblum/agent-os/issues/274

## ADR 0040 Boundary

The active browser-compatible prototype uses Step Descriptor V1 and Work Record
V1. Both are neutral evidence contracts. Neither accepts Gate data, grants
permission, classifies risk, requires approval, or constrains a caller to an
operation registry. Gate remains a separate explicitly invoked structured-input
primitive.

## Projection

Browser capture specializes the existing AOS layers:

```text
target/app surface
-> control primitive
-> observation/capture/evidence block
-> caller-selected run
-> optional Work Record with evidence
```

The active ownership is:

| Layer | Browser projection | Repository owner |
| --- | --- | --- |
| Target/app surface | Browser targets and exact state-scoped Observation Refs | ADR 0040 and public `see`/`do` contracts |
| Control primitive | Caller-selected `see` and `do` operations | AOS command manifests and runtime |
| Evidence block | Before/action/after evidence with exact State IDs and postconditions | `aos-work-record-v1.schema.json` |
| Step descriptor | One source-bound descriptive step and evidence requirements | `aos-step-descriptor-v1.schema.json` |
| Work Record | Optional immutable evidence/history plus report-only verifier health | `aos-work-record-v1.schema.json` |

Step Descriptors and Work Records describe evidence. They do not execute a
workflow, authorize a future attempt, or add a parallel browser-capture
taxonomy.

## Active Prototype

The prototype path is:

```text
createBrowserStepDescriptorPrototype()
  -> runBrowserStepDescriptorPrototype()
  -> runOneStepStepDescriptorHarness()
  -> Work Record V1
  -> report-only Work Record verifier
  -> work_record.open read-only handoff
```

The implementation in
`packages/toolkit/workbench/browser-step-descriptor-prototype.js` is pure ESM.
Callers provide the descriptor and saved evidence as objects. Simulation reads
only supplied evidence. Execution requires a caller-supplied adapter and is not
exposed by the public Work Record command surface.

Active fixtures:

- `shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json`

The prototype is one-step, fixture-backed, and report-only by default. It adds
no autonomous replay, repair loop, macro playback, background loop, general
Playbook UI, or Wiki Subject Browser.

## Workbench Handoff

The Step Descriptor Workbench V1 shell lives at:

```text
aos://toolkit/components/step-descriptor-workbench/index.html
```

It loads the V1 descriptor and saved-evidence fixtures, simulates one step, and
hands the emitted V1 record to the existing read-only Work Record workbench.
Its controls contain no Gate, approval, risk, or operation-selection fields.
Its semantic selectors are local inspection selectors, not public Observation
Refs or action-time Locators.

## Historical V0

Step Descriptor V0 and Work Record V0 schemas and fixtures remain frozen
historical bytes. Active readers and harnesses reject them. They are not
translated, repaired, replayed, or accepted through a compatibility alias.

## Verification

- `tests/schemas/aos-step-descriptor-v1.test.mjs`
- `tests/toolkit/step-descriptor-harness.test.mjs`
- `tests/toolkit/browser-step-descriptor-prototype.test.mjs`
- `tests/toolkit/step-descriptor-workbench-v1.test.mjs`
