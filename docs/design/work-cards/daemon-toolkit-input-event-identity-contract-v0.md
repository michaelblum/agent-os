# Daemon/Toolkit Input Event Identity Contract V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #120 Add pointer source identity to input event contracts
- Related issues: #303 daemon generic input regions, #122 StageAffordance /
  visual-hit binding, #123 warm/suspend/resume lifecycle primitives, #305 Sigil
  remodel
- Prior work cards:
  - `docs/design/work-cards/daemon-generic-input-region-contract-v0.md`
  - `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
  - `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
  - `docs/design/work-cards/surface-inspector-surface-resource-visibility-v0.md`
- Canonical schema/doc starting point:
  - `shared/schemas/input-event-v2.schema.json`
  - `shared/schemas/input-event-v2.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make input identity a first-class daemon/toolkit contract instead of an
app-level inference layer.

Today the repo has a good draft schema for raw daemon `input_event` and routed
toolkit `aos_routed_input`, but the live daemon and input-region paths still
deliver a mix of legacy raw events, `input_region.event`, and app-specific
guards such as Sigil `fromHitTarget` / toolkit `assumeInside`. This slice should
pin the V0 identity contract and implement the practical bridge from daemon
events through toolkit routing without breaking existing consumers.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `docs/api/toolkit/runtime.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/aos-surface-system.md`
- `docs/design/work-cards/daemon-generic-input-region-contract-v0.md`
- `docs/design/work-cards/surface-inspector-surface-resource-visibility-v0.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 120 --json number,title,state,url,body,labels
./aos dev recommend --json
```

Run `./aos ready` only if you need live runtime status. The repo is currently
expected to report the known repo-mode TCC blocker
`daemon_tcc_grant_stale_or_missing`; do not attempt live pointer smoke while
that remains true.

## Existing Code To Inspect

- `src/perceive/events.swift` - current legacy `inputEventData` builder.
- `src/perceive/daemon.swift` - native tap to daemon input payload path.
- `src/daemon/unified.swift` - subscriptions, `currentInputEventSnapshot`,
  `broadcastInputEvent`, `routeInputRegionEvent`, and input-region IPC.
- `src/daemon/input-surface-ownership.swift` - generic input-region route and
  capture state.
- `shared/schemas/input-event-v2.schema.json` - canonical raw/routed contract.
- `shared/schemas/fixtures/input-event-v2/` - existing schema examples.
- `packages/toolkit/runtime/input-events.js` - current normalization for legacy,
  v2, and routed envelopes.
- `packages/toolkit/runtime/interaction-region.js` - JS-side routed interaction
  and capture helper.
- `packages/toolkit/runtime/input-region.js` - daemon input-region register /
  update / remove helper.
- `packages/toolkit/panel/stage-affordance.js` - current consumer of
  `input_region.event`.
- `packages/toolkit/components/surface-inspector/index.js` and
  `packages/toolkit/components/surface-inspector/surface-resources.js` - event
  subscribers and inspector-visible surface resources.
- `apps/sigil/renderer/live-modules/input-message.js`,
  `apps/sigil/renderer/live-modules/main.js`, and
  `apps/sigil/context-menu/menu.js` - app-level legacy duplicate-source guards.
- `tests/schemas/input-event-v2.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/toolkit/runtime-input-region.test.mjs`
- `tests/toolkit/runtime-interaction-region.test.mjs`
- `tests/daemon-input-surface-ownership.sh`

## Required Behavior

### Identity Model

Define the V0 identity fields at the shared contract boundary. The exact field
names should be code-informed, but the contract must answer these questions:

- What identifies the observed daemon event? Prefer the existing
  `sequence: { source: "daemon", value }`, monotonic timestamp, and
  `gesture_id` model unless inspection proves a better primitive is needed.
- What identifies a routed delivery? Owned/captured deliveries need stable
  `region_id`, `owner_canvas_id`, `capture_id` when captured, `delivery_role`,
  and `source_event` or `source_sequence`.
- What identifies source origin? Distinguish daemon-observed input from
  canvas-origin synthetic input and hit-canvas echoes without app-specific
  booleans such as `fromHitTarget`.
- What coordinate authority is canonical at each boundary? Raw daemon events own
  native coordinates; routed toolkit events must expose DesktopWorld coordinates
  with `coordinate_authority`.
- What compatibility shape is allowed while legacy consumers still exist?

If the existing `input-event-v2` schema already has the right field, use it. If
it is missing an essential field such as `owner_canvas_id`, `source_canvas_id`,
or an equivalent source identity, update the schema, fixtures, and prose docs.

### Daemon Contract

The daemon should produce or preserve enough identity for toolkit consumers to
avoid guessing. This does not require a reckless compatibility flip.

Required outcomes:

- raw daemon `input_event` snapshot/live payloads must have a documented path
  toward `input_schema_version: 2` identity;
- `input_region.event` delivery must carry a canonical routed identity payload
  that can be normalized into the shared routed event shape;
- captured input-region drags/ups must retain stable capture identity across the
  sequence;
- source event identity must be stable enough for replay, inspector display, and
  duplicate suppression;
- legacy top-level fields may remain during V0 if needed for compatibility, but
  the canonical payload/helper must be clear and tested.

### Toolkit Contract

Toolkit should expose one normalization path for consumers:

- normalize raw legacy daemon events, strict v2 raw events, `input_event`
  envelopes, `input_region.event` envelopes, and routed toolkit events into a
  consistent object;
- preserve `sequence`, `gestureId`, `captureId`, `deliveryRole`, `regionId`,
  `ownerCanvasId`, `sourceCanvasId` or equivalent source identity, and
  `sourceEvent` / source sequence;
- keep current panel chrome, StageAffordance, Surface Inspector, and Spatial
  Telemetry behavior working;
- avoid teaching app code to inspect new daemon-specific ad hoc fields.

If a new helper is needed, prefer a small public runtime helper in
`packages/toolkit/runtime/input-events.js` over duplicating parsing in panel or
Sigil code.

### Sigil Compatibility

Do not start the Sigil remodel. Sigil may remain a compatibility consumer.

However, use this slice to reduce or clearly isolate the reason for:

- `fromHitTarget` in `apps/sigil/renderer/live-modules/main.js`;
- `assumeInside` / manual `source: "hit"` routing in
  `apps/sigil/context-menu/menu.js`.

If those can be removed after the shared helper exists, remove them with focused
tests. If not, document the exact blocker and leave the app behavior unchanged.

### Manifest/Discovery Hygiene

While touching event contracts, audit affected component manifests for
self-description drift. In particular, Surface Inspector now requires
`canvas_object.registry` and `input_region`; ensure its `accepts` / `requires`
contract reflects the event messages it actually handles, or document why
`requires` is the only needed declaration.

## Scope

Ownership spans the daemon primitive, shared schema, toolkit runtime, and
focused consumer compatibility. Keep policy at the correct layer:

- daemon: observed input facts, input-region ownership/capture, primitive
  delivery;
- toolkit runtime: normalized routed event helper and compatibility adapters;
- panel/components: consume normalized toolkit events;
- Sigil: only compatibility cleanup that naturally follows from the shared
  contract.

## Hard Boundaries / Non-Goals

- Do not build a daemon window manager.
- Do not start the Sigil platform-stage remodel.
- Do not migrate all Sigil interaction state unless that becomes a tiny,
  obvious cleanup after the helper exists.
- Do not remove legacy input shapes unless all current consumers and tests have
  been audited and updated.
- Do not add new hard-coded product ids or Sigil branches to daemon input
  routing.
- Do not run live pointer smoke while `./aos ready` is blocked by stale/missing
  TCC permissions.

## Suggested Implementation Areas

Likely files, not a mandatory write set:

- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `shared/schemas/fixtures/input-event-v2/valid/*.json`
- `shared/schemas/fixtures/input-event-v2/invalid/*.json`
- `src/perceive/events.swift`
- `src/daemon/unified.swift`
- `src/daemon/input-surface-ownership.swift`
- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/input-region.js`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/spatial-telemetry/index.js`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/context-menu/menu.js`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-system.md`
- `shared/schemas/daemon-event.md`

## Verification

Run focused deterministic checks first:

```bash
git diff --check
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-surface-resources.test.mjs
bash tests/daemon-input-surface-ownership.sh
```

If Swift files change, ask the workflow router before building:

```bash
./aos dev recommend --json
./aos dev build
```

If `./aos ready` passes, run a bounded smoke only after deterministic tests:

1. subscribe a test canvas to `input_event` and verify identity fields arrive;
2. register one temporary input region and verify `input_region.event` includes
   routed identity;
3. drag through the region and verify capture identity is stable;
4. remove the region and verify cleanup is visible to Surface Inspector.

If readiness reports `daemon_tcc_grant_stale_or_missing`, skip live smoke and
report that exact blocker.

## Completion Report

Include:

- final V0 identity fields and which layer owns each one;
- whether raw daemon `input_event` is now strict v2, compatibility-shaped, or
  still legacy with a canonical adapter;
- final `input_region.event` / routed payload shape;
- any Sigil `fromHitTarget` / `assumeInside` cleanup completed or exact blocker;
- manifest/discovery hygiene changes;
- files changed;
- tests run with exact results;
- live smoke result or readiness blocker;
- remaining follow-up slices for #120, #303, #123, or #305.
