# GDI: Visual Object Phase 6 Resource Lifecycle Contract V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted Phase 6 stellation resource base:
  `03fafd3984af38529700d033f31089abf3eb10b8`
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

Extract the general visual-object resource/update lifecycle contract from the
accepted avatar stellation and tesseron resource proofs.

Do not run another avatar-only optimization pass. The branch now has two
defensible avatar resource slices. This slice should make the reusable contract
explicit and validate it across the existing descriptor-driven surfaces:
avatar/Three.js, radial/non-avatar 3D, toolkit DOM slider, and 2D/DesktopWorld
or canvas-style updates.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- Recent Phase 6 work cards:
  - `docs/design/work-cards/gdi-visual-object-phase6-gpu-resource-live-proof-v0.md`
  - `docs/design/work-cards/gdi-visual-object-phase6-stellation-gpu-resource-pass-v0.md`
- Existing reusable contract files:
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`
  - `packages/toolkit/workbench/index.js`
- Existing proof/adoption files:
  - `apps/sigil/renderer/geometry.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `apps/sigil/radial-item-editor/model.js`
  - `apps/sigil/radial-item-workbench/index.js`
  - `packages/toolkit/workbench/radial-menu-subject.js`
  - `tests/renderer/stellation-no-rebuild.test.mjs`
  - `tests/renderer/radial-item-editor.test.mjs`
  - `tests/toolkit/visual-object-form-binding.test.mjs`
  - `tests/toolkit/desktop-world-surface-2d.test.mjs`
  - `tests/toolkit/controls-slider-color.test.mjs`
  - `tests/toolkit/visual-object-contract.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "visual_object_descriptors|applyVisualObjectControllerUpdate|bindVisualObjectForm|primaryStellation|primaryTesseronProportion|stellationResourceSmoke|resource lifecycle|retained|replacement|temporary|dispose|JSON.stringify\\(state.avatar\\)|root element|same 2D target" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad contract-extraction and validation slice.

1. Lifecycle vocabulary and evidence contract
   - Define the reusable lifecycle terms the repo now relies on:
     `structural_rebuild`, `minimal_update`, `retained_resource`,
     `replacement_resource`, `temporary_resource`, `disposed_resource`,
     `renderer_sync`, `identity_stable`, and `json_serializable_state`.
   - Document the expected evidence shape for a descriptor-driven update:
     state path, descriptor id, route, renderer sync label, edit count,
     rebuild delta, retained identity/resource bounds, replacement count,
     temporary create/dispose count, finite/valid data check where applicable,
     JSON serialization result, and live cleanup result when a live surface is
     involved.
   - Put this in `docs/design/visual-object-descriptor-contract-v0.md` and
     update the architecture report only where the implementation status changes.

2. Reusable primitive or helper
   - Inspect existing toolkit/workbench patterns and decide whether this belongs
     as a small exported helper, a test utility, or a documented contract only.
   - Prefer a small renderer-agnostic toolkit helper if it removes real
     duplication from tests or live proof code. A likely shape is a
     `packages/toolkit/workbench/visual-object-resource-lifecycle.js` helper
     exported from `packages/toolkit/workbench/index.js`, but use the local
     pattern that fits after reading the code.
   - Keep any helper free of Three.js, DOM, and Sigil imports. It may operate on
     labeled resource references, identity snapshots, counters, and JSON
     serializability checks.
   - Do not force production renderer code through the helper unless that
     reduces complexity. It is acceptable for this slice to extract proof
     helpers used by tests plus durable docs if runtime adoption would be
     premature.

3. Cross-surface validation
   - Avatar / Three.js: prove the existing primary stellation and primary
     tesseron resource evidence can be expressed through the lifecycle contract
     without weakening the 100-edit checks.
   - Radial / non-avatar 3D: prove a descriptor-routed radial item update reports
     route/sync and stable relevant state or registry identity under the same
     evidence vocabulary.
   - DOM toolkit: prove the slider descriptor/form path preserves root identity
     and serializable state under the same lifecycle vocabulary.
   - 2D/DesktopWorld or canvas-style: prove the existing same-node transform
     update maps to the same lifecycle vocabulary.
   - Keep projection-only descriptors explicitly outside mutation/update
     lifecycle claims.

4. Live AOS proof
   - If `./aos ready --json` passes, run one bounded live proof that emits or can
     be summarized in the new lifecycle evidence shape.
   - Prefer using the existing avatar stellation smoke hook or radial descriptor
     smoke rather than adding another app-specific live harness.
   - Remove any temporary canvas and verify cleanup.

5. Remaining gaps
   - Make clear that the contract is now reusable, but GPU morph-target/uniform
     stellation, broader material/geometry pooling, full observe-mode snapshot
     integration, and broad live proof across every surface remain separate
     implementation work.
   - Name the next broad follow-up only if the extraction reveals a concrete
     platform gap. Avoid routing another avatar-only optimization by default.

## Scope

Primary scope is a reusable resource/update lifecycle contract plus deterministic
proof adoption across existing surfaces. Implementation may touch toolkit
workbench helpers, focused tests, and docs. App/runtime code should only change
where needed to expose or align the evidence contract.

## Hard Boundaries

- Do not perform another avatar-only renderer optimization in this slice.
- Do not migrate every visual surface or every descriptor.
- Do not introduce Three.js or Sigil dependencies into toolkit helpers.
- Do not add old avatar state compatibility aliases.
- Do not fix unrelated broad-suite failures in
  `tests/toolkit/runtime-radial-gesture.test.mjs` or
  `tests/toolkit/spatial-governance.test.mjs` unless your own edits touch those
  files.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- If live AOS readiness reports a TCC/input-tap blocker, stop live-dependent
  work and use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

after the human returns with `finished`.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
git diff --check
./aos dev recommend --json
```

Run any additional focused tests required by files you touched. If you add a
new helper file, add direct toolkit tests for that helper.

If `./aos ready --json` passes, run one bounded live proof using the new
evidence vocabulary and remove any temporary canvas.

The broad `node --test tests/toolkit/*.test.mjs` command is currently known to
fail in untouched `tests/toolkit/runtime-radial-gesture.test.mjs` and
`tests/toolkit/spatial-governance.test.mjs` on this branch. Do not report this
as a new failure unless the failure set changes.

## Commit And Push

Use path-scoped `git add`. Make one scoped commit if code/docs/tests changed,
then push:

```bash
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD and base SHA;
- files changed;
- whether the slice added a helper, docs-only contract, or both, and why;
- cross-surface lifecycle evidence summary;
- exact tests run and results;
- live AOS proof and cleanup result, or explicit readiness blocker handling;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
