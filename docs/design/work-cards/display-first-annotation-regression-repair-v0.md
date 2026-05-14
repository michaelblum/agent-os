# Display-First Annotation Regression Repair V0

## Tracker

- Parent issue: https://github.com/michaelblum/agent-os/issues/296
- Follows:
  `docs/design/work-cards/display-first-annotation-settled-reprojection-v0.md`
- Blocks the planned snapshot-continuity slice until accepted.

## Goal

Repair the display-first Annotation Mode regressions reported after the settled
reprojection slice landed on `main`.

Reported symptoms:

- Surface Inspector minimap is spatially off; the main-display lines are
  incorrect.
- A lightbulb/pin-looking frame affordance is still visible even though visible
  pin UI was demoted from the product direction.
- Sigil radial menu performance degraded with frame drops and jank.
- Annotation reticle fast-travel acquisition is too broad. It should acquire the
  reticle only when the drag passes directly over the reticle radial item and
  then exits that same item through the outer-radius margin that overlaps the
  reticle item.

Keep this as a targeted regression repair. Do not continue snapshot continuity,
full adapter expansion, or unrelated Sigil styling work in this slice.

## Read First

- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-sigil-reticle-visual-validation-v0.md`
- `docs/design/work-cards/display-first-annotation-settled-reprojection-v0.md`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/canvas-inspector/annotation-action-control/`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `packages/toolkit/runtime/radial-gesture.js`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `tests/toolkit/canvas-inspector.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/fast-travel-preview.test.mjs`

## Current Evidence

The current implementation likely has these weak spots:

- `projectAnnotationRectToMinimap()` already tries to normalize annotation rects
  into the minimap basis, but the minimap still mixes native display bounds,
  daemon-provided desktop-world bounds, and native-to-desktop conversion in
  different paths. Recheck the live display payload instead of assuming one
  arrangement.
- `buildAnnotationActionControlCanvasRecords()` still emits an `add_comment`
  action and a `pin_frame` action with `icon: "pin"`. The child canvas renders
  that as a gold pin/lightbulb-like icon.
- `applyRadialGestureMove()` updates the radial target surface and annotation
  reticle preview on the pointer path. The reticle enter path also opens/toggles
  Canvas Inspector through `requestCanvasInspectorAnnotationToggle()`. If that is
  happening during drag acquisition, it is a likely jank source.
- `shouldEnterAnnotationReticle()` currently treats `inside` or `outward`
  relation to the reticle item as enough to enter reticle mode. It does not track
  whether the pointer actually crossed the reticle item first, and the current
  `outward` relation is not constrained to the item-overlapping outer margin.

## Required Behavior

### 1. Minimap Lines Use One Spatial Basis

The minimap must draw display outlines, visible-display outlines, canvas marks,
cursor marks, and annotation outlines from one coherent coordinate basis.

Acceptance criteria:

- The main-display outline and visible-display line match the live display
  topology reported by the daemon.
- Canvas, cursor, object mark, and annotation projections align with that same
  display geometry.
- Daemon-provided `desktop_world_bounds` /
  `visible_desktop_world_bounds` remain authoritative when present.
- Native display coordinates are converted explicitly before entering minimap
  projection helpers.
- Add a focused regression test for the reported main-display-line case. If the
  live arrangement cannot be encoded exactly, add the smallest fixture that fails
  before the fix and explains the basis mismatch.

Avoid hard-coded offsets for the current monitor arrangement.

### 2. Retire The Visible Pin/Lightbulb Affordance

The display-first product language is anchor/frame/comment, not visible pin.

Acceptance criteria:

- No lightbulb/pin-shaped action control appears in Annotation Mode.
- User-facing labels, titles, and accessibility names avoid `pin` where the
  visible control remains.
- If a commentless frame-anchor action is still required, represent it as a
  frame/anchor affordance, not a pin/lightbulb.
- If the second action is no longer required, remove it and keep the remaining
  creation path coherent.
