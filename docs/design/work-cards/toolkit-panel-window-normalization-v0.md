# Toolkit Panel Window Normalization V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #261 Define panel window placement contract and migrate
  private drag paths
- Related issues: #122 StageAffordance / visual-hit binding, #120 input event
  identity, #123 warm/suspend/resume lifecycle, #303 daemon generic input
  regions, #305 Sigil remodel
- Follows:
  `docs/design/work-cards/toolkit-surface-interaction-decision-tree-v0.md`,
  `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`, and
  `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make #261 materially real: converge ordinary AOS panel/window behavior onto one
public toolkit policy path, then migrate or explicitly park the remaining
private drag/chrome paths that are still pulling in a different direction.

This should be wider than a tiny fix. Implementer is allowed to make a coherent
implementation slice across toolkit code, Sigil panel-like surfaces, tests, and
docs. Keep the shape bounded:

1. one canonical toolkit panel/window placement policy API or controller;
2. stock panel chrome using that policy path;
3. at least one real private drag/chrome migration, preferably more if the
   surfaces are straightforward;
4. deterministic tests proving the geometry and migration contract.

Do not build a daemon window manager. The daemon provides native frames,
display geometry, movement, lifecycle, and input routing. Toolkit owns the
default opt-in windowing policy.

## Read First

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/aos-surface-system.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/api/toolkit.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
- `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 261 --json number,title,state,url,body,labels,comments
gh issue view 223 --json number,title,state,url,body,labels
```

If `./aos ready` reports the known repo-mode TCC blocker, do not run live
pointer smoke. This slice can proceed with deterministic implementation tests.

## Existing Code And Docs To Inspect

- `packages/toolkit/panel/chrome.js` - stock chrome, drag, resize, maximize,
  minimize/restore, and current controller exports.
- `packages/toolkit/panel/placement.js` - display ownership, work-area, clamp,
  chip-frame, and restore helpers.
- `packages/toolkit/panel/drag-transfer.js` - cross-display transfer outline.
- `packages/toolkit/panel/stage-affordance.js` - passive chip hit-area binding.
- `packages/toolkit/runtime/resource-scope.js` - cleanup/ownership model.
- `packages/toolkit/panel/index.js` - public panel API exports.
- `tests/toolkit/panel-chrome.test.mjs` - current geometry/controller coverage.
- `tests/toolkit/panel-drag-transfer.test.mjs` - transfer visual coverage.
- `tests/toolkit/panel-public-api.test.mjs` - public export coverage.
- `apps/sigil/codex-terminal/index.html` - should already use
  `mountChrome`; verify and keep as precedent.
- `apps/sigil/chat/index.html` - legacy private titlebar/drag path.
- `apps/sigil/radial-item-editor/index.js` - private raw
  `drag_start` / `move_abs` / `drag_end` path.
- `apps/sigil/radial-item-workbench/index.js` - uses toolkit `wireDrag` and
  `wireResize`, but still has a custom shell around the panel policy.
- `src/display/canvas.swift` - daemon native movement and drag-end
  finalization. Inspect for boundary clarity, but avoid daemon changes unless
  a tiny comment or test fixture is necessary.

## Required Toolkit Outcome

Inspection should decide the exact name and shape, but the end state must make
one public toolkit policy path obvious. Options include:

- introducing `createPanelWindowController()` or a similarly named controller;
- promoting an existing composition of `placement.js`, `createDragController`,
  `createResizeController`, `createMaximizeController`, and
  `createMinimizeController` into the documented public policy path;
- keeping existing controller exports as compatibility wrappers while routing
  stock chrome through the canonical path.

The canonical path must cover:

- native global CG frame coordinates for panel frames;
- display ownership and work-area selection;
- final drag placement using release/cursor display when available;
- clamp-to-visible-work-area policy;
- maximize/restore using the same work-area helper;
- resize using the same work-area helper;
- minimize chip frame and restore frame using the same placement helpers;
- cross-display transfer outline staying toolkit-owned and DesktopWorld-backed;
- inspector-friendly state where practical, without adding a full Inspector UI.

If the current code already satisfies a sub-point, preserve it and add the
missing contract/test instead of rewriting it.

## Required Migration Outcome

Migrate or explicitly park current private paths. Minimum acceptable outcome:

- `apps/sigil/radial-item-editor/index.js` no longer hand-emits raw
  `drag_start` / `move_abs` / `drag_end`; it uses toolkit panel drag/window
  policy for window movement while preserving its 3D object/orbit drag.
- `apps/sigil/codex-terminal/index.html` is verified as a shared
  `mountChrome` client and documented/tested as the precedent, not changed
  gratuitously.
- `apps/sigil/chat/index.html` is either migrated to the shared panel/window
  path or marked parked/legacy with a clear reason in docs and tests so future
  agents do not copy it as a live pattern.

If practical without making the slice mushy:

- normalize `apps/sigil/radial-item-workbench/index.js` further around the
  canonical policy path while preserving its current layout and Three.js
  preview behavior;
- add a small reusable adapter for app-owned non-panel content that only needs
  stock window movement, maximize, resize, minimize, and close controls.

Do not migrate Sigil `avatar-main`, radial activation visuals, daemon
Sigil-specific input, or the broader Sigil platform model in this slice. Sigil
is the second client later; this slice only cleans up panel-shaped surfaces.

## Required Tests

Add or extend deterministic tests so the contract is hard to regress. Cover as
many of these as practical in one coherent pass:

- side-by-side displays;
- vertically stacked displays;
- mixed-origin or mixed-DPI-style geometry fixtures;
- off-left, off-right, and off-bottom drag release clamping;
- release/cursor display winning over top-left inference during drag end;
- maximize work-area clamping;
- resize work-area clamping;
- minimize chip placement and restore across displays;
- public export coverage for the canonical policy API;
- migration guardrails proving migrated Sigil surfaces no longer emit raw
  private drag messages.

Prefer existing Node test patterns under `tests/toolkit/`. Avoid brittle DOM
snapshot tests.

## Required Docs

Update the source-of-truth docs after the code lands:

- `docs/api/toolkit.md` - public API and intended use.
- `docs/design/aos-panel-window-placement-contract.md` - current status,
  migrated/private paths, and remaining #261 gaps.
- `docs/recipes/aos-surface-interaction-decision-tree.md` - update the first
  audit if statuses changed.
- `apps/sigil/AGENTS.md` or nearby Sigil docs - only if migration or parking
  changes the guidance for future Sigil panel-like surfaces.

Keep docs direct and provider-neutral. Do not paste a second full decision tree
where a link to the recipe is enough.

## Hard Boundaries / Non-Goals

- no daemon window manager;
- no daemon behavior changes unless inspection reveals a tiny boundary comment
  or fixture-only adjustment is needed;
- no Sigil `avatar-main` migration;
- no broad Sigil platform remodel;
- no lifecycle warming implementation;
- no Surface Inspector UI implementation;
- no removal of the explicit WebView minimized-chip fallback unless all tests
  and docs show it is truly safe;
- no live pointer smoke while repo-mode TCC is blocked;
- no GitHub issue mutation from this slice unless Foreman amends the card.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
node --test tests/toolkit/panel-public-api.test.mjs
```

Run any new or modified tests directly. If the changes touch shared runtime,
stage affordance, or app-source contract tests, also run the relevant focused
test files.

If executable toolkit code changes broadly, run:

```bash
node --test tests/toolkit/*.test.mjs
```

If Swift sources change, stop and justify why this docs/toolkit/app slice needed
daemon code, then run the workflow-router-recommended build/test path.

## Completion Report

Include:

- files changed;
- name and location of the canonical panel/window policy API;
- which private paths were migrated, verified as already migrated, parked, or
  deferred;
- behavior preserved for 3D object/orbit drag versus window drag;
- tests run with exact results;
- live smoke result or exact readiness blocker;
- remaining #261 gaps;
- recommended next slice: Surface Inspector surface-resource visibility,
  input-event identity contract (#120), lifecycle warming (#123), daemon
  Sigil-specific cleanup (#303), or Sigil as second StageAffordance client
  (#305).
