# Implementer: Visual Object Phase 5 Consolidation V0

> **Historical status:** Closed Phase 5 consolidation slice. The current status
> record is `docs/dev/reports/aos-visual-object-architecture.md`; the current
> contract is `docs/design/visual-object-descriptor-contract-v0.md`.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted radial workbench adoption base:
  `9fb6ba7e29f1c2dbbefc17ce29b350abca2cb546`
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

Consolidate the completed visual-object architecture workstream through Phase 5.

The branch now has the full path from avatar canonical state through reusable
visual-object contracts, controller/form binding, avatar compact-surface
adoption, and non-avatar radial workbench adoption. This slice should make that
state durable and reviewable: update the architecture report from planning-only
text to an implementation status record, add a validation matrix, identify
remaining gaps honestly, and run the cross-phase verification that proves the
implemented contract still holds.

This is a broad consolidation and readiness slice, not another feature bridge.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/visual-object-descriptor-contract-v0.md`
- Phase 5 work cards:
  - `docs/design/work-cards/implementer-visual-object-phase5-non-avatar-validation-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase5-non-avatar-mutation-updates-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase5-workbench-controller-adapter-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase5-workbench-form-binding-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase5-sigil-compact-surface-adoption-v0.md`
  - `docs/design/work-cards/implementer-visual-object-phase5-radial-workbench-adoption-v0.md`
- Key implementation files:
  - `apps/sigil/avatar-editor/model.js`
  - `apps/sigil/avatar-editor/compact-surface.js`
  - `apps/sigil/radial-item-editor/model.js`
  - `apps/sigil/radial-item-workbench/index.js`
  - `packages/toolkit/workbench/visual-object-contract.js`
  - `packages/toolkit/workbench/visual-object-controller.js`
  - `packages/toolkit/workbench/visual-object-form-binding.js`
  - `packages/toolkit/workbench/radial-menu-subject.js`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "state\\.avatar|visual_object_descriptors|aos.visual_object.descriptor.v0|applyVisualObjectControllerUpdate|bindVisualObjectForm|visual_object.descriptor.update|Phase 5|Success Criteria|Validation" docs/dev/reports/aos-visual-object-architecture.md docs/design/visual-object-descriptor-contract-v0.md apps/sigil packages/toolkit tests
```

## Required Behavior

Cover this as one broad consolidation slice:

1. Architecture report status
   - Update `docs/dev/reports/aos-visual-object-architecture.md` so it no longer
     reads as if all phases are only future planning.
   - Add an implementation status section summarizing completed work through
     Phase 5, with concrete commit-era capabilities:
     canonical `state.avatar.*`, minimal avatar update paths, descriptor
     contract extraction, controller/form binding, compact surface adoption, and
     radial workbench adoption.
   - Preserve future-looking sections where still true, but clearly distinguish
     implemented, partially implemented, and remaining work.

2. Validation matrix
   - Add or update a durable matrix that maps the architecture's core pattern:
     `state graph -> descriptor -> route/controller -> renderer sync/minimal update`
     across:
     - Sigil avatar / Three.js;
     - Sigil radial item workbench / non-avatar 3D;
     - toolkit DOM slider proof;
     - 2D/DesktopWorld or canvas-style proof.
   - Include the focused test commands that prove each row.

3. Remaining gaps
   - Record remaining gaps without overstating completion. Examples to consider:
     GPU morph-target/uniform stellation is not fully implemented; material or
     geometry resource pooling may still be future work; broad toolkit suite has
     known unrelated failures in radial gesture and spatial governance; live AOS
     proof exists for radial workbench but not necessarily every surface.
   - If a gap belongs in a future implementation slice, name the next broad slice
     explicitly.

4. Contract docs consistency
   - Ensure `docs/design/visual-object-descriptor-contract-v0.md` and the
     architecture report agree on terminology, helper names, and boundaries.
   - Remove stale "next Phase 5 target" phrasing if Phase 5 is now implemented.

5. Verification
   - Run the cross-phase focused validation matrix from the updated report.
   - If `./aos ready --json` passes, run one bounded live check that does not
     create long-lived clutter:
     - either verify the radial workbench descriptor update path again; or
     - verify the compact avatar surface opt-in binding path if a clean live
       harness exists.
   - If live readiness is blocked by repo-mode TCC/input permissions, use the
     dock-owned recovery path instead of treating it as noise.

## Scope

Docs and validation only unless a tiny test/doc consistency fix is required.

This is not an implementation feature slice, not a renderer optimization pass,
and not a request to fix unrelated broad-suite failures.

## Hard Boundaries

- Do not rewrite renderer or workbench behavior in this slice.
- Do not broaden the implementation just to make the report look complete.
- Do not fix unrelated `tests/toolkit/runtime-radial-gesture.test.mjs` or
  `tests/toolkit/spatial-governance.test.mjs` failures unless your own edits
  touch those files.
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
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs
node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs
node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs
git diff --check
./aos dev recommend --json
```

Run any additional focused checks recommended by `./aos dev recommend --json`.

The broad `node --test tests/toolkit/*.test.mjs` command is currently known to
fail in untouched `tests/toolkit/runtime-radial-gesture.test.mjs` and
`tests/toolkit/spatial-governance.test.mjs` on this branch. Do not report this
as a new failure unless the failure set changes.

## Commit And Push

Use path-scoped `git add`. Make one scoped commit if docs/tests changed:

```bash
git push origin implementer/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- architecture report updates made;
- validation matrix summary;
- remaining gaps and recommended next broad slice;
- live AOS result or explicit readiness blocker handling;
- any local-only state left untouched.
