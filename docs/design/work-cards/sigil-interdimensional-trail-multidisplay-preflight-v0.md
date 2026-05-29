# Sigil Interdimensional Trail Multidisplay Preflight V0

## Recipient

GDI.

## Transfer Kind

Correction / investigation round before the Selection Mode scene facet pointer
slice.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, screenshot, display topology, or prior implementation state. Read and
rediscover before editing.

## Source Artifact

- Branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Current coordination head before this card:
  `6f33710d`
- Deferred next card:
  `docs/design/work-cards/sigil-selection-scene-facet-pointer-v0.md`
- User live report before sending the pointer-facet card: the
  interdimensional trail effect renders on the extended display but not on the
  main display.

## Single Goal

Classify and fix the current multi-display interdimensional trail asymmetry
before moving Selection Mode pointer or selection rect visuals into a scene
facet.

This is a preflight because the same DesktopWorld-to-segment projection and
multi-display scene-root rules will affect `selectionVisualRoot.pointer` and
future selection rects.

## Branch / Base

- `branch_from`: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- `required_start_ref`: current local head containing this work card, with
  baseline no older than `6f33710d`
- Work surface/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- Commit the correction locally on that branch if code or tests change.
- Do not push, open or update PRs, close issues, or mutate GitHub state unless
  Foreman explicitly reassigns that responsibility.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/sigil-scene-visual-facet-selection-mode-spike-v0.md`
- `docs/design/work-cards/sigil-selection-scene-facet-pointer-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/desktop-world-surface-runtime.js`
- `packages/toolkit/runtime/desktop-world-surface-three.js`
- `packages/toolkit/runtime/spatial.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/omega.js`
- `apps/sigil/renderer/particles.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-visual-model.js`
- `apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `tests/renderer/fast-travel-preview.test.mjs`
- `tests/renderer/omega-trail.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs`
- `tests/renderer/sigil-selection-mode-performance.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos ready --json
```

Use `./aos` as the primary live-runtime control plane. If `./aos ready`
reports repo-mode Accessibility, Input Monitoring, or inactive input-tap
blockers and live verification is required, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`.

## Initial Foreman Notes

Source inspection suggests this is plausibly a display-segment projection /
replication issue, not a purely aesthetic one:

- `main.js` has both `projectStageLocalToScene(localX, localY)` and
  `projectAvatarToScene(screenX, screenY)`, where the avatar path first maps
  DesktopWorld coordinates through `desktopWorldToSegmentLocalPoint(...)`.
- The current Selection Mode cursor renderer consumes an overlay cursor that is
  already projected to segment-local space, then calls
  `projectStageLocalToScene(...)`.
- Fast-travel line interdimensional trails are backed by Omega state in
  `fast-travel.js` / `omega.js`; `surfaceRenderSnapshot(...)` currently
  publishes only limited Omega state, while follower segments apply snapshots
  and call `syncOmegaTrailToTravelOrigin()`.
- `syncOmegaTrailToTravelOrigin()` resets the Omega trail origin through
  `projectAvatarToScene(origin.x, origin.y)`, which depends on per-segment
  DesktopWorld projection.

Do not assume these notes identify the final bug. Use them to focus the first
inspection pass.

## Required Classification

Before editing, determine which live effect the report most likely refers to:

- fast-travel line interdimensional trail (`fastTravelLineInterDimensional`,
  Omega ghost trail);
- Selection Mode cursor trail (`selectionModeTrailInterDimensional` and the
  Selection Mode cursor model trail);
- normal avatar trail (`state.trailSprites` / `animateTrails`);
- another effect using similar language.

Record the classification in the completion report. If the exact effect cannot
be proven from source, fix the shared projection bug that plausibly explains
the report and state the residual uncertainty.

## Required Behavior

The corrected behavior must preserve these constraints:

- Interdimensional trail visuals render on both the main display and an
  extended display when the effect path crosses or occurs on either display.
- DesktopWorld coordinates are projected through the correct display segment
  before scene-space rendering.
- Primary and follower/secondary Sigil canvas segments receive enough render
  state to produce equivalent visual effects for their segment.
- Main-display coordinates must not be treated as raw stage-local coordinates
  unless that segment's origin is actually `(0, 0)`.
- No display segment should create unbounded objects, geometries, materials, or
  ghost/trail instances during pointer/travel movement.
- Fixes must not make Selection Mode input, hit testing, acquisition, semantic
  targets, or DesktopWorld ownership move into Three render objects.
- Do not proceed with the pointer `selectionVisualRoot` implementation in this
  round.

## Suggested Investigation Targets

Suggested, not mandatory:

- Verify `desktopWorldToSegmentLocalPoint(...)` behavior on topologies where
  main display is not the same segment as the observed extended display.
- Verify `surfaceRenderSnapshot(...)` / `applySurfaceRenderSnapshot(...)`
  carries all state needed for interdimensional trail rendering on follower
  segments.
- Verify `resetOmegaInterdimensionalTrail(...)` is called with a segment-local
  scene-space origin on every segment that needs the trail.
- Verify Selection Mode overlay/cursor trail projection does not double-project
  or skip DesktopWorld-to-segment conversion.
- Check whether tests only cover identity/no-op projectors and therefore miss
  non-zero display origins.

## Required Tests

Add or update deterministic tests that fail before the correction. Prefer tests
that simulate a multi-display topology with non-zero segment origins.

Coverage should prove the relevant subset of:

- DesktopWorld points on the main display and extended display project to the
  correct segment-local coordinates.
- Fast-travel interdimensional/Omega trail origin resets correctly for a
  non-zero display segment.
- Follower/secondary segment snapshots include and apply the trail state needed
  to render the same effect on the segment.
- Selection Mode cursor/rect projection keeps coordinates in the correct space
  if the source issue is shared with Selection Mode.
- Existing resource-bounded trail/pointer tests still pass.

## Live Smoke

After deterministic gates pass, run a bounded live smoke only if `./aos ready`
passes:

1. Launch/reload `avatar-main` on the corrected branch using repo-standard AOS
   commands and branch-scoped content roots if needed.
2. Use a two-display setup with a main display and extended display.
3. Trigger the classified interdimensional trail effect on the main display and
   on the extended display.
4. Confirm the trail appears on both displays and does not leave stale objects
   after completion/hide.
5. Restore/hide Sigil to the pre-run state.

If live readiness is blocked by TCC/input-tap permissions, use the GDI
human-needed TCC reset helper and stop.

## Verification

Run at minimum:

```bash
git diff --check
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/fast-travel.js
node --check apps/sigil/renderer/omega.js
node --test tests/renderer/fast-travel-preview.test.mjs tests/renderer/omega-trail.test.mjs
node --test tests/renderer/sigil-selection-mode-cursor-model-renderer.test.mjs tests/renderer/sigil-selection-mode-runtime.test.mjs tests/renderer/sigil-selection-mode-performance.test.mjs
```

If you touch toolkit projection helpers, run the adjacent toolkit spatial tests
or explain why there are none.

## Completion Report

Return:

- commit SHA if committed;
- files changed;
- classification of the reported effect;
- root cause and fix summary;
- how the fix informs the later `selectionVisualRoot.pointer` and selection
  rect scene-facet work;
- tests added/changed and what they prove;
- verification commands and pass/fail result;
- live smoke result or exact readiness blocker;
- confirmation that the pointer scene facet card was not implemented in this
  round;
- confirmation that no push/GitHub mutation occurred.
