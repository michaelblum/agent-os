# Toolkit Child Hit Surface Source Identity V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #120 Add pointer source identity to input event contracts
- Related issues:
  - #122 Toolkit-owned DesktopWorld hit-region controller
  - #305 Remodel Sigil as first-class consumer of AOS surface platform
  - #303 Daemon generic input regions
- Prerequisite work cards:
  - `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`
  - `docs/design/work-cards/input-event-v2-version-truth-correction-v0.md`
  - `docs/design/work-cards/toolkit-desktop-world-hit-region-controller-v0.md`
  - `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make child hit-surface echoes identify themselves as canvas-origin input instead
of relying on Sigil-local booleans.

The daemon and input-region identity baseline now exists, and Sigil's radial
menu and avatar hit-target physical child canvases are both backed by the
toolkit DesktopWorld hit-region controller. The remaining gap is event identity:
`apps/sigil/renderer/hit-area.html` still sends a plain `canvas_message`,
`main.js` converts it into `fromHitTarget: true`, and
`apps/sigil/context-menu/menu.js` uses `assumeInside` to bypass normal hit
selection. This slice should promote that echo path into a reusable toolkit
normalization contract and remove the app-local flags from Sigil's live path.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/daemon-toolkit-input-event-identity-contract-v0.md`
- `docs/design/work-cards/sigil-avatar-hit-target-toolkit-controller-v0.md`

## Rediscover State

```bash
git status --short --branch
gh issue view 120 --json number,title,state,url,body,labels
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 305 --json number,title,state,url,body,labels
rg -n "fromHitTarget|assumeInside|source_canvas_id|canvas_message|sigil-hit|sigil-radial-menu-surface" apps/sigil packages/toolkit tests/renderer tests/toolkit shared/schemas docs/design docs/api
./aos dev recommend --json
```

Run `./aos ready` before any live smoke. If readiness is blocked or the input tap
is not active, report the concrete status and keep this slice to deterministic
tests.

## Existing Code To Inspect

- `packages/toolkit/runtime/input-events.js` - canonical normalization for raw,
  v2, routed, and `input_region.event` input.
- `packages/toolkit/runtime/interaction-region.js` - DesktopWorld interaction
  router and the remaining `assumeInside` compatibility hook.
- `packages/toolkit/runtime/desktop-world-hit-region.js` - generic child
  hit-region controller now used by Sigil radial and avatar surfaces.
- `apps/sigil/renderer/hit-area.html` - avatar child page that currently emits
  plain `canvas_message` payloads with `source: "sigil-hit"`.
- `apps/sigil/renderer/radial-menu-surface.html` - radial child page that emits
  semantic `canvas_message` payloads.
- `apps/sigil/renderer/live-modules/input-message.js` - Sigil-local message
  unwrapping that should not grow another private protocol.
- `apps/sigil/renderer/live-modules/hit-target.js` - exposes hit target id,
  current native frame, and DesktopWorld placement state.
- `apps/sigil/renderer/live-modules/main.js` - current `fromHitTarget`
  duplicate-source guard and child hit-canvas event handling.
