# Sigil Context Menu Compact Surface Lifecycle Extraction V0

## Recipient

Implementer implementation round.

## Branch / Base

- source PR: `https://github.com/michaelblum/agent-os/pull/397`
- branch_from: `origin/implementer/sigil-context-menu-record-snapshot-extraction-v0`
- required_start_ref:
  `origin/implementer/sigil-context-menu-record-snapshot-extraction-v0` at `9160d44d89c0203ae820053eff405acbf91b3c51`
- expected output branch:
  `implementer/sigil-context-menu-compact-surface-lifecycle-extraction-v0`

Do not start from `origin/main`. This is a stacked follow-up after the accepted
PR #397 snapshot projection extraction.

## Source Artifact

PR #397 re-review accepted the pure snapshot seam and identified one
non-blocking residual: `apps/sigil/context-menu/menu.js` is still 997 lines,
right against the 1,000-line review threshold. The next higher-value
decomposition is compact-surface lifecycle/cache ownership.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the compact context-menu surface mount/cache/destroy lifecycle out of
`apps/sigil/context-menu/menu.js` so the menu module moves meaningfully away
from the 1,000-line threshold while preserving compact control behavior and
snapshot output.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/context-menu-snapshot-projection.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
gh pr view 397 --json number,title,state,headRefName,baseRefName,headRefOid,url
wc -l apps/sigil/context-menu/menu.js
rg -n "compactSurface|compactValueCache|seedCompactValueCache|routeChangedControls|handleCompactProjectionAction|mountCompactSurface|destroy|refreshVisibility|syncFromState|syncSnapshot" apps/sigil/context-menu/menu.js
```

## Required Behavior

- Keep the compact control-record contract stable, including the
  `buildContextMenuSnapshot(menuState, compactSurface)` output from PR #397.
- Preserve menu open/close/applySnapshot behavior, including:
  - initial pre-mount snapshot publication;
  - post-mount `syncFromState()`, cache seeding, positioning, snapshot
    publication, and `onBoundsChange` calls;
  - close/applySnapshot destroy and cache clear behavior;
  - active tab preservation when applying a snapshot;
  - compact projection action and control-change routing behavior.
- Preserve direct menu accessors used by pointer handling:
  - descriptor id lookup;
  - element-to-field lookup;
  - slider/checkbox/select event routing.
- Keep `apps/sigil/context-menu/menu.js` below 1,000 lines, and target a
  meaningful margin below the threshold. A successful extraction should get it
  below 950 unless code inspection shows a smaller safe boundary is the right
  reversible slice.

## Suggested Implementation Area

After reading the code, prefer a small context-menu-local lifecycle/session
module such as:

- `apps/sigil/context-menu/compact-surface-session.js`

The likely owner is the code around:

- `compactSurface`;
- `compactValueCache`;
- `cacheKey()`;
- `seedCompactValueCache()`;
- `routeChangedControls()`;
- `handleCompactProjectionAction()`;
- `mountCompactSurface()`;
- destroy/clear helpers used by `close()` and `applySnapshot()`;
- optional refresh forwarding for `syncFromState()`.

Use concrete required dependencies for the session/controller. Avoid replacing
the file-size issue with a broad optional callback bag or silent fallbacks.
Leave product state mapping in `syncFromState()` unless moving a tiny call site
is necessary to keep the lifecycle boundary coherent.

## Scope

Sigil context-menu JS and focused renderer tests only.

## Hard Boundaries / Non-Goals

- Do not change the compact control-record schema or add compatibility fields.
- Do not redesign descriptors, visual object binding, pointer routing, menu
  geometry, or product behavior.
- Do not move generic behavior into toolkit for this slice.
- Do not run live pointer scenarios for this decomposition.
- Do not delete unrelated untracked work-card or report files.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --check apps/sigil/context-menu/snapshot-projection.js
node --check apps/sigil/context-menu/compact-surface-session.js
node --test tests/renderer/context-menu-snapshot-projection.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
wc -l apps/sigil/context-menu/menu.js
```

If the extracted module uses a different filename, run `node --check` on that
module instead of `compact-surface-session.js` and report the actual path.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- what compact-surface lifecycle ownership moved and what stayed in `menu.js`;
- final `menu.js` line count;
- exact verification commands and results;
- whether a PR was opened or which existing branch was pushed;
- any remaining local-only state;
- next smallest follow-up if the extraction exposes one.
