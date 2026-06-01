# Selection Mode DesktopWorld And Model Cursor Correction V5

## Recipient

GDI.

## Transfer Kind

Correction round.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, or prior implementation state. Read and rediscover before
editing.

## Source Artifact

- PR: https://github.com/michaelblum/agent-os/pull/392
- PR title: `feat(selection-mode): add model cursor and ancestor ladder`
- Required head reviewed by Foreman and Operator:
  `0ad72ead315d0052a1154fbb09e58e7c3893e672`
- Operator live validation artifacts:
  - `/tmp/aos-pr392-selection-mode/01-selection-mode-active-cursor.png`
  - `/tmp/aos-pr392-selection-mode/02-selection-mode-target-before-acquire.png`
  - `/tmp/aos-pr392-selection-mode/03-selection-mode-acquired-badges.png`
  - `/tmp/aos-pr392-selection-mode/04-selection-mode-retargeted-badge.png`
  - `/tmp/aos-pr392-selection-mode/05-selection-mode-after-exit-cleared.png`
- Foreman review mode: thermo-nuclear code-quality review.

## Single Goal

Make PR #392 live-mergeable by correcting the two visual/model blockers without
weakening the intended Selection Mode behavior:

1. Selection Mode candidate frames and ancestor badges must align with their
   live DesktopWorld targets on multi-display layouts, including a negative-left
   display/main-display-offset topology.
2. The Selection Mode cursor must be rendered by a real Sigil/avatar-derived
   model path, not a Canvas2D polygon that merely labels itself
   `model_kind: sigil_model`.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `0ad72ead315d0052a1154fbb09e58e7c3893e672`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/guides/aos-surface-interaction-decision-tree.md`
- `/Users/Michael/Code/agent-os/.docks/foreman/skills/thermo-nuclear-code-quality-review/SKILL.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/selection-mode-badges.js`
- `apps/sigil/renderer/live-modules/avatar-object-control.js`
- `apps/sigil/renderer/live-modules/ux-tree.js`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/runtime/desktop-world-surface.js`
- `packages/toolkit/runtime/desktop-world-surface-three.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/selection-mode.js`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-ux-tree.test.mjs`
- `tests/toolkit/desktop-world-surface-three.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos ready --json
```

If live readiness reports repo-mode Accessibility, Input Monitoring, or
inactive input-tap blockers and live evidence is needed, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Blocker 1: Selection Overlay Projection Is In The Wrong Coordinate Contract

Operator proved the live target at native `[120,120,360,260]` rendered Selection
Mode candidate/badge evidence shifted by the DesktopWorld offset/dead-space
amount. The screenshots make this visible, especially
`03-selection-mode-acquired-badges.png`.

Relevant suspect paths:

- `apps/sigil/renderer/live-modules/main.js:1916`:
  `annotationReticleCanvasDesktopWorldRect()` reads `canvas?.atResolved ||
  canvas?.at` and unconditionally runs `nativeToDesktopWorldRect(...)`.
- `apps/sigil/renderer/live-modules/main.js:2004`:
  `annotationReticleCanvasCandidate()` repeats the same assumption.
- `apps/sigil/renderer/live-modules/main.js:2048`:
  `annotationReticleSemanticTargetForDesktopWorld()` adds local semantic target
  rectangles to `annotationReticleCanvasDesktopWorldRect(canvasId)`, so one bad
  canvas-space assumption shifts every Selection Mode candidate.
- `packages/toolkit/components/surface-inspector/index.js:2991` already has a
  `normalizeCanvasesToDesktopWorld()` path that writes `atResolved` in
  DesktopWorld coordinates. Treating that resolved value as native later
  double-applies the display offset.

Required correction:

- Make the coordinate-space boundary explicit and canonical.
- Do not patch this with Sigil-local offset arithmetic, magic `+/-207` values,
  or a local "if negative display" branch.
- Prefer a shared toolkit/spatial normalization helper that takes canvas
  lifecycle geometry plus display topology and returns a single normalized
  DesktopWorld canvas frame with coordinate-space metadata.
- Route Sigil candidate and semantic-target projection through that shared path.
- If `atResolved` can be either native or DesktopWorld today, make that
  ambiguity loud and eliminate it at the boundary. Downstream selection-mode
  rendering should not need to guess.

Add deterministic coverage for a topology with a left display at negative
DesktopWorld X and the main display offset by that amount. The test must fail
against the current double-conversion behavior and prove:

- a native canvas rect projects once into DesktopWorld;
- an already DesktopWorld-normalized canvas rect is not projected again;
- semantic target local rects added to that canvas frame align with the final
  Selection Mode overlay frame.

## Blocker 2: The Cursor Claims A Sigil Model But Renders As Canvas2D Strokes

The product claim and data model say model cursor; the renderer draws a flat
Canvas2D polygon.

Relevant paths:

- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js:204`
  returns `model_kind: 'sigil_model'`, `shape:
  'three_sided_pyramid_prism'`, and `geometry.primitive:
  'triangular_prism'`.
