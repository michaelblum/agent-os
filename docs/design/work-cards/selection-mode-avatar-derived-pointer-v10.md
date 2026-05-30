# Selection Mode Avatar-Derived Pointer V10

## Recipient

GDI.

## Transfer Kind

Correction round after Foreman/user product review of V9.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `24eb2ac912d4ff0a0801a47b9da5f12cff16259e`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction card:
  `docs/design/work-cards/selection-mode-render-only-pointer-correction-v9.md`
- Foreman review note: V9 deterministic review passed, but user still reports
  less-than-stellar live performance and rejects the independent cursor visual
  model.

## Single Goal

Replace the independent Selection Mode cursor model with an avatar-derived
pointer render harness.

The Selection Mode pointer must be a derived view of the current live Sigil
avatar, not the default avatar shape: same current appearance/effects/color/
material source, same shared scene, but with a forced pointer geometry, locked
orientation, pointer-hotspot placement, and single-axis cursor rotation.

## Product Contract

The cursor is not a second bespoke model. Treat it as a decorated/avatar-derived
render instance:

- Source visuals from the current live avatar render state or current avatar
  appearance model.
- If the user changes avatar appearance, colors, effects, skin, aura, or other
  visual controls, the Selection Mode pointer inherits those visuals without a
  separate manual mapping table drifting out of date.
- The only cursor-specific overrides are geometry, orientation, pointer
  hotspot, scale if needed, visibility, and the single cursor rotation axis.
- The pointer shape is an elongated tetrahedral/triangular-pyramid pointer:
  the pointy apex is exactly at the real mouse cursor coordinates.
- The base sits below and to the right of the cursor location in screen space,
  so the pointer points north-west relative to the display.
- The pointer rotates on exactly one axis in the screen plane. It must not use
  the avatar's normal idle rotation axes or quick-spin settings.
- No Canvas2D cursor glyph should render for the `sigil_model` pointer path.
- Do not create unbounded objects, geometries, materials, or effects during
  pointer movement.

Use the local name that makes ownership clear. Good candidates are
`avatar-derived pointer`, `avatar render-model decorator`, or
`selection pointer render adapter`. Avoid names that imply an independent
cursor model owns avatar appearance.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `24eb2ac912d4ff0a0801a47b9da5f12cff16259e`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-render-only-pointer-correction-v9.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/avatar-object-control.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/appearance.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/aura.js`
- `apps/sigil/renderer/skins.js`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`
- `tests/renderer/avatar-object-control.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos ready --json
```

If `./aos ready` reports repo-mode Accessibility, Input Monitoring, or inactive
input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Required Design Correction

The current cursor renderer constructs its own shape and hand-maps color/aura
fields:

- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
  creates separate core/edge materials and updates colors from
  `overlay.cursorGlyph`.
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js` projects a
  cursor glyph shape instead of exposing an avatar-derived render contract.

That is the wrong ownership model. It makes the cursor visually lag behind
avatar customization and encourages another parallel effects stack.

Implement the cursor as a derived avatar render harness:

- Reuse the current live avatar appearance/render source instead of duplicating
  appearance mapping inside Selection Mode.
- Reuse the current avatar scene family or a bounded clone/derived instance
  created once and reused. Do not clone on every pointer move.
- Override only the primary shape geometry to the elongated pointer shape.
- Preserve inherited materials/effects/skin/aura wherever they are meaningful
  for a pointer-sized avatar-derived instance.
- Lock the pointer root transform so its apex maps exactly to the projected
  cursor point.
- Orient the long axis north-west in screen coordinates, with the base below
  and right of the cursor point.
- Animate only the approved single rotation axis in the screen plane.
- Keep V9's visual-only pointer scheduling and stale-hidden-frame cleanup.

If the current avatar renderer cannot be reused directly without unacceptable
coupling, extract a narrow avatar render-model adapter first, then feed both the
normal avatar and the Selection Mode pointer from that source. Do not solve this
by adding another hand-synchronized `cursorGlyph` color/effect object.

## Performance Requirements

- Pointer movement stays visual-only: no structural sync, input-region sync,
  hit-surface sync, DesktopWorld publish, or projection rebuild on ordinary
  mouse move/drag.
- Debug snapshots remain cached reads and must not refresh the pointer model.
- Object/resource counts are bounded after warmup.
- No per-frame material/geometry allocation on pointer movement.
- Live rendering should not visibly stutter in Selection Mode under normal
  pointer movement.

## Required Tests

Add deterministic coverage that would fail on V9:

- The Selection Mode pointer render source is avatar-derived, not a separate
  hand-mapped color/material model.
- Avatar appearance changes are reflected by the pointer without updating a
  separate cursor color/effect mapping.
- The forced geometry has apex/hotspot at local origin and an elongated
  triangular-pyramid/tetrahedral pointer shape whose base is down/right in
  screen projection.
- The pointer root has fixed orientation and only one animated screen-plane
  rotation axis, independent of normal avatar idle rotation settings.
- Pointer movement remains visual-only and resource-bounded after warmup.
- Hidden cleanup still clears stale pixels/objects.

Prefer behavior tests at the avatar-derived render adapter seam. Source-shape
tests are acceptable only for invariants that cannot be tested cleanly through
runtime objects.

## Live Smoke Requirement

Run a bounded live smoke only after deterministic gates pass:

- reload or recreate `avatar-main` on the corrected branch;
- enter Selection Mode;
- move the pointer over a visible target and watch responsiveness;
- confirm the pointer looks like the current avatar with only the forced shape
  and locked rotation/orientation changed;
- exit Selection Mode;
- hide Sigil or restore pre-run visibility;
- confirm no stale purple dot remains.

Use `./aos` commands only. If live AOS/TCC blocks, use the GDI human-needed TCC
reset path above and stop.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-visual-model.js
node --check apps/sigil/renderer/live-modules/render-loop.js
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
node --test tests/renderer/avatar-object-control.test.mjs tests/renderer/sigil-render-loop.test.mjs
./build.sh --no-restart
./aos ready --json
```

If you touch broader avatar appearance/effects/geometry code, rerun the
adjacent affected renderer suites before reporting completion.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the avatar-derived pointer design;
- exact explanation of which avatar visual source the pointer reuses;
- exact cursor-only overrides that remain;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- live smoke result and cleanup snapshot if run;
- confirmation that no push/GitHub mutation occurred.
