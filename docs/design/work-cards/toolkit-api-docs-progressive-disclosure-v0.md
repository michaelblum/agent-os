# Toolkit API Docs Progressive Disclosure V0

## Tracker

- Epic: #223 AOS Surface System
- Related: #261 panel/window placement, #122 StageAffordance / visual-hit
  binding, #305 Sigil remodel
- Follows:
  `docs/design/work-cards/toolkit-surface-interaction-decision-tree-v0.md` and
  `docs/design/work-cards/toolkit-panel-window-normalization-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Refactor `docs/api/toolkit.md` from a roughly 3,000-line omnibus into a
progressive-disclosure API map. Keep the existing contract content, but move it
to smaller boundary-focused files so future agents do not have to ingest the
entire toolkit universe to answer a panel, runtime, workbench, or component
question.

This is a docs-topology slice, not a product or runtime slice. Preserve meaning;
do not use this as an excuse to rewrite contracts.

## Read First

- `AGENTS.md`
- `docs/api/README.md`
- `docs/api/toolkit.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/CLAUDE.md`
- `tests/toolkit/surface-interaction-decision-tree-contract.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
wc -l docs/api/toolkit.md
rg -n "^#{1,3} " docs/api/toolkit.md
rg -n "docs/api/toolkit\\.md|api/toolkit\\.md|toolkit.md" README.md docs packages apps tests --glob '!docs/archive/**'
./aos dev recommend --json
```

`./aos ready` is not required for this slice unless the workflow router says a
live AOS check is needed. This is docs and deterministic tests only.

## Desired Shape

Keep `docs/api/toolkit.md`, but make it an overview/index with short boundary
guidance and links. It should not remain a full component manual.

Create smaller files under `docs/api/toolkit/`. Use these exact files unless
inspection reveals a clearly better split:

- `docs/api/toolkit/runtime.md` - runtime bridge, canvas lifecycle, resource
  scope, DesktopWorld surface runtime, input regions/events, subscriptions.
- `docs/api/toolkit/panel-window.md` - panel chrome, placement,
  `createPanelWindowController`, drag/resize/maximize/minimize,
  StageAffordance, split pane/tabs/single layout where it belongs.
- `docs/api/toolkit/workbench.md` - workbench contracts, subject model,
  human checkpoint, HTML/Markdown/work-record/artifact/playbook/wiki
  workbench contracts.
- `docs/api/toolkit/components.md` - stock components snapshot, Canvas
  Inspector, Surface-Zoom, Spatial Telemetry, Render Performance, Object
  Transform Panel, Test Console, Integration Hub, component launch surfaces.
- `docs/api/toolkit/content-host.md` - content contract, `ContentHost`,
  import/hosting model, styling boundary, minimal standalone template. If this
  would be too tiny after inspection, it may be folded into `runtime.md` or
  `workbench.md`, but explain the choice in the completion report.

Keep `docs/api/toolkit.md` under a practical size target, preferably under 400
lines. If the final index needs to be slightly longer, explain why and add
tests that prevent it from becoming an omnibus again.

## Mechanical Movement Rules

- Prefer moving existing sections wholesale over rewriting prose.
- Preserve important headings and anchors where practical; if a heading moves,
  leave a link from the index.
- Avoid touching archived docs unless a live test or live doc link requires it.
- Update live references in `README.md`, `docs/api/README.md`, toolkit
  `AGENTS.md`/`CLAUDE.md`, and tests when the new scoped file is the better
  target.
- Do not update every historical work card. Future cards can refer to the
  index, and archived references can stay historical.
- Keep the surface interaction decision tree canonical in
  `docs/recipes/aos-surface-interaction-decision-tree.md`; scoped API docs
  should link to it rather than duplicating the full tree.
- Keep active design/audit status in `docs/design/`, not in API reference.

## Required Content Checks

After the split, these concepts must remain discoverable from the index within
one click:

- `createResourceScope`;
- `createStageAffordance`;
- `createPanelWindowController`;
- `mountChrome`;
- DesktopWorld stage/surface runtime;
- input regions/events;
- workbench contracts;
- Surface Inspector and Surface-Zoom Inspector;
- content/host contract;
- styling boundary.

The new scoped files should make the preferred API home obvious:

- panel/window behavior goes to `panel-window.md`;
- runtime primitives go to `runtime.md`;
- workbench/subject contracts go to `workbench.md`;
- stock component surfaces go to `components.md`;
- content authoring/hosting guidance goes to `content-host.md` or the chosen
  equivalent.

## Required Tests

Add or extend a deterministic docs contract test. It should verify at least:

- `docs/api/toolkit.md` exists and is an index/overview, not the only toolkit
  API body;
- the scoped files exist;
- the index links to every scoped file;
- stable terms are present in the expected scoped files;
- the decision-tree recipe remains discoverable from the index and relevant
  panel/runtime docs;
- `docs/api/toolkit.md` stays below the agreed line-count guard.

Prefer a small Node test under `tests/toolkit/`, for example
`tests/toolkit/toolkit-api-docs-contract.test.mjs`. Avoid brittle long prose
matching.

Update `tests/toolkit/surface-interaction-decision-tree-contract.test.mjs` if
it currently assumes the old omnibus file is the only API home.

## Required Docs Updates

- `docs/api/README.md` should describe the new toolkit API map.
- `README.md` should still point newcomers at the toolkit API index.
- `packages/toolkit/CLAUDE.md` should point to the index and, if useful, the
  scoped panel/runtime docs.
- `packages/toolkit/AGENTS.md`, `packages/toolkit/runtime/AGENTS.md`, and
  `packages/toolkit/panel/AGENTS.md` should point at the scoped docs when that
  is more useful than the index.

## Hard Boundaries / Non-Goals

- no executable code changes;
- no runtime behavior changes;
- no API contract rewrites beyond moving content and adding short navigation;
- no broad archive churn;
- no GitHub issue mutation from this slice unless Foreman amends the card;
- no live pointer smoke.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/toolkit-api-docs-contract.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
```

Run any other docs contract tests you add or modify. If the workflow router
recommends additional checks for docs-only changes, include them in the
completion report.

## Completion Report

Include:

- files created, moved, and updated;
- final line count for `docs/api/toolkit.md`;
- the scoped-file map and what lives where;
- tests run with exact results;
- any old links intentionally left alone;
- any content that still feels misplaced and should become a follow-up slice.
