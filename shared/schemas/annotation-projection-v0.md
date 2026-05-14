# Annotation Projection Result V0

**File:** `annotation-projection-v0.schema.json`
**Version:** 0.1.0
**Producers:** surface adapters and toolkit workbench projection helpers
**Consumers:** overlay twins, workbenches, capture preparation, inspectors

## What This Is

Annotation intent records describe what a human or agent meant. Projection
results describe where that intent currently resolves on one live surface and
viewport. The projection layer is therefore derived state, not a replacement
for `annotation.schema.json`.

Each surface owns anchor resolution for its coordinate system. The shared
contract only records the normalized output: surface binding, viewport state,
per-annotation resolution status, viewport-local rectangles, decorator placement
recommendations, and layer visibility state.

## Surface Binding

`surface_binding` identifies the live surface that resolved the annotations.
`surface_type` is neutral and may be `markdown_workbench`, `browser_page`,
`mermaid_svg`, `three_scene`, `pdf_page`, `image`, or `generic_canvas`.
Source identity is optional but should use the most specific available field,
such as `source_path`, `source_url`, `subject_id`, `canvas_id`, `window_id`, or
`tab_id`.

## Viewport

`viewport` records width, height, scroll offsets, zoom, scale, device pixel
ratio, and view mode. Rectangles in `projections[].rects` are always local to
this viewport at the time of projection.

## Projection Status

Each projection has one status:

- `resolved`: the adapter found current geometry.
- `out_of_viewport`: the anchor resolved, but no rect intersects the viewport.
- `unresolved`: the anchor is understood but could not be found in current
  content.
- `stale`: the annotation likely refers to older content or a different source
  version.
- `unsupported`: the adapter does not support that anchor type.

`source_anchor` copies neutral anchor metadata from the annotation record, such
as text range, text excerpt, selectors, role, label, and ancestor chain. Selectors
remain candidates only; they are not the sole anchor model.

## Layer State

`layer` records whether the projection overlay is visible or dismissed, which
decorator mode is active, which annotations have expanded details, and capture
prepare/restore implications. Capture tools can hide annotation controls while
keeping target evidence visible, then restore the layer after capture.

## Future Surface Adapters

Markdown Workbench V0 resolves line and text-range anchors to editor or preview
geometry. Future browser-page adapters should resolve selector, text, role, and
ancestor candidates through a supervised page adapter and
`getBoundingClientRect`. Future Mermaid/SVG adapters should resolve node ids,
edge ids, SVG text, or generated data attributes to SVG bounding boxes. Future
3D adapters should resolve object ids, materials, meshes, or world points to
screen-space using the active camera. Future PDF, image, and canvas adapters
should transform page or image coordinates into viewport-local rectangles.

Those adapters are future consumers of this contract; they are not implemented
by this V0 Markdown proof.
