# Surface-Zoom Inspector Human-Grade Interaction V0

## Goal

Take the Surface-Zoom Inspector from "less broken debug workbench" to a human-grade interaction surface that an Operator and user can actually use for alignment.

The previous UX overhaul removed page-level horizontal overflow and replaced the old five-panel grid. That was necessary but not sufficient. The current surface still exposes too much internal diagnostic structure at once: multiple vertical scroll containers, path-heavy detail panels, a dense wall of geometry, and a bottom split panel that keeps the user in a debugger mindset.

This slice should make the surface feel like an inspect-and-decide tool:

1. choose a meaningful target,
2. see where it is on the synthetic subject map,
3. understand why it was selected,
4. draft or clear an annotation,
5. optionally open diagnostics when needed.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent toolkit tests only when directly needed for layout or state contracts

Keep this generic and reusable. Do not add Employer Brand-specific behavior.

## Observed Problems To Fix

Foreman's AOS review after the prior slice confirmed:

- `document.scrollWidth === document.clientWidth`; horizontal document overflow is fixed.
- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` correctly selects `target:line-041-company-and-competitor-set`.
- The surface still shows several visible vertical scroll regions at once.
- The right inspector is dominated by long paths and implementation metadata.
- The bottom `Targets / Outline` plus `Drafts` split competes with the primary map.
- The synthetic map renders a dense amber wireframe by default, which is technically accurate but visually overwhelming.

## Required UX Changes

### 1. Replace Bottom Split With A Single Secondary Drawer

Do not show `Targets / Outline` and `Drafts` as two permanent side-by-side bottom panes.

Use one secondary region with simple tabs or segmented controls:

- `Targets`
- `Drafts`
- `Diagnostics`

Default to `Targets`.

Only the active secondary view should be visible. This removes one major source of nested visual complexity.

### 2. Make The Inspector Summary-First

The right inspector should start with a compact selected-target summary:

- label
- kind / role
- source summary, not full path
- bounds summary
- last hit-test status
- primary action: `Draft Annotation`

Long full paths, source IDs, bounds JSON, capabilities, and metadata belong behind collapsed `<details>` sections. They must not be visible by default.

The selected target's full path may appear in a copyable/wrapped diagnostic detail, but not as the main readout.

### 3. Make The Map Less Visually Noisy By Default

For dense synthetic Markdown fixtures:

- Keep `selected_only` labels.
- Visually de-emphasize non-selected geometry.
- Highlight required alignment/decision targets more clearly than generic text ranges.
- Keep the selected target and last hit-test target prominent.
- Avoid a default screen full of equally bright amber rectangles.

Use visual hierarchy, not additional text, to distinguish:

- surface/document bounds
- generic text/region blocks
- decision targets
- selected target
- last hit-test target
- draft annotations

### 4. Add A Focused Target Navigator

The default `Targets` secondary view should be a short, scannable navigator:

- prioritize selectable decision/semantic targets before generic text ranges;
- show label, kind/role, and line/source summary;
- truncate/wrap gracefully;
- include enough state to see selected/last-hit/draft-related items.

If the fixture has many low-level nodes, put them behind an `All nodes` disclosure/filter. Do not make the user scan every generated node first.

### 5. Reduce Visible Scrollbars

At common AOS canvas size around `1180 x 720`:

- Page/body horizontal overflow must remain false.
- Map frame must not scroll internally.
- Only one of these should visibly scroll at a time under normal default state:
  - inspector content, or
  - secondary drawer content.
- Avoid visible nested scrollbars inside cards, details, or code blocks by default.
- Diagnostic code blocks can scroll only inside collapsed/opened diagnostics.

### 6. Preserve Behavior

Preserve:

- `window.surfaceZoomInspector.inspectPoint(...)`
- `window.surfaceZoomInspector.snapshot()`
- mini-map click to inspect
- selected target updates
- last hit-test target visual state
- draft annotation creation
- overlay toggle
- label density control
- fit / zoom out / zoom in / reset view controls
- reset selection
- clear drafts

Add/preserve snapshot state for:

- active secondary tab/view
- map view state
- layout guard metadata
- selected target summary
- visible scroll/overflow guard metadata if available

## Verification

Update focused tests to assert:

- no legacy permanent bottom split layout remains;
- secondary region has `Targets`, `Drafts`, and `Diagnostics` views with only one active by default;
- inspector renders summary-first fields before diagnostics;
- raw diagnostic blocks are collapsed by default;
- dense Markdown fixture navigator prioritizes required decision/semantic targets;
- dense map default styling distinguishes selected/decision/generic targets by class/state;
- snapshot includes active secondary view and map view state;
- existing `inspectPoint(...)` behavior and annotation draft creation still pass.

Run:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- `bash tests/help-contract.sh`
- `git diff --check`

If `./aos ready` passes, run a bounded AOS visual/DOM smoke with the Employer Brand Markdown tree fixture and remove the smoke canvas afterward.

The smoke should verify:

- no document-level horizontal overflow;
- `Synthetic Subject Map` visible;
- target navigator visible and defaults to decision/semantic targets;
- diagnostics are collapsed or hidden by default;
- no permanent side-by-side bottom `Targets / Outline` plus `Drafts` split;
- `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` selects `target:line-041-company-and-competitor-set`;
- only the expected default scroll containers are active.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not add a broad new annotation framework.
- Do not port Syborg/Chrome-extension UI.

## Completion Report

Report:

- changed files;
- before/after UX simplifications;
- which visible scroll containers remain by default and why;
- AOS smoke evidence or exact readiness blocker;
- verification commands and results.
