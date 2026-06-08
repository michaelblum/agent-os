# Sigil Context Menu Snapshot Projection Pure Correction V0

## Recipient

Implementer correction round for PR #397.

## Branch / Base

- PR: `https://github.com/michaelblum/agent-os/pull/397`
- branch_from: `origin/implementer/sigil-context-menu-record-snapshot-extraction-v0`
- required_start_ref:
  `origin/implementer/sigil-context-menu-record-snapshot-extraction-v0` at `ec1503dbfa73d5bf1ae3bb0da495fb391733c3a7`
- expected output branch:
  `implementer/sigil-context-menu-record-snapshot-extraction-v0`

Update the existing PR head branch in place. Do not start from `origin/main`.
This is a correction to the accepted extraction, not a replacement of the
extraction direction.

## Source Artifact

Thermo-Nuclear Review for PR #397:

- Keep the extraction, but make the extracted boundary a pure projection seam.
- Collapse `createContextMenuSnapshotProjection(...)` to a required-argument
  pure `buildContextMenuSnapshot(menuState, compactSurface)` style helper.
- Keep `syncSnapshot()` inline in `menu.js`, where `menuState`, `anchor`, and
  `liveJs` are already lexical dependencies.
- Drop optional getter/DOM fallback defensiveness that guards states the sole
  caller cannot create.
- Add one direct deterministic projection test for the extracted helper.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Turn PR #397's context-menu snapshot extraction into a pure, directly tested
projection seam while preserving behavior and keeping
`apps/sigil/context-menu/menu.js` under 1,000 lines.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
gh pr view 397 --json number,title,state,headRefName,baseRefName,headRefOid,url
wc -l apps/sigil/context-menu/menu.js
rg -n "createContextMenuSnapshotProjection|buildContextMenuSnapshot|syncSnapshot|snapshot\\(|liveJs\\.contextMenu|menuState\\.snapshot|aria-hidden|data-state" apps/sigil/context-menu tests/renderer
```

## Required Behavior

- Keep the public/debug snapshot payload stable:
  - `open`;
  - cloned `bounds`;
  - `stack: null`;
  - active compact tab;
  - compact control records from the compact surface.
- Keep `window.liveJs.contextMenu`, `onBoundsChange`, and `onClose` snapshot
  behavior stable.
- Keep `menuState.snapshot` as the lightweight local summary with active tab and
  compact control count.
- Keep `anchor` attribute updates in `menu.js`:
  - `aria-hidden`;
  - `data-state`.
- Keep `apps/sigil/context-menu/menu.js` below 1,000 lines after the correction.

## Correction Shape

Suggested target shape after reading the code:

- `apps/sigil/context-menu/snapshot-projection.js` exports a pure helper such
  as `buildContextMenuSnapshot(menuState, compactSurface)`.
- The helper takes concrete required arguments. Do not keep a factory with
  optional `= {}` parameters, optional collaborator chaining, or
  `getMenuState`/`getCompactSurface` closures.
- `menu.js` keeps a small inline `snapshot()` wrapper if useful for the public
  menu API.
- `menu.js` keeps `syncSnapshot()` inline, mutating `menuState.snapshot`,
  setting anchor attributes, and publishing `liveJs.contextMenu`.
- Prefer direct invariants over silent fallback for collaborators that the sole
  caller always passes. Misuse should fail loudly enough to reveal the broken
  contract.

## Scope

Sigil context-menu JS and focused renderer tests only.

## Hard Boundaries / Non-Goals

- Do not reject or undo the extraction direction from PR #397.
- Do not redesign menu descriptors, compact controls, visual layout, input
  routing, compact-surface lifecycle, or product behavior.
- Do not change the compact control-record contract or add compatibility fields.
- Do not run live pointer scenarios for this correction.
- Do not delete unrelated untracked work-card or report files.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --check apps/sigil/context-menu/snapshot-projection.js
node --test tests/renderer/context-menu-snapshot-projection.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
wc -l apps/sigil/context-menu/menu.js
```

The final line count for `apps/sigil/context-menu/menu.js` must remain less
than 1,000.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- how the corrected boundary is now pure and required-argument based;
- what direct projection test was added;
- final `menu.js` line count;
- exact verification commands and results;
- whether PR #397 was updated on GitHub;
- any remaining local-only state;
- next smallest follow-up, or `none required` if this closes the review
  findings.
