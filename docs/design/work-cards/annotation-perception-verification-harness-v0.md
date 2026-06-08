# Annotation Perception Verification Harness V0

## Context

The annotation system has moved through these layers:

- structured annotation intent records,
- Markdown Workbench visible badges,
- annotation projection results,
- Spatial Subject Tree,
- Surface-Zoom Annotation Inspector proof.

The next bar is higher: Implementer should be able to create an annotation, project it,
re-perceive the surface through structured AOS/surface-adapter data, and prove
that the annotation is anchored to the intended thing without asking Operator to
visually confirm the canvas and without doing pixel inspection.

The verification loop should be:

```text
choose target from structured perception
  -> create annotation intent
  -> project/render annotation
  -> re-perceive surface through structured state
  -> assert identity and geometry match
```

This is the deterministic foundation for future annotation tools that work
across AOS canvases, Markdown/workbench surfaces, browser pages, generic Mac
windows, Mermaid/SVG, 3D scenes, PDFs/images, and other surface classes.

## Goal

Build Annotation Perception Verification Harness V0.

The harness should prove that annotation intent, projection, and perception can
round-trip through representative surface classes using structured data only:

- no manual Operator visual confirmation,
- no screenshot pixel checks as the assertion mechanism,
- no arbitrary live websites,
- no arbitrary user-app harvesting,
- no Employer Brand capture changes.

## Inputs

Inspect at minimum:

- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation-projection-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/surface-zoom-inspector/model.js`
- `packages/toolkit/components/surface-zoom-inspector/launch.sh`
- `shared/schemas/aos-semantic-targets.md`
- `shared/schemas/spatial-topology.md`
- browser evidence/local fixture utilities if useful:
  - `scripts/browser-evidence-capture.mjs`
  - `packages/toolkit/workbench/browser-evidence-capture.js`
  - `tests/toolkit/browser-evidence-capture.test.mjs`
- Pi reference notes only for AX/Mac-window adapter principles:
  - `/Users/Michael/Code/pi-computer-use/AOS_AGENT_OS_NOTES.md`
  - `/Users/Michael/Code/pi-computer-use/README.md`
  - `/Users/Michael/Code/pi-computer-use/src/bridge.ts`
  - `/Users/Michael/Code/pi-computer-use/native/macos/bridge.swift`

Do not import or call `pi-computer-use`.

## Deliverables

Add a neutral verification contract and harness:

- Schema/docs for a verification report, for example:
  - `shared/schemas/annotation-perception-verification-v0.schema.json`
  - `shared/schemas/annotation-perception-verification-v0.md`
- Toolkit helper(s), likely under `packages/toolkit/workbench/`, that can:
  - build verification cases from structured perception targets,
  - create annotation intent from the selected target,
  - normalize projection output,
  - normalize re-perception output,
  - compare target identity/path,
  - compare projected and perceived bounds by overlap threshold,
  - verify annotation decorator/discoverability state where available,
  - classify each case as `passed`, `failed`, `blocked`, or
    `adapter_fixture_only`.
- A CLI or script, for example:
  - `scripts/annotation-perception-verify.mjs`
- Fixture verification reports under:
  - `docs/design/fixtures/annotation-perception-verification-v0/`
- Focused tests for helper behavior and representative surface classes.
- Docs in `docs/api/toolkit.md` explaining the round-trip verification loop.

## Required Verification Model

Each verification case should record:

- `case_id`
- `surface_class`
- `surface_binding`
- `perception_source`
- `target`
  - target path or id,
  - kind,
  - label,
  - source ids,
  - perceived bounds,
  - role/capabilities where available
- `annotation`
  - structured annotation intent produced from the target
- `projection`
  - annotation projection result or component state projection
- `reperception`
  - structured state after annotation projection/rendering
- `assertions`
  - target identity/path match,
  - bounds overlap ratio,
  - ordinal/decorator discoverability,
  - hide/show or layer-state behavior where available,
  - content mutation guard where applicable
- `status`
- `blockers` / `notes`

Bounds matching should be explicit. A useful default is intersection-over-union
or area-overlap ratio with a conservative threshold, for example `>= 0.75`,
unless a surface class needs stricter exact matching.

## Required Surface Matrix

Implement real structured verification for every class that AOS can already
perceive deterministically. For classes that do not yet have live adapters, add
fixture-backed adapter cases so the harness shape is exercised and the missing
live adapter is explicit.

### 1. AOS Canvas / Semantic Targets

Required passing class.

Use a deterministic AOS canvas, preferably the Surface-Zoom Inspector proof or
another local toolkit fixture surface. Pick a target from structured state or
`semantic_targets`, create an annotation, project/render it, then re-perceive
through structured state and/or `aos see capture --canvas ... --xray`.

Assertions:

- annotation target path/id matches the selected semantic target,
- projected/decorator bounds overlap the perceived target bounds,
- ordinal/decorator is discoverable through state or semantic/xray output,
- hide/show changes annotation layer state without mutating target content.

### 2. Markdown Workbench / Text Range

Required passing class.

Use a local Markdown Workbench fixture. Create a `selection_comment` or
line/text-range annotation. Verify via
`window.__markdownWorkbenchState.annotation_projection`, source/preview state,
and checkpoint/resume state as needed.

Assertions:

- annotation text range/source path matches the selected Markdown target,
- projection rect corresponds to the perceived line/text target,
- decorator moves with scroll or projection state updates after scroll,
- hide/show toggles layer state,
- Markdown content is not mutated by annotation rendering.

### 3. Browser Page / Local HTML

Required if existing repo tooling can support it without external websites.
Use a controlled local HTML page only.

The perception source may be a small supervised local browser/DOM adapter,
Playwright DOM state, or existing browser evidence local fixture utilities, as
long as assertions use structured DOM/rect/selector data and not pixel
inspection.

Assertions:

- annotation selector/text/role target matches the DOM element selected,
- projected rect overlaps `getBoundingClientRect()` or equivalent structured
DOM bounds,
- ordinal/decorator is discoverable through DOM/state,
- no external URL collection or arbitrary browsing occurs.

If browser-page live fixture support is not feasible in this slice, add an
`adapter_fixture_only` case and report the exact missing AOS browser adapter
surface. Do not silently skip the class.

### 4. Mac Window / Spatial Topology

Required passing class for top-level windows.

Use a deterministic AOS-owned canvas/window or local fixture window from
`./aos see list` / spatial topology. Annotate the top-level window/canvas
surface as a `region_comment` or `element_selection` and verify against
structured topology/canvas frame data.

Assertions:

- annotation target path matches the selected window/canvas node,
- projected bounds overlap topology/canvas bounds,
- state includes the selected window/canvas identity,
- no generic app AX harvesting is performed.

### 5. Generic AX Element

Fixture-backed class in this slice unless AOS already has a deterministic AX
perception adapter available.

Add a case that maps Pi-inspired AX target metadata into a Spatial Subject Tree
`ax_element` node and annotation intent:

- role/subrole,
- title/description/value,
- actions,
- frame/center,
- capabilities,
- score/confidence,
- source app/window metadata,
- parent path/depth when available.

Mark this case `adapter_fixture_only` if no live AOS AX adapter exists yet.
This keeps the class in the harness without adding live AX harvesting.

### 6. SVG/Mermaid, 3D, PDF/Image

Fixture-backed classes in this slice unless adapters already exist.

Add small adapter fixture cases for these surface classes so the harness proves
the same target -> annotation -> projection -> perception comparison shape:

- `mermaid_svg` / `svg_node`,
- `three_scene` / `three_object`,
- `pdf_page` or `image_region`.

Mark these cases `adapter_fixture_only` when live adapters are not present.

## Hard Boundaries

- Do not ask Operator to visually confirm whether the annotation rendered.
- Do not use screenshot pixel comparison as the pass/fail assertion.
- Do not run arbitrary live websites.
- Do not harvest arbitrary user app AX trees.
- Do not implement full global pointer hover/click annotation mode.
- Do not implement full browser, AX, Mermaid/SVG, 3D, PDF/image adapters unless
  a minimal deterministic local fixture adapter is already straightforward.
- Do not modify Employer Brand capture artifacts or capture state.
- Do not run live capture/locator/report/export/workflow execution.
- Do not import or call `/Users/Michael/Code/pi-computer-use`.

## Verification

Run focused verification appropriate to touched files, including:

- annotation perception verification helper tests,
- surface class tests for AOS canvas, Markdown, browser/local HTML where
  implemented, Mac window/topology, and fixture-only adapter classes,
- existing annotation projection tests,
- existing spatial subject tree tests,
- relevant toolkit component tests,
- schema tests,
- `git diff --check`.

If using AOS runtime in tests or smoke scripts:

- run `./aos ready`,
- use `aos show eval`, component state, semantic targets, xray, and topology as
  structured perception sources,
- avoid pixel inspection as the verification oracle.

## Completion Report

Report:

- files added/changed,
- verification report schema shape,
- which surface classes are passing through real structured perception,
- which surface classes are fixture-only and why,
- the target identity and bounds matching strategy,
- tests/smokes run,
- confirmation that Operator/manual visual confirmation was not required,
- confirmation that no arbitrary live website, generic AX harvesting, Employer
  Brand capture, report/export, or workflow execution was performed.
