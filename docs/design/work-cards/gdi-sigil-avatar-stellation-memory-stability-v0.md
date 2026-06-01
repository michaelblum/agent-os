# GDI: Sigil Avatar Stellation Memory Stability V0

> **Historical status:** Closed Phase 2 hardening/proof slice. Current
> stellation guidance is the accepted Phase 6 status: positive-factor
> non-tesseron edits use a renderer-local morph-target subset, factor-zero
> topology remains a retained limit, and resource evidence uses
> `aos.visual_object.resource_lifecycle.v0`.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted stellation no-rebuild correction base:
  `1a318320e32384a12e67ad6317adabe47dc29f7a`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Harden and prove memory/resource stability for repeated primary avatar
stellation edits.

The previous slice made primary `sigil-menu-stellation` avoid full hierarchy
rebuilds and corrected finite replacement geometry. This slice should prove the
remaining acceptance claim: 100 stellation-only value changes do not grow
renderer resources, materials, or mesh hierarchy.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/design/work-cards/gdi-sigil-avatar-stellation-no-rebuild-v0.md`
- `docs/design/work-cards/gdi-sigil-avatar-stellation-size-correction-v0.md`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "__sigilGeometryStats|updatePrimaryStellation|dispose|geometry\\.dispose|renderer\\.info|primaryStellation" apps/sigil tests
```

## Required Behavior

- 100 primary non-tesseron stellation-only edits must:
  - keep the same `depthMesh`, `coreMesh`, `wireframeMesh`;
  - keep the same primary materials;
  - avoid incrementing `primaryFullRebuilds`;
  - increment only the stellation update counter;
  - keep replacement geometry positions finite;
  - dispose old replacement geometries so retained geometry count is bounded.
- `state.avatar` must remain JSON-serializable after the loop.
- Tesseron suppression behavior must remain intact.

## Scope

Sigil renderer and focused tests. This is a hardening/proof slice for the
existing primary stellation helper, not a broad Phase 2 rewrite.

## Hard Boundaries

- Do not implement general material pooling.
- Do not optimize omega stellation unless a bug in shared disposal accounting
  requires a tiny shared helper.
- Do not add morph targets unless inspection proves the existing geometry-swap
  helper cannot meet the bounded-memory requirement.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely paths:

- `apps/sigil/renderer/geometry.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`

Suggested proof shape:

- Add or refine instrumentation around `updatePrimaryStellation()` for created,
  replaced, and disposed geometry counts.
- Add a deterministic test that performs 100 stellation updates across a range
  of values and asserts bounded retained geometry/material/mesh identity.
- If the helper currently leaks an edge geometry or base/final geometry, fix
  disposal in the smallest local way.

Avoid relying only on browser heap snapshots for acceptance. Use deterministic
renderer/resource assertions first, then live AOS as optional confirmation.

## Verification

Run:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

If `./aos ready --json` passes, run a bounded live smoke:

```bash
source tests/lib/sigil/visual-harness.sh
aos_visual_prepare_live_roots
aos_visual_seed_sigil repo
aos_visual_launch_sigil_avatar avatar-main
aos_visual_wait_sigil_avatar_ready avatar-main
./aos show eval --id avatar-main --js 'JSON.stringify(window.state?.avatar)' --json
```

Then run a small `./aos show eval` loop through the same stellation update path
and report the before/after geometry stats. If live readiness hits a repo-mode
TCC/input blocker, stop with:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

## Commit And Push

Use path-scoped `git add`. Make one scoped commit:

```bash
git commit -m "test: prove avatar stellation memory stability"
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- deterministic 100-change resource stability evidence;
- live AOS result or readiness blocker;
- JSON serialization result;
- whether any runtime disposal behavior changed;
- any local-only state left untouched;
- recommended next slice.
