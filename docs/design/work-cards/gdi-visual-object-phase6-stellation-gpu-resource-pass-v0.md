# GDI: Visual Object Phase 6 Stellation GPU Resource Pass V0

> **Historical status:** Superseded Phase 6 renderer-resource slice. The
> accepted closure now keeps positive-factor non-tesseron stellation on a
> renderer-local morph-target subset, factor-zero topology as a retained limit,
> and uniform-only stellation as future work.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted Phase 6 tesseron resource base:
  `fcd7f5ef6107aae3e2df2f151e31825ebca99cb3`
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

Continue Phase 6 as a broad renderer-resource implementation pass: address the
remaining stellation GPU/resource gap called out by the architecture report.

The branch already proves canonical `state.avatar.*`, descriptor/controller/form
adoption, non-avatar validation, no-full-rebuild primary stellation, and
in-place primary tesseron proportion updates. The next broad step is to reduce
or eliminate primary stellation replacement-geometry churn, and to make a
durable renderer decision about whether stellation should move to morph/uniform
updates now or to a bounded geometry/resource pool first.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-gpu-resource-live-proof-v0.md`
- Current renderer/test files:
  - `apps/sigil/renderer/geometry.js`
  - `apps/sigil/renderer/avatar-shape-composition.js`
  - `apps/sigil/renderer/tesseron.js`
  - `apps/sigil/renderer/state.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `apps/sigil/context-menu/descriptors.js`
  - `tests/renderer/stellation-no-rebuild.test.mjs`
  - `tests/renderer/tesseron.test.mjs`
- Cross-phase regression files:
  - `apps/sigil/avatar-editor/model.js`
  - `apps/sigil/avatar-editor/compact-surface.js`
  - `apps/sigil/radial-item-editor/model.js`
  - `apps/sigil/radial-item-workbench/index.js`
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "updatePrimaryStellation|createStellatedGeometry|primaryStellation|morph|uniform|EdgesGeometry|disposeUniqueGeometries|countUniqueGeometries|primaryTesseronProportion|updateOmegaGeometry|stellationFactor|rendererSync" apps/sigil tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad implementation slice. GDI should inspect and choose the
right renderer layer after rediscovery, but the completed slice must make a
meaningful Phase 6 advance on stellation resource behavior.

1. Resource model decision
   - Characterize current primary stellation churn after the accepted tesseron
     pass: retained geometries, temporary geometries created/disposed, mesh and
     material identities, and full rebuild deltas over repeated canonical
     `state.avatar.shape.stellationFactor` edits.
   - Decide whether the current shape topology supports a real GPU
     morph-target/uniform implementation in this slice.
   - If feasible, implement the GPU-friendly path for the supported primary
     shapes and keep unsupported shapes on a bounded fallback.
   - If a true GPU path is not yet safe, implement the best resource architecture
     step instead: reusable geometry buffers, a small keyed geometry/edge pool,
     or a shared helper that cuts replacement churn while preserving finite
     geometry and disposal correctness.
   - Document the decision in code comments or docs only where it prevents
     future ambiguity; do not add broad narrative comments.

2. Primary stellation behavior
   - `updatePrimaryStellation()` must remain the descriptor renderer-sync path
     for `avatar.shape.stellationFactor`.
   - Repeated stellation edits must not full-rebuild the primary avatar
     hierarchy.
   - Mesh and material identities should remain stable where minimal updates are
     expected.
   - Geometry/resource stats should prove a stricter bound than the previous
     replacement-only path, or clearly prove why the chosen fallback is already
     the safe bound for current topology.

3. Scope-aware shared behavior
   - If the implementation naturally shares code with omega stellation or future
     tesseron-derived layers, extract a small renderer-local helper.
   - Do not force omega or every shape parameter into this slice if that would
     make the pass unfocused. If omega remains on rebuild/update paths, record
     that as a future Phase 6 follow-up.

4. Deterministic resource evidence
   - Extend the existing 100-edit primary stellation proof rather than replacing
     it with a weaker check.
   - Evidence must include full rebuild delta, update count, created/disposed or
     pooled/reused resource counts, retained geometry/material bounds, finite
     geometry positions, stable identity assertions, and `JSON.stringify(state.avatar)`.
   - Keep the accepted 100-edit primary tesseron proportion proof passing.

5. Live AOS proof
   - If `./aos ready --json` passes, run a bounded live avatar smoke on a
     temporary canvas for the changed stellation path.
   - Report repeated-edit count, full rebuild delta, resource bounds, finite
     geometry, identity expectations, JSON serialization success, and cleanup.
   - Remove any temporary canvas and verify it no longer exists.

6. Documentation
   - Update `docs/dev/reports/aos-visual-object-architecture.md` and/or
     `docs/design/visual-object-descriptor-contract-v0.md` only to reflect real
     Phase 6 progress and remaining gaps.
   - Do not claim complete 60fps/GPU stellation unless the implementation and
     evidence genuinely support that claim.

## Scope

Primary scope is Sigil avatar renderer stellation resource behavior. Descriptor,
controller, and non-avatar workbench code should only change if a regression
proof exposes a real contract issue.

## Hard Boundaries

- Do not reopen Phase 5 descriptor architecture.
- Do not migrate every shape parameter or visual surface.
- Do not introduce stale compatibility aliases for old avatar state paths.
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
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
git diff --check
./aos dev recommend --json
```

Run any additional focused checks recommended by `./aos dev recommend --json`
or required by files you touched.

If `./aos ready --json` passes, run the bounded live avatar stellation resource
smoke and remove any temporary canvas. Do not substitute the radial workbench
smoke for this slice unless avatar live proof is blocked by a clear harness gap;
if that happens, state the gap and keep deterministic avatar proof strong.

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
- the stellation resource/GPU decision and implementation path;
- deterministic repeated-edit evidence with before/after resource counts;
- JSON serialization evidence;
- exact tests run and results;
- live AOS result and cleanup proof, or explicit readiness blocker handling;
- docs updated, if any;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
