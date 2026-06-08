# Surface Inspector Minimap Fit + Annotation Hover Stability V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Follows:
  `docs/design/work-cards/surface-inspector-annotation-mode-operator-defect-repair-v0.md`

## Goal

Repair the remaining Surface Inspector usability defects found after Operator
re-verified Annotation Mode.

The core annotation flow is now usable enough for V0:

- Annotation Mode is quiet on entry;
- hover resolves to `html-workbench-expression`, not broad `avatar-main`;
- one perimeter-only highlight appears;
- plus/pin controls are real AOS canvases;
- plus opens the editor through normal AOS targeting;
- comments project as active-edge chips;
- unanchored semantic rows are hidden.

Two platform defects remain:

1. the minimap can be cut off at the bottom when the Surface Inspector window is
   too short for the desktop-world aspect ratio;
2. Annotation Mode hover is visually janky for the app-window/AOS-canvas scope,
   likely because the current implementation resolves hover against broad live
   canvas/window state on every pointer movement.

Use a scoped hit-layer model for the hover repair. Annotation Mode owns the
mouse at the current scope: it should build hit regions only for the immediate
children of the current frame anchor, not for every descendant in the world.
Plus/pin controls remain separate AOS child canvases. The hit-layer model should
replace world-level hover churn, not merely throttle it.

Fix those without continuing Employer Brand alignment/capture/report work.

## Required Behavior

### 1. Minimap Fits The Top Panel

The minimap must always fit inside its top overview panel without clipping the
bottom of the desktop world.

Required behavior:

- preserve the desktop-world aspect ratio;
- scale down uniformly in both dimensions when either width or height would
  overflow the available top panel;
- never clip the bottom of the rendered desktop-world/minimap geometry;
- keep the minimap centered or aligned in a visually intentional way when it
  scales down;
- define a lower bound for usable minimap size so the top panel cannot collapse
  into an unreadable strip;
- if the inspector is smaller than the lower bound, prefer a clear bounded
  minimum/minimap viewport behavior over clipping.

The previous split repair should remain intact:

- resizing Surface Inspector taller gives extra height to the bottom list panel;
- the overview/minimap remains bounded;
- no giant blank gap appears.

This card adds the missing fit-to-panel behavior inside the overview itself.

### 2. Annotation Scope Stack

Annotation Mode should maintain an explicit **annotation scope stack**.

Rules:

- the root scope is implied and represents top-level app windows/AOS canvases;
- desktop world and displays are never actionable frame candidates;
- creating a frame anchor pushes that frame onto the scope stack;
- current scope is the top frame on the stack;
- the active hit layer exposes only the immediate visible children of the
  current scope;
- `Back` pops one frame from the stack;
- `Clear anchors` or mode-off clears the whole stack;
- clicking a frame-address breadcrumb in SI may jump back to that frame;
- clicking the root breadcrumb, such as `main`, returns to root scope;
- if the current frame is removed/stale, auto-pop to the nearest valid ancestor.

This scope stack is the way a user moves from one window/panel/element level to
the next. To annotate a different window after descending into one window, the
user backs out to the root scope and then chooses another top-level window or
canvas.

### 3. Scoped Hit Layer

Implement hover with a scoped hit layer.

Preferred shape:

- one transparent AOS hit-layer canvas for the current scope;
- structured hit regions inside that layer for the scope's immediate visible
  child frames;
- plus/pin controls remain separate AOS child canvases positioned against the
  selected hit region.

Do not create one AOS canvas per candidate unless the candidate count is tiny
and the implementation has a clear cap. The important contract is one active
scope with bounded structured hit regions, not world-wide hover resolving.

At root scope, hit regions should cover top-level app windows and AOS panel
canvases only. At a frame-anchor scope, hit regions should cover that frame's
immediate visible child elements/frames only.

The hit layer should:

- ignore Surface Inspector and annotation action-control canvases as candidates;
- keep the current candidate stable while the cursor is over the candidate or
  over its action-control canvases;
- clear hover only when the cursor leaves the candidate/control envelope or the
  underlying candidate disappears;
- avoid emitting create/update/remove churn when the candidate id and rect are
  unchanged;
- avoid treating action-control canvas lifecycle events as a reason to rebuild
  the same hit layer.

### 4. Hover Candidate Updates Are Stable

Annotation Mode hover should not visibly flicker, oscillate, or churn.

Implement bounded update behavior:

