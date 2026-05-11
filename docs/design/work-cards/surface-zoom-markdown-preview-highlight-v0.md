# Surface-Zoom Markdown Preview Highlight V0

## Goal

Make Markdown-backed Surface-Zoom subjects show the actual Markdown content, not just synthetic hit-test bars.

The current Surface-Zoom Inspector can select synthetic line-range bars, but humans cannot see the underlying Markdown that each bar represents. That makes the inspector feel like an abstract geometry debug surface. For Markdown subjects, clicking or inspecting a bar should visibly highlight the corresponding rendered Markdown line range.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `packages/toolkit/workbench/markdown-spatial-subject-tree.js` only if needed to expose safe preview metadata
- `packages/toolkit/markdown/render.js` only if a small source-line wrapper hook is needed
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent focused tests only if directly needed

Keep this generic to Markdown-backed spatial subject trees. Do not add Employer Brand-specific UI logic.

## Existing Useful Inputs

The existing Markdown spatial tree already includes:

- surface adapter type: `markdown_workbench`
- source path in `surface.source.file_path`
- node line ranges in `node.metadata.line_range`
- synthetic bounds in `node.bounds.parent_local`

The shared Markdown renderer already emits `data-source-line` attributes for rendered headings, list items, paragraphs, code blocks, Mermaid blocks, and other rendered elements.

## Required Behavior

### 1. Render A Markdown Preview Layer

For a selected surface whose adapter/source indicates a Markdown document:

- Load the Markdown source from the surface tree metadata/source path.
- Render it with the shared safe Markdown renderer.
- Display the rendered Markdown content inside the primary subject map region.
- Preserve the existing synthetic hit-test overlay as an overlay layer above the rendered content.

If Markdown content cannot be loaded or rendered:

- fall back to the current synthetic map view;
- expose a visible, concise fallback reason;
- keep `inspectPoint(...)` behavior working.

### 2. Highlight Selected Line Range

When the selected node has `metadata.line_range`:

- Highlight all rendered Markdown elements whose `data-source-line` falls within that range.
- Show the selected target label in the summary as today.
- Keep the synthetic selected bar visible, but make the Markdown highlight the main visual cue.

When `inspectPoint(...)` selects a different line-range node:

- update the highlighted rendered Markdown range immediately;
- preserve last hit-test state and draft creation behavior.

### 2a. Make Synthetic Bounds Show Hierarchy

When the synthetic overlay is visible, it should communicate nesting and
relationship instead of rendering every line-range rectangle as a same-weight
bar.

For Markdown-backed trees:

- inset child/descendant bounds slightly within parent/document bounds when
  rendering the overlay, without changing the underlying hit-test coordinates;
- use depth/role styling to distinguish document, headings, regions/tables, and
  decision targets;
- keep parent bounds visually quieter than child decision targets;
- keep selected and last-hit targets prominent;
- avoid a flat wall of identical gold rectangles.

The inset is presentation-only. `inspectPoint(...)`, stored bounds, annotation
drafts, and verification seeds must continue to use the original structured
coordinates.

### 3. Add Preview / Overlay Controls

Add a simple map display mode control:

- `Preview`
- `Overlay`
- `Both`

Default to `Both` for Markdown subjects if the preview loads successfully.

Definitions:

- `Preview`: rendered Markdown content with selected range highlight; synthetic bars hidden except selected/last-hit marker if needed.
- `Overlay`: current synthetic subject map only.
- `Both`: rendered Markdown content plus de-emphasized synthetic overlay.

Keep the existing overlay checkbox if useful, but avoid duplicate/confusing controls. It is acceptable to reinterpret the existing overlay toggle as controlling synthetic bars while display mode controls preview visibility.

### 4. Keep Decision Targets Navigable

The `Targets` tab remains the primary navigator.

Clicking a target in the navigator should:

- select the node;
- update the rendered Markdown highlight;
- keep the selected synthetic bar in sync.

### 5. Preserve Behavior And Contracts

Preserve:

- `window.surfaceZoomInspector.inspectPoint(...)`
- `window.surfaceZoomInspector.snapshot()`
- mini-map click to inspect
- selected target updates
- last hit-test target visual state
- draft annotation creation
- overlay/label controls or their clear replacement
- fit / zoom out / zoom in / reset view controls
- reset selection
- clear drafts
- secondary Targets/Drafts/Diagnostics views

Add snapshot state for:

- map display mode
- Markdown preview availability
- selected line range
- highlighted line count or highlighted source lines
- preview fallback reason, if any

## UX Requirements

- The primary visual for Markdown subjects should be recognizable rendered Markdown.
- The yellow/gold synthetic bars should not be the only visible representation of the document.
- Default Markdown subject view should not look like a dense wireframe chart.
- Text should be legible at the default `1180 x 720` AOS canvas size.
- No document-level horizontal overflow.
- The map frame must not introduce horizontal scrolling.
- If vertical scrolling is needed inside the preview, it should be one clear preview scroll area, not nested scrollbars.
- Do not render raw Markdown source as the main preview unless the renderer fails.

## Verification

Add focused tests that assert:

- Markdown-backed selected surfaces expose preview metadata in the model/snapshot.
- Selected node line ranges produce a selected line range in snapshot state.
- Rendered preview output uses `data-source-line` and selected-range highlight classes.
- Target list click / `selectSurfaceNode(...)` updates the selected line range.
- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` still selects `target:line-041-company-and-competitor-set` and highlights lines 41-49.
- Display modes `Preview`, `Overlay`, and `Both` are represented in state/UI.
- Synthetic overlay rendering uses presentation-only hierarchy/depth classes or
  style variables while preserving original hit-test bounds in model state.
- Non-Markdown fixture subjects fall back to the existing synthetic map behavior.

Run:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/markdown-render.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- `bash tests/help-contract.sh`
- `git diff --check`

If `./aos ready` passes, run a bounded AOS smoke with the Employer Brand Markdown tree fixture and remove the smoke canvas afterward.

Smoke must verify:

- rendered Markdown preview is visible;
- `Synthetic Subject Map` still identifies the surface/map;
- no document-level horizontal overflow;
- display mode default is `Both`;
- selecting or inspecting `target:line-041-company-and-competitor-set` highlights Markdown lines 41-49;
- target navigator remains usable;
- diagnostics remain collapsed/hidden by default.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not add a broad new annotation framework.
- Do not port Syborg/Chrome-extension UI.
- Do not implement generic PDF/image/DOM preview layers in this slice.

## Completion Report

Report:

- changed files;
- how Markdown preview loading works;
- how selected line range highlighting is represented in state and DOM;
- AOS smoke evidence or exact readiness blocker;
- verification commands and results.
