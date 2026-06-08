# Implementer: Visual Object Phase 6 GPU Stellation Feasibility V0

> **Historical status:** Closed feasibility/implementation slice. The accepted
> result is the safe positive-factor non-tesseron morph-target subset; zero to
> positive topology-stable stellation and uniform-only stellation remain future
> tracks.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted non-avatar live coverage:
  `a658640e65cadb22f2058bb02e438bebe6d46f01`
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

Address the main remaining Phase 6 implementation gap: decide whether primary
stellation can move from retained CPU buffer mutation to a GPU-friendly
uniform/morph-target path for any supported shape topology, and implement the
safe subset if the code proves one exists.

This slice is allowed to touch Sigil avatar renderer code because the
architecture report explicitly names avatar as the reference implementation and
GPU stellation as remaining Phase 6 work. It must still stay broad and
decision-driven: do not add another proof-only loop or a cosmetic avatar tweak.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- Recent Phase 6 cards:
  - `docs/design/work-cards/implementer-visual-object-phase6-runtime-duration-leak-proof-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase6-non-avatar-live-coverage-v0.md`
- Sigil renderer files:
  - `apps/sigil/renderer/avatar-shape-composition.js`
  - `apps/sigil/renderer/geometry.js`
  - `apps/sigil/renderer/state.js`
  - `apps/sigil/renderer/skins.js`
  - `apps/sigil/renderer/live-modules/main.js`
  - `apps/sigil/renderer/vendor/three.min.js`
- Existing proof files:
  - `tests/renderer/stellation-no-rebuild.test.mjs`
  - `tests/renderer/tesseron.test.mjs`
  - `tests/renderer/sigil-avatar-editor-model.test.mjs`
  - `tests/toolkit/visual-object-resource-lifecycle.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
./aos ready --json
rg -n "createStellatedGeometry|updatePrimaryStellation|stellationFactor|morphTarget|morphAttributes|uniform|BufferGeometry|position|normal|shape.type|geometry stats|resource_lifecycle" apps/sigil tests/renderer docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad feasibility-and-implementation slice.

1. Topology feasibility
   - Inspect how `createStellatedGeometry()` changes vertex/index topology for
     the supported editable shapes.
   - Identify whether any supported primary shape can safely use a morph target
     or uniform-driven stellation without changing vertex counts, attribute
     layout, face semantics, edge rendering, or tesseron suppression behavior.
   - Add deterministic feasibility coverage that makes the decision explicit.

2. Implementation decision
   - If a safe topology-stable subset exists, implement the smallest real GPU-
     friendly path for that subset and route eligible stellation edits through
     it.
   - If no safe subset exists in the current composition model, do not fake GPU
     support. Keep the retained-buffer path, make the blocker explicit in tests
     and docs, and name the renderer model change required to make GPU
     stellation feasible.
   - Preserve structural boundaries: shape type changes, tesseron enable/disable
     topology changes, and unsupported topology-changing stellation paths may
     remain on the current retained-buffer route.

3. Evidence
   - Keep the existing 1,000-edit stellation resource proof at least as strong
     as it is now.
   - If GPU/morph/uniform support is implemented, prove stable mesh/material/
     geometry identity, no full rebuild, serializable `state.avatar`, finite
     data, and the expected GPU state update (`morphTargetInfluences`, uniforms,
     or equivalent) without weakening replacement/temporary accounting.
   - If the result is a blocker decision, prove why the current generated
     geometry cannot be represented by a safe morph/uniform path.

4. Live AOS proof
   - If `./aos ready --json` passes and an implementation changed live behavior,
     run one bounded live avatar proof and remove any temporary canvas.
   - If the slice concludes with a blocker decision and no live behavior changed,
     live proof may reuse the current stellation smoke as a regression, but the
     completion report must say that GPU behavior was not implemented.

5. Documentation
   - Update the architecture report and descriptor contract only where Phase 6
     status changes.
   - Make the distinction clear between retained CPU buffer mutation, morph-
     target support, uniform support, and a topology blocker.

## Scope

Primary scope is Sigil primary stellation feasibility and any safe GPU-friendly
implementation found by that analysis. Toolkit visual-object helpers should
only change if the evidence contract needs a narrowly justified metadata field.

## Hard Boundaries

- Do not add a fake GPU flag if the rendered geometry is still CPU-rebuilt or
  CPU-mutated.
- Do not weaken existing no-rebuild, resource lifecycle, tesseron, or live proof
  tests.
- Do not migrate every visual surface or descriptor.
- Do not introduce Three.js or Sigil dependencies into toolkit helpers unless a
  narrow evidence metadata need is explicitly justified.
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
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs
node --test tests/toolkit/controls-slider-color.test.mjs tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs
git diff --check
./aos dev recommend --json
```

Run additional focused tests for any touched renderer/helper files.

If `./aos ready --json` passes, run a bounded live avatar stellation proof when
live behavior changes, and verify cleanup. If live behavior does not change,
state why deterministic feasibility evidence is the acceptance gate.

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
- topology feasibility result;
- whether GPU morph/uniform support was implemented or explicitly blocked, and
  why;
- deterministic evidence and tests run;
- live AOS proof and cleanup result, or explicit reason live proof was not the
  acceptance gate;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
