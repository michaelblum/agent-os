# Sigil Avatar Render Model Adapter V0

## Recipient

GDI.

## Transfer Kind

Implementation round after acceptance of the Selection Mode scene visual facet
spike.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required design head:
  `843076bc48151d0a8713851eef2f83c65c9c35f6`
- Design note:
  `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- Spike card:
  `docs/design/work-cards/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- Prior implementation cards for context only:
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`

## Single Goal

Build a current-avatar render-model adapter with no visible behavior change.

The adapter should expose the current live avatar appearance/effect source as a
renderer-owned source that the existing Selection Mode cursor renderer can
consume now and future scene visual facets can consume later. This is the
adapter-only proof recommended by the scene visual facet design note.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: current local head containing this work card, with
  design baseline no older than
  `843076bc48151d0a8713851eef2f83c65c9c35f6`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the implementation locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/aura.js`
- `apps/sigil/renderer/phenomena.js`
- `apps/sigil/renderer/skins.js`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/avatar-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
```

This slice should be deterministic. Do not run live AOS checks unless local
tests reveal a renderer behavior that cannot be resolved without live evidence.
If live AOS verification becomes necessary and `./aos ready` reports repo-mode
Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Current Seams To Replace Or Generalize

Current source seam:

- `apps/sigil/renderer/live-modules/main.js`
  `currentAvatarRenderSourceForSelectionPointer()`

Current consumers:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
  calls `getAvatarRenderSource()` and clones/copies primary and edge materials.
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
  still declares cursor-only source strings such as
  `material_source: 'state.coreMesh/state.wireframeMesh/state.skinMaterial'`
  and `effects_source: 'state.polyGroup avatar effect family'`.

The adapter should make this source general enough for an avatar-derived render
instance without moving visual roots yet.

## Required Behavior

Create a small renderer-owned adapter, likely near the live renderer modules,
that can emit a current avatar render source resembling:

```text
currentAvatarRenderSource()
  source: avatar_render_state
  appearanceSource: current_live_sigil_avatar
  materialSource: current_avatar_render_model
  version
  geometryType
  skin
  primaryMaterialTemplate
  edgeMaterialTemplate
  colors/colorRamp
  auraDescriptor
  phenomenaDescriptor
  trailDescriptor
  effectRootDescriptor
```

Use names that match the existing codebase after inspection. The important
contract is ownership, not the exact field spelling above.

The adapter must:

- read from current live avatar renderer state, not from Selection Mode state;
- preserve the existing cursor material behavior through the current
  `getAvatarRenderSource()` seam;
- expose descriptors for current avatar aura/effects/trails/skin where those
  are available from state, even if the existing cursor renderer does not render
  all descriptors yet;
- keep cursor-specific overrides outside the avatar source:
  pointer geometry, cursor transform, fixed orientation, single screen-plane
  rotation axis, visibility, and scale;
- include a stable version or identity that changes when relevant avatar
  appearance/effect inputs change;
- avoid cloning or allocating Three materials/effect objects merely to read the
  source;
- ensure pointer-specific opacity, depth, render order, or scale cannot mutate
  the real avatar materials or effect objects;
- keep the existing Selection Mode Canvas2D overlay, cursor Three root, frames,
  connectors, effects, badges, and text behavior visually unchanged.

## Hard Boundaries / Non-Goals

- Do not implement `selectionVisualRoot` or `SigilSceneVisualFacet` in this
  round.
- Do not move pointer, frames, connectors, trails, badges, text, or enter/exit
  effects to a new scene facet.
- Do not make selection visuals children of the avatar root.
- Do not move Selection Mode state, input, hit testing, acquisition, target
  scoring, semantic target ownership, or DesktopWorld ownership into the
  adapter.
- Do not render inherited aura/phenomena in the pointer as part of this slice
  unless it falls out as metadata-only debug state with no visible behavior
  change. Actual pointer effect rendering belongs to a later slice.
- Do not add broad compatibility shims. If the old pointer-specific source name
  remains as a local wrapper, make it a thin compatibility call within this
  branch and identify the removal gate in the completion report.

## Suggested Implementation Areas

Suggested, not mandatory:

- Add a focused module such as
  `apps/sigil/renderer/live-modules/avatar-render-model-adapter.js`.
- Replace `currentAvatarRenderSourceForSelectionPointer()` in `main.js` with a
  thin call to the adapter.
- Keep `createSelectionModeCursorModelRenderer({ getAvatarRenderSource })`
  working through the same callback shape.
- Update cursor renderer source identity logic only as needed to consume the
  generalized adapter source without increasing per-frame material churn.
- Update tests to assert the source is avatar-render-model-derived instead of a
  pointer-specific string bundle.

## Required Tests

Add or update deterministic coverage that fails before this slice:

- Adapter output is derived from live avatar renderer state and includes
  geometry, skin, material templates, color/aura/effect descriptors, and a
  version/identity.
- The adapter version/identity changes when relevant avatar appearance/effect
  fields change, including at least one non-material effect field.
- Cursor-specific override fields do not live in the avatar render source.
- The existing cursor renderer still consumes the source through
  `getAvatarRenderSource()` and preserves material cloning/copying behavior.
- Pointer movement remains visual-only and resource-bounded after warmup.
- The misleading runtime assertion from the V11 review is not made worse:
  tests should not imply that absence of pointer aura rendering is the final
  product contract.

Prefer focused unit tests for the adapter plus the existing cursor renderer and
Selection Mode runtime tests. Do not rely on screenshots for this slice.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
node --test tests/renderer/avatar-object-control.test.mjs
```

If you add a new module or test file, include it in `node --check` or
`node --test` as appropriate.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the adapter boundary;
- exact source fields/descriptors exposed by the adapter;
- how the existing cursor renderer consumes the adapter without visible behavior
  change;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- whether any old pointer-specific wrapper remains and its removal gate;
- confirmation that no push/GitHub mutation occurred.
