# Surface-Zoom Inspector Spatial Workbench UX Overhaul V0

## Goal

Redesign the Surface-Zoom Inspector from a dense multi-pane debug grid into a decipherable spatial workbench for selecting, inspecting, and drafting annotations against a structured subject surface.

This is a usability correction for the existing Surface-Zoom Inspector. The current implementation still behaves like a debug dashboard: too many persistent panels, nested scroll containers, horizontal overflow, raw JSON blocks, and unclear visual hierarchy. The new UX should make the user understand what they are looking at within a few seconds.

## Scope

Work in:

- `packages/toolkit/components/surface-zoom-inspector/`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- adjacent toolkit tests only if needed for shared layout contracts

Keep this generic. Do not make Employer Brand-specific UI logic.

## Required UX Model

Reframe the app as a spatial workbench with these regions:

1. **Chrome/titlebar**
   - Keep toolkit `mountChrome` and stock close/minimize/maximize/drag/resize controls.
   - Keep the source/fixture subtitle, but make it short and non-dominant.

2. **Top command bar**
   - Keep controls for selected surface, overlay visibility, label density, reset selection, clear drafts, and inspect status.
   - Add explicit zoom controls for the subject map: fit, zoom in, zoom out, and reset view. These may be UI-state-only in V0 if pan/zoom is deterministic and covered by tests.
   - Controls must wrap cleanly on narrow widths instead of causing horizontal scroll.

3. **Primary subject map**
   - The subject map is the main surface, not one panel among five.
   - Label it clearly as `Synthetic Subject Map`.
   - Include concise helper text: structured/line-based bounds are not screenshot pixels.
   - No internal scrollbars inside the map frame.
   - Map content must fit its container by default.
   - Dense fixtures should default to `selected_only` labels.
   - Do not render all labels on the map unless the user explicitly chooses `all`.

4. **Targets / outline**
   - Provide a navigational target list or outline that is useful but secondary.
   - It should not force the whole app wider.
   - Long labels and paths must wrap or truncate gracefully; no horizontal scrolling.
   - On narrower windows, collapse this region below the map or into a tab/section rather than preserving a fixed three-column layout.

5. **Inspector / details**
   - Show human-readable selected target details first: label, kind, path summary, bounds summary, adapter summary, current state, and last hit-test result.
   - Move raw JSON into collapsible `<details>` sections or compact wrapped code blocks that cannot create page-level horizontal scroll.
   - Draft annotations should be shown as concise cards/list items. Do not dedicate a permanent bottom row that creates another scroll axis.

## Layout Requirements

- Remove the hard `body` / root `min-width: 980px` behavior.
- The page must have no horizontal document scroll at normal canvas sizes.
- Use responsive CSS with `minmax(0, ...)`, `overflow-wrap`, and constrained panels.
- Prefer one primary scroll container for non-map content at a time. Avoid nested `overflow: auto` on every panel.
- At desktop width, use a clear workbench layout, for example:
  - top toolbar
  - main area with a large map and a right inspector
  - secondary target list/outline below or in a left rail only if it does not compress the map
- At narrower widths, collapse to a vertical stack:
  - map first
  - inspector
  - targets/drafts
- Text must not overlap, spill out of controls, or require horizontal scrolling to read.
- The surface should look like a toolkit/workbench component, not a bespoke debug webpage.

## Interaction Requirements

Preserve existing behavior:

- `window.surfaceZoomInspector.inspectPoint(...)`
- `window.surfaceZoomInspector.snapshot()`
- mini-map click to inspect
- selected target updates
- last hit-test target visual state
- draft annotation creation
- overlay toggle
- label density control
- reset selection
- clear drafts

Add or preserve state in snapshots:

- `label_density`
- `overlay_visible`
- `inspect_status`
- selected surface/node labels
- `last_inspect`
- map view state for fit/zoom/reset controls, if implemented
- enough layout metadata for tests to assert no known overflow regression

## Verification

Add focused tests that assert:

- The component still imports toolkit panel, controls, and workbench CSS.
- The UI no longer uses the old five-panel `surface-zoom-layout` grid or a permanent bottom drafts row.
- Dense fixtures default to selected-only labels.
- Long labels/paths are rendered in wrappers that cannot force horizontal document scroll.
- Raw JSON sections are collapsible or otherwise constrained.
- `inspectPoint(...)` still selects the expected target and produces annotation draft + verification seed.
- Snapshot state still exposes all required inspect and map state.

Run:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- `bash tests/help-contract.sh`
- `git diff --check`

If `./aos ready` passes, also do a bounded AOS smoke with the Employer Brand Markdown Spatial Subject Tree fixture:

- Launch Surface-Zoom with `docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`.
- Use `./aos see capture` or equivalent structured DOM evaluation to verify:
  - titlebar/chrome is present
  - command bar is visible
  - `Synthetic Subject Map` is visible
  - no document-level horizontal overflow
  - no obvious nested-scrollbar layout
  - target list and inspector are legible
  - `inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" })` selects `target:line-041-company-and-competitor-set`

Remove any smoke canvas after verification.

## Non-Goals

- Do not resume Employer Brand Operator alignment.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report rendering/export, or workflow execution.
- Do not modify Employer Brand capture manifests, repair patches, diagnostics, data bundles, or source evidence fixtures.
- Do not rebuild Surface-Zoom as a Chrome extension or import old Syborg transport.
- Do not add a broad new annotation framework in this slice.

## Completion Report

Report:

- Changed files.
- UX changes made.
- What horizontal-scroll/nested-scroll issues were removed.
- Snapshot or DOM evidence for no horizontal document overflow.
- AOS smoke result, or exact readiness blocker if smoke could not run.
- Verification commands and results.
