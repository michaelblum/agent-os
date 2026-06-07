# GDI: Sigil Avatar Stellation No-Rebuild V0

> **Historical status:** Closed Phase 2 delivery slice. Current implementation
> guidance lives in `docs/adr/0014-visual-object-descriptor-contract.md`,
> `docs/design/visual-object-descriptor-contract-v0.md`, and
> `docs/dev/reports/aos-visual-object-architecture.md`. This card explains the
> original no-full-rebuild stellation target; it is not an active prompt to
> extend Phase 2 or replace the accepted descriptor/resource-lifecycle closure.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted Phase 1 state graph base: `d2fe0e9e9fcd3bce48b38ff5c00069c261969a73`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make primary avatar stellation parameter edits apply without rebuilding the full
avatar geometry on each value change.

This is the first Phase 2 performance slice. Keep it vertical and narrow:

- primary avatar `state.avatar.shape.stellationFactor`;
- context menu / compact surface stellation control path;
- renderer update path for stellation-only edits;
- deterministic proof that repeated stellation value edits do not call the full
  geometry rebuild path.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `apps/sigil/context-menu/descriptors.js`
- `apps/sigil/context-menu/menu.js`
- `tests/renderer/tesseron.test.mjs`
- Relevant avatar/context-menu tests you discover with `rg`.

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
rg -n "stellationFactor|sigil-menu-stellation|updateGeometry|createStellatedGeometry|morphTarget|uniform" apps/sigil tests packages/toolkit
```

## Required Behavior

- Dragging or programmatically applying `sigil-menu-stellation` updates
  `state.avatar.shape.stellationFactor`.
- For stellation-only changes on the same primary shape, the renderer must use a
  minimal update path instead of rebuilding the full shape hierarchy.
- Tesseron behavior stays intact: when tesseron is active, stellation remains
  stored but suppressed in the rendered tesseron geometry.
- Shape type, tesseron toggle, size, shape-specific params, opacity/material
  changes may still use existing rebuild paths in this slice.
- `state.avatar` remains JSON-serializable.
- Existing visual behavior must remain functionally equivalent for primary
  non-tesseron stellation.

## Scope

Sigil app renderer plus focused tests. This slice may introduce a small
stellation update helper, cached geometry/morph target support, or another
minimal renderer update mechanism if it is clearly smaller than a broad rewrite.

## Hard Boundaries

- Do not implement full material pooling.
- Do not optimize omega stellation unless the primary path naturally shares the
  same tiny helper without expanding scope.
- Do not complete all descriptor/workbench coverage.
- Do not extract a platform package.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely files:

- `apps/sigil/renderer/geometry.js` - current `updateGeometry()` rebuild path.
- `apps/sigil/renderer/avatar-shape-composition.js` - current stellated
  geometry creation and tesseron suppression behavior.
- `apps/sigil/context-menu/descriptors.js` - `sigil-menu-stellation` currently
  routes through `updateGeometry`.
- `tests/renderer/context-menu-hit-test.test.mjs` - descriptor routing tests.
- A new focused renderer test may be preferable to live-only proof.

Possible shape:

- Split primary shape rebuild from stellation value update.
- Keep a stable base/non-tesseron mesh when only stellation changes.
- Instrument rebuild count or expose a test seam so deterministic tests can
  prove repeated stellation writes avoid the full rebuild hook.

Choose the simplest approach that proves no full geometry rebuild on value-only
stellation edits. Do not over-design the final Phase 2 architecture.

## Verification

Run deterministic checks:

```bash
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
node --test <new-or-updated-focused-stellation-test>
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

Then perform a small `./aos show eval` loop that changes
`window.state.avatar.shape.stellationFactor` repeatedly through the same helper
the control path uses, and report the observed rebuild counter / instrumentation
result. If no live-safe helper exists, report the deterministic proof instead.

If live readiness hits a repo-mode TCC/input blocker, stop with:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

## Commit And Push

Use path-scoped `git add`. Make one scoped implementation commit:

```bash
git commit -m "perf: avoid avatar stellation rebuilds"
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- implementation summary, especially how stellation-only edits avoid rebuilds;
- exact deterministic tests run and results;
- live AOS result or readiness blocker;
- JSON serialization result;
- rebuild-count or equivalent no-rebuild evidence;
- any local-only state left untouched;
- remaining blocker or follow-up recommendation.
