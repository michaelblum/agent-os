# Selection Mode Performance And Model Cursor Correction V8

## Recipient

GDI.

## Transfer Kind

Correction round after V7 completion report and human live-product review.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, performance state, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `7e32874e4811e8af692890573a1f171ca45afe5f`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Prior correction cards:
  - `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v5.md`
  - `docs/design/work-cards/selection-mode-desktopworld-model-cursor-correction-v6.md`
  - `docs/design/work-cards/selection-mode-live-smoke-correction-v7.md`
- Prior performance contract:
  - `docs/design/work-cards/sigil-render-performance-regression-v0.md`

## Single Goal

Make the V7 Selection Mode branch acceptable for live use by fixing the
reported performance regression and making the Selection Mode cursor visibly
and structurally a real Sigil/Three.js 3D cursor model rather than a flat glyph.

This correction must also add deterministic guard coverage for the recurring
agent failure class: a visual animation or overlay mode accidentally causing
full structural sync, state publication, object allocation, or debug-snapshot
work every frame.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `7e32874e4811e8af692890573a1f171ca45afe5f`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/selection-mode-live-smoke-correction-v7.md`
- `docs/design/work-cards/sigil-render-performance-regression-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `tests/renderer/sigil-render-loop.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`

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

## Human Report

After V7, the user reports:

- performance is worse now;
- this degradation pattern has happened before, been fixed, then returned;
- the repo needs a performance test battery that catches the repeat mistake
  agents make when touching Sigil render/overlay code;
- the Selection Mode cursor still reads as flat;
- the desired cursor can be essentially an avatar-like Sigil model: a conic
  prism with an equilateral triangular base, three sides along its length, and
  the central/long axis aligned with the scene axis that corresponds to the
  screen depth axis.

Treat the performance report as blocking. Do not accept V7 as-is.

## Finding 1: Debug Snapshot And Visual Frames Can Still Do Hot Work

V7 made `selection-mode` a visual-only render-loop reason, which is directionally
right. But review of the current head shows remaining risk:

- `animate()` still calls `updateSelectionModeCursorModelSnapshot()` every
  frame, regardless of whether the Selection Mode cursor/overlay changed.
- `window.__sigilDebug.snapshot()` calls the same update helper, so debug
  reads can mutate/update the model instead of returning the latest known
  renderer state.
- The update helper can build a projected Selection Mode overlay when
  `liveJs.selectionModeOverlay` is absent, making a read/update path perform
  projection work.
- The model renderer can allocate trail model instances up to the configured
  repeat count; repeated unchanged frames should reuse existing scene objects
  and never add/remove scene objects after warmup.

Required correction:

- Keep active Selection Mode visual frames cheap. Cursor/trail animation may
  update existing Three.js transforms/material opacity, but unchanged frames
  must not force structural sync, overlay redraw, DesktopWorld state publish,
  input-region sync, hit-target sync, or fresh projection/candidate work.
- Make `__sigilDebug.snapshot()` a read of the latest model state, not a normal
  hot-path renderer update. If a force-refresh debug helper is needed, make it
  explicit and bounded rather than hidden inside every snapshot.
- Avoid rebuilding projected overlays from the cursor model snapshot path on
  every active frame. Use already-owned Selection Mode visual state or a dirty
  flag/cache that is updated when input/session state changes.
- Ensure repeated calls to the cursor renderer with an unchanged overlay do not
  allocate additional geometries, materials, trail objects, root groups, or
  scene children after the first warmup for the configured repeat count.
- Keep V7's semantic target projection fix intact.

## Finding 2: Add A Small Sigil Performance Guard Battery

The desired test coverage is not a benchmark with fragile wall-clock numbers.
It should be a deterministic guard battery for recurring hot-path mistakes.

Add focused tests that would fail for the repeated bad pattern:

- visual-only Selection Mode frames stay visual-only and do not request
  structural sync, overlay publish, or DesktopWorld state publish when no
  Selection Mode structural input changed;
