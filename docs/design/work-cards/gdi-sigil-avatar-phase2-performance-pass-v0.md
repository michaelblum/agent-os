# GDI: Sigil Avatar Phase 2 Performance Pass V0

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted memory-stability base:
  `65f4a76b1813c2e9d419361874aa3a15da6e442d`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Complete a broad Phase 2 avatar performance pass: make active primary avatar
parameter edits data-driven and minimal-render where they do not structurally
change the avatar, and add local resource reuse/disposal safeguards for the
remaining shape rebuild paths.

The accepted stellation slices prove one parameter can avoid full hierarchy
rebuilds and remain resource-bounded. This slice should use the `/goal` loop for
a larger cohesive pass, not a single-control correction.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/work-cards/gdi-sigil-avatar-stellation-no-rebuild-v0.md`
- `docs/design/work-cards/gdi-sigil-avatar-stellation-memory-stability-v0.md`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `apps/sigil/renderer/colors.js`
- `apps/sigil/renderer/skins.js`
- `apps/sigil/renderer/appearance.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/stellation-no-rebuild.test.mjs`
- `tests/renderer/tesseron.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "rendererSync|updateGeometry|updatePrimaryStellation|updateAllColors|applySkin|new THREE\\.|dispose\\(|Material|Geometry|primaryFullRebuilds|__sigilGeometryStats" apps/sigil tests
```

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Required Behavior

Use judgment from the code, but cover this broad Phase 2 surface:

1. Primary appearance minimal updates
   - `sigil-menu-opacity`, `sigil-menu-edge-opacity`, `sigil-menu-xray`, and
     `sigil-menu-specular` must not call `updateGeometry` for non-tesseron
     primary avatars.
   - Existing primary mesh, geometry, and material object identity should remain
     stable when mutating material flags/properties in place.
   - Inner-edge visibility/opacity behavior must stay coherent.

2. Color and skin/resource lifecycle
   - Color-only edits should mutate existing materials/attributes where
     practical and avoid unnecessary hierarchy rebuilds.
   - Add a local material/geometry reuse or disposal guard where inspection
     shows rebuild paths recreate identical resources or leak intermediate
     objects.
   - Keep the resource policy local to Sigil avatar renderer code. Do not extract
     a platform package in this slice.

3. Remaining active minimal-update coverage
   - Inspect active avatar descriptors that still route through `updateGeometry`.
     Leave true structural controls, such as shape type and tesseron topology,
     as rebuild paths.
   - Convert non-structural active controls to a minimal renderer sync hook when
     that can be done without changing product behavior.
   - Make any retained rebuild boundary explicit in the completion report.

4. Stability and serialization
   - Existing stellation no-rebuild and memory-stability behavior must remain
     intact.
   - `state.avatar` must remain JSON-serializable after deterministic update
     loops and in live `avatar-main` when readiness permits.

## Scope

Sigil avatar renderer, context-menu descriptor routing, and focused tests.

This is the broad Phase 2 performance slice for the avatar reference
implementation. It may add small local helpers for material mutation, resource
reuse, descriptor sync routing, and deterministic instrumentation. It should not
extract platform contracts, rewrite the workbench, or pursue non-avatar visuals.

## Hard Boundaries

- Do not introduce morph targets or GPU stellation uniforms unless they are the
  smallest safe way to complete the pass.
- Do not change shape/tesseron structural semantics.
- Do not optimize omega unless sharing a small helper is safer than primary-only
  duplication.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `apps/sigil/renderer/colors.js`
- `apps/sigil/renderer/skins.js`
- `apps/sigil/context-menu/descriptors.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/stellation-no-rebuild.test.mjs`
- optional new focused renderer test if that keeps the broader proof readable

Prefer in-place mutation of existing `THREE.Material` and `THREE.BufferGeometry`
state where behavior allows. If a resource cache/pool is added, keep it bounded,
observable in tests, and clear about ownership/disposal.

## Verification

Run:

```bash
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/stellation-no-rebuild.test.mjs
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

If `./aos ready --json` passes, run a bounded live smoke that launches a unique
Sigil avatar canvas id and applies a mixed loop of non-structural avatar
updates. Report:

- before/after `window.state.__sigilGeometryStats`;
- mesh, geometry, and material identity checks for minimal-update controls;
- JSON serialization result;
- any retained rebuild count and why it is structural.

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
- deterministic no-full-rebuild evidence for covered non-structural controls;
- resource reuse/disposal evidence, including any cache/pool bounds;
- live AOS result or readiness blocker;
- JSON serialization result;
- retained structural rebuild boundaries;
- any local-only state left untouched;
- recommended next broad slice.
