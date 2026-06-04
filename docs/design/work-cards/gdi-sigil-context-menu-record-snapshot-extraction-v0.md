# Sigil Context Menu Record Snapshot Extraction V0

## Recipient

GDI implementation round.

## Branch / Base

- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref:
  `gdi/post-refactor-real-input-dogfooding-corrections-v0` at `2bd2338`
- expected output branch:
  `gdi/sigil-context-menu-record-snapshot-extraction-v0`

Do not start this card from `origin/main`. The compact control-record
corrections are accepted on `gdi/post-refactor-real-input-dogfooding-corrections-v0`
at `2bd2338`.

## Source Artifact

- Foreman review input: `apps/sigil/context-menu/menu.js` crossed from 995 to
  1001 lines after adding `compactControlRecords()` and snapshot fields in
  `gdi/post-refactor-real-input-dogfooding-corrections-v0`.
- Accepted correction card:
  `docs/design/work-cards/gdi-compact-control-record-contract-review-correction-v0.md`
- Accepted id/ref correction card:
  `docs/design/work-cards/gdi-compact-control-record-id-ref-consistency-correction-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Extract the context-menu snapshot/record projection concern so
`apps/sigil/context-menu/menu.js` drops back below 1,000 lines without changing
context-menu behavior or compact control-record output.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
wc -l apps/sigil/context-menu/menu.js
rg -n "compactControlRecords|snapshot\\(|menuState\\.snapshot|onBoundsChange|contextMenu = snapshot|controlCount|records" apps/sigil/context-menu apps/sigil/avatar-editor tests/renderer
```

## Required Behavior

- Keep the public/debug snapshot behavior stable, including compact control
  record exposure through `window.liveJs.contextMenu` and the existing
  `onBoundsChange`/`onClose` payload shape.
- Extract only the smallest coherent snapshot/record projection helper or
  module. The likely concern is the code around `compactControlRecords()`,
  `snapshot()`, `menuState.snapshot`, and published context-menu debug state.
- Keep `apps/sigil/context-menu/menu.js` under 1,000 lines after extraction.
- Do not use this follow-up to redesign menu descriptors, compact controls,
  visual layout, or input handling.

## Scope

Sigil context-menu JS and focused renderer tests only.

## Hard Boundaries / Non-Goals

- Do not modify the accepted compact control-record contract while this card is
  extracting menu snapshot code.
- Do not add compatibility fields or alternate record namespaces.
- Do not move Sigil product behavior into toolkit.
- Do not run live pointer scenarios for this decomposition.

## Verification

Run:

```bash
git diff --check
node --check apps/sigil/context-menu/menu.js
node --test tests/renderer/context-menu-hit-test.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
wc -l apps/sigil/context-menu/menu.js
```

The final line count for `apps/sigil/context-menu/menu.js` must be less than
1,000.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- what was extracted and why that owner is coherent;
- final `menu.js` line count;
- exact verification commands and results;
- any remaining local-only state;
- next smallest follow-up if the extraction exposes one.
