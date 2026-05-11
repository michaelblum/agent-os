# Surface-Zoom Annotation Inspector Proof V0

## Context

Spatial Subject Tree V0 now defines the neutral tree for everything visible or
addressable across displays:

```text
DesktopWorld
  Display
    Window / App / AOS Canvas / Browser
      Surface
        View / Pane / Document / Scene
          Element / Node / Text Range / Mesh / Region
            Sub-element / Point / Selection
```

This unlocks the next interaction model: an inspector that can "zoom" into one
surface as its own mini-map. The user first chooses a top-level surface, then
inspects or annotates elements within that selected surface. This should feel
like Chrome DevTools element inspect, but generalized across AOS canvases,
browser pages, Markdown, Mermaid/SVG, 3D scenes, PDFs/images, and generic Mac
apps over time.

Do not implement all adapters in this slice. Build the first proof against
static/fixture Spatial Subject Tree data and AOS canvas-style semantic targets.

## Goal

Add a bounded Surface-Zoom Annotation Inspector proof that consumes Spatial
Subject Tree V0 data and demonstrates the core lifecycle:

1. Load a spatial subject tree.
2. Show the outer DesktopWorld/display/window/canvas tree.
3. Select one surface node.
4. Treat the selected surface as its own mini-map/inspect world.
5. Show child nodes and bounds inside that surface.
6. Let the user create annotation draft records from selected tree nodes.
7. Keep the UI/data generic and adapter-boundary aware.

This is a proof of the surface-zoom inspection model, not a full global
Annotation Inspector.

## Inputs

Inspect at minimum:

- `shared/schemas/spatial-subject-tree-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/canvas-inspector/index.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `docs/design/aos-surface-system.md`
- `docs/design/surface-annotation-intent-convergence-tracker.md`
- `docs/api/toolkit.md`
- Pi reference notes only:
  - `/Users/Michael/Code/pi-computer-use/AOS_AGENT_OS_NOTES.md`
  - `/Users/Michael/Code/pi-computer-use/README.md`
  - `/Users/Michael/Code/pi-computer-use/src/bridge.ts`
  - `/Users/Michael/Code/pi-computer-use/native/macos/bridge.swift`

Use Pi as reference material for a future generic AX adapter. Do not import or
call `pi-computer-use`.

## Deliverables

Add a generic proof component or workbench surface, preferably as a Canvas
Inspector sibling rather than a Canvas Inspector rewrite. Suggested path:

- `packages/toolkit/components/surface-zoom-inspector/`

The proof should include:

- a tree loader/model for Spatial Subject Tree V0,
- a left/outer tree view for DesktopWorld/display/window/canvas/surface nodes,
- a selected-surface mini-map or bounded viewport panel,
- visual bounds for child nodes inside the selected surface,
- a node details panel showing:
  - path,
  - kind,
  - label,
  - source ids,
  - adapter type/confidence/freshness/child discovery,
  - bounds in available coordinate spaces,
  - capabilities,
  - state,
- an "annotation draft from node" action that creates a structured annotation
  intent draft object in local component state,
- a draft list grouped under the selected surface,
- show/hide control for the node overlay layer,
- fixture/demo launch path or documented `aos://...` URL for the component.

Add focused tests for:

- model normalization from the fixture tree,
- selecting a surface and deriving its visible child nodes,
- converting a selected node to an annotation draft,
- preserving adapter boundaries and unsupported child discovery state,
- rendering or serialized view-model output for the surface mini-map.

Update docs:

- `docs/api/toolkit.md` with a short section for Surface-Zoom Inspector proof.
- `docs/design/surface-annotation-intent-convergence-tracker.md` with a
  cross-reference that this is the first proof of the "select surface, inspect
  inside surface, draft annotation" loop.
- Add or update a design note documenting the future `ax_element` adapter slot
  inspired by `pi-computer-use`.

## Annotation Draft Requirements

When creating a draft from a tree node, map neutral tree data into structured
annotation intent fields:

- `kind`:
  - `element_selection` for semantic/AX/DOM/SVG/3D element-like nodes,
  - `region_comment` for region/image/pdf bounds,
  - `point_comment` for point nodes,
  - `selection_comment` for text range nodes.
- `surface_id` from the nearest surface/canvas/window context.
- `source_path` / `source_url` / source ids from the node where available.
- `coordinate_space` from the best available bounds:
  - `viewport` for viewport-local bounds,
  - `page` or `document` for document/text ranges,
  - `desktop_world` only as metadata if the annotation is about the outer
    surface itself.
- `bounds`, `viewport_bounds`, or metadata copied from node bounds.
- `text_excerpt`, `role`, `label`, `ancestor_chain`, and selector candidates
  where available.
- `note` as a draft placeholder such as `Review <label>`.
- `actor` as `{ "role": "operator", "id": "surface-zoom-inspector" }`.
- `status` as `draft`.

Do not mutate checkpoint files or Employer Brand artifacts from this proof.

## Pi-Inspired AX Adapter Note

Add a concise documentation note for the future generic Mac app adapter,
grounded in `pi-computer-use` patterns:

- window refs are useful as session-scoped handles but should not become AOS
  canonical persistent ids,
- AX targets should map to `ax_element` nodes with role, subrole, title,
  description, value, actions, frame, center, capabilities, score/confidence,
  and source app/window metadata,
- actionable refs should be state-scoped and stale-state checked,
- adapters should preserve parent paths/depth when possible instead of only
  returning a flat ranked target list,
- strict/no-fallback policies should be represented as capabilities and adapter
  state,
- browser pages still need a DOM adapter for selectors/XPath; AX is only a
  generic fallback for browser windows.

This is documentation only in this slice.

## Non-Goals

- No full Annotation Inspector product.
- No Canvas Inspector rewrite.
- No global pointer hover mode.
- No live click/keyboard capture.
- No live AX harvesting.
- No browser DOM adapter.
- No Mermaid/SVG, 3D, PDF/image, or OCR adapter implementation.
- No live website/capture/locator/report/export/workflow execution.
- No Employer Brand capture artifact changes.
- No dependency on `/Users/Michael/Code/pi-computer-use`.

## Verification

Run focused verification appropriate to touched files, including:

- new Surface-Zoom Inspector model/render tests,
- existing Spatial Subject Tree tests,
- annotation schema/projection tests if draft mapping touches helpers,
- relevant toolkit component tests,
- `node --test tests/schemas/*.test.mjs`,
- `git diff --check`.

If a local AOS component smoke is practical, keep it local to fixture data and
AOS canvases. Do not run live browser/capture workflows.

## Completion Report

Report:

- files added/changed,
- how the proof loads and displays Spatial Subject Tree data,
- how surface selection and surface mini-map inspection work,
- how annotation drafts are created from nodes,
- what Pi-inspired AX adapter guidance was added,
- tests/smoke checks run,
- what remains future work,
- confirmation that no live AX/browser/capture/Employer Brand artifact work was
  performed.
