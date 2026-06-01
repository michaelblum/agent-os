# GDI: Visual Object Phase 6 Runtime Duration Leak Proof V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted boundary proof:
  `89f50dd7b51108ce65c6771abfecde341bc7c3ad`
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

Turn the remaining Phase 6 durability gap into a concrete proof: extend the
visual-object lifecycle evidence from bounded deterministic edit loops to a
longer-duration leak/resource proof that still uses the shared lifecycle
vocabulary.

This slice should answer the question, "does the current resource/update shape
stay stable over a longer runtime window?" It should not re-litigate the
descriptor boundary, snapshot boundary, or avatar-only renderer micro-optimiza-
tions.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-resource-pooling-broad-proof-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-observe-snapshot-boundary-live-proof-v0.md`
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
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "resource lifecycle|pool|geometry|material|temporary|disposed|retained|json_serializable_state|identity_stable|visual_object.resource_lifecycle|stall|leak|duration|profile|profiler|snapshot_count|observe-mode" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad durability slice.

1. Longer-duration proof
   - Extend the existing lifecycle evidence from short bounded loops to a
     longer-duration edit/proof window.
   - Keep the same vocabulary: structural rebuild delta, retained resources,
     replacement and temporary create/dispose counts, identity stability, JSON
     serializability, and finite-data validation where applicable.
   - Prefer the existing avatar stellation/tesseron smoke hooks or radial
     descriptor smoke if they can be extended without inventing a new harness.

2. Broad surface regression
   - Keep the representative radial, DOM slider, and DesktopWorld/canvas-style
     proofs green with the new duration-focused evidence.
   - Keep projection-only descriptors outside mutation/update claims.
   - Do not regress the observe/snapshot boundary or the descriptor/controller
     boundary already accepted.

3. Live AOS proof
   - If `./aos ready --json` passes, run one bounded live proof that extends the
     current edit loop duration or repeats enough iterations to make leak
     stability meaningful.
   - Remove any temporary canvas and verify cleanup.
   - Summarize the proof with the shared lifecycle vocabulary rather than a new
     app-specific format.

4. Documentation
   - Update `docs/dev/reports/aos-visual-object-architecture.md` and/or
     `docs/design/visual-object-descriptor-contract-v0.md` only where Phase 6
     status changes.
   - Make clear that this is still not a claim of broad platform-wide resource
     pooling or full observe-mode snapshot integration.

5. Remaining gaps
   - Keep GPU morph-target or uniform-only stellation, broader material/
     geometry pooling beyond the chosen boundary, full observe-mode snapshot
     integration, and broader live proof across every possible visual surface
     explicitly marked as future work unless this slice truly closes one of
     them.
   - Do not reopen unrelated broad-suite failures in
     `tests/toolkit/runtime-radial-gesture.test.mjs` or
     `tests/toolkit/spatial-governance.test.mjs` unless your own edits touch
     those files.

## Scope

Primary scope is longer-duration resource stability proof using the existing
lifecycle contract. Implementation may touch focused tests, docs, and any narrow
live hooks needed to expose the proof. Avoid broad renderer rewrites.

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
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
git diff --check
./aos dev recommend --json
```

If `./aos ready --json` passes, run one bounded live proof with extended edit
duration or iteration count and remove any temporary canvas.

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
- whether the slice extended duration proof, changed docs, or both, and why;
- cross-surface lifecycle evidence summary;
- exact tests run and results;
- live AOS proof and cleanup result, or explicit readiness blocker handling;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
