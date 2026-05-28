# Browser Capture Ladder Projection

**Status:** execution-model projection note plus first browser-compatible prototype bridge
**Tracked by:** https://github.com/michaelblum/agent-os/issues/274

## Purpose

Browser capture is a downstream capability family on top of the AOS Execution
Model. It is not a taxonomy root and it does not define the ladder. The current
shape maps browser work onto the existing model:

```text
target/app surface
-> control primitive
-> observation/capture/evidence block
-> reusable capture recipe
-> workflow orchestration with gates/retries
-> run
-> work record with evidence/trace
```

This note defines that projection and records the first browser-compatible Step
Descriptor prototype without introducing a general Playbook UI, a new public CLI
surface, autonomous replay, autonomous repair, or the Wiki Subject Browser.

## Projection Shape

| Layer | Browser Capture Projection | Current repo evidence |
| --- | --- | --- |
| Target/app surface | Browser Host surface addressed through `browser:<session>` and `browser:<session>/<ref>` target strings. | `CONTEXT.md`, `docs/design/see-do-grammar-trace-connections.md`, browser-compatible workbench subjects. |
| Control primitive | AOS `see` and `do` primitives over browser targets, with State IDs and Target-with-Ref addresses. | `./aos see capture ... --xray`, `./aos do click ... --state-id ...`, saved AOS action evidence fixtures. |
| Observation/capture/evidence block | A typed block that captures before/action/after evidence and postconditions without deciding broader orchestration. | `shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json`, `buildWorkRecordV0FromAosActionEvidence()`. |
| Reusable capture recipe | A source-backed `aos recipe` manifest that can dry-run and run bounded capture steps once the block shape is ready. | Reserved; current live recipes are under `recipes/` and prove the recipe surface, not website capture. |
| Workflow orchestration | Gates, retries, human review, branch decisions, evidence quality checks, and optional repair paths around one or more recipes or harness runs. | `aos.step_descriptor`, `runOneStepStepDescriptorHarness()`, workflow gate refs, and report-only verifier checks. |
| Run | One execution instance of a capture recipe, workflow child, or gated harness. | Step Descriptor harness results and Work Record `origin.run_id`. |
| Work Record with evidence/trace | Durable receipt containing intent, execution map, claims, postconditions, immutable evidence, verifier output, and health. | `shared/schemas/aos-work-record-v0.md` and `workflow-browser-click-status.json`. |

Existing browser capture work should therefore specialize primitives, blocks,
recipes, workflows, runs, evidence, and Work Records. It should not add a
parallel "browser capture" taxonomy or make Employer Brand artifacts the source
of execution-model terms.

## Current Prototype

The prototype path is:

```text
createBrowserStepDescriptorPrototype()
  -> runBrowserStepDescriptorPrototype()
  -> runOneStepStepDescriptorHarness()
  -> Workflow-origin Work Record v0
  -> work_record.open message for the existing Work Record workbench model
```

The implementation lives in
`packages/toolkit/workbench/browser-step-descriptor-prototype.js`. It is pure ESM and
browser-compatible: callers provide the `aos.step_descriptor` descriptor and the
saved AOS action evidence as JSON objects, and the module does not use Node
APIs, daemon APIs, Playwright APIs, or filesystem access.

## Prototype Contract

The first fixture path uses the existing browser click/status Step descriptor:

- `shared/schemas/fixtures/aos-step-descriptor-v0/valid/browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/valid/workflow-browser-click-status.json`

The prototype creates an `aos.workbench.subject` descriptor with
`subject_type: "aos.step_descriptor_prototype"`, `browser-compatible` capability, and
one narrow control: `step_descriptor.simulate_once`. The subject records that the
path is report-only, one-step-only, explicitly workflow-gated, and not a replay,
repair, macro, background loop, broad CLI surface, general Playbook UI, or Wiki
Subject Browser.

`runBrowserStepDescriptorPrototype()` always calls `runOneStepStepDescriptorHarness()` in
`simulate` mode. It requires the caller to pass an explicit workflow gate with a
declared gate ref and token. If the gate is missing or undeclared, the harness
rejects the run before emitting a Work Record.

When the saved evidence is good, the result is a Workflow-origin Work Record v0
with `origin.kind: "workflow"` and verifier profile
`aos.verifier.work-record.v0.report-only`. The Work Record remains report-only:
`execution_map.replay_policy.replay_requires_workflow_gate` and
`execution_map.replay_policy.repair_requires_workflow_gate` stay `true`.

## Workbench Handoff

The prototype exposes
`createBrowserStepDescriptorPrototypeWorkRecordOpenMessage(record, { prototype })` so
the emitted Work Record can be opened through the existing Work Record workbench
model path:

```text
createWorkRecordWorkbenchState()
  -> openWorkRecord(state, work_record.open message)
  -> workRecordWorkbenchSnapshot(state)
```

Because Work Record v0 records are read-only in the existing workbench model,
the open subject has no patch persistence and no patch controls. The verifier
report remains inspectable through the existing `work_record.verifier_report`
view.

## Step Descriptor Workbench V0 Shell

The browser-hosted V0 shell lives at
`aos://toolkit/components/step-descriptor-workbench/index.html` and launches through
`packages/toolkit/components/step-descriptor-workbench/launch.sh`. It is a thin
surface over this prototype contract: the launch path loads the existing
browser click/status step fixture and saved evidence fixture, the shell requires
an explicit workflow gate ref and token before calling
`runBrowserStepDescriptorPrototype()` in `simulate` mode, and the emitted Work Record
is handed to the existing read-only Work Record workbench open path.

The shell remains fixture-backed, report-only, and one-step-only. It exposes
semantic refs for inspection and operation, but it does not add live browser
execution, autonomous replay, repair, macro playback, background loops, broad
CLI commands, or a second Work Record viewer.

## Non-Goals

This is not the Browser-Hosted Wiki Subject Browser. It does not navigate wiki
Subjects, resolve Subject Entry Handles, or render graph/facet browsing.

This is not a general Playbook UI. It does not list Playbooks, edit Playbook
steps, execute multi-step plans, or expose arbitrary adapters.

This is not a new broad command surface. There is no `aos playbook`, `aos
verify`, `aos audit`, recorder command, or public replay command.

This is not autonomous replay or repair. The prototype does not repair refs,
patch execution maps, re-run failed steps, play back macros, or start background
loops. Any future live execution, replay, or repair must be a separate
Workflow-gated path that emits a new Work Record or an explicit patch.

## Verification

The focused regression is
`tests/toolkit/browser-step-descriptor-prototype.test.mjs`. It proves that the
prototype subject validates as an `aos.workbench.subject`, ungated simulation is
rejected without a Work Record, a gated simulation runs exactly one step through
`runOneStepStepDescriptorHarness()`, the generated Work Record matches the existing
Workflow-origin fixture and passes the report-only verifier, and the emitted
record opens read-only through the existing Work Record workbench model.