- `tests/renderer/sigil-selection-mode-runtime.test.mjs:128` asserts those
  fields but does not prove the visual path uses a model renderer.
- `apps/sigil/renderer/live-modules/interaction-overlay.js:21` through `99`
  computes 2D projection points, calls `ctx.beginPath()`, `ctx.lineTo()`,
  `ctx.fill()`, and `ctx.stroke()`. There is no Three.js mesh, geometry,
  material, lighting, depth, or avatar object graph integration.
- The live screenshot `01-selection-mode-active-cursor.png` confirms the result
  is a glowing 2D polygon, not a real avatar-derived model.

Required correction:

- Render the Selection Mode cursor through the real Sigil model/Three.js path
  if PR #392 keeps the model-cursor product claim.
- Reuse the existing Sigil scene/avatar/object-control vocabulary where
  possible. `avatar-main` is allowed to be a private 3D renderer for rich Sigil
  product expression, but do not fake a model in the 2D overlay and label it as
  one.
- The cursor model must have real geometry/depth semantics and be positioned so
  its tip hotspot is exactly the current pointer.
- The trail should repeat the rendered model expression or a deliberately named
  model-derived projection. Do not make the primary cursor a model and leave the
  trail as an unrelated hard-coded polygon unless the model contract says so.
- If the product decision changes to "2D glyph cursor", then remove the model
  claims from `selection-mode-visual-model.js`, tests, PR description, and UX
  vocabulary. Given the current product direction, assume the fix is real model
  rendering, not a downgrade.

Add coverage that would fail for the current implementation. It is acceptable to
use a renderer seam or fake Three classes, but the test must prove that
`model_kind: sigil_model` is consumed by a model renderer/scene object and not
only by Canvas2D stroke/fill code.

## Scope And Hard Boundaries

- Preserve the existing behavior that already passed live validation:
  - Selection Mode enters from avatar double-click.
  - Native cursor suppression is active while Selection Mode is active.
  - Acquisition creates a Display -> stage -> panel -> target path.
  - Badges render leaf-to-root.
  - Badge retargeting preserves acquisition pointer and clicked leaf evidence.
  - Escape exits and unregisters the Selection Mode input region.
- Do not broaden this into a redesign of the whole Sigil renderer.
- Do not move Sigil product expression into daemon code.
- Do not add another private DesktopWorld coordinate system inside Sigil.
- Do not hide this behind screenshots only. Add deterministic seams.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --test tests/renderer/sigil-selection-mode-input.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-input-regions.test.mjs tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-ux-tree.test.mjs
node --test tests/daemon/input-region-cursor-suppression.test.mjs
bash tests/daemon-input-surface-ownership.sh
./build.sh --no-restart
```

Add or update the narrow deterministic tests described in both blocker
sections. Include exact test names in the completion report.

Live proof is required after GDI completes. Do not self-accept this round on
deterministic tests alone; Foreman will route Operator for another bounded
Selection Mode smoke.

## Completion Report

Return:

- commit SHA;
- concise summary of the projection ownership fix;
- concise summary of the cursor model rendering fix;
- whether any product claim was narrowed instead of implementing real model
  rendering;
- tests run and exact pass/fail result;
- any live-readiness blocker and whether `.docks/gdi/scripts/human-needed-tcc-reset`
  was used;
- residual risks or follow-up slices.
