# Spatial Subject Tree Contract V0

## Context

Recent annotation work exposed a larger platform abstraction: everything visible
across all displays can be treated as a tree of spatial subjects.

The current system already has pieces of that tree:

- `shared/schemas/spatial-topology.*` models DesktopWorld, displays, windows,
  apps, z-order, and cursor position.
- `shared/schemas/aos-semantic-targets.md` models child targets inside AOS-owned
  canvases.
- `shared/schemas/annotation.schema.json` models durable annotation intent.
- `shared/schemas/annotation-projection-v0.*` models how annotation anchors
  project back into current surface geometry.
- Surface Inspector already visualizes canvas/window-level spatial state.

The missing contract is the shared tree model that connects these levels:

```text
DesktopWorld
  Display
    Window / App / AOS Canvas / Browser
      Surface
        View / Pane / Document / Scene
          Element / Node / Text Range / Mesh / Region
            Sub-element / Point / Selection
```

This tree should become the conceptual foundation for:

- surface-scoped annotation inspection,
- "zoom into one surface" inspector behavior,
- hit-testing under the pointer,
- annotation projection,
- locator/capture repair,
- human-in-the-loop approval workflows,
- eventual browser, Mermaid/SVG, PDF/image, and 3D adapters.

## Goal

Define `Spatial Subject Tree V0` as a durable, neutral contract and add helper
coverage that maps existing AOS outputs into a tree-shaped projection.

This is contract and data-shape work. Do not build the full Annotation
Inspector UI yet. Do not implement global pointer hover, browser DOM probing,
3D raycasting, or Mermaid/SVG node picking in this slice.

## Inputs

Inspect at minimum:

- `shared/schemas/spatial-topology.schema.json`
- `shared/schemas/spatial-topology.md`
- `shared/schemas/aos-semantic-targets.md`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/annotation-projection-v0.md`
- `docs/design/aos-surface-system.md`
- `docs/design/surface-annotation-intent-convergence-tracker.md`
- `docs/api/toolkit.md`
- `packages/toolkit/runtime/spatial.js`
- `packages/toolkit/components/surface-inspector/index.js`
- existing schema/test patterns under `tests/schemas/` and `tests/toolkit/`

## Design Principle

The tree should not be another DOM. It is a cross-surface spatial subject
projection with adapter boundaries.

AOS owns the outer world:

- displays,
- windows,
- apps,
- AOS canvases,
- DesktopWorld and VisibleDesktopWorld coordinate spaces,
- z-order and coarse occlusion context.

Surface adapters own their inner worlds:

- AOS canvas adapters expose semantic targets and toolkit panes,
- Markdown Workbench exposes lines, headings, rendered blocks, source ranges,
  Mermaid blocks, and annotation projection anchors,
- browser adapters eventually expose DOM elements, selectors, XPath, ARIA role,
  text, frames, and viewport rects,
- Mermaid/SVG adapters eventually expose nodes, edges, labels, and SVG bounds,
- 3D adapters eventually expose object/mesh/material/world-point targets,
- PDF/image adapters eventually expose page regions, OCR/text spans, and image
  coordinates,
- generic Mac apps fall back to AX elements and window-local bounds.

## Deliverables

Add a first-class neutral contract:

- `shared/schemas/spatial-subject-tree-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`

Add toolkit helper(s), likely under `packages/toolkit/workbench/` or
`packages/toolkit/runtime/`, that can:

- normalize a spatial subject tree,
- build a tree from a spatial topology snapshot plus optional semantic targets
  and annotation projections,
- produce stable path strings such as
  `desktop-world/display:<id>/window:<id>/canvas:<id>/surface:<id>/target:<id>`,
- convert parent-local rects to DesktopWorld rects when the required parent
  transforms are present,
- preserve adapter boundaries and unsupported/unresolved child states,
- validate or schema-check fixtures.

Add fixtures and tests:

- A small fixture under `docs/design/fixtures/spatial-subject-tree-v0/` showing
  a DesktopWorld tree with at least:
  - one display,
  - one app/window,
  - one AOS canvas,
  - one surface/pane,
  - two semantic child targets,
  - one annotation projection child or reference.
- Focused toolkit tests proving normalization, path construction, parent/child
  relationships, and coordinate transform behavior.
- Schema tests for the V0 contract.

Update docs:

- `docs/api/toolkit.md` with a concise section explaining how Spatial Subject
  Tree relates to:
  - spatial topology,
  - semantic targets,
  - annotation intent,
  - annotation projection,
  - Surface Inspector,
  - future Annotation Inspector / surface-zoom inspector behavior.
- `docs/design/surface-annotation-intent-convergence-tracker.md` or a nearby
  design note with a short cross-reference to this contract.

## Contract Requirements

The V0 schema should model these concepts without domain-specific fields:

### Tree

- `schema`, `version`, `created_at`
- `root`
- `nodes[]`
- optional `edges[]` if parent ids alone are insufficient
- `metadata`

### Node

Each node should support:

- `id`
- `parent_id`
- `path`
- `kind`, for example:
  - `desktop_world`
  - `visible_desktop_world`
  - `display`
  - `app`
  - `window`
  - `canvas`
  - `surface`
  - `viewport`
  - `pane`
  - `document`
  - `browser_frame`
  - `dom_element`
  - `svg_node`
  - `three_object`
  - `pdf_page`
  - `image_region`
  - `ax_element`
  - `semantic_target`
  - `annotation_projection`
  - `text_range`
  - `point`
  - `region`
- `label`
- `source`
  - file path, URL, app bundle id, canvas id, window id, subject id, or adapter
    owned ids where available
- `bounds`
  - bounds in parent-local coordinates when available
  - DesktopWorld bounds when available
  - viewport-local bounds when available
  - LCS/image-local bounds when available
- `z_order` or sibling order where meaningful
- `state`
  - visible/hidden/offscreen/out_of_viewport/occluded/unknown
- `adapter`
  - adapter id, adapter type, confidence, freshness, and whether child
    discovery is complete, partial, unsupported, or blocked
- `capabilities`
  - hit_test
  - annotate
  - project_annotation
  - click/action
  - capture
  - inspect_children

### Transform

V0 should be explicit about transforms:

- parent-local -> DesktopWorld where available,
- viewport-local -> parent surface where available,
- LCS/image-local -> capture source where available,
- world/screen projection placeholder for future 3D adapters.

Do not require every node to have every transform. Missing transforms should be
modeled as unavailable, not guessed.

### Hit-Test And Inspect Relationship

Document how a future inspect operation would use the tree:

1. Start from a DesktopWorld pointer point.
2. Resolve display/window/canvas from spatial topology and z-order.
3. Enter the selected surface adapter.
4. Ask that adapter for the deepest hit target under the surface-local point.
5. Return a path of candidate nodes and their bounds/identity metadata.
6. Convert the selected hit target into an annotation intent record.

Do not implement this live pointer loop in this slice.

### Annotation Relationship

Document how annotations fit:

- annotation intent records preserve what the human/agent meant,
- spatial subject nodes describe what is currently visible/addressable,
- annotation projections resolve annotation anchors into current geometry,
- annotation inspectors can group annotations by surface node and project them
  back through the tree.

## Non-Goals

- No full Annotation Inspector UI.
- No Surface Inspector redesign.
- No live pointer hover or click capture.
- No browser DOM adapter implementation.
- No Mermaid/SVG, 3D, PDF/image, or OCR adapter implementation.
- No global AX tree harvesting beyond documenting the generic-app fallback.
- No Employer Brand capture changes.
- No live website/capture/locator/report/export/workflow execution.

## Verification

Run focused verification appropriate to touched files, including:

- new spatial subject tree toolkit tests,
- new schema tests,
- any affected toolkit model tests,
- `node --test tests/schemas/*.test.mjs`,
- `git diff --check`.

No live UI smoke is required for this contract slice. If you add one, keep it
local to AOS canvases and do not touch live browser/capture workflows.

## Completion Report

Report:

- files added/changed,
- the core tree shape,
- how the contract relates to spatial topology, semantic targets, annotation
  intent, annotation projection, and Surface Inspector,
- what helper behavior was implemented,
- what fixtures/tests were added,
- what adapters remain future work,
- confirmation that no Employer Brand capture artifacts, live browser work, or
  annotation inspector UI were changed.
