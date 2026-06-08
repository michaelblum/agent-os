# Implementer: Visual Object Phase 6 Resource Pooling And Broad Proof V0

> **Historical status:** Superseded Phase 6 proof slice. Current guidance keeps
> material and geometry pooling renderer-local unless a future profiler-backed
> track proves shared pooling is needed. Use the accepted closure docs rather
> than treating this card as open Phase 6 scope.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted Phase 6 resource lifecycle contract:
  `13de8ab797b67b07def76095e0a3227164dae58f`
- Branch/output branch: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Take the remaining Phase 6 gap and make it concrete: decide where material and
geometry pooling belongs, then prove longer-lived resource stability with the
new lifecycle vocabulary across representative visual surfaces.

Do not do another avatar-only optimization pass. The reusable lifecycle
contract is already extracted. This slice should either:

1. extract a small pooling boundary/helper where it removes real duplication, or
2. document that pooling stays renderer-local for now and prove the boundary
   with focused tests plus one bounded live proof.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/implementer-visual-object-phase6-resource-lifecycle-contract-v0.md`
- Existing reusable contract files:
  - `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
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
  - `tests/toolkit/visual-object-resource-lifecycle.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "resource lifecycle|pool|geometry|material|temporary|disposed|retained|json_serializable_state|identity_stable|visual_object.resource_lifecycle|stellationResourceSmoke|radial item|DesktopWorld|controls-slider" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad contract-and-proof slice.

1. Pooling boundary decision
   - Inspect the current Sigil renderer/resource flow and decide whether
     material and geometry pooling belongs in Sigil renderer code, a shared
     toolkit helper, or a future package boundary.
   - If you extract a helper, keep it renderer-agnostic and free of Three.js,
     DOM, and Sigil imports unless the local code clearly proves that a narrow
     import is unavoidable.
   - If pooling should remain renderer-local for now, say so explicitly in the
     docs and prove the boundary with tests.

2. Broad lifecycle proof
   - Extend the reusable lifecycle vocabulary to longer-lived edit sessions and
     make clear which resource counts are retained, temporary, replacement, and
     disposed.
   - Use the existing evidence helper where it fits instead of inventing a new
     contract shape.
   - Keep projection-only descriptors outside mutation/update claims.

3. Cross-surface validation
   - Avatar / Three.js: keep the existing no-rebuild tesseron/stellation
     evidence intact, but use it only as the reference for the broader lifecycle
     proof.
   - Radial / non-avatar 3D: prove the lifecycle vocabulary still applies to a
     routed descriptor update and registry/selected-item identity.
   - DOM toolkit: prove the slider/form path still preserves root identity and
     serializable state under the same vocabulary.
   - 2D/DesktopWorld or canvas-style: prove the same-node transform/update path
     still maps to the lifecycle contract.

4. Live AOS proof
   - If `./aos ready --json` passes, run one bounded live proof that uses the
     lifecycle vocabulary and exercises the chosen pooling boundary or
     renderer-local decision.
   - Prefer the existing avatar stellation smoke hook or radial descriptor smoke
     if it can summarize the result cleanly without adding another app-specific
     harness.
   - Remove any temporary canvas and verify cleanup.

5. Remaining gaps
   - Make clear that GPU morph-target or uniform-only stellation, broader
     material/geometry pooling beyond the chosen boundary, full observe-mode
     snapshot integration, and broad live proof across every visual surface
     remain separate implementation work.
   - Do not reopen unrelated broad-suite failures in
     `tests/toolkit/runtime-radial-gesture.test.mjs` or
     `tests/toolkit/spatial-governance.test.mjs` unless your own edits touch
     those files.

## Scope

Primary scope is a reusable pooling boundary decision plus a broader lifecycle
proof that demonstrates the contract can describe the real resource behavior of
representative surfaces. Implementation may touch Sigil renderer code,
toolkit workbench helpers, focused tests, and docs. App/runtime code should only
change where needed to expose or align the evidence contract.

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
the manual TCC blocker report path
./aos ready --post-permission
```

after the human returns with `finished`.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
git diff --check
./aos dev recommend --json
```

Run any additional focused tests required by files you touched. If you add or
change a helper, add direct helper tests.

If `./aos ready --json` passes, run one bounded live proof using the chosen
pooling boundary or lifecycle evidence shape and remove any temporary canvas.

## Commit And Push

Use path-scoped `git add`. Make one scoped commit if code/docs/tests changed,
then push:

```bash
git push origin implementer/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD and base SHA;
- files changed;
- whether the slice extracted a helper, kept pooling renderer-local with docs,
  or did both, and why;
- cross-surface lifecycle evidence summary;
- exact tests run and results;
- live AOS proof and cleanup result, or explicit readiness blocker handling;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
