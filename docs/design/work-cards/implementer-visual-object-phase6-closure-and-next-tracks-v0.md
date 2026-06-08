# Implementer: Visual Object Phase 6 Closure And Next Tracks V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted GPU stellation morph path:
  `c5cf2085a7cdb86877d26cd5d8809bcae15387d8`
- Branch/output branch: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- branch_from: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, live harness state, or prior implementation state. Read and
rediscover before editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Close the current visual-object architecture workstream as an accepted,
usable architecture rather than continuing to expand Phase 6.

This is a consolidation and validation slice. Do not implement another renderer
optimization, descriptor migration, live harness, or snapshot feature unless a
required validation exposes a direct contradiction in the current docs.

The output should make the branch easy to review and continue from:

- architecture report accurately states what is implemented;
- descriptor/resource lifecycle contract accurately states the reusable
  contracts;
- validation matrix names the exact deterministic and live evidence now present;
- remaining work is split into separate future tracks, not bundled into the
  active Phase 6 loop.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- Recent Phase 6 cards:
  - `docs/design/work-cards/implementer-visual-object-phase6-runtime-duration-leak-proof-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase6-non-avatar-live-coverage-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase6-gpu-stellation-feasibility-v0.md`
- Current core implementation/proof files:
  - `apps/sigil/renderer/geometry.js`
  - `apps/sigil/renderer/avatar-shape-composition.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`
  - `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
  - `packages/toolkit/components/visual-object-live-proof/index.js`
  - `packages/toolkit/components/desktop-world-stage/index.js`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "Implemented|Partially implemented|Remaining|Phase 6|morph-target|resource_lifecycle|visual_object_descriptors|visual-object-live-proof|desktopWorldStageVisualObjectProof|observe/snapshot|profiler-backed|runtime-radial-gesture|spatial-governance" docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md apps/sigil packages/toolkit tests
```

## Required Behavior

Cover this as one broad closure slice.

1. Status consolidation
   - Update `docs/dev/reports/aos-visual-object-architecture.md` so it no
     longer reads like Phase 6 is open-ended implementation work.
   - Clearly distinguish:
     - implemented core architecture;
     - implemented representative live proofs;
     - implemented primary stellation positive-factor morph-target subset;
     - retained current blockers such as zero-factor topology split;
     - future separate tracks.

2. Contract consolidation
   - Update `docs/design/visual-object-descriptor-contract-v0.md` only where it
     needs alignment with the final Phase 6 status.
   - Preserve the separation between descriptor/update evidence,
     resource-lifecycle evidence, and observe/snapshot session evidence.

3. Validation matrix
   - Make sure the report names the focused deterministic commands and live
     proof hooks that now define acceptance for this architecture.
   - Do not imply every visual surface has migrated. The claim is representative
     cross-surface proof plus reusable contracts.

4. Future tracks
   - Split remaining work into separate next tracks instead of "keep Phase 6
     going":
     - profiler-backed leak proof;
     - full observe-mode snapshot product integration;
     - zero-factor/topology-stable stellation model if desired;
     - omega tesseron only if profiling or product use makes it hot;
     - unrelated broad toolkit stabilization for radial gesture and spatial
       governance.
   - Do not create GitHub issues or PRs unless explicitly asked.

5. Verification
   - Run the focused validation matrix enough to prove no closure edits broke
     the branch.
   - Run `./aos dev recommend --json`.
   - Live AOS proof is optional for this docs/closure slice unless you change
     live code.

## Scope

Primary scope is docs/status/validation consolidation. Code changes are out of
scope unless they are tiny corrections required by an inconsistency discovered
during validation.

## Hard Boundaries

- Do not implement new renderer behavior.
- Do not implement new live proof surfaces.
- Do not migrate more descriptors.
- Do not create GitHub issues or PRs.
- Do not fix unrelated broad-suite failures in
  `tests/toolkit/runtime-radial-gesture.test.mjs` or
  `tests/toolkit/spatial-governance.test.mjs`.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/toolkit/controls-slider-color.test.mjs tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
git diff --check
./aos dev recommend --json
```

## Commit And Push

Use path-scoped `git add`. Make one scoped commit if docs changed, then push:

```bash
git push origin implementer/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD and base SHA;
- files changed;
- final architecture status summary;
- validation commands and results;
- whether any code was changed, and why;
- remaining future tracks;
- any local-only state left untouched.
