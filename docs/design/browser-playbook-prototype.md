# Browser Playbook Prototype

**Status:** first browser-compatible prototype bridge
**Tracked by:** https://github.com/michaelblum/agent-os/issues/274

## Purpose

This slice proves the browser Playbook path without introducing a general
Playbook UI, a new public CLI surface, autonomous replay, autonomous repair, or
the Wiki Subject Browser.

The prototype path is:

```text
createBrowserPlaybookPrototype()
  -> runBrowserPlaybookPrototype()
  -> runOneStepPlaybookHarness()
  -> Playbook-origin Work Record v0
  -> work_record.open message for the existing Work Record workbench model
```

The implementation lives in
`packages/toolkit/workbench/browser-playbook-prototype.js`. It is pure ESM and
browser-compatible: callers provide the `aos.playbook_step` descriptor and the
saved AOS action evidence as JSON objects, and the module does not use Node
APIs, daemon APIs, Playwright APIs, or filesystem access.

## Prototype Contract

The first fixture path uses the existing browser click/status Playbook step:

- `shared/schemas/fixtures/aos-playbook-step-v0/valid/browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/evidence/aos-browser-click-status.json`
- `shared/schemas/fixtures/aos-work-record-v0/valid/playbook-browser-click-status.json`

The prototype creates an `aos.workbench.subject` descriptor with
`subject_type: "aos.playbook_prototype"`, `browser-compatible` capability, and
one narrow control: `playbook_step.simulate_once`. The subject records that the
path is report-only, one-step-only, explicitly workflow-gated, and not a replay,
repair, macro, background loop, broad CLI surface, general Playbook UI, or Wiki
Subject Browser.

`runBrowserPlaybookPrototype()` always calls `runOneStepPlaybookHarness()` in
`simulate` mode. It requires the caller to pass an explicit workflow gate with a
declared gate ref and token. If the gate is missing or undeclared, the harness
rejects the run before emitting a Work Record.

When the saved evidence is good, the result is a Playbook-origin Work Record v0
with `origin.kind: "playbook"` and verifier profile
`aos.verifier.work-record.v0.report-only`. The Work Record remains report-only:
`execution_map.replay_policy.replay_requires_workflow_gate` and
`execution_map.replay_policy.repair_requires_workflow_gate` stay `true`.

## Workbench Handoff

The prototype exposes
`createBrowserPlaybookPrototypeWorkRecordOpenMessage(record, { prototype })` so
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

## Playbook Workbench V0 Shell

The browser-hosted V0 shell lives at
`aos://toolkit/components/playbook-workbench/index.html` and launches through
`packages/toolkit/components/playbook-workbench/launch.sh`. It is a thin
surface over this prototype contract: the launch path loads the existing
browser click/status step fixture and saved evidence fixture, the shell requires
an explicit workflow gate ref and token before calling
`runBrowserPlaybookPrototype()` in `simulate` mode, and the emitted Work Record
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
`tests/toolkit/browser-playbook-prototype.test.mjs`. It proves that the
prototype subject validates as an `aos.workbench.subject`, ungated simulation is
rejected without a Work Record, a gated simulation runs exactly one step through
`runOneStepPlaybookHarness()`, the generated Work Record matches the existing
Playbook-origin fixture and passes the report-only verifier, and the emitted
record opens read-only through the existing Work Record workbench model.
