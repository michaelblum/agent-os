# GDI: Visual Object Phase 5 Non-Avatar Validation V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 4 contract base:
  `9055ae3275528428ce4f9139acacdfd61df371b2`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Execute the first broad Phase 5 proof-of-generality slice for the extracted
visual object descriptor contract.

The target is to prove the Phase 4 contract is not avatar-specific by applying
it to non-avatar visual surfaces already present in the repo. Use the radial menu
workbench subject as the main validation target, and include at least one
toolkit/DOM control proof if the existing toolkit control metadata gives a clean
path. Keep this deterministic and reviewable: contract descriptors, state paths,
routes, projection-only classification, JSON serialization, and tests matter
more than live UI ceremony.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-sigil-avatar-phase4-visual-contract-extraction-v0.md`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
- `apps/sigil/renderer/radial-menu/sigil-radial-menu.json`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- `tests/toolkit/runtime-radial-menu-config.test.mjs`
- For the DOM/toolkit proof, inspect the smallest existing candidate before
  choosing: `packages/toolkit/controls/slider.js`,
  `packages/toolkit/controls/button.js`, `packages/toolkit/controls/toggle.js`,
  `tests/toolkit/controls-slider-color.test.mjs`,
  `tests/toolkit/controls-button.test.mjs`, and
  `tests/toolkit/controls-toggle.test.mjs`.

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID|createVisualObjectDescriptor|validateVisualObjectDescriptors|visual_object_descriptors|radial_menu|canvas_object\\.(transform|effects|visibility)\\.patch|state_path|projection_only" packages/toolkit apps/sigil tests docs/design docs/dev/reports/aos-visual-object-architecture.md
```

## Required Behavior

Cover this Phase 5 surface as one coherent validation slice:

1. Radial menu descriptors
   - Project representative radial menu workbench state into
     `visual_object_descriptors` using the Phase 4 contract id
     `aos.visual_object.descriptor.v0`.
   - Include editable descriptors for meaningful non-avatar radial menu state,
     such as menu/item config, selected item, target surface, object transform,
     visibility, effect/animation controls, or other existing radial menu
     controls that already have clear state paths and routes.
   - Keep renderer-specific details out of the shared contract. The descriptor
     should describe state, route, sync expectation, technology, object ids, and
     evidence contracts without importing Three.js or Sigil renderer modules into
     toolkit workbench helpers.

2. Projection-only classification
   - Preserve the distinction between canonical/editable visual state and
     projection-only shortcuts/resources/actions.
   - If the radial menu subject exposes resources or app actions that should not
     mutate canonical visual state, mark them explicitly with
     `projection_only: true` and a concrete reason.

3. DOM/toolkit proof
   - Add a small deterministic proof that at least one toolkit/DOM control can
     be described with the same contract. Prefer a helper, fixture, or test that
     reuses `createVisualObjectDescriptor()` over a broad controls rewrite.
   - Choose a real existing control surface if clean; otherwise add a focused
     contract fixture that names the follow-up needed for live control
     integration.

4. Contract friction
   - If the radial menu or DOM proof exposes a real gap in
     `visual-object-contract.js`, refine the contract narrowly and update the
     docs/tests. Favor evergreen strictness for in-repo contracts when the repo
     can update all callers in the same slice.
   - Do not add compatibility aliases for old field names unless a live consumer
     requires them; if one is needed, document the removal gate.

5. Evidence
   - Tests must prove the non-avatar descriptors validate, serialize through
     `JSON.stringify`/`JSON.parse`, retain explicit technology identity, and
     include non-avatar evidence contracts.
   - Tests must also prove the radial menu subject remains independent of Sigil
     modules, Three.js imports, DOM globals, and Zag imports unless an existing
     test already covers that and remains in place.

## Scope

Shared toolkit workbench/runtime helpers, radial menu subject/model projection,
contract docs/helpers, and focused deterministic tests.

This is not an avatar renderer pass. Do not return to Sigil avatar
implementation except for imports or tests that must continue passing because
the shared contract changed.

## Hard Boundaries

- Do not rewrite radial menu runtime rendering.
- Do not migrate all toolkit controls.
- Do not start live/browser-only work unless deterministic coverage is complete
  and `./aos ready --json` passes.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/radial-menu-subject.js`
- `packages/toolkit/runtime/radial-menu-config.js`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `tests/toolkit/visual-object-contract.test.mjs`
- `tests/toolkit/radial-menu-subject.test.mjs`
- a focused toolkit control test if adding a DOM-control fixture/helper.

Keep the result broad enough to prove generality, but avoid a platform package
rewrite in this pass.

## Verification

Run:

```bash
node --test tests/toolkit/visual-object-contract.test.mjs tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/runtime-radial-menu-config.test.mjs
node --test tests/renderer/sigil-avatar-editor-model.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

Live AOS verification is optional for this deterministic contract validation
slice. If runtime descriptor routing changes and `./aos ready --json` passes,
run a bounded smoke proving representative non-avatar descriptor edits serialize
and route as expected. If `./aos ready` reports a repo-mode TCC/input-tap
blocker, stop live-dependent work and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

after the human returns with `finished`.

## Commit And Push

Use path-scoped `git add`. Make one or more scoped commits as needed, but keep
the final diff reviewable:

```bash
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- radial menu descriptor summary and descriptor count;
- DOM/toolkit proof summary;
- JSON serialization result for non-avatar descriptors;
- any contract refinements and why they were needed;
- explicit boundaries left in place;
- live AOS result if runtime routing changed, otherwise state that live was not
  needed;
- any local-only state left untouched;
- recommended next broad slice.
