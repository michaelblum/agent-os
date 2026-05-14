# Sigil Radial Reticle Drift Repair V0

## Tracker

- Follow-up to `docs/design/work-cards/display-first-annotation-regression-repair-v0.md`.
- Product direction: `docs/design/display-first-annotation-mode-and-sigil-reticle.md`.
- Current branch evidence: `codex/sigil-idle-render-fix` as inspected on
  2026-05-14.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## User Report

The current Sigil radial reticle behavior has drifted from the requested
display-first annotation interaction:

- the avatar no longer rotates while idle;
- radial menu items are crowded and overlap;
- the annotation radial item behaves like release-on-item activation, not
  drag-through acquisition;
- dragging through the annotation item does not reliably turn the normal green
  fast-travel vector into the gold reticle/cross treatment;
- dragging back into the radial interior should leave annotation mode and
  restore normal fast travel;
- display-first annotation overlays, hover highlights, and drill-down behavior
  are not visible from the Sigil reticle path.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-regression-repair-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/render-loop.js`
- `apps/sigil/renderer/live-modules/radial-gesture-menu.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/renderer/radial-menu-defaults.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/radial-gesture-visuals.js`
- `packages/toolkit/runtime/radial-gesture.js`
- `packages/toolkit/components/canvas-inspector/index.js`
- `tests/renderer/sigil-render-loop.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/scenarios/sigil/radial-menu/real-input.sh`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
```

If Swift files are dirty or changed relative to the active base, use
`./aos dev build` before live runtime verification. Do not rebuild for pure
Node-only edits unless `./aos dev recommend --json` says the repo binary is
stale for the active verification path.

## Current Evidence

### Idle Rotation Regression

`be0e7fc` changed `animate()` from unconditional `scheduleRenderFrame()` to
continuation-reason scheduling. The avatar rotation still happens inside
`animate()`:

- `state.polyGroup.rotation.y += 0.005 * rotationMultiplier`
- `state.polyGroup.rotation.x += 0.002 * rotationMultiplier`

But `renderLoopContinuationReasons()` has no reason for visible idle avatar
motion. The current test `visible idle avatar does not require continuous
rendering` encodes the regression rather than the product behavior.

### Crowded Radial Items

The default radial geometry exposes four items before any annotation anchor and
five after the snapshot camera becomes available, but the spread/radius values
were not retuned when annotation items were added:

- `itemRadius: 4.15`
- `itemHitRadius: 0.9`
- `itemVisualRadius: 1.4`
- `spreadDegrees: 92`
- `radiusBasis` defaults to `avatarHitRadius`, currently `40`

That puts adjacent item centers close enough for visual and semantic hit
targets to overlap, especially when the fifth camera item appears. There is no
spacing/collision test.

### Drag-Through Activation Is Not The Real Input Path

The intended path exists only partially in the parent renderer:

- `applyRadialGestureMove()` calls `shouldEnterAnnotationReticle()` when the
  radial model reaches `phase === "fastTravel"`;
- returning to radial calls `exitAnnotationReticle("radial-reentry")`.

But the physical radial child surface is click-oriented:

- `apps/sigil/renderer/radial-menu-surface.html` emits
  `radial_item_pointer_down`, `radial_item_pointer_up`, and
  `radial_item_click`;
- it does not emit pointer move, pointer enter/leave, hover, or drag-through
  state;
- `handleRadialTargetSurfaceEvent()` ignores pointer down/up and only activates
  on `radial_item_click`;
- the click handler releases the radial model at `item.center`, which is exactly
  the release-on-menu-item behavior the user is rejecting.

If the child canvas owns the pointer while the mouse button is held, the parent
drag path can be starved of the `left_mouse_dragged` events needed for hover
highlighting and reticle acquisition.

### Annotation Overlay Path Is Mostly State, Not Product UI

`createSigilAnnotationReticleController()` creates a session with display and
pointer subjects, and `interaction-overlay.js` can switch the fast-travel vector
from green arrow to gold reticle/cross only while `annotationReticle.active` is
true.

There is not yet a Sigil-owned or shared display overlay renderer that shows
the active frame, hover candidates, child drill-down highlights, or committed
live anchors from the reticle session. `requestCanvasInspectorAnnotationToggle`
is unused, and the current tests explicitly assert that the reticle enter block
does not call it. Surface Inspector has overlay support for its own annotation
mode, but the Sigil reticle state is not the same live display authoring loop.

### Test Gap

The focused renderer tests pass, but they prove synthetic state and click/release
behavior. They do not prove real drag-through acquisition, radial child-surface
hover/drag messages, visual item spacing, idle rotation, or display-first
annotation overlays.

## Required Behavior

### 1. Restore Intentional Idle Motion

Visible idle avatar animation should continue when configured motion exists. Do
not return to a wasteful unconditional loop if a narrow continuation reason can
represent visible avatar motion. The debug snapshot should make the reason
clear, for example `avatar-motion`.

