# Implementer: Sigil Avatar State Tesseron Correction V0

> **Historical status:** Closed Phase 1 correction slice. It remains useful as
> evidence for the canonical `state.avatar.*` migration, but current
> visual-object guidance is the accepted descriptor/resource-lifecycle contract.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Accepted base slice under review: `0139800e72798c737222c1a555de071052acd1c1`
- Branch/output branch: `implementer/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/implementer/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Fix the Phase 1 state graph regression where the adjacent tesseron renderer test
still fails after canonical `state.avatar.*` migration:

```bash
node --test tests/renderer/tesseron.test.mjs
```

Observed failure from Foreman review:

```text
not ok - Tesseron build suppresses stellation without erasing the stored value
AssertionError: assert.ok(state.tesseronChildCoreMesh)
```

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `tests/renderer/tesseron.test.mjs`
- `apps/sigil/renderer/state.js`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `apps/sigil/context-menu/descriptors.js`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
```

## Required Behavior

- `tests/renderer/tesseron.test.mjs` must pass.
- The failing test should exercise the canonical `state.avatar.*` graph, not
  only legacy aliases, unless inspection proves the renderer must continue
  accepting legacy-only mutation for an active runtime path.
- `updateGeometry()` and `updateInnerEdgePulse()` must continue to read the
  canonical avatar graph.
- `state.avatar` must remain JSON-serializable.
- Do not revert the Phase 1 state graph migration.

## Scope

This is a correction round for the Sigil app renderer and tests. Keep the change
small.

## Hard Boundaries

- Do not start Phase 2 GPU optimization.
- Do not add morph targets, material pooling, or geometry caching.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.
- Do not broaden into descriptor/workbench completion beyond what is required
  to make this correction test-clean.

## Suggested Implementation Areas

Likely correction paths:

- Update `tests/renderer/tesseron.test.mjs` to mutate
  `state.avatar.shape.*` / `state.avatar.appearance.*` before calling
  `updateGeometry()`.
- If needed, use `syncAvatarAliasesFromGraph(state)` after canonical test
  mutations so legacy assertions remain coherent.
- If inspection finds a real runtime path still mutates only legacy fields,
  repair that active caller to write `state.avatar.*` rather than adding a
  compatibility shim.

## Verification

Run:

```bash
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Live AOS verification is not required for this correction unless your code
changes runtime behavior beyond the test fixture. If you do run live checks and
`./aos ready` reports a repo-mode TCC/input blocker, stop with:

```bash
the manual TCC blocker report path
```

## Commit And Push

Use path-scoped `git add`. Make one correction commit:

```bash
git commit -m "test: align tesseron renderer coverage with avatar state graph"
git push origin implementer/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and pass/fail results;
- whether the fix was test-only or changed runtime behavior;
- any local-only state left untouched;
- any remaining blocker or follow-up recommendation.
