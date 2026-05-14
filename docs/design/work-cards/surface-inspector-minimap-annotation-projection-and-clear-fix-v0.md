# Surface Inspector Minimap Annotation Projection + Clear Fix V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Follows:
  `docs/design/work-cards/surface-inspector-minimap-fit-and-hover-stability-v0.md`

## Goal

Repair two defects found by Operator after the scoped Annotation Mode hit-layer
work landed:

1. gold minimap annotation outlines appear offset because they do not account
   for desktop-world dead space on either side of the main display;
2. confirming annotation clear/mode-off can remove the Surface Inspector canvas
   itself.

Keep this as a Surface Inspector correctness fix. Do not continue Employer
Brand alignment, capture, locator, report, export, or workflow work.

## Current Evidence

Operator verified the scoped hit-layer repair mostly works:

- `./aos ready` recovered with one permitted `./aos ready --repair`;
- HTML Workbench Expression and Surface Inspector launched;
- minimap fit held in short/tall sizes;
- root hit regions were top-level only;
- hover on HTML Workbench Expression was stable;
- `canvas-inspector-annotation-hit-layer` and action-control child canvases were
  present;
- pinning pushed scope into immediate children;
- active-edge rendering was perimeter-only;
- plus/editor created one comment chip;
- no `CONTENT_WAIT_TIMEOUT` or daemon drops recurred.

Remaining defects:

- The minimap gold annotation outlines do not line up with the rendered display
  geometry when desktop-world coordinates include horizontal dead space around a
  display. The outline projection appears to use a different coordinate basis
  than the minimap display/canvas projection.
- Confirming cleanup removed the `canvas-inspector` canvas, so final
  pin/comment counts could not be read after clear.

## Required Behavior

### 1. Minimap Annotation Projection Uses One Coordinate Basis

All minimap annotation geometry must project through the same desktop-world
coordinate basis as displays, canvases, cursor marks, and object marks.

Required behavior:

- active-edge frame outlines on the minimap align with the corresponding
  display/canvas marks even when `desktop_world_bounds.x` is non-zero or the
  main display has dead space to the left/right inside the desktop world;
- comment markers projected on the minimap use the same corrected frame
  projection;
- display-visible dead space remains represented by the display/visible-display
  geometry, but annotation outlines must not drift as if the dead space did not
  exist;
- coordinate conversion should be explicit, not a hard-coded offset patch.

Implementation guidance:

- inspect whether annotation projections store `visible_display_rect` /
  `display_space_rect` in native, display, or desktop-world coordinates;
- add/normalize coordinate-space metadata if needed;
- either convert projection rects to desktop-world before calling
  `projectPointToMinimap`, or add a single helper that accepts projection rects
  and resolves them to the minimap's coordinate basis;
- keep existing display-overlay behavior intact. The display overlay can still
  use screen/display coordinates if that is the correct host surface, but the
  minimap must use desktop-world coordinates.

Avoid:

- guessing offsets from the primary display;
- special-casing only the current user display arrangement;
- changing the desktop-world bounds contract to hide the dead space.

### 2. Clearing Annotations Must Not Remove Surface Inspector

Confirming annotation clear or turning Annotation Mode off must clean annotation
runtime artifacts without closing/removing Surface Inspector itself.

Required behavior:

- `Clear anchors` with confirmation removes frame anchors, comments, active
  edge state, hover state, action-control child canvases, and hit-layer child
  canvas;
- turning Annotation Mode off with confirmation performs the same runtime
  cleanup and leaves `canvas-inspector` open;
- after cleanup, `window.__canvasInspectorState` remains readable and reports
  zero pins/comments, no hit-layer canvas, and no action-control canvases;
- the normal Surface Inspector close button remains the only UI path that
  removes the inspector canvas.

Avoid:

- `emit('canvas.remove', { id: SELF_ID })` from annotation cleanup paths;
- relying on the inspector disappearing as a way to clean up child canvases;
- leaving orphaned `canvas-inspector-annotation-*` canvases after cleanup.

## Suggested Implementation Areas

Inspect before editing:

- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/canvas-inspector.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`

Likely fixes:

- add a focused minimap projection helper for annotation frame rects;
- add tests with `desktop_world_bounds.x` / dead-space display geometry and a
  pinned annotation frame that must align with a canvas/display mark;
- update projection metadata or conversion code so annotation minimap geometry
  is not fed in the wrong coordinate space;
- remove inspector self-removal from annotation clear confirmation;
- add a regression test that clear confirmation keeps `canvas-inspector` alive
  and explicitly removes only annotation child canvases/state.

## Verification

Run focused tests:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
bash tests/help-contract.sh
git diff --check
```

If `./aos ready` passes, run a bounded AOS smoke with HTML Workbench Expression
and Surface Inspector:

- create one frame anchor and one comment;
- verify minimap gold outline alignment on the current display arrangement;
- clear anchors through confirmation;
- verify Surface Inspector remains open and final debug state is readable with
  zero pins/comments and no annotation child canvases.

## Non-Goals

- no Employer Brand capture/alignment/report work;
- no live website work;
- no new annotation interaction model;
- no minimap action controls;
- no global display coordinate model rewrite beyond the smallest necessary
  coordinate-space correction.
