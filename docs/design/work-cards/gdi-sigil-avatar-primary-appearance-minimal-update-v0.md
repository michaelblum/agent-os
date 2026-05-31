# GDI: Sigil Avatar Primary Appearance Minimal Update V0

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

Make primary avatar appearance-only controls apply through minimal renderer
updates instead of full shape rebuilds.

The accepted stellation slices prove primary stellation can update without
recreating the mesh hierarchy. This slice should do the same for the smallest
appearance cluster that currently routes through `updateGeometry`:

- `sigil-menu-opacity` / `state.avatar.appearance.opacity`
- `sigil-menu-edge-opacity` / `state.avatar.appearance.edgeOpacity`
- `sigil-menu-xray` / `state.avatar.appearance.interiorEdges`
- `sigil-menu-specular` / `state.avatar.appearance.specular`

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
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/stellation-no-rebuild.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "sigil-menu-opacity|sigil-menu-edge-opacity|sigil-menu-xray|sigil-menu-specular|updateGeometry|primaryFullRebuilds|appearance\\.opacity|edgeOpacity|interiorEdges|specular" apps/sigil tests
```

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Required Behavior

For primary non-tesseron avatar appearance-only edits:

- descriptor routing must not call `updateGeometry`;
- `primaryFullRebuilds` must not increment;
- `depthMesh`, `coreMesh`, `wireframeMesh`, and their geometries must remain the
  same objects;
- face opacity updates must mutate the existing primary core material state;
- edge opacity updates must mutate the existing primary wire and inner-edge
  material state where present;
- x-ray/interior toggles must update visibility/depth-facing behavior on the
  existing primary meshes without recreating geometry;
- specular toggles must mutate the existing primary core material state;
- `state.avatar` must remain JSON-serializable.

Tesseron child-specific appearance may remain a rebuild path if keeping child
override semantics minimal would otherwise broaden the slice. If GDI keeps any
tesseron appearance rebuild behavior, make that boundary explicit in the
completion report.

## Scope

Sigil app renderer, context-menu descriptor routing, and focused tests.

This is a minimal-update coverage slice for primary appearance parameters, not
a general material pooling or shader rewrite.

## Hard Boundaries

- Do not implement general material pooling.
- Do not introduce morph targets or GPU stellation uniforms.
- Do not optimize omega appearance controls unless a tiny shared helper is
  clearly safer than primary-only code.
- Do not change geometry shape/tesseron parameter rebuild semantics.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/renderer/geometry.js` or a nearby renderer helper for a small
  `updatePrimaryAppearance` style function.
- `apps/sigil/context-menu/descriptors.js` to route the four controls through
  the new minimal sync hook.
- `tests/renderer/context-menu-hit-test.test.mjs` for descriptor routing proof.
- `tests/renderer/stellation-no-rebuild.test.mjs` or a new focused renderer
  test for mesh/material identity and `primaryFullRebuilds` stability.

Prefer mutating existing material properties (`opacity`, `transparent`,
`depthWrite`, `side`, `shininess`, `specular`, `visible`) over replacing
materials. If skin shader materials need special handling, update uniforms
in-place where practical and keep non-skin behavior covered deterministically.

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
Sigil avatar canvas id, applies the four primary appearance updates through the
same descriptor path or renderer sync hook, and reports before/after
`window.state.__sigilGeometryStats` plus mesh/material identity checks. Remove
the temporary canvas after the smoke.

If live readiness hits a repo-mode TCC/input blocker, stop with:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

## Commit And Push

Use path-scoped `git add`. Make one scoped commit:

```bash
git commit -m "perf: avoid avatar appearance rebuilds"
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- deterministic no-full-rebuild evidence for the four primary appearance
  controls;
- live AOS result or readiness blocker;
- JSON serialization result;
- whether tesseron child appearance still rebuilds;
- any local-only state left untouched;
- recommended next slice.
