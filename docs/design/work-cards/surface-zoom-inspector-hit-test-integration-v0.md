# Surface-Zoom Inspector Hit-Test Integration V0

## Context

Surface-Zoom Inspector proved the mini-map inspection model over fixture Spatial
Subject Tree data. Surface Hit-Test Inspect V0 then proved a neutral contract:

```text
surface-local point
  -> structured candidates
  -> deepest selected target
  -> annotation draft
  -> APV-compatible verification seed
```

The next step is to connect those two pieces. The Inspector should be able to
take a point inside its selected-surface mini-map, run the Surface Hit-Test
Inspect contract, show the candidate/selected-target result in structured
state, and create an annotation draft from the selected candidate.

This is deterministic GDI work. It should not depend on Operator visual
confirmation.

## Goal

Add Surface-Zoom Inspector support for local hit-test inspect results.

The implementation should let tests and a bounded AOS smoke call something like
`window.surfaceZoomInspector.inspectPoint({ x, y, coordinate_space })` against
the selected surface and receive/store:

- normalized inspect request,
- hit-test candidates,
- selected deepest/most-specific candidate,
- annotation draft,
- APV-compatible verification seed,
- blocker/fixture-only metadata where applicable.

## Inputs

Inspect at minimum:

- `packages/toolkit/components/surface-zoom-inspector/model.js`
- `packages/toolkit/components/surface-zoom-inspector/index.js`
- `packages/toolkit/components/surface-zoom-inspector/styles.css`
- `packages/toolkit/components/surface-zoom-inspector/launch.sh`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- `shared/schemas/surface-hit-test-inspect-v0.schema.json`
- `shared/schemas/surface-hit-test-inspect-v0.md`
- `docs/design/fixtures/surface-hit-test-inspect-v0/representative-surfaces.report.json`
- `docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json`
- `tests/toolkit/surface-hit-test-inspect.test.mjs`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- `tests/toolkit/annotation-perception-verification.test.mjs`
- `docs/api/toolkit.md`

## Deliverables

Update Surface-Zoom Inspector so it can consume or generate Surface Hit-Test
Inspect results for the selected surface.

Expected implementation shape:

- Model helper(s) in `surface-zoom-inspector/model.js` that:
  - build an inspect request from the current selected surface and a local
    point,
  - convert selected-surface child nodes into hit-test candidates,
  - call/reuse Surface Hit-Test Inspect selection and draft-building helpers
    where practical,
  - store the last inspect result in component state,
  - keep a draft created from hit-test distinct from older node-selection
    drafts, while preserving schema-compatible annotation intent records.
- Browser/component behavior in `surface-zoom-inspector/index.js` that:
  - exposes `window.surfaceZoomInspector.inspectPoint(...)`,
  - updates the selected node from the selected hit-test candidate,
  - renders a concise inspect result panel with point, candidates, selected
    target, ambiguity, blockers, and verification seed status,
  - optionally lets a local mini-map click trigger the same inspect operation.
- Styling for the inspect result panel if needed.
- Tests proving:
  - a point inside Primary CTA selects Primary CTA via hit-test, not merely a
    preselected node,
  - a point inside Evidence Card selects Evidence Card,
  - a miss preserves candidates and creates no selected candidate/draft,
  - tie/ambiguity metadata is preserved if existing helpers support it,
  - the resulting annotation draft validates against `annotation.schema.json`,
  - the verification seed passes through Annotation Perception Verification V0,
  - the inspector snapshot exposes `last_inspect` or equivalent structured
    state for GDI verification.
- Docs update in `docs/api/toolkit.md` explaining that the Inspector now bridges
  Spatial Subject Tree mini-map points into Surface Hit-Test Inspect results.

## Bounded AOS Smoke

If practical, run the fixture-only component smoke without Operator:

```bash
./aos ready
packages/toolkit/components/surface-zoom-inspector/launch.sh
./aos show eval --id surface-zoom-inspector --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 92, coordinate_space: "viewport" })'
./aos show eval --id surface-zoom-inspector --js 'window.surfaceZoomInspector.snapshot()'
```

Assert from structured state that the selected candidate is Primary CTA, an
annotation draft exists, and the verification seed is present. Do not use
screenshot pixels or Operator visual confirmation as the oracle.

## Hard Boundaries

- Do not implement global pointer hover/click capture.
- Do not inspect arbitrary live websites.
- Do not harvest arbitrary user-app AX trees.
- Do not use screenshot-pixel comparison as the pass/fail oracle.
- Do not import or call `/Users/Michael/Code/pi-computer-use`.
- Do not modify Employer Brand capture artifacts or capture state.
- Do not resume live capture, locator resolution, report rendering/export, or
  workflow execution.
- Do not turn this into the full Surface Annotation Intent Convergence product.

## Verification

Run focused verification appropriate to touched files, including:

- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- `node --test tests/schemas/surface-hit-test-inspect-v0.test.mjs`
- `node --test tests/schemas/*.test.mjs`
- bounded AOS smoke if the local daemon is ready,
- `git diff --check`.

## Completion Report

Report:

- files changed,
- how mini-map point inspect now works,
- how candidate selection and ambiguity/blocker preservation works,
- how hit-test annotation drafts differ from node-selection drafts, if they do,
- whether APV-compatible verification seeds are emitted,
- tests and AOS smoke run,
- remaining gaps before Operator can use this on Employer Brand alignment,
- confirmation that no Employer Brand capture/crawl/locator/report/export work
  was performed.
