# Implementer: Visual Object Phase 6 GPU Resource Live Proof V0

> **Historical status:** Superseded Phase 6 implementation slice. Phase 6 is
> now closed for the visual-object workstream. Use
> `docs/adr/0014-visual-object-descriptor-contract.md`,
> `docs/design/visual-object-descriptor-contract-v0.md`, and
> `docs/dev/reports/aos-visual-object-architecture.md` for current closure,
> retained limits, and future tracks.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Contract doc: `docs/design/visual-object-descriptor-contract-v0.md`
- Accepted Phase 5 consolidation base:
  `f6b2aefc2e695f2308fb15ff66cbf0499561fab9`
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

Start Phase 6 as one broad implementation slice, not another minute follow-up:
convert the proven visual-object descriptor/update architecture into stronger
runtime performance and resource lifecycle evidence.

Focus on Sigil avatar renderer paths first because the architecture report names
them as the reference implementation and remaining risk: GPU-friendly or
minimal-render stellation/tesseron behavior, material/geometry resource churn,
and live AOS proof. Keep the result reviewable by choosing the highest-leverage
resource/update improvements that the current renderer shape can support in one
Implementer loop, then prove them deterministically and with a bounded live smoke.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- `docs/design/work-cards/implementer-visual-object-phase5-consolidation-v0.md`
- Renderer/update files:
  - `apps/sigil/renderer/geometry.js`
  - `apps/sigil/renderer/state.js`
  - `apps/sigil/renderer/appearance.js`
  - `apps/sigil/renderer/avatar-shape-composition.js`
  - `apps/sigil/renderer/skins.js`
  - `apps/sigil/renderer/live-modules/main.js`
- Descriptor/live adoption files:
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
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "updatePrimaryStellation|updatePrimaryAppearance|updateGeometry|tesseron|geometryCache|dispose|material|uniform|morph|resource|visual_object.descriptor.update|bindVisualObjectForm|applyVisualObjectControllerUpdate" apps/sigil packages/toolkit tests docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md
```

## Required Behavior

Cover this as one broad Phase 6 slice. Implementer should inspect current code before
choosing exact internals, but the completed slice must materially reduce
renderer churn or prove that existing minimal paths are now bounded enough for
the architecture claim.

1. Avatar resource/update improvement
   - Identify the remaining highest-churn avatar path reachable from canonical
     `state.avatar.*` edits: likely stellation replacement geometry,
     tesseron-derived child/link visuals, skin/material updates, or shape
     parameter rebuild boundaries.
   - Implement the best bounded improvement available in this loop. Acceptable
     examples include resource pooling/reuse, stronger disposal lifecycle
     accounting, GPU-friendly uniform/morph updates where the current geometry
     model supports it, or converting tesseron parameter edits from full rebuilds
     into derived child/link buffer/material updates in place.
   - Preserve structural rebuild boundaries where still necessary. Enabling or
     disabling tesseron may remain structural; pure parameter edits should move
     toward minimal updates when feasible.
   - Keep canonical state near shape semantics. For tesseron, treat it as a
     shape modifier or derived visual layer conceptually (`state.avatar.shape.tesseron`
     is acceptable for this slice); do not force a full state migration unless
     it is required for the implementation.

2. Deterministic resource evidence
   - Add tests that perform repeated descriptor or canonical state edits and
     prove bounded retained geometries/materials, stable object identities where
     minimal update is expected, and correct disposal counts where replacement is
     still required.
   - Include JSON serialization evidence for `state.avatar` after the repeated
     edits.
   - Keep or extend the existing 100-edit stellation/resource stability proof
     rather than replacing it with a weaker check.

3. Cross-surface contract regression
   - Ensure the Phase 5 descriptor/controller/form contract still passes after
     renderer changes.
   - Do not regress compact avatar binding or radial workbench adoption.

4. Live AOS proof
   - If `./aos ready --json` passes, run one bounded live smoke that exercises
     the changed avatar update path through the current live surface or a clean
     deterministic workbench/harness path.
   - The live proof should report update counts or resource identity/resource
     bounds, JSON serialization success, and cleanup of any temporary canvas.
   - If avatar live proof is blocked by missing harness support but AOS is
     ready, keep the radial workbench descriptor smoke as a secondary regression
     and state exactly what avatar live gap remains.

5. Documentation
   - Update the architecture report and/or descriptor contract doc only where
     Phase 6 status changed. Do not make the docs claim platform-wide completion
     unless the tests and live proof actually cover it.
   - If substantial GPU/resource work remains, name the next broad Phase 6
     follow-up explicitly.

## Scope

Primary scope is Sigil avatar renderer/resource behavior plus cross-phase
contract regression. Toolkit descriptor/controller/form code should only change
if renderer proof exposes a real contract issue.

## Hard Boundaries

- Do not reopen Phase 5 consolidation unless the new implementation makes a doc
  statement false.
- Do not migrate every visual surface. This slice may use non-avatar surfaces as
  regression proof, but the implementation target is avatar renderer resource
  and update behavior.
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
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
git diff --check
./aos dev recommend --json
```

Run any additional focused checks recommended by `./aos dev recommend --json`
or required by files you touched.

If `./aos ready --json` passes, run a bounded live smoke and remove any
temporary canvas. Prefer an avatar live update path for this slice; use radial
workbench descriptor live smoke only as a secondary regression when avatar live
proof is not yet cleanly exposed.

The broad `node --test tests/toolkit/*.test.mjs` command is currently known to
fail in untouched `tests/toolkit/runtime-radial-gesture.test.mjs` and
`tests/toolkit/spatial-governance.test.mjs` on this branch. Do not report this
as a new failure unless the failure set changes.

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
- exact implementation choice and why it was the broad/highest-leverage Phase 6
  step;
- resource/update evidence, including repeated-edit counts and retained
  geometry/material bounds;
- JSON serialization evidence;
- exact tests run and results;
- live AOS result or explicit readiness blocker handling;
- docs updated, if any;
- remaining gaps and recommended next broad slice;
- any local-only state left untouched.
