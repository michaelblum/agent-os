# Sigil Scene Visual Facet Selection Mode Spike V0

## Recipient

GDI.

## Transfer Kind

GDI design/architecture investigation. This is not an implementation
correction round.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Current reviewed implementation head before this spike:
  `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Adjacent cards:
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
  - `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`
- User product concern: V10/V11 are pushing toward an avatar-derived pointer,
  but may still be too narrow if they only copy materials/effect metadata. The
  broader question is whether Selection Mode pointer, frames, connectors, and
  effects should render as a first-class Three.js scene facet fed by the
  current live avatar appearance/effect source.

## Single Goal

Produce a short design note and recommendation for whether Sigil should render
Selection Mode visuals through a shared Three.js scene visual facet pattern
instead of continuing to patch a separate cursor model or Canvas2D-only overlay
path.

The recommendation must settle the next smallest implementation slice. Do not
continue V11-style implementation work until this design question is answered.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: current local head containing this work card, with
  implementation baseline no older than
  `ad2c0c57927dd8a3b6264a8164ea132cb8c2e51b`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the design note locally on that branch if you create or update one.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-avatar-derived-pointer-v10.md`
- `docs/design/work-cards/selection-mode-avatar-derived-pointer-effects-v11.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/scene.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/live-modules/radial-object-control.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/avatar-object-control.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/aura.js`
- `apps/sigil/renderer/phenomena.js`
- `apps/sigil/renderer/skins.js`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
```

This is a source inventory and design slice. Do not run live AOS checks unless
you determine live renderer evidence is necessary for the recommendation. If
live AOS verification becomes necessary and `./aos ready` reports repo-mode
Accessibility, Input Monitoring, or inactive input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Design Question

Can Sigil render Selection Mode pointer, selection rects/frames, connectors, and
effects in the same Three.js scene/composition as the avatar without breaking
existing conceptual contracts?

Evaluate this proposed mental model:

```text
scene
  avatarRoot
    alpha
    omega
    avatar effects

  selectionVisualRoot
    pointerMesh
    selectionFrames
    connectors
    selectionEffects
```

`avatarRoot` and `selectionVisualRoot` should be siblings. Selection visuals
must not be children of the avatar root because they should not inherit avatar
position, idle rotation, or normal avatar transform state.

Both roots may read from the same current avatar appearance/effect source.
Selection Mode runtime remains the owner of Selection Mode state, target path,
candidates, acquisition, and input behavior.

## Inventory Required

Create or update a concise design note at:

```text
docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md
```

The design note must include an inventory table for:

- radial menu visuals;
- radial menu target surface / semantic child canvas;
- radial object/effect controls;
- fast travel visuals;
- annotation reticle;
- current Selection Mode runtime, visual model, cursor renderer, and overlay;
- avatar rendering, appearance, aura, phenomena, skins, and object controls.

For each row, capture:

- current state owner;
- current render surface: Three scene object, Canvas2D overlay, DOM/child
  canvas, or mixed;
- appearance/effect source;
- coordinate/projection source;
- allocation/pooling/cleanup behavior visible from source;
- accessibility or semantic target surface, if any;
- whether it should align to a future scene visual facet pattern.

## Recommendation Required

The design note must include:

- recommended boundary diagram for a `SigilSceneVisualFacet` or better named
  pattern;
- explicit keep/move/defer list for Selection Mode pointer, frames, connectors,
  enter/exit effects, trails, badges, and text labels;
- whether radial, reticle, and fast-travel should share the same pattern later
  or stay separate;
- where avatar appearance/effect source should live and how selection visuals
  should consume it;
- cursor-only override mask:
  geometry, cursor-driven transform, fixed orientation, one screen-plane
  rotation axis, visibility, and scale;
- non-goals: input ownership, hit testing, semantic target ownership,
  acquisition, target scoring, and DesktopWorld state ownership;
- one proposed smallest implementation slice after the design note.

Use these terms where they fit:

- avatar-derived render instance;
- render-model adapter;
- appearance/effect source;
- transform driver;
- cursor-driven world transform;
- selection scene facet;
- visual root / render root;
- override mask.

## Performance And Cleanup Constraints

The recommendation must preserve these constraints:

- pointer movement remains visual-only;
- no structural sync on mouse move/drag;
- no DesktopWorld publish on pointer-only frames;
- no input-region or hit-surface sync on pointer-only frames;
- no projection rebuild from debug snapshots;
- bounded object, material, and geometry allocation after warmup;
- persistent `selectionVisualRoot`;
- object pools for frames, connectors, badges, and effects if they move to
  Three;
- shared materials or derived material variants that cannot mutate the real
  avatar through pointer-specific opacity/depth changes;
- geometry buffer updates only when candidate/path changes;
- per-frame pointer transform only.

For overlay-like Three scene visuals, evaluate:

- `depthTest: false`;
- `depthWrite: false`;
- stable `renderOrder`;
- DesktopWorld/canvas rect projection to scene coordinates;
- crisp scaling across displays and DPR;
- intentional occlusion rules relative to avatar geometry.

Text badges are a known hard part. The default recommendation should consider
keeping badge text in Canvas2D/DOM unless a Three text/sprite/texture approach
has a clear performance and clarity argument.

## Hard Boundaries / Non-Goals

- Do not implement the scene facet in this round.
- Do not continue V11 aura/effect pointer patching in this round.
- Do not move Selection Mode state, acquisition, hit testing, or input behavior
  into Three render objects.
- Do not make selection visuals children of the avatar root.
- Do not introduce broad compatibility shims or old/new parallel vocabulary.
- Do not remodel radial, reticle, or fast-travel behavior. Inventory and
  recommend only.
- Do not remove existing Canvas2D/DOM badge or semantic surfaces.
- Do not run broad live smoke tests unless source inspection leaves a specific
  unanswered question that only live evidence can answer.

## Suggested Smallest Slice Candidates

Choose exactly one as the recommended next implementation slice, or propose a
smaller equivalent:

- Selection pointer only as `selectionVisualRoot.pointer`, fed by the live
  avatar appearance/effect source and driven by a cursor transform driver.
- Selection frames only as pooled Three lines/planes with badge text staying in
  the existing overlay.
- A render-model adapter only, with no visible behavior change, that exposes
  current avatar appearance/effect source to both avatar and future scene
  facets.

## Verification

Run at minimum:

```bash
git diff --check
```

If the design note edits code comments, tests, or production files, also run the
appropriate `node --check` or focused tests for those paths. Production code
changes are expected to be unnecessary for this spike.

## Completion Report

Return:

- commit SHA if you committed the design note;
- files changed;
- path to the design note;
- concise answer to the main question: yes, no, or yes with boundaries;
- recommended next implementation slice and why it is the smallest reversible
  proof;
- keep/move/defer summary for Selection Mode visuals;
- whether radial/reticle/fast-travel should converge on the same facet pattern;
- verification commands and pass/fail result;
- confirmation that no production implementation work, push, PR mutation, or
  GitHub issue mutation occurred.