- Internal function or action names may keep `pin_frame` only if changing them
  adds churn; visible UX must not expose it.

### 3. Restore Radial Menu Frame Budget

Sigil radial menu interaction must remain smooth with the annotation reticle item
present.

Acceptance criteria:

- Measure or instrument enough evidence to identify the jank source.
- Pointer movement must not create/destroy canvases, repeatedly open/toggle
  Canvas Inspector, or force full Surface Inspector list rerenders.
- Reticle preview updates are requestAnimationFrame-coalesced or otherwise
  bounded to state changes that matter.
- Radial target surface sync is idempotent and does not send update work when the
  radial target geometry is unchanged.
- Existing radial item activation and normal fast-travel behavior remain intact.

If opening Canvas Inspector during drag is the cause, defer that bridge until it
is not on the drag hot path, while still recording inspectable reticle state.

### 4. Narrow Reticle Fast-Travel Acquisition

Fast-travel should acquire annotation reticle mode only through the reticle item
itself.

Required gesture rule:

1. The drag path must first pass directly over the annotation reticle radial
   item hit region.
2. Reticle mode may then activate only when the pointer exits that same menu item
   through the outer-radius margin that overlaps the reticle item.
3. A drag that starts or travels outside the reticle item but happens to be
   outward along the same radial axis must remain normal fast-travel.
4. A sideways exit or inward return must not acquire the reticle.
5. Returning to the radial interior exits reticle mode and restores normal
   fast-travel vector treatment.

Implementation guidance:

- Add a small explicit reticle acquisition state, for example
  `reticle_candidate_item_hit` plus the item id/geometry that was crossed.
- Base the outer-margin test on both axial and lateral distance, not just
  `relation === "outward"`.
- Keep the logic testable with pure geometry helpers before wiring it into
  `apps/sigil/renderer/live-modules/main.js`.

## Suggested Implementation Areas

- `packages/toolkit/runtime/spatial.js`
  - verify display normalization and native/desktop-world conversion contracts;
  - add any missing projection helper only at the shared toolkit boundary.
- `packages/toolkit/components/canvas-inspector/index.js`
  - fix minimap callers and visible pin/lightbulb action control setup;
  - keep Surface Inspector passive/supportive.
- `packages/toolkit/components/canvas-inspector/annotation-action-control/`
  - replace or remove the visible pin glyph and user-facing labels.
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
  - add pure helper/state for reticle acquisition if it belongs with reticle
    semantics.
- `apps/sigil/renderer/live-modules/main.js`
  - keep reticle/radial wiring out of per-move heavy work.
- `packages/toolkit/runtime/radial-gesture.js`
  - only change shared radial geometry helpers if the rule is generic; avoid
    putting Sigil-specific policy into toolkit runtime.

## Verification

Run focused checks:

```bash
node --check packages/toolkit/runtime/spatial.js
node --check packages/toolkit/components/canvas-inspector/index.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/main.js
node --test tests/toolkit/canvas-inspector.test.mjs tests/toolkit/canvas-inspector-mouse-effects.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs tests/renderer/radial-gesture-menu.test.mjs tests/renderer/radial-gesture-visuals.test.mjs tests/renderer/fast-travel-preview.test.mjs
git diff --check
./aos ready
```

Run one bounded live smoke if `./aos ready` passes:

- open Sigil radial menu and confirm the menu remains smooth;
- verify normal fast-travel is not captured by the annotation reticle unless the
  drag crosses the reticle item and exits through the overlapping outer margin;
- verify returning to the radial interior exits reticle mode;
- open Surface Inspector and verify the minimap main-display lines align with
  the live display arrangement;
- verify no lightbulb/pin-shaped frame affordance is visible.

## Completion Report

Report:

- root cause for each of the four reported symptoms;
- files changed;
- exact tests and live smoke performed;
- before/after evidence for radial jank, even if qualitative;
- whether any symptom remains blocked on missing live evidence.

