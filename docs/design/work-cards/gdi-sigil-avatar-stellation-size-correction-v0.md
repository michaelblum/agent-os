# GDI: Sigil Avatar Stellation Size Correction V0

> **Historical status:** Closed correction slice for the earlier no-rebuild
> helper. Current authority is the accepted descriptor/resource-lifecycle
> contract in `docs/adr/0014-visual-object-descriptor-contract.md`,
> `docs/design/visual-object-descriptor-contract-v0.md`, and
> `docs/dev/reports/aos-visual-object-architecture.md`.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Reviewed implementation commit: `866fc0f8ceefc76c7c2554d279dcbde0fb4e98ae`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Fix the stellation no-rebuild helper so it rebuilds the replacement primary
geometry with the same finite base size used by the full `updateGeometry()`
path.

Foreman review found that `updatePrimaryStellation()` calls
`createBaseGeometry(type, undefined)`. For several editable shapes this creates
NaN geometry after a stellation-only edit:

```text
type 6  -> core geometry has NaN positions
type 92 -> core geometry has NaN positions
type 93 -> core geometry has NaN positions
```

The full rebuild path passes a finite size through
`createAvatarShapeComposition()`, so the minimal stellation path must match that
contract.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/gdi-sigil-avatar-stellation-no-rebuild-v0.md`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/selection-mode-cursor-ancestor-ladder-v0
./aos dev recommend --json
```

## Required Behavior

- `updatePrimaryStellation()` must create finite replacement geometry for all
  primary editable shape types it supports.
- The no-full-rebuild behavior for repeated non-tesseron stellation edits must
  remain true.
- Tesseron suppression behavior must remain true.
- `state.avatar` must remain JSON-serializable.
- The correction should be small and focused.

## Hard Boundaries

- Do not start material pooling, morph target architecture, or broader Phase 2
  work.
- Do not optimize omega stellation in this correction unless the fix is a shared
  one-line helper with no scope expansion.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Suggested Implementation Areas

Likely fix:

- In `apps/sigil/renderer/geometry.js`, make `updatePrimaryStellation()` use the
  same finite base size as `createAvatarShapeComposition()` uses when
  `updateGeometry()` does not provide an explicit size.
- Add a regression assertion in `tests/renderer/stellation-no-rebuild.test.mjs`
  that checks stellation-only updates for box, torus, and prism produce finite
  position attributes.

Useful local probe from Foreman review:

```bash
node --input-type=module <<'EOF'
import THREE from './apps/sigil/renderer/vendor/three.min.js';
globalThis.THREE = THREE;
const stateMod = await import('./apps/sigil/renderer/state.js');
const state = stateMod.default;
const { syncAvatarAliasesFromGraph } = stateMod;
const { updateGeometry, updatePrimaryStellation } = await import('./apps/sigil/renderer/geometry.js');
function hasNaNGeometry(g) {
  const a = g?.getAttribute?.('position');
  if (!a) return true;
  for (let i = 0; i < a.array.length; i += 1) if (!Number.isFinite(a.array[i])) return true;
  return false;
}
for (const type of [6, 90, 92, 93, 100]) {
  state.polyGroup = new THREE.Group();
  state.avatar.shape.type = type;
  state.avatar.shape.stellationFactor = 0;
  state.avatar.shape.tesseron = { enabled: false, proportion: 0.5, matchMother: true, child: {} };
  syncAvatarAliasesFromGraph(state);
  updateGeometry(type);
  state.avatar.shape.stellationFactor = 0.5;
  updatePrimaryStellation(0.5);
  console.log(JSON.stringify({ type, coreNaN: hasNaNGeometry(state.coreMesh.geometry) }));
}
EOF
```

## Verification

Run:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/toolkit/sigil-subject.test.mjs
git diff --check
```

Live AOS verification is not required unless runtime behavior changes beyond the
finite-size correction.

## Commit And Push

Use path-scoped `git add`. Make one correction commit:

```bash
git commit -m "fix: keep stellation replacement geometry finite"
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- confirmation that box/torus/prism stellation-only replacement geometry is
  finite;
- whether the fix changed runtime behavior beyond correcting geometry size;
- any local-only state left untouched.
