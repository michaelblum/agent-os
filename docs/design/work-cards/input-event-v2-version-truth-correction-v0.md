# Input Event V2 Version Truth Correction V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #120 Add pointer source identity to input event contracts
- Corrects prior slice:
  `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the new input identity contract honest about versioned payloads.

The previous #120 slice added the right identity direction and passed the
focused JS/schema tests, and Foreman verified a forced `./aos dev build` passes.
However, review found a contract-risk: the Swift builder now emits
`input_schema_version: 2` broadly, while some event kinds that the builder or
routing helpers know about can still be shaped without required v2 fields.

Examples to inspect:

- `inputEventData(type: "scroll_wheel", ...)` would mark the event as v2 but
  lacks the schema-required `scroll: { dx, dy, unit }`.
- `inputEventData(type: "pointer_cancel" | "mouse_cancel", ...)` would mark the
  event as v2 but lacks the schema-required `cancel_reason`.
- `input_region.event` routed payloads can claim `routed_schema_version: 1` with
  `event_kind: "scroll"` or `event_kind: "cancel"` only if the required routed
  fields are present.

The fix is not necessarily to implement live scroll/cancel if those are not
currently produced by the native tap. The fix is that any payload claiming a
versioned schema must validate against that schema for its event kind, or it
must stay in an explicit compatibility/legacy shape without the version claim.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 120 --json number,title,state,url,body,labels
./aos dev recommend --json
```

Foreman already observed the known readiness blocker after a forced build:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing
```

Do not run live pointer smoke while that remains true.

## Existing Code To Inspect

- `src/perceive/events.swift` - versioned raw input builder.
- `src/perceive/daemon.swift` - CGEvent type mapping into raw input payloads.
- `src/daemon/unified.swift` - current input snapshot and
  `inputRegionRoutedInputPayload`.
- `src/daemon/input-surface-ownership.swift` - route phases, capture identity,
  and event kind coverage.
- `shared/schemas/input-event-v2.schema.json` - required fields by event kind.
- `shared/schemas/fixtures/input-event-v2/` - versioned examples.
- `tests/schemas/input-event-v2.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/daemon-input-surface-ownership.sh`

## Required Behavior

### Raw Daemon Events

For every raw event shape that includes `input_schema_version: 2`, the payload
must validate as one of the schema's raw event variants.

Acceptable implementation choices:

- fully support an event kind by adding its required fields;
- keep an unsupported event kind legacy-shaped by omitting
  `input_schema_version`;
- stop advertising helper coverage for event kinds the daemon cannot currently
  produce.

Do not silently produce a v2-looking scroll or cancel event that cannot validate.

If live native scroll should be included in V0, wire `.scrollWheel` in
`src/perceive/daemon.swift` and populate `scroll.dx`, `scroll.dy`, and
`scroll.unit: "point"` from the CGEvent. If that is too broad, leave scroll as
documented future coverage and avoid claiming v2 for it.

### Routed Input Region Events

For every `routed_input` payload with `routed_schema_version: 1`, the payload
must validate against the routed schema for its `event_kind`.

In particular:

- scroll routed events need `phase: "scroll"` and `scroll`;
- cancel routed events need `phase: "cancel"` and `cancel_reason`;
- owned/captured routed events need `region_id` and `owner_canvas_id`;
- captured routed events need stable `capture_id`.

Legacy top-level compatibility fields on `input_region.event` may remain.

### Tests

Add deterministic coverage proving the daemon/builder contract, not just static
fixtures. Choose the smallest maintainable test shape. Options include:

- a Swift shell test that compiles a tiny harness against the relevant Swift
  files, emits representative payload JSON, then validates it with the same
  JSON schema;
- a Swift shell test for builder/event-kind decisions plus existing schema
  fixture tests;
- a targeted schema fixture that captures the compatibility decision for
  unsupported scroll/cancel.

The important part: future changes should fail tests if a payload claims
`input_schema_version: 2` or `routed_schema_version: 1` without the required
fields.

## Scope

This is a correction pass for the daemon/schema/toolkit input identity contract.
It should be small and surgical.

## Hard Boundaries / Non-Goals

- Do not start Sigil migration.
- Do not build a daemon window manager.
- Do not rework the whole input schema.
- Do not remove legacy compatibility fields from existing consumers.
- Do not run live pointer smoke while TCC is blocked.

## Verification

Run:

```bash
git diff --check
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
bash tests/daemon-input-surface-ownership.sh
```

If Swift files change, run:

```bash
./aos dev recommend --json
./aos dev build --force
```

If `./aos ready` still reports `daemon_tcc_grant_stale_or_missing`, report that
blocker and skip live smoke.

## Completion Report

Include:

- the final rule for when raw daemon events may claim `input_schema_version: 2`;
- whether native scroll/cancel are implemented now or explicitly left legacy /
  future;
- how routed `input_region.event` avoids invalid v1 payloads;
- tests run with exact results;
- build result;
- readiness blocker if live smoke remains blocked.