- coalesce pointer/mouse move events, preferably through `requestAnimationFrame`
  or an equivalent scheduler;
- avoid rerender/spawn/remove cycles when the selected candidate id and rect are
  unchanged;
- do not rebuild action-control canvases unless candidate id, pinned state, or
  frame geometry changes;
- do not rebuild the scoped hit layer unless the active scope, child region set,
  or viewport geometry changes.

### 5. Active Edge Rendering

Anchored frames should render as the active nested gold perimeter chain, not as
always-visible hit regions.

Required behavior:

- render only the current active edge/path;
- root/outer anchor can be strongest;
- intermediate anchors are progressively softer;
- deepest active frame is around `0.25` opacity;
- no interior fill;
- no desktop-world/display gold rectangle, because root context is implied;
- comment chips render only for active-edge comments.

### 6. Back-Out Controls

Provide a clear way to move back up the annotation scope stack.

Minimum controls:

- `Esc` or an equivalent keyboard/action hook pops one frame when possible;
- visible `Back` control in SI or overlay control area pops one frame;
- `Clear anchors` returns to root scope and clears anchors/comments with existing
  destructive confirmation behavior when needed;
- frame-address breadcrumbs in SI can select/jump to an ancestor scope if this
  fits existing UI patterns.

Do not make the user toggle Annotation Mode off/on just to choose a different
window.

### 7. Instrument The Fix Enough To Verify

Expose lightweight debug state in `window.__canvasInspectorState` or tests so
Implementer/Operator can verify the scoped hit layer is not thrashing.

Examples:

- current scope stack ids;
- active hit-layer canvas id;
- current hit region count;
- current hover candidate id;
- last hover update reason;
- number of action-control canvas create/update/remove emits since mode entry;
- whether a pending animation-frame hover refresh exists.

Keep this diagnostic small and remove or avoid noisy counters if they make
snapshots unstable.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/surface-inspector/styles.css`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/panel/layouts/split-pane.js`
- `tests/toolkit/surface-inspector.test.mjs`

Likely fixes:

- extend minimap layout/rendering to fit by both width and height, not width
  alone;
- use the top panel's measured available content box as the minimap max bounds;
- add an annotation scope stack and scoped hit-layer helper;
- build structured hit regions from only the active scope's immediate visible
  children;
- throttle scoped hit-layer hover and related rerenders/action-canvas sync;
- make action-control canvas lifecycle idempotence stricter;
- add Back/root-scope behavior without introducing minimap actions.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

Add/adjust tests to prove:

- minimap layout fits within both available width and available height;
- desktop-world aspect ratio is preserved after scale-down;
- minimap has a sane lower bound;
- taller resize still gives extra height to the bottom list panel;
- root scope hit regions include top-level app windows/AOS canvases only, not
  displays/desktop world;
- nested scope hit regions include only immediate visible children of the active
  frame anchor;
- Back pops one frame from the scope stack and returns hit regions to the parent
  scope;
- clearing/mode-off returns to root scope;
- repeated same-candidate hover events do not emit repeated action-control
  create/update/remove cycles;
- action-control canvases are ignored as candidates but keep the target candidate
  stable while hovered;
- hover clears cleanly when leaving the candidate/control envelope.

Run a bounded AOS smoke when `./aos ready` passes:

```bash
./aos ready
packages/toolkit/components/html-workbench-expression/launch.sh \
  docs/design/fixtures/aos-html-workbench-expression-v0/expression.json
```

Smoke expectations:

- resize Surface Inspector short/tall and verify the minimap never clips at the
  bottom;
- the top overview keeps a bounded size and the bottom panel gets extra height;
- enable Annotation Mode and verify root scope exposes top-level windows/AOS
  canvases, not desktop/display roots;
- hover over the HTML Workbench Expression and verify hover remains visually
  stable, without flickering or action-control canvas churn;
- create a frame anchor and verify the hit layer changes to that frame's
  immediate children;
- use Back to return to the parent/root scope;
- plus/pin controls remain centered and usable;
- mode off removes controls and clears hover state.

## Non-Goals

- Do not continue Employer Brand alignment/capture/report work.
- Do not change the successful overlay plus/pin/comment workflow except as
  needed to stabilize hover.
- Do not revive Surface-Zoom annotation behavior.
- Do not add minimap action controls.
- Do not add global pointer capture.
- Do not browse arbitrary live websites.
- Do not make generated HTML canonical.
