# GDI: Visual Object Phase 6 Non-Avatar Live Coverage V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted runtime-duration proof:
  `c9f860981901f41a4c4e8316c145ce26f93d201f`
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

Extend Phase 6 live confidence beyond the current bounded avatar/radial checks
to representative non-avatar surfaces: a toolkit DOM control path and a
DesktopWorld/canvas-style path.

This is not another avatar optimization or another loop-length proof. The slice
should find the smallest real live harness path, add narrow debug/proof hooks
only if needed, and summarize the result with the shared
`aos.visual_object.resource_lifecycle.v0` vocabulary.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/gdi-visual-object-phase6-runtime-duration-leak-proof-v0.md`
- Toolkit live/component docs:
  - `docs/api/toolkit/controls.md`
  - `docs/api/toolkit/runtime.md`
  - `docs/api/toolkit/components.md`
- Existing reusable contract files:
  - `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`
- Existing deterministic proof files:
  - `tests/toolkit/controls-slider-color.test.mjs`
  - `tests/toolkit/desktop-world-surface-2d.test.mjs`
  - `tests/toolkit/runtime-canvas.test.mjs`
  - `tests/toolkit/visual-object-resource-lifecycle.test.mjs`
  - `tests/toolkit/visual-object-form-binding.test.mjs`
  - `tests/toolkit/visual-object-contract.test.mjs`
  - `tests/renderer/radial-item-editor.test.mjs`
  - `tests/renderer/stellation-no-rebuild.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "createSlider|controls-slider|DesktopWorldSurface2D|desktop-world-stage|runtime-canvas|visual_object.resource_lifecycle|proofWindow|window\\.__|__.*Debug|aos://toolkit|show create|show eval" packages/toolkit apps/sigil tests docs/api docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad non-avatar live-coverage slice.

1. DOM control live proof
   - Identify the narrowest live toolkit DOM control path that can exercise the
     descriptor/form/controller update loop for a real slider or equivalent
     control.
   - Prefer an existing component or inline `./aos show create` harness over a
     new permanent app surface.
   - Prove stable root/control identity, state serialization, route/sync
     evidence, and lifecycle evidence using the shared helper.

2. DesktopWorld/canvas-style live proof
   - Identify the narrowest live DesktopWorld/canvas-style path that can
     exercise a same-node transform or equivalent retained-target update.
   - Prefer existing DesktopWorld stage/runtime utilities. Add only narrow debug
     hooks if the current surface lacks a readable proof result.
   - Prove retained target identity, state serialization, route/sync evidence,
     and lifecycle evidence using the shared helper.

3. Contract and docs
   - Keep the visual-object lifecycle contract renderer-agnostic.
   - Update docs only where Phase 6 live coverage status changes.
   - Do not claim broad live coverage for every surface unless the proof truly
     covers it.

4. Regression guard
   - Keep avatar and radial focused lifecycle proofs passing.
   - Keep projection-only descriptors outside mutation/update lifecycle claims.
   - Do not regress the observe/snapshot boundary or resource pooling boundary.

5. Blocker behavior
   - If `./aos ready --json` reports a repo-mode TCC/input-tap blocker, use the
     dock-owned recovery path below and stop live-dependent work.
   - If AOS is ready but a non-avatar harness does not exist, implement the
     smallest deterministic-to-live harness needed for this proof or document a
     precise harness gap. Do not pretend a deterministic test is live evidence.

## Scope

Primary scope is live proof coverage for DOM/toolkit and DesktopWorld/canvas
representative visual-object paths. Implementation may touch focused toolkit
test harnesses, small component/debug hooks, docs, and deterministic tests.

## Hard Boundaries

- Do not perform another avatar-only renderer optimization.
- Do not migrate every visual surface or every descriptor.
- Do not introduce Three.js or Sigil dependencies into toolkit helpers.
- Do not build a new persistent snapshot system.
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
node --test tests/toolkit/controls-slider-color.test.mjs tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs tests/toolkit/visual-object-resource-lifecycle.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
git diff --check
./aos dev recommend --json
```

If `./aos ready --json` passes, run bounded live DOM and DesktopWorld/canvas
proofs, remove any temporary canvases, and verify cleanup. If one live proof is
blocked by a missing harness, report the precise gap and still run the other
live proof if available.

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
- DOM live proof result or precise harness blocker;
- DesktopWorld/canvas live proof result or precise harness blocker;
- cross-surface deterministic lifecycle evidence summary;
- exact tests run and results;
- live canvas cleanup result;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
