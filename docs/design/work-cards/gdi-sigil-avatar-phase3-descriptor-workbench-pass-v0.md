# GDI: Sigil Avatar Phase 3 Descriptor Workbench Pass V0

> **Historical status:** Closed descriptor/workbench delivery slice. Current
> descriptor guidance is `aos.visual_object.descriptor.v0` plus the toolkit
> descriptor/controller/form-binding helpers documented in
> `docs/design/visual-object-descriptor-contract-v0.md`.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 2 performance/correction base:
  `6ac48e41f151df0f7e8a6cb4f8a75cb7b0ecd175`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Goal

Complete a broad Phase 3 pass for descriptor-driven avatar editing: make the
Sigil avatar workbench/control-surface descriptors complete enough for active
avatar state, keep descriptor routing canonical under `state.avatar.*`, and
prove live-bound editing can round-trip through UI/subject descriptors without
falling back to legacy state or unnecessary rebuild paths.

Phase 1 established the canonical avatar graph. Phase 2 made the first
performance-critical primary updates minimal and corrected tesseron child
appearance semantics. This slice should focus on descriptor/workbench coverage
and binding quality, not more renderer optimization.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/work-cards/gdi-sigil-avatar-phase2-performance-pass-v0.md`
- `docs/design/work-cards/gdi-sigil-avatar-tesseron-child-appearance-correction-v0.md`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/geometry.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "statePath|rendererSync|sigil-menu-|avatar\\.shape|avatar\\.appearance|avatar\\.effects|avatar\\.transform|contracts|canvas_object\\.(transform|effects)\\.patch|sigil\\.avatar\\.control\\.patch|projection-only|canonical" apps/sigil tests
```

## Required Behavior

Use judgment from the code, but cover this broad Phase 3 surface:

1. Descriptor inventory and canonical paths
   - Inventory active avatar edit controls against `state.avatar.shape`,
     `state.avatar.appearance`, `state.avatar.effects`, `state.avatar.transform`,
     and interaction/window settings that intentionally remain projection or
     world-context state.
   - Add or correct descriptors for active avatar parameters that are missing,
     stale, or still imply legacy/scattered state.
   - Keep projection-only shortcuts explicitly classified outside canonical
     avatar editing.

2. Workbench/control-surface binding
   - Ensure the avatar editor model and compact control surface expose descriptor
     metadata consistently: id, label, type, path, route, coercion/range/options,
     renderer sync, grouping, and conditional visibility.
   - Ensure form changes round-trip through canonical descriptor routing and
     update `state.avatar.*` without creating duplicate legacy paths.
   - Preserve Phase 2 minimal renderer sync hooks for primary stellation and
     primary appearance controls.

3. Tesseron modifier semantics
   - Keep tesseron canonical state near shape semantics for this slice
     (`state.avatar.shape.tesseron` is acceptable).
   - Descriptor/workbench metadata should make tesseron feel like a shape
     modifier or derived visual layer, not an ordinary base geometry.
   - Preserve `matchMother` child override semantics in descriptor projections
     and tests.

4. Validation and coercion
   - Keep numeric, boolean, select, segmented, and color coercion centralized
     through descriptor routing where practical.
   - Add or tighten tests for invalid/edge inputs only when they map to active
     descriptor risk; do not build a generic validation framework in this slice.

5. Serialization and evidence
   - `state.avatar` must remain JSON-serializable after descriptor-driven
     updates.
   - Deterministic tests should prove representative shape, appearance, effect,
     transform, and tesseron modifier controls route through the expected
     contracts and update canonical state.

## Scope

Sigil avatar editor/workbench model, compact surface projection, context-menu
descriptor routing, and focused tests.

This is the broad Phase 3 descriptor/workbench slice for the avatar reference
implementation. It should not extract platform packages or apply the pattern to
non-avatar visuals.

## Hard Boundaries

- Do not start Phase 4 platform extraction.
- Do not optimize renderer internals beyond tiny adjustments needed to preserve
  descriptor sync correctness.
- Do not change tesseron enable/disable structural semantics.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/avatar-editor/model.js`
- `apps/sigil/avatar-editor/surface-view-model.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-model.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/toolkit/sigil-subject.test.mjs`

Prefer improving existing descriptor/model contracts over adding parallel
metadata structures.

## Verification

Run:

```bash
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

If `./aos ready --json` passes, run a bounded live smoke that launches a unique
Sigil avatar canvas id and applies a representative descriptor-driven edit set
through the same route used by the workbench/control surface. Report:

- state paths updated;
- contracts/routes used;
- renderer sync hooks invoked for primary stellation and primary appearance;
- `JSON.stringify(window.state.avatar)` result;
- any retained rebuild boundaries.

If live readiness hits a repo-mode TCC/input blocker, stop with:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

## Commit And Push

Use path-scoped `git add`. Make one or more scoped commits as needed, but keep
the final diff reviewable:

```bash
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- descriptor inventory summary: added, corrected, explicitly projection-only,
  and intentionally deferred controls;
- deterministic evidence for representative descriptor-driven shape,
  appearance, effect, transform, and tesseron modifier updates;
- confirmation that Phase 2 minimal renderer sync hooks still route correctly;
- live AOS result or readiness blocker;
- JSON serialization result;
- any local-only state left untouched;
- recommended next broad slice.
