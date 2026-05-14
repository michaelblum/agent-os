# Surface Annotation Projection Contract V0

## Context

The Workbench Annotation Badges V0 smoke proved annotations can be loaded,
displayed, cleared, reloaded, and preserved through checkpoint resume. The
human review exposed the next gap: visible annotations are not yet anchored to
the annotated entity.

Current Markdown Workbench behavior is a fixed rail/panel. Badges move with the
Workbench window, but line/text annotations do not move with the source or
preview content when the view scrolls. The fixed panel can cover content, and
the user cannot tell why a badge appears where it appears.

The durable platform direction is not "more Markdown badges." It is a neutral
annotation projection layer:

- annotation intent records stay durable and domain-neutral,
- each surface resolves anchors to current viewport geometry,
- an overlay twin renders small non-disruptive decorators,
- notes expand on hover/click,
- the layer is dismissable/summonable,
- the same projection contract can later support Markdown, browser pages,
  Mermaid/SVG, PDFs/images, 3D model views, and other canvases.

## Goal

Implement the V0 projection contract and one bounded Markdown Workbench proof.

This is the next step after visible annotation badges. It should convert
annotation display from "fixed list of badges" toward "decorators resolved from
anchors into current surface geometry." Keep the implementation conservative:
define the reusable contract now, prove it in Markdown Workbench for line/text
anchors, and leave browser/3D/Mermaid adapters as documented future consumers.

## Inputs

Inspect at minimum:

- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation.md`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `shared/schemas/workbench-human-checkpoint-v0.md`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/styles.css`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `scripts/workbench-human-checkpoint-annotations-push.mjs`
- `tests/toolkit/markdown-workbench-model.test.mjs`
- `tests/toolkit/markdown-workbench-layout.test.mjs`
- `tests/toolkit/workbench-human-checkpoint.test.mjs`
- `docs/design/surface-annotation-intent-convergence-tracker.md`
- `docs/api/toolkit.md`

## Required Design Principle

Do not treat annotations as UI positions. Treat annotations as stable anchor
intent plus projection output.

An annotation record should say what the human or agent meant. A projection
record should say where that intent currently resolves on a specific live
surface and viewport.

## Deliverables

Add a neutral projection contract:

- Schema and docs for a first-class annotation projection result, for example:
  - `shared/schemas/annotation-projection-v0.schema.json`
  - `shared/schemas/annotation-projection-v0.md`
- Toolkit helper(s), likely under `packages/toolkit/workbench/`, that can:
  - normalize projection requests,
  - build projection results from annotation records and surface adapter output,
  - distinguish resolved, unresolved, stale, out-of-viewport, and unsupported
    anchors,
  - validate or schema-check projection result fixtures.
- A small fixture under `docs/design/fixtures/` showing a projection result for
  Markdown Workbench annotations.
- Focused tests for the projection helper and Markdown Workbench behavior.
- Documentation in `docs/api/toolkit.md` explaining how annotation intent,
  surface binding, projection result, and overlay rendering relate.

Add a bounded Markdown Workbench proof:

- Resolve `selection_comment` / `text_range` / line anchors to visible content
  geometry in the current Markdown Workbench view.
- Render annotations as compact decorators near the resolved anchor rather than
  only as a fixed panel/list.
- Keep decorators non-disruptive:
  - small ordinal badge by default,
  - note/details expand on hover and/or click,
  - avoid covering the annotated text when possible,
  - support a dismiss/summon toggle for the annotation layer.
- Keep the annotation list/rail available if useful, but it must not be the only
  way to understand where annotations attach.
- Recompute projection on scroll, resize, view-mode changes, content edits, and
  annotation reload/clear.
- Preserve `window.__markdownWorkbenchState.annotations`; add inspectable
  projection state such as `window.__markdownWorkbenchState.annotation_projection`
  or equivalent.

## Projection Contract Requirements

The projection result should model these neutral concepts without
Employer Brand-specific fields:

- `surface_binding`
  - `surface_id`
  - `surface_type` such as `markdown_workbench`, `browser_page`, `mermaid_svg`,
    `three_scene`, `pdf_page`, `image`, or `generic_canvas`
  - source identity, such as `source_path`, `source_url`, `subject_id`, or
    canvas/window/tab identifiers where available
- `viewport`
  - width/height
  - scroll offsets if applicable
  - zoom/scale/device pixel ratio if available
  - view mode if applicable
- `projections[]`
  - annotation id and ordinal
  - anchor type
  - resolution status: `resolved`, `unresolved`, `stale`, `out_of_viewport`,
    `unsupported`
  - resolved rect(s) in viewport-local coordinates when available
  - decorator placement recommendation
  - confidence or reason when unresolved
  - source excerpt/selector/semantic anchor metadata copied from the annotation
- `layer`
  - visible/dismissed state
  - decorator mode
  - whether details are expanded
  - prepare/restore implications for capture

## Markdown Proof Requirements

For Markdown Workbench V0:

- Text-range annotations should resolve against the editor/source view where
  feasible.
- Preview-mode resolution can be simpler: if exact rendered text mapping is not
  ready, show the decorator in a content-relative section/line area and mark the
  projection status or precision clearly.
- Decorator positions must move with scroll instead of staying fixed.
- Badges should not sit in a fixed top-left rail as the primary visual grammar.
- The note card should appear only on hover/click/focus, or in a dismissable
  side panel.
- The annotation layer should be hide/show-able from a UI control and from a
  message/event.
- The layer must not mutate Markdown content or checkpoint annotations.

## Future Adapter Notes

Document, but do not implement, how other surfaces would resolve anchors:

- Browser page: selector/text/role/ancestor candidates to `getBoundingClientRect`
  through a supervised adapter.
- Mermaid/SVG: node id, edge id, SVG text, or generated data attributes to SVG
  bounding boxes.
- 3D model: object id/material/mesh/world point to screen-space projection using
  the active camera.
- PDF/image/canvas: page or image coordinates to viewport-local rects.

These notes should make clear that the projection contract is shared, while each
surface adapter owns anchor resolution for its coordinate system.

## Hard Boundaries

- Do not implement browser-page overlays in this slice.
- Do not implement Mermaid/SVG or 3D model adapters in this slice.
- Do not revive or port the old Chrome extension/sidebar architecture.
- Do not change Employer Brand evidence artifacts or capture state.
- Do not run live browser/capture work, URL opening, locator resolution,
  screenshots, report rendering/export, or workflow execution.
- Do not replace `annotation.schema.json`; extend around it with projection
  output contracts.
- Do not make selectors the sole anchor model.

## Verification

Run focused verification appropriate to the files touched, including:

- projection helper tests,
- Markdown Workbench model/layout/render tests,
- Workbench Human Checkpoint tests,
- schema tests,
- `git diff --check`.

Also run a bounded local Markdown Workbench smoke if practical:

1. Start a checkpoint on
   `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`.
2. Add a committed `selection_comment` line/text annotation.
3. Push/load annotations.
4. Confirm the decorator is content-relative and moves with scroll.
5. Confirm the note expands on hover/click or equivalent focus interaction.
6. Confirm hide/show works.
7. Confirm resume still preserves annotations.

If the local smoke cannot be automated, report the exact manual check needed for
Operator.

## Completion Report

Report:

- what neutral contract was added,
- what Markdown proof behavior changed,
- what remains fixed/list-only, if anything,
- which future adapters are documented but not implemented,
- tests and smoke checks run,
- confirmation that Employer Brand capture artifacts were not modified.