- `apps/sigil/context-menu/menu.js` - current `assumeInside` route from child
  hit-canvas events into the context-menu interaction router.
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/toolkit/runtime-interaction-region.test.mjs`

## Current Evidence

- `shared/schemas/input-event-v2.md` already states that canvas-origin
  synthetic input should use `source_origin: "canvas"` with
  `source_canvas_id`, and that this exists to avoid private booleans such as
  `fromHitTarget`.
- `packages/toolkit/runtime/input-events.js` normalizes v2 raw events, routed
  events, `input_event` envelopes, and `input_region.event`, but it does not
  yet provide a canonical path for child `canvas_message` echoes.
- `apps/sigil/renderer/hit-area.html` can know the parent canvas id and child
  hit canvas id from query params, but it cannot know final DesktopWorld
  coordinates. The parent renderer must still resolve local child offsets
  through the current native frame and display geometry.
- `apps/sigil/renderer/live-modules/main.js` currently suppresses duplicate
  daemon events with `msg.fromHitTarget === true`.
- `apps/sigil/context-menu/menu.js` currently routes hit-canvas menu events
  with `assumeInside` and `regionId: "sigil-context-menu"`.

## Required Behavior

### Toolkit Canvas-Origin Input Path

Add a small reusable toolkit runtime path for child canvas input echoes.

The exact API should be code-informed, but it should give app code a way to turn
a child `canvas_message` plus parent-owned placement facts into a normalized
input object compatible with `normalizeCanvasInputMessage()`.

The normalized object should preserve these concepts:

- `sourceOrigin: "canvas"` / `source_origin: "canvas"`;
- `sourceCanvasId` / `source_canvas_id` for the child hit canvas;
- `ownerCanvasId` / `owner_canvas_id` for the parent or owning canvas;
- `sourceEvent` / `source_event` for the original child DOM-derived event kind;
- `sourceSequence` / `source_sequence` with `source: "toolkit"` and a stable
  value for deterministic tests;
- `gestureId` / `gesture_id` and, where applicable, `captureId` / `capture_id`
  stable across down/drag/up for the same child pointer sequence;
- DesktopWorld `x` / `y` and `desktop_world` after parent-side coordinate
  resolution;
- `coordinateAuthority` / `coordinate_authority: "toolkit"`;
- child-local offset and native/screen details retained for debugging.

Prefer extending `packages/toolkit/runtime/input-events.js` or a closely named
runtime helper over placing this logic in Sigil. Export it from
`packages/toolkit/runtime/index.js` if it is a public helper.

### Child Page Payloads

Update child pages only as much as needed for identity.

For `apps/sigil/renderer/hit-area.html`, include explicit identity fields in
the emitted payload or envelope:

- parent/owner canvas id from `parent`;
- source child canvas id from `id`;
- local offsets;
- original event kind;
- scroll deltas when present.

Do not make the child page invent DesktopWorld coordinates. The parent renderer
owns that conversion because it has current frame/display state.

For `apps/sigil/renderer/radial-menu-surface.html`, preserve semantic radial
messages. If the same source identity convention can be added without changing
behavior, add it. Do not force radial semantic clicks into pointer events unless
the code naturally supports that distinction.

### Sigil Live Path Cleanup

Remove `fromHitTarget` from Sigil's live input path.

`main.js` should identify child hit-surface echoes by canonical identity, for
example `sourceOrigin === "canvas"` and `sourceCanvasId === hitTarget.hit.id`,
rather than a private boolean. Preserve behavior:

- right-button hit-canvas events remain daemon-authoritative and should not
  double-open the context menu;
- left hit-canvas events are ignored when the context menu is closed;
- outside-menu and recent daemon echo suppression still work;
- avatar drag/fast-travel behavior remains intact;
- duplicate daemon event suppression does not treat canvas-origin echoes as
  daemon input.

Remove live Sigil calls to `assumeInside` if practical. Prefer passing explicit
source identity and an explicit target region id into the interaction router.
If `packages/toolkit/runtime/interaction-region.js` still needs to retain
`assumeInside` as a compatibility option for tests or older callers, leave it
isolated and documented as compatibility; Sigil should not be the reason it is
still required.

### Interaction Router Identity

Teach the interaction router to carry source identity through dispatch and
snapshot state instead of flattening everything to `"hit"` or `"global"`.

Acceptable implementation shape:

- derive source from `routeOptions.sourceIdentity`,
  `rawEvent.sourceCanvasId`, `rawEvent.source_canvas_id`, or the existing
  `routeOptions.source` fallback;
- allow an explicit `regionId` to route a trusted child-canvas echo to a known
  region without the app saying `assumeInside`;
- preserve the existing duplicate-source suppression behavior during capture;
- keep old `source` strings working for compatibility tests.

### Tests

Add or update focused tests for the new contract:

- toolkit input normalization accepts a child `canvas_message` or helper-built
  canvas-origin event and exposes `sourceOrigin`, `sourceCanvasId`,
  `ownerCanvasId`, `sourceEvent`, `sourceSequence`, `gestureId`, DesktopWorld
  point, and `coordinateAuthority`;
- Sigil `normalizeMessage()` either delegates to the toolkit helper or remains
  a thin wrapper without inventing new identity fields;
- hit-area payloads include source/owner identity and still preserve local
  offsets and scroll deltas;
- Sigil hit-canvas event handling no longer emits or depends on
  `fromHitTarget`;
- context-menu routing no longer depends on Sigil passing `assumeInside`;
- interaction router tests cover explicit source identity plus region id and
  keep legacy compatibility where needed;
- existing avatar/radial/Sigil renderer behavior remains covered.

Add a source guard test or deterministic grep-style assertion only if it is the
cleanest way to prevent accidental reintroduction of `fromHitTarget` in the live
path. Do not block historical work-card text or docs that intentionally mention
the retired term.

### Docs

Update the source-of-truth docs for the boundary:

- `docs/api/toolkit/runtime.md` should describe the child hit-surface
  canvas-origin input helper and source identity fields.
- `docs/design/aos-surface-system.md` should move the `fromHitTarget` /
  `assumeInside` note from active blocker to retired/transitional compatibility,
  or state the exact remaining blocker if any compatibility remains.
- `apps/sigil/AGENTS.md` should say Sigil child hit-surface echoes use toolkit
  canvas-origin input identity; Sigil keeps product semantics, not private input
  identity folklore.
- `docs/recipes/aos-surface-interaction-decision-tree.md` only needs an update
  if the status buckets change.

## Scope

This is a toolkit runtime plus focused Sigil compatibility cleanup slice. It may
touch tests and docs at the API/design boundary.

Swift daemon changes should not be necessary. If inspection proves the shared
schema needs one small doc/fixture update for canvas-origin input, do that with
schema tests. Do not reopen daemon product-specific routing.

## Hard Boundaries / Non-Goals

- Do not redesign Sigil's avatar state machine, radial menu, or context-menu
  product semantics.
- Do not remove child hit canvases; this slice improves their identity.
- Do not move Sigil visuals to the shared DesktopWorld stage.
- Do not add new Sigil-specific branches to daemon code.
- Do not widen this into a full input-event v2 schema migration for all
  consumers.
- Do not break legacy raw `input_event`, `input_region.event`, or routed input
  normalization.
- Do not run real mouse-input smoke without explicit idle keyboard/mouse
  handoff.

## Suggested Implementation Areas

Likely files, not a mandatory write set:

- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/interaction-region.js`
- `packages/toolkit/runtime/index.js`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/renderer/live-modules/input-message.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/context-menu/menu.js`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/toolkit/runtime-interaction-region.test.mjs`
- `tests/renderer/input-message.test.mjs`
- `tests/renderer/hit-target.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`
- `docs/api/toolkit/runtime.md`
- `docs/design/aos-surface-system.md`
- `apps/sigil/AGENTS.md`

