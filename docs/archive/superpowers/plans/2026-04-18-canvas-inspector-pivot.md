# Canvas Inspector Pivot — Primitive Marks + `aos see stream`

**Date:** 2026-04-18  
**Status:** Active pivot brief  
**Supersedes for active work:**  
- `docs/superpowers/specs/2026-04-18-canvas-inspector-object-marks-design.md`  
- `docs/superpowers/plans/2026-04-18-canvas-inspector-object-marks.md`

## Summary

Narrow the in-flight canvas-inspector object-marks work to primitive-only object markers. Split live visual reference out into a separate primitive, `aos see stream`, instead of embedding thumbnail/icon/capture logic into mark payloads.

This keeps object marks simple and safe, and establishes display/window/region streaming as a reusable AOS primitive for inspector backgrounds, projection into other canvases, recording, and future perception consumers.

## Part A — Primitive Object Marks

### Scope

Keep `canvas_object.marks` as the wire event and keep the existing full-snapshot replace semantics keyed by `canvas_id`.

Keep:
- daemon fan-out for `canvas_object.marks`
- required stable mark `id`
- per-canvas TTL expiry
- eviction on parent canvas removal
- minimap placement based on desktop CG coordinates
- indented text rows under the parent canvas entry

Drop:
- raw SVG payloads
- all icon URLs and thumbnails
- all capture-backed mark visuals
- SVG sanitization
- icon cache / capture cache / capture scheduler logic
- mini visual preview inside list rows

### Wire Contract

Consumer payload:

```jsonc
{
  "type": "canvas_object.marks",
  "payload": {
    "canvas_id": "avatar-main",
    "objects": [
      {
        "id": "avatar",
        "x": 942,
        "y": 540,
        "name": "Avatar",
        "color": "#ff66cc",
        "w": 20,
        "h": 20,
        "rect": true,
        "ellipse": true,
        "cross": true
      }
    ]
  }
}
```

Mark fields:
- required: `id`, `x`, `y`
- optional: `name`, `color`, `w`, `h`, `rect`, `ellipse`, `cross`

Defaults:
- `w = 20`
- `h = 20`
- `rect = true`
- `ellipse = true`
- `cross = true`

`x` and `y` stay in desktop CG coordinates, same space as `canvas.at`.

`w` and `h` are marker-local logical units for inspector rendering. They should behave like the old unscaled minimap marker size: visually stable and independent of display DPI.

### Default Visual

If the consumer does not specify size or primitive booleans, the default "child-of-canvas" marker is:

- a `20 x 20` square
- a circle inscribed in the square
- an `X` drawn corner-to-corner across the square

The circle's diameter matches the full side length of the square.

Any mark may compose the three primitive layers arbitrarily:
- rectangle only
- ellipse only
- cross only
- any 2-way combination
- all three together

### List Rendering

List rows remain indented under the parent canvas entry, but become text-only:
- marker name
- optional coordinates
- no thumbnail
- no swatch copy of the marker
- no per-mark action buttons

### Inspector Tree

Canvas-inspector should present a location tree instead of a flat canvas list.

Display naming:
- `main`
- `extended [1]`, `extended [2]`, ...
- these names live in the list/tree, not as text painted onto the minimap display boxes
- remove the current bottom-right resolution label from each minimap display box

Tree rules:
- single-display setup: use the display row itself as the top-level location node
- multi-display setup: synthesize a top-level `union` node for the full desktop union
- under `union`, render display rows for `main` and each `extended [n]`
- canvases nest under the display they belong to
- canvases tracked to `union`, or otherwise spanning the desktop union, nest directly under `union`
- object rows nest under their parent canvas

Example multi-display tree:

```text
union
  main
    canvas-inspector
    other-main-canvas
  extended [1]
    sidecar-canvas
  avatar-main
    Avatar
```

### Implementation Notes

Rewrite the current object-marks implementation toward:
- `normalize.js`: validate required fields, apply defaults, clamp dimensions if needed
- `reconcile.js`: retain TTL/lifecycle eviction only
- `scheduler.js`: TTL sweep only
- `render.js`: primitive composition renderer only
- `controller.js`: no icon or capture state

Tests should cover:
- default marker
- each primitive alone
- composed primitives
- custom `w` / `h`
- TTL expiry
- parent canvas removal
- text-only list rows
- single-display tree layout
- multi-display `union` tree layout
- `union` canvas nested directly under `union`
- object rows nested under the owning canvas
- minimap display boxes render without resolution text labels

Sigil and other consumers should emit primitive markers only for now.

## Part B — New Primitive: `aos see stream`

### Goal

Add a live screen-content streaming primitive to AOS that provides a low-latency preview feed for:
- a display
- a window
- a region

This is the AOS-level primitive analogous to the capture/preview capability users already see in macOS screen sharing and screen recording flows. It should exist on its own, not as an object-mark subtype.

### Why Split It Out

Object marks answer: "where is this object?"

`aos see stream` answers: "what does this display/window/region currently look like?"

Keeping those separate:
- avoids overloading mark payloads
- keeps marks cheap and predictable
- makes streaming reusable by any consumer
- gives canvas-inspector a clean way to draw live display-feed backgrounds behind object markers

### Initial Target

Phase 1 should be preview-oriented, not full recording parity:
- no audio
- no microphone
- no file recording
- no mark-level embedding API

Phase 1 output profiles:
- `very-low`
- `low`
- `medium`
- `high`

Canvas-inspector minimap should use `very-low` by default.

### Multi-Display

Support all displays simultaneously.

Preferred architecture:
- one stream per display
- one stream per window when needed
- one stream per explicit region when needed

For canvas-inspector, this means one low-profile stream per display, rendered as faint moving display backgrounds beneath the minimap overlays and object markers.

### Transport Direction

Do not implement this by polling the current one-shot screenshot path.

Current repo state only supports one-shot ScreenCaptureKit screenshots. Streaming should use ScreenCaptureKit stream primitives directly and expose a daemon-managed transport appropriate for WKWebView consumers, likely:
- a localhost MJPEG endpoint, and/or
- a "latest frame" JPEG endpoint plus metadata

Desired behavior:
- latest-frame-only for preview consumers
- drop old frames instead of queueing unbounded work
- allow width/height or max-edge based scaling

### Canvas-Inspector Use

Canvas-inspector should consume display feeds as low-fidelity reference backgrounds:
- lowest practical resolution
- low frame rate
- scaled to minimap display box size
- visual reference only, not perception-quality output

Object markers then sit on top of those backgrounds.

### Later Follow-Ons

Once the primitive exists, future consumers can use it for:
- richer canvas-inspector backgrounds
- projection into other canvases
- video capture / recording workflows
- perception experiments with live feeds

Those belong in later phases, not in the object-marks pivot.

## Execution Order

1. Treat this pivot brief as the active source of truth.
2. Update the in-flight object-marks implementation to primitive-only markers.
3. Remove thumbnail / icon / raw SVG / capture assumptions from tests and docs.
4. Verify primitive markers end-to-end in the live canvas inspector.
5. Write a dedicated design/spec for `aos see stream`.
6. Open or update GitHub issues for both the object-marks pivot and the new stream primitive.
7. Only after the primitive-marker pivot is stable, start `aos see stream` implementation work.
