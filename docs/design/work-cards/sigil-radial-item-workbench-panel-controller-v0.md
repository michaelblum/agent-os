# Sigil Radial Item Workbench Panel Controller V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issues: #261 panel/window placement, #305 Sigil first-class surface
  consumer
- Closed V0 baselines this slice should consume: #304, #122, #120, #123
- Related docs:
  - `docs/design/aos-surface-stack-v0-integration-ledger.md`
  - `docs/design/aos-canon-surface-boundary-alignment-plan.md`
  - `docs/design/aos-panel-window-placement-contract.md`
  - `docs/recipes/aos-surface-interaction-decision-tree.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing. The worktree is expected to be substantially dirty
from the surface-stack workstream; do not revert unrelated changes.

## Goal

Migrate `apps/sigil/radial-item-workbench/` from its private panel/window
chrome behavior onto the public toolkit `createPanelWindowController()`.

This is the next bounded #305 second-client slice: Sigil should consume the
accepted toolkit surface primitives instead of carrying a private minimized-chip
WebView path or one-off drag/maximize wiring. Keep Sigil's 3D radial item
preview and object/orbit manipulation app-owned.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/aos-surface-stack-v0-integration-ledger.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/design/work-cards/toolkit-panel-window-normalization-v0.md`
- `apps/sigil/radial-item-editor/index.js`
- `apps/sigil/radial-item-workbench/index.js`
- `apps/sigil/radial-item-workbench/index.html`
- `tests/renderer/sigil-panel-window-migration.test.mjs`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/index.js`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "createPanelWindowController|createMaximizeController|wireDrag|wireResize|minimized-chip|aos-chip|spawnChild|suspendCanvas|removeSelf|radial-item-workbench" apps/sigil packages/toolkit tests docs
```

If `./aos ready` reports only `input_tap_not_active`, do not ask the human for
a macOS permission reset. Continue with deterministic renderer/toolkit tests
and report the runtime blocker. Run live pointer smoke only if readiness is
clean and the card's deterministic coverage passes.

## Current Problem

`apps/sigil/radial-item-workbench/index.js` still carries panel/window policy
that belongs in toolkit:

- imports and wires `createMaximizeController`, `wireDrag`, and `wireResize`
  directly;
- creates an `aos-chip-*` WebView by hand through
  `/${toolkitRoot}/panel/minimized-chip.html`;
- calls `spawnChild()` and `suspendCanvas()` as a private minimize path;
- keeps close/maximize/minimize click handlers outside the public controller.

The radial item editor was already migrated to
`createPanelWindowController().wireDrag(...)`; use it as the local precedent,
but migrate the workbench more fully because it has minimize/maximize/close
controls.

## Required Behavior

### Public Controller Ownership

Use `createPanelWindowController()` from `/${toolkitRoot}/panel/index.js` as
the workbench's single public panel/window policy object.

The controller should own:

- titlebar drag and cross-display transfer behavior;
- maximize/restore behavior;
- minimize behavior, including the stage-backed chip default and WebView
  fallback only through toolkit internals;
- close behavior through the existing self-remove semantics;
- controller state exposure for debug/tests if useful.

Preserve existing workbench UI controls and labels unless a small wiring change
is required. The buttons in `index.html` can remain custom markup for this
slice; the behavior should route through the public controller.

### Remove Private Minimized-Chip Path

Remove the private `chipFrame()` / `minimizeWorkbench()` path that constructs
`aos-chip-*` ids and opens `panel/minimized-chip.html` directly.

After this slice, `apps/sigil/radial-item-workbench/index.js` should not:

- refer to `panel/minimized-chip.html`;
- construct `aos-chip-*` ids;
- call `spawnChild()` or `suspendCanvas()` only to minimize itself;
- recreate toolkit fallback policy in app code.

The app may still use generic bridge helpers for non-windowing messages if they
are unrelated to panel/window behavior.

### Preserve Product Interaction

Do not change Sigil's radial item model, 3D preview, object transform behavior,
split panes, history, lock-in payloads, or renderer orbit drag. The Three.js
object/orbit pointer handling remains app-owned product behavior, just like the
radial item editor.

### Docs And Tests

Update `tests/renderer/sigil-panel-window-migration.test.mjs` so it covers the
workbench as well as the editor. The test should prove the workbench:

- imports `createPanelWindowController`;
- creates a `panelWindowController`;
- routes titlebar drag through `panelWindowController.wireDrag(...)`;
- does not directly reference `panel/minimized-chip.html` or create
  `aos-chip-*` ids;
- does not use private `spawnChild()` / `suspendCanvas()` for minimize;
- preserves separate 3D orbit dragging.

Update docs/AGENTS only where active guidance currently names the workbench as
a remaining private panel/window path.

## Verification

Minimum:

```bash
git diff --check
node --check apps/sigil/radial-item-workbench/index.js
node --test tests/renderer/sigil-panel-window-migration.test.mjs
node --test tests/renderer/radial-item-editor.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
```

If the change affects shared toolkit imports or panel behavior more broadly,
also run:

```bash
node --test tests/toolkit/panel-public-api.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
```

If readiness is clean and GDI can safely launch the workbench without touching
real mouse ownership, run a bounded `./aos show create` / `show eval` probe to
confirm the controller state exists. Do not run real pointer smoke unless
explicitly routed to Operator or the human has made input ownership available.

## Hard Boundaries / Non-Goals

- Do not remodel `avatar-main`.
- Do not migrate Sigil radial graphics to shared DesktopWorld stage layers in
  this slice.
- Do not remove WebView fallback from toolkit panel chrome.
- Do not alter daemon primitives.
- Do not revive or evolve legacy `apps/sigil/chat/`.
- Do not redesign the workbench UI.

## Completion Report

Include:

- files changed;
- private panel/window paths removed from the workbench;
- how the workbench now uses `createPanelWindowController`;
- confirmation that 3D orbit/object behavior stayed app-owned;
- tests run and results;
- readiness result and any live-smoke blocker;
- recommended next #261/#305 slice.
