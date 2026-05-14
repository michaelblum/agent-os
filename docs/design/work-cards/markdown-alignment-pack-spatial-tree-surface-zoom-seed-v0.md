# Markdown Alignment Pack Spatial Tree + Surface-Zoom Seed V0

## Context

The fixed annotation badge workflow worked technically but is not the right UX.
The corrected path is:

```text
visible surface
  -> Spatial Subject Tree
  -> Surface-Zoom Inspector
  -> local hit-test/inspect
  -> annotation draft / verification seed
  -> human alignment checkpoint
```

Surface-Zoom Inspector now supports local hit-test inspection from mini-map
points and exposes `last_inspect` in structured state. The remaining gap before
Operator can use it on Employer Brand alignment is that the alignment pack is a
Markdown document, while the Inspector currently launches over a fixture tree.

Build a deterministic Markdown-to-Spatial-Subject-Tree seed for the Employer
Brand Human Alignment Pack and verify it through the Surface-Zoom Inspector
hit-test path.

## Goal

Create Markdown Alignment Pack Spatial Tree + Surface-Zoom Seed V0.

The slice should produce a neutral, reusable way to model a Markdown document
as inspectable Spatial Subject Tree nodes and a checked-in seed fixture for:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`

The seed should include inspectable targets for the key human decision points
in the pack and should work with the existing Surface-Zoom Inspector local
hit-test path.

## Inputs

Inspect at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `packages/toolkit/components/surface-zoom-inspector/model.js`
- `packages/toolkit/components/surface-zoom-inspector/index.js`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/workbench/surface-hit-test-inspect.js`
- `shared/schemas/spatial-subject-tree-v0.schema.json`
- `shared/schemas/spatial-subject-tree-v0.md`
- `shared/schemas/surface-hit-test-inspect-v0.schema.json`
- `docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json`
- `docs/design/fixtures/surface-hit-test-inspect-v0/markdown-workbench.fixture.md`
- `tests/toolkit/spatial-subject-tree.test.mjs`
- `tests/toolkit/surface-zoom-inspector.test.mjs`
- `tests/toolkit/surface-hit-test-inspect.test.mjs`
- `docs/api/toolkit.md`

## Deliverables

Add a deterministic Markdown document Spatial Subject Tree builder, likely under
`packages/toolkit/workbench/`, with build/load/normalize/validate helpers. Keep
it neutral; it should not be Employer Brand-specific except for the fixture
input.

Add a CLI or script, for example:

- `scripts/markdown-spatial-subject-tree.mjs`

Add checked-in fixtures under a clear location, for example:

- `docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`
- optional report or launch metadata under
  `docs/design/fixtures/surface-zoom-inspector-v0/`

The Markdown-derived tree should model:

- DesktopWorld/display/window/canvas/surface scaffolding sufficient for the
  Surface-Zoom Inspector.
- The Markdown document as the selected surface.
- Structured child nodes for headings, decision prompts, decision table rows,
  Mermaid block, fallback evidence-flow table, and important text ranges.
- Stable node ids and paths derived from line numbers/slugs.
- Bounds in a declared deterministic document coordinate space. The bounds can
  be synthetic but must be stable, line-based, and explicit about not being a
  rendered-pixel oracle.
- Source identity pointing to the Markdown file.
- Text excerpts, labels, roles/kinds, line ranges, and source metadata.
- Capabilities such as `hit_test`, `annotate`, `inspect_children`, and
  `capture=false` where appropriate.
- Adapter metadata showing this is a deterministic Markdown fixture/builder,
  not a live browser, AX, or screenshot adapter.

Include at least these inspectable decision targets from the alignment pack:

- current assumptions / 0 accepted live captures,
- company and competitor set,
- desired evidence elements and 4 visibility-adjusted executable slots,
- what not to collect,
- KILOS interpretation table,
- LinkedIn/source-unavailable policy,
- report tone and direction,
- explicit human decision table.

## Surface-Zoom Verification

Extend or add tests so the generated Markdown tree can be consumed by
Surface-Zoom Inspector model helpers.

Required deterministic checks:

- generated tree validates against Spatial Subject Tree V0,
- selected surface mini-map includes the required decision targets,
- `inspectSelectedSurfacePoint(...)` can select at least:
  - company/competitor-set target,
  - live capture scope target,
  - LinkedIn policy target,
  - report direction target,
- each selected target creates a structured annotation draft,
- each selected target emits a Surface Hit-Test Inspect verification seed,
- APV helper accepts the emitted verification seeds,
- miss behavior remains deterministic and creates no draft,
- source path and line-range metadata are preserved.

If practical and `./aos ready` passes, run a bounded AOS smoke:

```bash
./aos ready
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

Use an explicit `tree=` URL or environment override if needed so the Inspector
loads the generated Employer Brand Markdown tree fixture. Then call
`window.surfaceZoomInspector.inspectPoint(...)` through `./aos show eval` for
one required decision target and verify from structured state only.

## Docs

Update `docs/api/toolkit.md` to describe the Markdown document Spatial Subject
Tree builder and how it lets Markdown Workbench subjects participate in the
Surface-Zoom / Hit-Test / APV loop.

If useful, add a short note to
`docs/design/surface-annotation-intent-convergence-tracker.md` that the
Employer Brand alignment pack is now the first Markdown consumer seed.

## Hard Boundaries

- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report
  rendering/export, or workflow execution.
- Do not use screenshot-pixel comparison as the oracle.
- Do not implement global pointer capture.
- Do not harvest arbitrary app AX trees.
- Do not import or call `/Users/Michael/Code/pi-computer-use`.
- Do not mutate Employer Brand capture manifests, repair patches, diagnostics,
  or data bundles.
- Do not turn this into the full Surface Annotation Intent Convergence product.

## Verification

Run focused verification appropriate to touched files, including:

- new Markdown spatial tree tests,
- `node --test tests/toolkit/spatial-subject-tree.test.mjs`
- `node --test tests/toolkit/surface-zoom-inspector.test.mjs`
- `node --test tests/toolkit/surface-hit-test-inspect.test.mjs`
- `node --test tests/toolkit/annotation-perception-verification.test.mjs`
- relevant schema tests, including Spatial Subject Tree and Surface Hit-Test
  Inspect,
- bounded AOS smoke if the local daemon is ready,
- `git diff --check`.

## Completion Report

Report:

- files added/changed,
- generated Markdown tree fixture path,
- decision targets represented and their line ranges,
- how synthetic document bounds are assigned,
- Surface-Zoom hit-test selections verified,
- APV seed verification result,
- tests and AOS smoke run,
- remaining gaps before Operator can use the Inspector on the alignment pack,
- confirmation that no Employer Brand capture/crawl/locator/report/export work
  was performed.
