# Spatial Subject Tree V0

**File:** `spatial-subject-tree-v0.schema.json`
**Version:** `0.1.0`
**Producers:** spatial topology snapshots, AOS canvas adapters, surface adapters, capture/locator/report/export/workflow adapters
**Consumers:** Surface Inspector, future Annotation Inspector, hit-test services, annotation projection, capture repair, human approval workflows

## What This Is

Spatial Subject Tree V0 is the neutral tree contract for everything visible or
addressable across displays. It connects AOS-owned DesktopWorld state with
adapter-owned surface internals without turning every surface into a DOM.

The tree starts at `desktop_world`, then descends through displays, windows,
canvases, surfaces, panes, documents, elements, regions, points, and projection
records. It is a projection of current visibility and addressability. Durable
meaning still belongs in source contracts such as annotation intent records,
work records, website capture plans, locator review packs, report/export
artifacts, and Employer Brand audit artifacts.

## Ownership Boundary

AOS owns the outer world: DesktopWorld, VisibleDesktopWorld, displays, windows,
apps, coarse z-order, canvas placement, and the coarse visible/hidden/offscreen
state available from spatial topology.

Surface adapters own their inner worlds. AOS canvas adapters can expose semantic
targets and toolkit panes. Markdown Workbench can expose source lines, headings,
rendered blocks, Mermaid blocks, and annotation projection anchors. Browser
adapters can later expose DOM elements, selectors, XPath, ARIA roles, frames,
and viewport rectangles. Mermaid/SVG adapters can expose nodes, edges, labels,
and SVG bounds. 3D adapters can expose objects, meshes, materials, world points,
and screen projections. PDF/image adapters can expose pages, OCR spans, and
image-local regions. Generic Mac apps can fall back to AX elements and
window-local bounds.

The same tree shape also covers live website capture, capture locator repair,
report/export surfaces, workflow execution panels, global AX harvesting, and
Employer Brand capture changes. These producers should use adapter metadata and
neutral node kinds rather than adding domain-specific top-level fields.

## Paths

Every node has a stable path assembled from its visible ancestry, for example:

```text
desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit/target:cta
```

Paths are for addressing and diagnostics. They do not replace source identity:
nodes should still preserve canvas ids, window ids, file paths, URLs, subject
ids, and adapter-owned ids under `source`.

## Bounds And Transforms

`bounds` may include rectangles in several named spaces:

- `parent_local` for the node's parent coordinate space,
- `desktop_world` for cross-display coordinates,
- `viewport_local` for browser/workbench viewport geometry,
- `lcs_local` or `image_local` for capture/image-local spaces,
- `screen_projected` for future 3D world-to-screen projections.

Missing transforms are unavailable, not guessed. V0 can record simple
translation/scale transforms when the producer knows enough to convert
parent-local rectangles to DesktopWorld. Future 3D adapters can record a
placeholder transform from `world_3d` to `screen_projected` until a concrete
camera projection contract exists.

## Adapter State

Each node records the adapter that produced it, including confidence, freshness,
and child discovery state. Child discovery can be `complete`, `partial`,
`unsupported`, `blocked`, `unresolved`, or `unknown`. This lets inspectors show
where the tree stops without pretending hidden descendants were inspected.

## Hit Test And Inspect

A future inspect operation should use the tree as follows:

1. Start from a DesktopWorld pointer point.
2. Resolve the display, window, and canvas from spatial topology and z-order.
3. Enter the selected surface adapter.
4. Ask that adapter for the deepest hit target under the surface-local point.
5. Return a path of candidate nodes with bounds and identity metadata.
6. Convert the selected hit target into an annotation intent record.

V0 defines the data shape for this operation. It does not implement live pointer
hover, browser DOM probing, Mermaid/SVG picking, 3D raycasting, or global AX
harvesting.

## Annotation Relationship

Annotation intent records preserve what the human or agent meant. Spatial
subject nodes describe what is currently visible or addressable. Annotation
projection records resolve durable anchors into current geometry. Annotation
inspectors can group annotations by surface node and project them back through
the tree.

An `annotation_projection` node should reference the projection id or
annotation id in `source.subject_id`, carry its resolved geometry in
`bounds.viewport_local`, and inherit DesktopWorld geometry only when the
surface-to-world transform is available.