## Verification

Run focused deterministic checks:

```bash
git diff --check
node --check packages/toolkit/runtime/input-events.js
node --check packages/toolkit/runtime/interaction-region.js
node --check apps/sigil/renderer/live-modules/input-message.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-interaction-region.test.mjs
node --test tests/renderer/input-message.test.mjs
node --test tests/renderer/hit-target.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/sigil-input-regions.test.mjs
```

If renderer behavior changes broadly, also run:

```bash
node --test tests/renderer/*.test.mjs
```

If schema docs or fixtures change, also run:

```bash
node --test tests/schemas/input-event-v2.test.mjs
```

Report `./aos ready` status. If it reports ready with an active input tap and
the normal isolated smoke remains available, run:

```bash
bash tests/sigil-avatar-interactions.sh
```

Do not run any real mouse-input scenario unless the user or Operator explicitly
hands over idle keyboard/mouse control.

## Completion Report

Include:

- files changed;
- the public toolkit helper or normalization path added;
- whether child hit-surface echoes now carry `source_origin: "canvas"` and
  `source_canvas_id`;
- whether Sigil live code still contains any `fromHitTarget` or `assumeInside`
  dependency, with exact file/line and reason if yes;
- whether `interaction-region.js` still retains compatibility `assumeInside`;
- tests run with exact pass/fail results;
- `./aos ready` result and any live-smoke blocker;
- recommended next slice.
