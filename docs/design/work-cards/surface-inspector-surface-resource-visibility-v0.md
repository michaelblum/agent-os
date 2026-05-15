# Surface Inspector Surface Resource Visibility V0

## Tracker

- Epic: #223 AOS Surface System
- Related issues: #122 StageAffordance / visual-hit binding, #261 panel/window
  placement, #303 daemon generic input regions, #305 Sigil remodel
- Follows:
  `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`,
  `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`,
  `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`,
  `docs/design/work-cards/toolkit-surface-interaction-decision-tree-v0.md`,
  and `docs/design/work-cards/toolkit-panel-window-normalization-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make Surface Inspector able to explain the new surface stack. It should show
not only canvases and object marks, but also toolkit-owned surface resources:
DesktopWorld stage layers, StageAffordance bindings, resource-scope ownership,
and daemon input regions.

The practical question the inspector should answer is:

> What canvas owns this visual layer, hit area, affordance, child canvas, or
> stale cleanup artifact?

This is an observability slice. It should make the stage-backed minimized-chip
path and future StageAffordance users inspectable before Sigil remodel work
starts.

## Read First

- `AGENTS.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/api/toolkit.md`
- `docs/api/toolkit/runtime.md`
- `docs/api/toolkit/panel-window.md`
- `docs/api/toolkit/components.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/tree.js`
- `packages/toolkit/components/desktop-world-stage/model.js`
- `packages/toolkit/components/desktop-world-stage/index.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/runtime/resource-scope.js`
- `packages/toolkit/runtime/input-region.js`
- `src/daemon/input-surface-ownership.swift`
- `src/daemon/unified.swift`
- `shared/schemas/daemon-event.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "input_region|canvas_object.registry|desktop_world_stage|StageAffordance|resourceScope|marksByCanvas" packages/toolkit src/daemon shared/schemas tests
```

If `./aos ready` reports the known repo-mode TCC blocker, do not run live
pointer smoke. This slice can proceed with deterministic model and component
tests.

## Current Signals To Use

Use existing generic routes before adding new daemon routes:

- daemon already supports `input_region` subscription with
  `input_region.snapshot` and live register/update/remove events;
- daemon already supports `canvas_object.registry` fan-out and snapshot
  replay;
- DesktopWorld stage already has a pure state model and
  `desktopWorldStageSnapshot(state)`;
- StageAffordance already stamps input-region metadata with
  `toolkit_affordance_id`;
- ResourceScope state already exposes child canvas ids, stage layer ids, input
  region ids, subscription events, cleanup status, and active state.

Prefer exposing stage layers through the existing `canvas_object.registry`
route from `desktop-world-stage` if that fits the existing object-registry
contract. If inspection shows a cleaner route, document why. Avoid adding a
stage-specific daemon event unless the existing generic routes are inadequate.

## Required Data Model

Add a small pure model for inspector-visible surface resources. The exact file
name is up to inspection; likely homes are:

- `packages/toolkit/components/surface-inspector/surface-resources.js`; or
- an extension of `packages/toolkit/components/surface-inspector/tree.js` if the
  logic stays small.

The model should normalize and correlate:

- current canvases from `canvas_lifecycle`;
- current input regions from `input_region.snapshot` and `input_region` events;
- current DesktopWorld stage layers from the chosen stage-layer publication
  path;
- StageAffordance hints from layer metadata and input-region metadata;
- resource-scope hints where they are available through StageAffordance state or
  metadata.

The normalized snapshot should expose enough information for tests and
`window.__canvasInspectorState`, including:

- stage layer id, kind, label, frame, z-index, owner/source canvas id, and
  metadata;
- input region id, owner canvas id, semantic label, consume policy,
  coordinate space, frame, enabled state, and metadata;
- inferred affordance id when a stage layer and input regions share
  `toolkit_affordance_id`;
- status buckets such as `active`, `orphaned_owner_missing`,
  `stage_layer_without_region`, `region_without_stage_layer`, and
  `cleanup_suspect` where those can be inferred deterministically.

Do not overfit to minimized chips. The model should work for any future
StageAffordance.

## Required UI / Inspector State

Add inspector visibility without turning this into a redesign.

Minimum UI:

- Canvas list/tree shows a resource group under the owning canvas or an
  equivalent location that makes ownership obvious.
- Stage layers are distinguishable from canvases and object marks.
- Input regions are distinguishable from stage layers and show the semantic
  label/consume policy.
- Affordance group rows make it clear when a passive visual and its hit regions
  are coupled.
- Stale or suspicious resources get a compact text/status marker.

Minimum debug state:

- `window.__canvasInspectorState` includes normalized surface-resource data and
  counts for stage layers, input regions, affordances, and stale/suspicious
  resources.
- The state is stable enough for deterministic tests and future Operator smoke.

Minimap rendering is optional but useful. If implemented, keep it lightweight:
project stage layer and input-region frames using the existing minimap layout,
with restrained styling that does not obscure canvases or object marks.

## Required Publication / Subscription Behavior

Surface Inspector should subscribe to `input_region` with `snapshot: true` and
maintain live state through:

- `input_region.snapshot`;
- `input_region` actions `registered`, `updated`, and `removed`;
- `canvas_lifecycle` removal events for cleanup/owner-missing inference.

DesktopWorld stage should publish stage-layer state through the chosen generic
route whenever layers are upserted, removed, replaced, or cleared. If using
`canvas_object.registry`, represent each stage layer as a non-editable registry
object or explicitly mark it as inspector-only so Object Transform Panel does
not imply transform controls that do not exist.

The publication path must support snapshot replay for a newly opened Surface
Inspector.

## Required Tests

Add or extend deterministic tests. Cover:

- input-region snapshot/register/update/remove normalization;
- stage-layer snapshot/publication normalization;
- StageAffordance correlation by shared `toolkit_affordance_id`;
- owner-missing/stale status inference when a canvas disappears but a resource
  remains visible in the model;
- tree rows or resource rows render with stable types/labels/data attributes;
- `window.__canvasInspectorState` includes resource counts/state;
- DesktopWorld stage publishes updated layer registry/snapshot on upsert,
  replace, remove, and clear;
- no false coupling when an input region and stage layer only happen to have
  similar ids but no shared metadata.

Likely test files to add or extend:

- `tests/toolkit/surface-inspector-surface-resources.test.mjs`;
- `tests/toolkit/surface-inspector-tree.test.mjs`;
- `tests/toolkit/surface-inspector.test.mjs`;
- `tests/toolkit/desktop-world-stage.test.mjs`.

Prefer pure model tests first. Avoid browser-only assertions unless the existing
test harness already makes them cheap.

## Required Docs

Update:

- `docs/api/toolkit/components.md` for Surface Inspector's resource visibility;
- `docs/api/toolkit/panel-window.md` if StageAffordance publication metadata or
  inspectability expectations change;
- `docs/api/toolkit/runtime.md` if input-region subscription usage becomes part
  of the public runtime guidance;
- `docs/design/aos-surface-system.md` or
  `docs/design/aos-canon-surface-boundary-alignment-plan.md` with the new
  observability milestone.

Keep the decision-tree recipe canonical. Only update the audit there if a
status actually changes.

## Hard Boundaries / Non-Goals

- no Sigil remodel;
- no daemon window manager;
- no lifecycle warming implementation;
- no panel/window behavior changes beyond metadata needed for inspection;
- no broad Surface Inspector redesign;
- no new object transform controls for stage layers unless the stage layer is
  genuinely transformable;
- no Swift changes unless GDI proves the existing `input_region` and
  `canvas_object.registry` routes cannot carry the needed observability state;
- no live pointer smoke while repo-mode TCC is blocked;
- no GitHub issue mutation from this slice unless Foreman amends the card.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/surface-inspector-surface-resources.test.mjs
node --test tests/toolkit/surface-inspector-tree.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/desktop-world-stage.test.mjs
```

Run any other new or modified focused tests. If executable toolkit code changes
broadly, run:

```bash
node --test tests/toolkit/*.test.mjs
```

If Swift changes are unavoidable, stop and justify the daemon change in the
completion report, then run the workflow-router-recommended Swift/build tests.

## Completion Report

Include:

- files changed;
- chosen publication/subscription path for stage layers and input regions;
- where the normalized surface-resource model lives;
- what Surface Inspector now shows and what remains hidden;
- stale/suspicious resource statuses implemented;
- tests run with exact results;
- live smoke result or exact readiness blocker;
- remaining follow-up: Operator live smoke after TCC reset, input identity
  (#120), lifecycle warming (#123), daemon Sigil-specific cleanup (#303), or
  Sigil as second StageAffordance client (#305).
