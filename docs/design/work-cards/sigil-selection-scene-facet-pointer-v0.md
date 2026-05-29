# Sigil Selection Scene Facet Pointer V0

## Recipient

GDI.

## Transfer Kind

Implementation round after acceptance of the avatar render-model adapter.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required implementation head:
  `a92b7bd4d5bb99ad18ad29b30c75fe8f7722dbc5`
- Design note:
  `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- Prior adapter card:
  `docs/design/work-cards/sigil-avatar-render-model-adapter-v0.md`
- Adapter implementation:
  `apps/sigil/renderer/live-modules/avatar-render-model-adapter.js`

## Single Goal

Move the Selection Mode pointer into the first narrow scene visual facet proof:
a persistent sibling `selectionVisualRoot` whose pointer child consumes the new
avatar render-model adapter.

This slice should be pointer-only. It should preserve user-visible behavior
while changing ownership from a standalone cursor model root toward the design
note's `selectionVisualRoot.pointer` architecture.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: current local head containing this work card, with
  adapter baseline no older than
  `a92b7bd4d5bb99ad18ad29b30c75fe8f7722dbc5`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the implementation locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- `docs/design/work-cards/sigil-avatar-render-model-adapter-v0.md`
- `apps/sigil/renderer/live-modules/avatar-render-model-adapter.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/scene.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `tests/renderer/sigil-avatar-render-model-adapter.test.mjs`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
```

This slice should be deterministic first. Do not run live AOS checks until the
deterministic gates pass. If live AOS verification becomes necessary and
`./aos ready` reports repo-mode Accessibility, Input Monitoring, or inactive
input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Required Behavior

Create the smallest durable scene facet shape needed for Selection Mode pointer
rendering:

```text
state.scene
  avatarRoot / state.polyGroup

  selectionVisualRoot
    pointer
```

The new selection visual root must:

- be a sibling of `state.polyGroup`, not a child of the avatar root;
- be persistent and pooled, not recreated during pointer movement;
- be mounted once into `state.scene` and removed/disposed on destroy;
- own only render objects, not Selection Mode state, input, acquisition,
  target scoring, hit testing, semantic targets, or DesktopWorld ownership;
- consume `currentAvatarRenderSource(state)` through the adapter added in
  `a92b7bd4d5bb99ad18ad29b30c75fe8f7722dbc5`;
- keep cursor-specific overrides explicit and outside the avatar source:
  pointer geometry, cursor-driven transform, fixed orientation, one
  screen-plane rotation axis, visibility, and scale.

The pointer behavior must remain equivalent to the accepted V10/V11 path:

- elongated triangular-pyramid pointer;
- apex/hotspot projects exactly to the real cursor coordinate;
- base sits down/right in screen space so the pointer points north-west;
- root orientation locked;
- only the screen-plane Z rotation is animated;
- no Canvas2D cursor glyph for `sigil_model`;
- pointer movement is visual-only and resource-bounded after warmup;
- hidden/stale cleanup clears pointer/trail objects.

## Naming And Compatibility

Prefer a name such as `createSelectionSceneVisualFacet()` or
`createSelectionModeSceneFacet()` if it fits the code after inspection.

The old `createSelectionModeCursorModelRenderer()` name may remain only as a
thin local compatibility wrapper if replacing all call sites would make this
slice noisy. If it remains, the new implementation should make the canonical
root and snapshots clearly say `selectionVisualRoot` / selection scene facet,
and the completion report must state the removal gate.

Likewise, remove or thin the old `currentAvatarRenderSourceForSelectionPointer()`
wrapper if the new facet can call `currentAvatarRenderSource(state)` directly
without causing unrelated churn.

## Hard Boundaries / Non-Goals

- Do not move selection frames, connectors, enter/exit effects, badge bubbles,
  badge text, or reticle/radial/fast-travel visuals in this round.
- Do not make selection visuals children of the avatar root.
- Do not add a broad visual framework for every Sigil mode yet.
- Do not move runtime state or input behavior into Three objects.
- Do not render inherited aura/phenomena as new pointer effect geometry in this
  slice unless the current renderer already does so. Actual aura/effect
  rendering remains a later proof after the scene facet root is stable.
- Do not mutate real avatar materials from pointer-specific opacity, depth,
  render order, scale, or visibility changes.

## Suggested Implementation Areas

Suggested, not mandatory:

- Add `apps/sigil/renderer/live-modules/selection-scene-visual-facet.js`.
- Move the existing pointer root/pooling logic from
  `selection-mode-cursor-model-renderer.js` into the facet, keeping old behavior
  and tests green.
- In `main.js`, create the facet/renderer with
  `getAvatarRenderSource: () => currentAvatarRenderSource(state)`.
- Keep the existing Selection Mode overlay model shape stable unless a tiny
  metadata rename is required for tests.

## Required Tests

Add or update deterministic coverage that fails before this slice:

- The mounted root is a `selectionVisualRoot` / selection scene facet root and
  is a direct child of the scene, not `state.polyGroup`.
- The pointer is a child of that root and keeps the accepted
  avatar-derived triangular pointer geometry.
- Pointer updates still consume the avatar render-model adapter and do not use a
  pointer-specific material/effect source string.
- Cursor-specific overrides remain outside the avatar render source.
- Pointer movement after warmup does not create new root groups, scene adds,
  geometries, materials, or trail instances when the avatar source is stable.
- Hidden/stale cleanup still hides or clears the facet pointer/trails.
- Canvas2D cursor projection remains disabled for `sigil_model`, while frames,
  connectors, badges, and text remain in the existing overlay.

Prefer focused unit tests around the new facet plus the existing runtime and
performance tests. Do not rely on screenshots for this slice.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/avatar-render-model-adapter.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --test tests/renderer/sigil-avatar-render-model-adapter.test.mjs tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
```

If you add a new module or test file, include it in `node --check` or
`node --test` as appropriate. If this changes boot wiring in `main.js` beyond a
thin replacement, also run:

```bash
./build.sh --no-restart
```

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the selection scene facet boundary;
- whether the old cursor renderer or pointer-specific avatar-source wrapper
  remains, and the removal gate if so;
- confirmation that `selectionVisualRoot` is a sibling scene root, not an avatar
  child;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- confirmation that no push/GitHub mutation occurred.
