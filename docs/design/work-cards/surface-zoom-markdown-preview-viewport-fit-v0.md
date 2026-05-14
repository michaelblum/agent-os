# Surface-Zoom Markdown Preview Viewport Fit V0

## Goal

Make the Markdown preview layer usable at the default AOS canvas size by fitting rendered Markdown into the synthetic map viewport and keeping the selected line range visible.

The Markdown source-resolution fix succeeded, but Foreman visual smoke still shows an ergonomic failure: rendered Markdown is enormous, clipped, and visually fighting the synthetic overlay. The selected line-range highlight is structurally present, but the user cannot comfortably see the selected Markdown section.

## Foreman Smoke Evidence

After the source-resolution fix:

- `./aos ready` passed.
- Markdown preview loads successfully:
  - `markdown_preview.available === true`
  - `markdown_preview.status === "ready"`
  - `map_display_mode === "both"`
- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` selects `target:line-041-company-and-competitor-set`.
- Snapshot highlights source lines 41-49.
- DOM highlight elements are present.
- No document-level horizontal overflow.

But the screenshot shows:

- rendered Markdown text is too large for the map viewport;
- the preview starts at the top of the document even after selecting lines 41-49;
- the selected range is not brought into view;
- synthetic bars and Markdown text visually collide;
- the "Both" mode still reads as a messy overlay, not an inspector.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent focused tests only if needed

Keep this generic to Markdown-backed Surface-Zoom subjects.

## Required Fixes

### 1. Fit Markdown Preview Typography To The Map

The rendered Markdown preview should be legible but not giant at a default `1180 x 720` AOS canvas.

Use a component-specific preview scale/typography, not global Markdown preview defaults. The preview should:

- fit within the map frame width without clipping;
- use compact workbench typography;
- preserve readable headings, paragraphs, tables, and Mermaid placeholder blocks;
- avoid page-level horizontal overflow;
- avoid map-frame horizontal overflow.

### 2. Scroll Or Position To Selected Line Range

When a selected node has `metadata.line_range`, the preview should bring that rendered line range into view.

Acceptable V0 approaches:

- scroll the preview container to the first highlighted line after render; or
- translate the preview content so the selected line range is visible; or
- use a focused excerpt window around the selected line range with enough surrounding context.

The user must be able to see the selected Markdown content after:

```js
window.surfaceZoomInspector.inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })
```

For the Employer Brand fixture, the visible preview should include `Companies And Competitor Set` after that inspect call.

### 3. Make Both Mode Visually Legible

In `Both` mode:

- rendered Markdown should be the primary readable layer;
- synthetic overlay should be de-emphasized;
- selected and last-hit bounds may stay prominent;
- non-selected generic bounds should be subtle enough not to obscure text;
- decision-target bounds should communicate structure without covering the preview.

If needed, use opacity, blend mode, borders-only styling, or show only decision/selected/last-hit bounds in `Both` mode.

### 4. Preserve Overlay Mode

`Overlay` mode should preserve the synthetic geometry map for diagnostics and hit-test reasoning.

Do not remove the synthetic map.

### 5. Preserve Contracts

Preserve:

- `window.surfaceZoomInspector.inspectPoint(...)`
- `window.surfaceZoomInspector.snapshot()`
- mini-map click to inspect
- selected target updates
- target navigator
- draft creation
- Preview / Overlay / Both display modes
- overlay hierarchy/inset presentation metadata
- original hit-test bounds, stored bounds, annotation draft bounds, and verification seed bounds

Add or preserve snapshot/DOM state sufficient to verify:

- preview is available;
- selected line range is visible or focused;
- highlighted source lines are 41-49 for the company-set target;
- preview scroll/focus state if implemented.

## Tests

Add focused tests that assert:

- Markdown preview has component-specific fit/viewport classes or state.
- Selecting/inspecting a line-range node records enough state for the preview to focus that range.
- The company-set target produces selected range 41-49 and a visible/focused preview state.
- `Both` mode de-emphasizes generic synthetic overlay relative to selected/decision targets.
- `Overlay` mode still renders synthetic bounds.
- Existing source-resolution tests still pass.

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

- Markdown preview is visible.
- No document-level horizontal overflow.
- default display mode is `Both`.
- after inspecting company-set target, visible preview text includes `Companies And Competitor Set`.
- highlighted source lines include 41-49.
- generic synthetic overlay does not obscure the selected Markdown content.
- `Overlay` mode can still be selected and shows synthetic bounds.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not add new preview types.

## Completion Report

Report:

- changed files;
- how preview fitting/focusing works;
- AOS smoke evidence, including visible selected Markdown text;
- verification commands and results.
