# GDI: Toolkit Radial And Spatial Stabilization V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted visual-object closure:
  `74bd63244ae7a136f8f1720071d524d807c1ee7f`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, live harness state, or prior implementation state. Read and
rediscover before editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Close the two known broad toolkit failures that the visual-object architecture
track had to keep excluding:

- `tests/toolkit/runtime-radial-gesture.test.mjs`
- `tests/toolkit/spatial-governance.test.mjs`

This is a separate stabilization track, not more visual-object architecture
work. Fix the underlying toolkit/runtime issues so the branch no longer needs a
standing caveat for these tests.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `tests/toolkit/runtime-radial-gesture.test.mjs`
- `tests/toolkit/spatial-governance.test.mjs`
- `packages/toolkit/runtime/radial-gesture.js`
- `packages/toolkit/runtime/spatial.js`
- `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
node --test tests/toolkit/runtime-radial-gesture.test.mjs tests/toolkit/spatial-governance.test.mjs
rg -n "createRadialGestureModel|handoffRadius|reentryRadius|fastTravel|triggerLocked|findDisplayForPoint|computeDisplayUnion|spatial governance" packages/toolkit apps/sigil tests/toolkit
```

## Current Failure Evidence

As of Foreman review after `74bd6324`, the combined command fails 6 tests:

- Five `runtime-radial-gesture.test.mjs` assertions:
  - trigger-vector placement unlocks/relocks incorrectly around origin;
  - dragging past handoff radius does not enter `fastTravel`;
  - fast-travel handoff/reentry hysteresis remains stuck in `radial`;
  - radial item pointer metrics after handoff report `radial` instead of
    `fastTravel`.
- One `spatial-governance.test.mjs` assertion:
  - `findDisplayForPoint` is defined in
    `apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js` even
    though the allowlist says the helper belongs in
    `packages/toolkit/runtime/spatial.js`.

## Required Behavior

1. Radial gesture stabilization
   - Fix `packages/toolkit/runtime/radial-gesture.js` behavior so the existing
     tests pass because the model is correct.
   - Preserve browser-coordinate angle semantics, trigger-vector egress lane
     behavior, item commit behavior, cancel behavior, and radial pointer
     metrics.
   - Do not loosen assertions just to make the suite green.

2. Spatial governance stabilization
   - Remove the duplicate `findDisplayForPoint` implementation from Sigil by
     using the canonical toolkit helper from `packages/toolkit/runtime/spatial.js`.
   - Keep Sigil lineage-bar behavior equivalent for display selection,
     acquisition pointer fallback, cursor fallback, and rect-center fallback.
   - Do not weaken the governance allowlist unless a real contract change is
     required; the expected direction is one canonical helper.

3. Visual-object closure guard
   - Do not reopen the visual-object architecture report or descriptor contract
     unless your changes make a statement false.
   - Keep the accepted visual-object focused tests passing.

## Scope

Primary scope is toolkit radial gesture runtime and Sigil's use of toolkit
spatial helpers. This should be a code/test stabilization slice, not docs
expansion.

## Hard Boundaries

- Do not implement new visual-object architecture work.
- Do not change the accepted Phase 6 closure docs unless directly required.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not use broad allowlist relaxation as a shortcut for spatial governance.
- Live AOS proof is not required unless the implementation changes live-only
  behavior that deterministic tests cannot cover.

## Verification

Run at minimum:

```bash
node --test tests/toolkit/runtime-radial-gesture.test.mjs tests/toolkit/spatial-governance.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs
git diff --check
./aos dev recommend --json
```

Run additional focused tests if `./aos dev recommend --json` or touched files
require them.

## Commit And Push

Use path-scoped `git add`. Make one scoped commit if code/tests changed, then
push:

```bash
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD and base SHA;
- files changed;
- radial gesture fix summary;
- spatial governance fix summary;
- exact tests run and results;
- whether any visual-object docs/code changed, and why;
- any local-only state left untouched.