### 2. Retune Radial Geometry For Four And Five Items

The radial menu must remain readable and hittable when it has:

- four visible items: context menu, agent terminal, annotation reticle, wiki;
- five visible items: the above plus annotation camera.

Avoid overlap between visual glyphs and semantic hit targets. Add deterministic
geometry tests for minimum adjacent spacing and target bounds.

### 3. Make Reticle Drag-Through A First-Class Path

The annotation reticle item must support continuous drag-through activation:

- dragging through the reticle item should show hover/active visual feedback;
- crossing the item and exiting through the outer item margin should enter
  Annotation Mode without requiring mouse release on the item;
- the fast-travel vector should change to the gold reticle/cross treatment as
  soon as annotation mode is active;
- dragging back into the radial interior in the same drag should exit
  Annotation Mode and restore the normal green fast-travel vector;
- release on a display target should commit the preview scope and fast-travel to
  the deterministic placement point;
- release-on-item activation may remain as an accessibility/semantic click path,
  but it must not be the only working path.

Decide whether the child radial target surface should forward pointer movement
to the parent, become pass-through during held drags, or use a shared
input-region/router primitive. Keep Sigil product policy in Sigil; only move
generic input mechanics downward if a reusable primitive is missing.

### 4. Add Display-First Overlay Feedback

The reticle session needs visible overlay feedback independent of Surface
Inspector list management:

- current root/current scope frame;
- hover candidate frame;
- committed live anchor frames;
- no pin/lightbulb visual language;
- no fresh AX/DOM/CDP discovery or canvas create/destroy on every pointer move.

The first acceptable version may be display/root and AOS-surface scoped, but it
must be visible from the Sigil reticle drag flow and must leave inspectable
state in `window.__sigilDebug.snapshot()`.

## Scope

Likely scope:

- Sigil renderer runtime and radial visuals;
- Sigil radial child surface event forwarding or pass-through behavior;
- toolkit radial geometry helpers only if a generic helper/test belongs there;
- toolkit annotation overlay renderer only if the shared display overlay can be
  reused cleanly.

Do not add daemon branches named for Sigil, avatar, radial menu, or annotation.
Do not make Surface Inspector the primary authoring UI for this repair.

## Hard Boundaries

- Do not implement a broad persistent annotation database.
- Do not revive pin/lightbulb UX.
- Do not solve browser DOM/AX drill-down fully unless needed for the first
  visible overlay proof.
- Do not hide this behind renderer debug state only; the user must see the
  vector/hover/overlay feedback.
- Do not accept synthetic-only proof for drag-through behavior.

## Suggested Implementation Areas

- `apps/sigil/renderer/live-modules/render-loop.js`
  - add a continuation reason for visible idle avatar motion or configured
    visual motion;
  - update tests so idle rotation is preserved intentionally.
- `apps/sigil/renderer/radial-menu-defaults.js` and
  `apps/sigil/renderer/state.js`
  - retune spacing defaults for four/five item layouts.
- `packages/toolkit/runtime/radial-gesture.js`
  - add generic spacing helpers only if the Sigil tests need reusable math.
- `apps/sigil/renderer/radial-menu-surface.html` and
  `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
  - forward hover/drag-through evidence or make held-drag pass-through.
- `apps/sigil/renderer/live-modules/main.js`
  - integrate child-surface drag evidence with `radialGestureMenu.move()` and
    `shouldEnterAnnotationReticle()`;
  - avoid treating child-surface click as the only activation route.
- `apps/sigil/renderer/live-modules/annotation-reticle.js` and
  `apps/sigil/renderer/live-modules/interaction-overlay.js`
  - render visible frame/hover/anchor feedback for the reticle session.

## Verification

Deterministic checks:

```bash
node --check apps/sigil/renderer/live-modules/render-loop.js
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/radial-gesture-menu.test.mjs tests/renderer/radial-gesture-visuals.test.mjs tests/renderer/annotation-reticle.test.mjs tests/renderer/radial-menu-target-surface.test.mjs
git diff --check
./aos ready
```

Live proof:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

Add or extend the live scenario so it explicitly proves:

- idle avatar rotation is visible after the renderer settles;
- radial items do not overlap;
- held drag through the reticle item activates annotation mode before mouse up;
- retreating back into the radial interior exits annotation mode;
- vector color/head shape changes both ways;
- overlay frames/highlights appear during the reticle drag.

If live verification is blocked by repo-mode readiness, report the exact
`./aos ready` blocker and keep deterministic evidence separate from acceptance.

## Completion Report

Report:

- root cause accepted or corrected for each user-reported symptom;
- files changed;
- exact deterministic tests run and results;
- live real-input result, screenshots, or readiness blocker;
- whether release-on-item remains as an alternate semantic path;
- any remaining follow-up needed for deeper AX/DOM drill-down.
