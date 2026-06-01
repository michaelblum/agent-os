# GDI: Visual Object Phase 6 Observe Snapshot Boundary And Live Proof V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted Phase 6 resource pooling boundary:
  `94b483ca5e0d724e8f5a2258a51fc901af540b2d`
- Related separate snapshot continuity track:
  `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`
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

Make the remaining Phase 6 gap concrete without turning the visual-object
contract into a second snapshot system.

Use the current lifecycle contract and representative live surfaces to prove
the boundary between:

- visual-object descriptor/update evidence, and
- existing observe-mode / snapshot-style session artifacts.

This slice should document the boundary clearly and run one bounded live proof
that shows the current live surfaces and snapshot-style evidence remain
compatible, but it must not implement a new persistent snapshot database or
revive broad annotation authoring work.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-resource-pooling-broad-proof-v0.md`
- `docs/design/work-cards/display-first-annotation-snapshot-continuity-v0.md`
- Existing reusable contract files:
  - `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`
  - `packages/toolkit/workbench/index.js`
- Existing observe/snapshot boundary files:
  - `packages/toolkit/workbench/annotation-session.js`
  - `packages/toolkit/workbench/annotation-overlay-renderer.js`
  - `packages/toolkit/workbench/surface-inspector-annotations.js`
  - `packages/toolkit/components/surface-inspector/index.js`
  - `apps/sigil/renderer/live-modules/annotation-reticle.js`
  - `apps/sigil/renderer/live-modules/main.js`
- Existing proof/adoption files:
  - `apps/sigil/renderer/geometry.js`
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
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "observe-mode|snapshot|annotation-session|annotation-overlay-renderer|surface-inspector-annotations|visual_object.resource_lifecycle|snapshot_count|selectionMode|canvas_inspector.capture_bundle|sigil_radial_camera" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad boundary-and-proof slice.

1. Boundary definition
   - Inspect the current observe/snapshot helpers and decide where the visual-
     object lifecycle contract stops and the observe-mode snapshot contract
     starts.
   - Document that boundary in `docs/design/visual-object-descriptor-contract-v0.md`
     and/or `docs/dev/reports/aos-visual-object-architecture.md` only where the
     implementation status changes.
   - Do not introduce a second snapshot model or a persistent annotation store.

2. Boundary validation
   - Use the current lifecycle helper where it is useful, but do not force
     observe-mode artifacts into the visual-object contract if they are better
     represented as a separate session/snapshot contract.
   - Make the shared and separate responsibilities explicit:
     descriptor/update evidence versus snapshot/session evidence.

3. Cross-surface live proof
   - If `./aos ready --json` passes, run one bounded live proof that exercises
     the existing visual-object live path and, where cleanly available, the
     current observe/snapshot boundary path.
   - Prefer an existing live surface or debug hook rather than adding a new
     harness.
   - Remove any temporary canvas and verify cleanup.

4. Regression guard
   - Keep the existing avatar, radial, DOM slider, and DesktopWorld/canvas
     lifecycle proofs passing.
   - Keep projection-only descriptors outside mutation/update claims.

5. Remaining gaps
   - Make clear that full observe-mode snapshot integration remains a separate
     surface contract, and that broader live proof across every possible visual
     surface remains future work.
   - Do not reopen unrelated broad-suite failures in
     `tests/toolkit/runtime-radial-gesture.test.mjs` or
     `tests/toolkit/spatial-governance.test.mjs` unless your own edits touch
     those files.

## Scope

Primary scope is boundary clarification between the visual-object lifecycle
contract and existing observe/snapshot semantics, plus a bounded live proof
that demonstrates the two can coexist without broad new infrastructure.

Implementation may touch docs, focused tests, and any narrow live hook needed to
exercise the boundary. Avoid broad annotation-system changes.

## Hard Boundaries

- Do not build a new persistent snapshot database.
- Do not revive broad annotation authoring UI or introduce a new snapshot
  schema here.
- Do not perform another avatar-only optimization.
- Do not migrate every visual surface or every descriptor.
- Do not introduce Three.js or Sigil dependencies into toolkit helpers.
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
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
git diff --check
./aos dev recommend --json
```

If `./aos ready --json` passes, run one bounded live proof that makes the
boundary visible and remove any temporary canvas.

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
- whether the slice clarified the boundary, added proof, or both, and why;
- cross-surface lifecycle and snapshot-boundary evidence summary;
- exact tests run and results;
- live AOS proof and cleanup result, or explicit readiness blocker handling;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
