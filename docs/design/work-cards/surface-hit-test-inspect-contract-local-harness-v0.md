# Surface Hit-Test Inspect Contract + Local Harness V0

## Context

Annotation Perception Verification V0 proved that Implementer can create annotation
intent from structured targets, project/render it, re-perceive the surface
through structured state, and assert identity/bounds/decorator/layer matches
without Operator visual confirmation or screenshot pixel checks.

The missing step is the inspect operation that chooses the target in the first
place:

```text
pointer/surface-local point
  -> surface adapter hit-test
  -> deepest target candidate(s)
  -> selected target
  -> annotation draft
  -> existing annotation perception verification loop
```

This slice should define and test that contract locally. It should not implement
global pointer capture or a full annotation mode.

## Goal

Build Surface Hit-Test Inspect Contract + Local Harness V0.

The harness should prove that AOS can take a pointer-like coordinate inside a
known surface, resolve a structured target candidate through the correct surface
adapter or fixture adapter, convert it into an annotation draft, and feed that
target into the existing annotation perception verification model.

Use structured state only. Do not use screenshot pixel inspection as the oracle.

## Inputs

Inspect at minimum:

- `shared/schemas/spatial-subject-tree-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/annotation-perception-verification-v0.schema.json`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/annotation-perception-verification.js`
- `packages/toolkit/components/surface-zoom-inspector/model.js`
- `docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json`
- `docs/design/fixtures/annotation-perception-verification-v0/representative-surfaces.report.json`
- `tests/toolkit/annotation-perception-verification.test.mjs`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- `shared/schemas/aos-semantic-targets.md`
- `shared/schemas/spatial-topology.md`
- `docs/api/toolkit.md`
- Pi reference notes only for future AX adapter design:
  - `/Users/Michael/Code/pi-computer-use/AOS_AGENT_OS_NOTES.md`
  - `/Users/Michael/Code/pi-computer-use/README.md`
  - `/Users/Michael/Code/pi-computer-use/src/bridge.ts`
  - `/Users/Michael/Code/pi-computer-use/native/macos/bridge.swift`

Do not import or call `pi-computer-use`.

## Deliverables

Add a neutral hit-test/inspect contract:

- Schema/docs, for example:
  - `shared/schemas/surface-hit-test-inspect-v0.schema.json`
  - `shared/schemas/surface-hit-test-inspect-v0.md`
- Toolkit helper(s), likely under `packages/toolkit/workbench/`, that can:
  - normalize an inspect request,
  - normalize adapter hit-test responses,
  - choose deepest/most-specific target candidates,
  - preserve candidate path, depth, bounds, label, role, source ids, adapter
    metadata, confidence, and blockers,
  - convert selected hit-test candidates to structured annotation drafts,
  - build a local harness report,
  - optionally emit compatible input for
    `annotation-perception-verification.js`.
- A CLI or script, for example:
  - `scripts/surface-hit-test-inspect.mjs`
- Fixtures under:
  - `docs/design/fixtures/surface-hit-test-inspect-v0/`
- Focused tests under `tests/toolkit/` and `tests/schemas/`.
- Docs in `docs/api/toolkit.md` explaining how inspect results sit between
  Spatial Subject Tree and Annotation Perception Verification.

## Contract Shape

The inspect result should model:

- `schema`, `version`, `created_at`
- `request`
  - `surface_binding`
  - pointer point in a declared coordinate space
  - optional active surface path or selected surface id
  - requested adapter type
  - allowed target kinds
- `surface`
  - selected surface path/id/type
  - source ids
  - viewport/bounds context
- `candidates[]`
  - target id/path/kind/label
  - depth and ancestor chain
  - role/text/source metadata
  - bounds in available coordinate spaces
  - hit-test status: `hit`, `miss`, `blocked`, `unsupported`, `ambiguous`
  - adapter confidence and child-discovery state
  - capabilities
  - blockers/reasons
- `selected_candidate`
  - deterministic selected candidate or `null`
- `annotation_draft`
  - structured annotation intent derived from selected candidate, or `null`
- `verification_seed`
  - optional shape that can feed Annotation Perception Verification V0
- `summary`

The harness should prefer the deepest target whose bounds contain the pointer.
If multiple candidates tie, choose by adapter confidence, then smaller area,
then stable path order. Preserve ambiguity in the report even when a stable
selection is made.

## Required Surface Matrix

Implement local structured hit-test cases for representative surface classes.
These do not all need live adapters yet; fixture-backed adapter responses are
acceptable where the missing live adapter is explicit.

### 1. AOS Canvas / Semantic Target

Required passing class.

Use Spatial Subject Tree fixture data or a deterministic local AOS canvas state
with semantic targets. Given a surface-local point inside Primary CTA, hit-test
should select the semantic target and create an `element_selection` annotation
draft.

The resulting verification seed should be compatible with the existing
annotation perception verification helper.

### 2. Markdown Workbench / Text Range

Required passing class.

Use a local Markdown Workbench-style fixture. Given a point or line coordinate
inside a known line/text range, hit-test should select the `text_range` target
and create a `selection_comment` annotation draft.

Use structured source/line/rect data, not pixel inspection.

### 3. Browser Page / Local HTML

Required local structured class if existing tooling supports it; otherwise
adapter fixture only with explicit blocker.

Use a controlled local HTML fixture only. Given a viewport-local point inside a
DOM element, hit-test should select a `dom_element` candidate with selector/text
metadata and create an `element_selection` annotation draft.

Do not browse arbitrary external pages.

### 4. Mac Window / Spatial Topology

Required passing class for top-level window/canvas surface.

Given a DesktopWorld point inside a deterministic AOS-owned canvas/window rect,
hit-test should select the window/canvas surface node and create a
`region_comment` or `element_selection` annotation draft.

Do not harvest generic app AX trees.

### 5. Generic AX Element

Fixture-backed class unless AOS already has a deterministic AX adapter.

Use Pi-inspired AX metadata as fixture shape only:

- role/subrole,
- title/description/value,
- actions,
- frame/center,
- score/confidence,
- capabilities,
- source app/window metadata,
- parent path/depth where available.

Hit-test should resolve a fixture point to an `ax_element` candidate and create
an `element_selection` draft. Mark live adapter status as fixture-only if no
AOS AX adapter exists.

### 6. Mermaid/SVG, 3D, PDF/Image

Fixture-backed classes unless live adapters already exist.

Add minimal hit-test fixture cases for:

- `svg_node`,
- `three_object`,
- `pdf_page` or `image_region`.

The point should select the expected target candidate, create the expected
annotation draft kind, and report missing live adapter blockers where
appropriate.

## Local Harness Behavior

The CLI should support at least:

```bash
node scripts/surface-hit-test-inspect.mjs --stdout
node scripts/surface-hit-test-inspect.mjs --default-output
```

The default output should write a deterministic fixture report under
`docs/design/fixtures/surface-hit-test-inspect-v0/`.

If practical, add an option to emit an Annotation Perception Verification seed
or report for the selected candidates. Keep this deterministic and local.

## Hard Boundaries

- Do not implement global pointer hover/click capture.
- Do not ask Operator to visually confirm target selection.
- Do not use screenshot pixel comparison as the pass/fail oracle.
- Do not browse arbitrary live websites.
- Do not harvest arbitrary user app AX trees.
- Do not implement full browser, AX, Mermaid/SVG, 3D, PDF/image adapters unless
  a minimal deterministic fixture adapter already exists.
- Do not modify Employer Brand capture artifacts or capture state.
- Do not run live capture/locator/report/export/workflow execution.
- Do not import or call `/Users/Michael/Code/pi-computer-use`.

## Verification

Run focused verification appropriate to touched files, including:

- hit-test inspect helper tests,
- schema tests for the new report/contract,
- existing annotation perception verification tests,
- existing spatial subject tree tests,
- surface-zoom inspector tests if draft mapping reuses its helpers,
- `node --test tests/schemas/*.test.mjs`,
- `git diff --check`.

If using AOS runtime, keep it local to deterministic AOS fixture canvases and
structured state. Do not use screenshots as the oracle.

## Completion Report

Report:

- files added/changed,
- inspect request/result schema shape,
- selection algorithm for deepest/most-specific candidates,
- surface classes covered as passing vs fixture-only,
- how selected candidates convert into annotation drafts,
- whether verification seeds integrate with Annotation Perception Verification,
- tests/smokes run,
- confirmation that no Operator visual confirmation, arbitrary live web, generic
  AX harvesting, Employer Brand capture, report/export, or workflow execution
  was performed.
