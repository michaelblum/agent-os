# Visual Object Profiler-Backed Leak Proof V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Closure baseline: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`
- Related historical proof card:
  `docs/design/work-cards/gdi-visual-object-phase6-runtime-duration-leak-proof-v0.md`
- Branch/base: start from `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Turn the accepted bounded lifecycle evidence into a concrete profiler-backed
leak proof for one representative visual-object path.

This is now a separate future track, not another open-ended Phase 6 expansion.
The deliverable is a bounded proof that answers whether the accepted
descriptor/update/resource shape remains stable over a meaningful runtime window
when observed with profiler-grade evidence rather than only deterministic and
bounded live counters.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-runtime-duration-leak-proof-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-observe-snapshot-boundary-live-proof-v0.md`
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
- `packages/toolkit/workbench/visual-object-contract.js`
- `packages/toolkit/workbench/visual-object-controller.js`
- `packages/toolkit/workbench/visual-object-form-binding.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/live-modules/main.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`
- `tests/renderer/tesseron.test.mjs`
- `tests/toolkit/visual-object-resource-lifecycle.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "visual_object.resource_lifecycle|proof_window|duration|profiler|memory|leak|temporary_resource|disposed_resource|retained_resource|identity_stable" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Existing Code To Inspect

- `packages/toolkit/workbench/visual-object-resource-lifecycle.js` - current
  accepted evidence vocabulary.
- `apps/sigil/renderer/live-modules/main.js` - current bounded live proof hooks.
- `apps/sigil/renderer/geometry.js` - primary retained-resource behavior on the
  avatar reference path.
- `tests/renderer/stellation-no-rebuild.test.mjs` and
  `tests/renderer/tesseron.test.mjs` - deterministic reference proofs.

## Required Behavior

### 1. Choose one representative proof path

- Pick one path where profiler-backed evidence is meaningful and reviewable.
- Prefer the avatar stellation/tesseron reference path unless code inspection
  shows a cleaner representative path with lower harness cost.
- State clearly why that path was chosen and what it does not prove.

### 2. Add profiler-backed evidence without inventing a new contract

- Keep `aos.visual_object.resource_lifecycle.v0` as the acceptance vocabulary.
- Add only the narrow extra evidence needed to tie a runtime window to
  profiler-grade memory/resource observations.
- Do not create a second parallel evidence schema if a small extension or
  optional metadata can express the result.

### 3. Keep the future-track boundary clear

- Do not turn this into broad pooling work, broad surface migration, or observe
  snapshot integration.
- Do not claim platform-wide leak safety from one representative proof.
- Update docs only where the future-track status or proof result actually
  changes.

### 4. Preserve accepted cross-surface behavior

- Keep existing deterministic avatar, radial, DOM slider, and DesktopWorld
-style proofs green.
- Keep projection-only descriptors outside canonical mutation/update claims.

### 5. Live blocker handling

- If `./aos ready --json` reports a repo-mode TCC/input-tap blocker, stop
  live-dependent work and run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
./aos ready --post-permission
```

after the human returns with `finished`.

## Scope

One bounded future-track proof for profiler-backed leak evidence on the accepted
visual-object architecture. Small test, doc, or harness edits are in scope.
Broad renderer rewrites are not.

## Hard Boundaries

- Do not reopen generic Phase 6 status work; closure is already accepted.
- Do not migrate every visual surface or every descriptor.
- Do not introduce broad toolkit pooling abstractions unless the proof forces a
  narrowly justified helper.
- Do not implement observe/snapshot product integration in this slice.
- Do not fix unrelated broad-suite failures in
  `tests/toolkit/runtime-radial-gesture.test.mjs` or
  `tests/toolkit/spatial-governance.test.mjs` unless your own edits touch those
  files.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/toolkit/controls-slider-color.test.mjs tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
git diff --check
./aos dev recommend --json
```

If `./aos ready --json` passes, run one bounded live proof with profiler-backed
or equivalent runtime evidence and report cleanup.

## Completion Report

Return:

- final HEAD and base SHA;
- files changed;
- chosen representative proof path and why;
- profiler-backed evidence summary;
- exact tests run and pass/fail counts;
- live proof result and cleanup, or explicit readiness blocker;
- docs changed or not changed, and why;
- remaining future gaps after this proof;
- any local-only state left untouched.