- debug snapshot/read behavior does not perform a model update or projection
  rebuild as a side effect;
- repeated unchanged cursor-model updates reuse scene objects and keep object
  counts bounded after warmup;
- invalid/unprojectable cursor updates still hide stale primary/trail objects;
- a dirty/acquire/exit frame still performs the required structural work and
  cleanup, so the perf fix does not break Selection Mode lifecycle.

Prefer adding a new focused test file such as
`tests/renderer/sigil-selection-mode-performance.test.mjs` or adding a clearly
named group to existing renderer tests. Keep the tests deterministic and
fast. Do not add a broad profiler or flaky timing threshold.

## Finding 3: Current Cursor Geometry Is Not The Requested 3D Model

Current `selection-mode-cursor-model-renderer.js` creates a triangular prism,
but it is a slim mesh whose long axis is effectively in the screen plane and
whose base is not proven equilateral. That explains why the live result can
still read as flat even though it is technically a Three.js mesh.

Required correction:

- Keep the cursor in the shared Sigil Three.js scene. Do not restore Canvas2D
  cursor drawing for `model_kind: "sigil_model"`.
- Replace or revise the cursor geometry so the product claim is true:
  - equilateral triangular base/cross-section;
  - three side faces along the cursor length;
  - meaningful depth along the scene axis corresponding to screen depth;
  - central/long axis aligned to that depth axis;
  - the cursor hotspot remains aligned to the live pointer point;
  - the trail repeats the same model shape, not a 2D outline.
- Reuse the avatar/Sigil visual vocabulary: aura colors, edge glow, trail
  settings, idle rotation/vitality multiplier, and shared scene/camera
  projection.
- Add deterministic geometry tests that inspect the generated model enough to
  prove it is not flat:
  - non-zero depth extent on the expected axis;
  - equilateral triangle side lengths within a small epsilon;
  - primary and trail instances use the same geometry family;
  - hotspot alignment and scene position remain correct.

If the exact camera/screen axis naming is ambiguous in the current renderer,
pick the scene axis used for depth by `projectAvatarToScene()` /
`projectStageLocalToScene()` and document that in code/test names.

## Scope And Hard Boundaries

- Preserve the V7 semantic projection fix: real clicks on the visible semantic
  Save button center must acquire the semantic leaf, not the ancestor canvas.
- Preserve the V6 strict DesktopWorld ambiguity contract.
- Preserve negative-display/DesktopWorld support; do not add display-specific
  offsets or special cases.
- Do not downgrade the cursor product claim to a 2D glyph.
- Do not remove expected avatar or Selection Mode visual animation.
- Do not move Sigil product policy into the daemon.
- Do not add a broad profiler, new perf framework, or timing-flaky test.
- Do not start unrelated PR #392 cleanup or push GitHub state.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/render-loop.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs
```

Also run any new focused performance test file you add, for example:

```bash
node --test tests/renderer/sigil-selection-mode-performance.test.mjs
```

Because the report is live performance-sensitive, finish with:

```bash
./build.sh --no-restart
```

If live readiness remains available and you can run a bounded smoke without
permission churn, also collect a compact `__sigilDebug.snapshot()` before and
after a short Selection Mode idle/cursor interval and report:

- `renderLoop.work`;
- `selectionModeCursorModel`;
- scene object/geometry counts if available;
- whether snapshot reads changed any cursor model update counters.

Do not block deterministic acceptance on flaky live timing measurements.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise root cause for the performance regression;
- exact guard tests added and what recurring mistake they catch;
- concise description of the cursor geometry/axis fix;
- exact verification commands and pass/fail result;
- whether `./aos ready --json` passed or the TCC recovery path was used;
- whether any live smoke/debug snapshot evidence was collected;
- local-only state still present;
- whether the branch is ready for Foreman to push/update PR #392 or needs
  another correction.
