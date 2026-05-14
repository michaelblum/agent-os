# Surface-Zoom Inspector Toolkit Shell + Decipherable UX V0

## Context

The Surface-Zoom Inspector now proves the right structured model:

```text
Spatial Subject Tree -> selected surface mini-map -> hit-test inspect -> annotation draft / APV seed
```

However, the current canvas is still a raw harness surface. In a human-facing
Operator/HITL context it is disorienting:

- no stock toolbar or titlebar chrome,
- no clear close/minimize/maximize controls,
- not obviously draggable or resizable,
- dense rectangles and labels overlap,
- the mini-map looks like broken rendered Markdown instead of a synthetic
  line-based subject map,
- the user cannot quickly tell what is selectable, selected, inspected, or
  fixture-only.

That is acceptable for a hidden deterministic harness. It is not acceptable for
a surface handed to Operator or the human.

Pause Operator use of Surface-Zoom on Employer Brand until this correction is
complete.

## Goal

Convert Surface-Zoom Inspector from raw harness UI into a toolkit-native,
decipherable workbench/panel surface while preserving its deterministic inspect
contract.

Use existing toolkit primitives rather than inventing private chrome.

## Inputs

Inspect at minimum:

- `packages/toolkit/components/surface-zoom-inspector/index.html`
- `packages/toolkit/components/surface-zoom-inspector/index.js`
- `packages/toolkit/components/surface-zoom-inspector/styles.css`
- `packages/toolkit/components/surface-zoom-inspector/model.js`
- `packages/toolkit/components/surface-zoom-inspector/launch.sh`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/defaults.css`
- `packages/toolkit/controls/defaults.css`
- `packages/toolkit/workbench/defaults.css`
- `docs/api/toolkit.md` Panel API and Workbench Contracts sections
- `tests/toolkit/workbench-shell.test.mjs`
- `tests/toolkit/style-contracts.test.mjs`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- `docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`

## Required UX Corrections

Add toolkit-native shell/chrome:

- Import and use stock toolkit panel/workbench primitives where practical:
  - `packages/toolkit/panel/chrome.js` for draggable/resizable panel chrome, or
  - `workbench/defaults.css` shell classes if the component remains a custom
    workbench surface.
- Include a visible titlebar with:
  - title `Surface-Zoom Inspector`,
  - source/fixture subtitle,
  - close/minimize controls,
  - maximize and/or resize affordance if supported by the chosen primitive.
- Include a toolbar with:
  - selected surface label,
  - overlay visibility toggle,
  - label-density mode: `labels off`, `selected only`, `all`,
  - reset selection / clear draft controls,
  - inspect status summary.
- Make the canvas draggable and resizable through toolkit primitives if the
  chosen shell supports it.

Make the mini-map decipherable:

- Explicitly label it as `Synthetic Subject Map`, not rendered Markdown.
- Add a short status/help line explaining that bounds are line-based or
  structured target bounds, not screenshot pixels.
- Prevent overlapping labels by default:
  - default to `selected only` labels for dense Markdown trees,
  - show target labels in a side list/details panel,
  - keep rectangle labels hidden or abbreviated when they cannot fit.
- Use distinct visual treatment for:
  - surface/document nodes,
  - decision targets,
  - headings/tables/blocks,
  - existing annotation projections,
  - currently selected target,
  - last hit-test selected target.
- Add a clear selected-target summary near the mini-map.
- Preserve a details panel, but keep long paths/source IDs scroll-contained so
  they do not dominate the surface.

Preserve deterministic APIs:

- `window.surfaceZoomInspector.inspectPoint(...)` must still work.
- `window.surfaceZoomInspector.snapshot()` must still expose structured state,
  including `last_inspect`.
- Existing model helpers and hit-test/APV behavior must remain deterministic.
- No pass/fail condition may depend on screenshot-pixel comparison.

## Tests

Update or add focused tests proving:

- Surface-Zoom imports or otherwise consumes stock toolkit shell/chrome/control
  primitives.
- The HTML/CSS includes a titlebar/shell, toolbar, and close/minimize controls
  or documented stock equivalents.
- Label density defaults avoid all-label overlap for dense Markdown trees.
- The mini-map exposes text identifying itself as a synthetic subject map.
- Snapshot and `inspectPoint(...)` APIs remain stable.
- Existing hit-test selection tests still pass.
- Style contract tests do not detect private duplication of protected control
  primitives.

## Bounded AOS Smoke

If `./aos ready` passes, run a fixture-only smoke:

```bash
./aos ready
AOS_SURFACE_ZOOM_INSPECTOR_ID=surface-zoom-inspector-shell-smoke \
AOS_SURFACE_ZOOM_INSPECTOR_TREE_URL=aos://repo_codex_docks_session_roots/docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json \
packages/toolkit/components/surface-zoom-inspector/launch.sh
./aos show eval --id surface-zoom-inspector-shell-smoke --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 760, coordinate_space: "viewport" })'
./aos show eval --id surface-zoom-inspector-shell-smoke --js 'window.surfaceZoomInspector.snapshot()'
```

Verify from structured state that the smoke launched, `inspectPoint` works, and
the shell reports the expected label-density/surface status. Do not use Operator
visual confirmation as the oracle.

## Hard Boundaries

- Do not resume the Employer Brand Operator alignment pass.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report
  rendering/export, or workflow execution.
- Do not implement global pointer capture.
- Do not harvest arbitrary app AX trees.
- Do not import or call `/Users/Michael/Code/pi-computer-use`.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics,
  or data bundles.
- Do not turn this into the full Surface Annotation Intent Convergence product.

## Verification

Run focused verification appropriate to touched files, including:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/toolkit/workbench-shell.test.mjs`
- `node --test tests/toolkit/style-contracts.test.mjs`
- relevant schema tests if touched,
- bounded AOS smoke if ready,
- `git diff --check`.

## Completion Report

Report:

- files changed,
- which toolkit shell/chrome/control primitives are now used,
- how the canvas is draggable/resizable or why the selected primitive only
  supports part of that,
- what changed to make the mini-map decipherable,
- how label overlap is prevented,
- structured API compatibility evidence,
- tests and AOS smoke run,
- remaining gaps before Operator can use Surface-Zoom on Employer Brand,
- confirmation that no Employer Brand capture/crawl/locator/report/export work
  was performed.
