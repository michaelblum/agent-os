# Selection Mode Live Smoke Correction V7

## Recipient

GDI.

## Transfer Kind

Correction round after Operator live smoke and Foreman evidence review.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, or prior live state. Read and rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Required reviewed head: `749bbb0ee1ceab0407004a1185db6cbfc6b29a7d`
- PR: https://github.com/michaelblum/agent-os/pull/392
- Operator card:
  `docs/design/work-cards/operator-selection-mode-desktopworld-model-cursor-live-smoke-v0.md`
- Operator evidence directory: `/tmp/aos-pr392-selection-mode-v6`
- Foreman diagnostic: `/tmp/aos-pr392-selection-mode-v6/05-foreman-live-render-diagnostic.json`

## Single Goal

Make the live Selection Mode smoke acceptable without weakening the strict
DesktopWorld contract: real clicks on a canvas-local semantic target must acquire
that semantic leaf, the Selection Mode cursor must be visibly and observably a
Three.js model cursor, and the render loop must not do avoidable structural work
every active Selection Mode frame.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: `749bbb0ee1ceab0407004a1185db6cbfc6b29a7d`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/operator-selection-mode-desktopworld-model-cursor-live-smoke-v0.md`
- `/tmp/aos-pr392-selection-mode-v6/02-target-candidates.json`
- `/tmp/aos-pr392-selection-mode-v6/03-selection-mode-acquired.png`
- `/tmp/aos-pr392-selection-mode-v6/03-debug-fallback-acquire.json`
- `/tmp/aos-pr392-selection-mode-v6/03-debug-fallback-acquired.png`
- `/tmp/aos-pr392-selection-mode-v6/05-foreman-live-render-diagnostic.json`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/runtime/spatial.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `tests/toolkit/annotation-projection.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-render-loop.test.mjs`
- `tests/renderer/sigil-input-regions.test.mjs`

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

## Finding 1: Semantic Targets Are Reprojected After Sigil Already Normalizes Them

The live target was created at native/display frame `367,173,360,260`.
Sigil correctly normalized the canvas window candidate to DesktopWorld:

```json
{"id":"selection-mode-live-target","projection":{"visible_display_rect":{"x":574,"y":173,"w":360,"h":260},"source_coordinate_space":"native_display"}}
```

Sigil also correctly produced the canvas-local Save button's first DesktopWorld
rect in `source_tree_node_metadata`:

```json
{"coordinate_space":"desktop_world","display_space_rect":{"x":598,"y":209,"w":90,"h":44},"source_coordinate_space":"canvas_local"}
```

But the final projection for that same semantic button was:

```json
{"display_space_rect":{"x":805,"y":209,"w":90,"h":44},"source_coordinate_space":"native_display"}
```

That extra `+207` display offset made real HITL clicks acquire only
`selection-mode-live-target`; the debug fallback acquired
`selection-mode-live-save-button` only because it clicked the shifted
DesktopWorld point `x=850`.

Likely root cause after Foreman review:

- `apps/sigil/renderer/live-modules/main.js`
  `annotationReticleSemanticTargetForDesktopWorld()` returns a target with
  `coordinate_space: 'desktop_world'` and `display_space_rect: { x: 598, ... }`.
- `packages/toolkit/workbench/annotation-projection.js`
  `buildSemanticTargetProjectionAdapterResult()` passes `source_tree_node_metadata`
  but does not pass `target.coordinate_space` to
  `normalizeAnnotationProjectionAdapterResult()`.
- `normalizeAnnotationProjectionStatus()` therefore defaults the adapter result
  coordinate space to `native_display`.
- `annotationReticleCandidateInDesktopWorld()` sees that final projection as
  native and reprojects `598` to `805`.

Required correction:

- Preserve the coordinate space of semantic target display rects through
  `buildSemanticTargetProjectionAdapterResult()`.
- Do not reproject a rect that Sigil has already normalized to DesktopWorld.
- Keep native/browser target behavior explicit. If any caller still passes
  native display semantic bounds, that input must remain marked native and still
  normalize once.
- Add a deterministic test that fails on this head and proves the final semantic
  target projection remains `x=598`, not `x=805`, for the live-smoke shape.
- Add or adjust Selection Mode acquisition coverage so a DesktopWorld pointer at
  the visible Save button center selects the semantic leaf, not just the canvas
  ancestor.

## Finding 2: Cursor Model Is In The Shared Three Scene, But The Product Proof Is Weak

The current code already mounts the Selection Mode cursor in the same Sigil
Three.js scene/WebGL canvas as the avatar:

- `apps/sigil/renderer/live-modules/main.js` creates the renderer with
  `scene: state.scene`.
- `createSelectionModeCursorModelRenderer()` receives that same scene and
  projects with `projectStageLocalToScene()`.
- `interaction-overlay.js` skips Canvas2D cursor drawing when
  `model_kind === 'sigil_model'`.

The live observation still reads as a flat "bellows" cursor, and the debug
fallback evidence had `selectionModeCursorModel` telemetry as `null` because the
snapshot was captured immediately after state mutation, before the render loop
published the renderer snapshot.

Required correction:

- Keep the cursor on the shared Sigil Three scene. Do not reintroduce a Canvas2D
  cursor for `model_kind: sigil_model`.
- Make the model read as an actual 3D cursor, not a flat projected outline. Use
  the existing avatar/radial Three patterns where appropriate rather than
  inventing another isolated stage.
- Ensure debug/live snapshots can observe the cursor model after Selection Mode
  state changes. Acceptable shapes include publishing the renderer snapshot
  during the same render tick, exposing a debug helper that waits for the next
  render frame, or making `__sigilDebug.snapshot()` report the latest model
  renderer state after an explicit update. Avoid expensive synchronous rendering
  in normal hot paths.
- Add deterministic tests that prove:
  - Canvas2D cursor drawing is skipped for `sigil_model`;
  - the Three renderer snapshot becomes visible/hotspot-aligned for a valid
    model cursor;
  - stale model objects still hide on invalid/unprojectable cursors.

## Finding 3: Selection Mode Must Not Turn Every Active Frame Into Structural Work

User-observed performance was choppy after the branch had been left running.
Foreman took a bounded live diagnostic after the Operator run:

- daemon ready and input tap active;
- `avatar-main` loaded at `2026-05-29T05:43:12.897Z`;
- renderer frame count around `701,962`;
- `renderPerformanceTelemetry.attempted` around `701,963`, `sent: 0`,
  `skipped: "panel-hidden"`;
- renderer memory was not obviously exploding: `geometries: 48`,
  `textures: 12`;
- scene object count was `409`;
- five full-screen canvases were attached in the Sigil document;
- idle state had only `avatar-motion` and was classified as visual-only with
  `idleMotionDelayMs: 33`.

The larger risk is the active Selection Mode classification:

- `renderLoopContinuationReasons()` includes `selection-mode`;
- `classifyRenderLoopWork()` treats anything except pure `avatar-motion` as
  non-visual, so active Selection Mode forces structural sync, overlay draw, and
  state publish every frame.

Required correction:

- Inspect whether active Selection Mode really needs structural work every
  frame. Cursor/trail animation may need visual frames; input regions, candidate
  geometry, hit canvases, and state publish should not churn unless dirty.
- Split visual-only Selection Mode cursor/trail animation from structural
  Selection Mode changes if that is the right contract.
- Keep existing entry/acquire/exit behavior intact, including input-region
  registration while active and cleanup after Escape.
- Add render-loop tests proving idle avatar remains visual-only and Selection
  Mode does not force avoidable structural work on unchanged frames.
- Add any lightweight telemetry needed to distinguish long-running render churn
  from actual resource accumulation. Do not add a noisy panel dependency just to
  satisfy this card.

## Scope And Hard Boundaries

- Preserve the V6 strict canvas-frame ambiguity contract.
- Preserve negative-display/DesktopWorld support; do not add display-specific
  offsets or special cases.
- Do not downgrade the cursor product claim to a 2D glyph.
- Do not redesign all of Sigil, all annotation projection, or all AOS show
  commands in this slice.
- Treat `./aos show to-front --id avatar-main` returning `UNKNOWN_ACTION` as an
  adjacent AOS CLI/help mismatch unless it is required for this fix.
- Treat missing `cursor_suppression_owner` in Operator snapshots as an evidence
  gap unless you prove the live registered input-region payload lacks it.
- Do not push or mutate GitHub state.
- Foreman will decide the next live proof route after reviewing this correction.

## Verification

Run at minimum:

```bash
git diff --check
node --check packages/toolkit/workbench/annotation-projection.js
node --check packages/toolkit/runtime/spatial.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --check apps/sigil/renderer/live-modules/render-loop.js
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/runtime-spatial.test.mjs
node --test tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-render-loop.test.mjs tests/renderer/sigil-input-regions.test.mjs
./build.sh --no-restart
```

If you touch broader annotation-reticle or Surface Inspector projection behavior,
also run the adjacent affected suites before reporting completion.

## Completion Report

Return:

- commit SHA;
- files changed;
- concise summary of the semantic projection fix and the failing evidence/test
  it closes;
- concise summary of the cursor model/telemetry correction;
- concise summary of the performance/render-loop correction or, if no code
  change is justified, the measured reason and follow-up boundary;
- exact tests run and pass/fail result;
- whether `./aos ready --json` passed or whether the TCC recovery path was
  used;
- confirmation that no push/GitHub mutation occurred.
