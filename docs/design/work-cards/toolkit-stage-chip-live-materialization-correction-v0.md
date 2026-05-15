# Toolkit Stage Chip Live Materialization Correction V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions
- Related issues:
  - #122 StageAffordance / visual-hit binding
  - #123 warm/suspend/resume lifecycle primitives
  - #261 panel window placement
- Prior work cards:
  - `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
  - `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
  - `docs/design/work-cards/toolkit-stage-affordance-subscription-cleanup-correction-v0.md`
  - `docs/design/work-cards/toolkit-surface-resource-scope-v0.md`
  - `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Fix the live Surface Inspector minimize regression where the source panel
suspends but no chip materializes.

Operator ran the post-permission live smoke with repo mode ready and input tap
active. A real pointer click on Surface Inspector's minimize button succeeded in
suspending `surface-inspector`, but no `aos-desktop-world-stage` canvas, no stage
layer, no `input_region` registration/event evidence, and no `aos-chip-*`
fallback WebView appeared. Restore/close through chip hit regions were therefore
impossible, and Operator recovered by removing the hidden source panel via CLI.

This is a panel/toolkit contract failure: a minimize operation must not report
success or leave the source suspended unless a restore/close affordance has been
materialized through the stage path or the explicit WebView fallback.

## Operator Evidence

Surface Inspector naming/TTS smoke passed enough to unblock this work:

- `./aos ready` and `./aos ready --post-permission` reported
  `ready=true mode=repo daemon=reachable tap=active`.
- `packages/toolkit/components/surface-inspector/launch.sh` created
  `surface-inspector`.
- Legacy `surface-inspector` was absent.
- `./aos show wait --id surface-inspector --manifest surface-inspector --timeout 5s --json`
  passed.

Surface stack minimize smoke failed:

- real pointer click on Surface Inspector minimize button succeeded;
- `surface-inspector` changed to `lifecycleState=suspended`;
- no visual minimized chip appeared in the captured region;
- no `aos-desktop-world-stage` canvas appeared;
- no `aos-chip-*` fallback WebView appeared;
- no `input_region` registration/event evidence appeared for the chip path;
- restore/close through chip hit regions were blocked because no chip/hit region
  existed;
- final cleanup was clean after `./aos show remove-all`.

Daemon log tail from Foreman review showed Surface Inspector subscription
activity and source cleanup, but no create log for `aos-desktop-world-stage` or
`aos-chip-*` from `surface-inspector`.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-stage-backed-minimized-chips-v0.md`
- `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/input-region.js`
- `packages/toolkit/components/surface-inspector/index.html`
- `packages/toolkit/components/surface-inspector/launch.sh`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/stage-affordance.test.mjs`

## Rediscover State

```bash
git status --short --branch
gh issue view 304 --json number,title,state,url,body,labels
./aos ready
./aos dev recommend --json
rg -n "createMinimizeController|createStageChip|createStageAffordance|ensureDesktopWorldStage|fallback_webview|aos-desktop-world-stage|aos-chip|input_region|suspending_source" packages/toolkit tests docs
tail -n 240 ~/.config/aos/repo/daemon.log 2>/dev/null || true
```

The worktree is expected to be substantially dirty from the surface-stack
workstream. Do not revert unrelated changes.

## Current Code Shape To Inspect

- `createMinimizeController()` in `packages/toolkit/panel/chrome.js` creates
  stage chips by calling `createStageChip()` before `suspend(target)`.
- `createStageChip()` delegates to `createStageAffordance()`.
- `createStageAffordance.setup()` calls `ensureStage()`, sends a
  `desktop_world_stage.layer.upsert`, then registers input regions.
- `ensureDesktopWorldStage()` in `packages/toolkit/panel/drag-transfer.js`
  catches stage creation errors and returns `false` for unavailable stage paths.
- `createStageAffordance.setup()` currently does not appear to treat a falsey
  `ensureStage()` result as fatal.
- The fallback WebView path should create a suspended `aos-chip-*` canvas before
  source suspend, then resume the chip after source suspend.
- Focused unit tests prove the happy path by stubbing `ensureStage`,
  `sendStageMessage`, and region registration, but they did not catch the live
  failure where no materialized chip resource exists.

The bullets above are starting hypotheses, not a substitute for reading the
code and reproducing.

## Required Behavior

### Atomic Minimize Contract

After `minimize()` returns `success` and suspends the source panel, one of these
must be true and inspectable:

- stage path:
  - `aos-desktop-world-stage` exists or was already present;
  - a stage-layer upsert was delivered for the chip layer id;
  - restore, close, and body input regions were registered;
  - Surface Inspector can observe the stage layer/input regions when open;
- fallback path:
  - an `aos-chip-*` WebView canvas exists and is resumed/visible;
  - result mode is `fallback_webview`;
  - fallback use is observable in minimize controller state/logs.

If neither path can materialize, the source panel must remain active or be
resumed during rollback. Do not leave a suspended panel without a restore/close
affordance.

### Stage Setup Must Be Truthful

Do not silently treat stage setup as successful if the stage cannot be created
or confirmed.

If `ensureDesktopWorldStage()` returns `false` because the stage already exists,
that may still be acceptable only if the stage canvas actually exists or the
stage layer delivery can be considered reliable. If it returns `false` because
creation failed or because the stage state is unknown, the minimize controller
must fall back or fail before source suspend.

It is acceptable to make `ensureDesktopWorldStage()` return a richer status, or
to add a confirmation helper, if that keeps the contract clear.

### Fallback Must Be Real

If stage setup is unavailable:

- create the `aos-chip-*` fallback WebView before suspending the source;
- verify the create call returns successfully;
- suspend the source;
- resume the fallback chip;
- report `mode: "fallback_webview"` and retain enough state for diagnostics.

If fallback create or resume fails, roll back and keep/resume the source panel.

### Live Observability

Add enough debug state to diagnose the next failure without reading daemon logs.
Options include:

- richer `minimizeController.getState()` fields for `stageEnsureStatus`,
  `stageLayerUpsertSent`, `registeredRegionIds`, `fallbackChipCreated`, and
  last error;
- exposing panel window controller state from mounted panels in a narrow debug
  hook such as `window.__aosPanelWindowController` or an equivalent existing
  pattern;
- targeted console warnings that identify stage unavailable, region register
  failure, fallback create failure, fallback resume failure, and rollback.

Keep this focused. Do not build a new diagnostics UI.

### Tests

Add tests that would have failed under Operator's observation:

- stage path does not report success if `ensureStage()` returns false/unknown
  and no fallback is created;
- falsey `ensureStage()` triggers fallback before source suspend, or throws and
  leaves the source active, depending on the chosen contract;
- if fallback creation fails, source is not suspended or is resumed;
- if fallback resume fails after source suspend, rollback resumes the source and
  removes the failed chip;
- successful stage path records enough state to prove materialization;
- successful fallback path records enough state to prove materialization.

Preserve existing tests for restore/close input-region behavior, duplicate
minimize suppression, source removal cleanup, and WebView fallback.

## Scope

This is a toolkit panel/windowing correction. Primary ownership is:

- `packages/toolkit/panel/chrome.js`;
- `packages/toolkit/panel/stage-affordance.js`;
- `packages/toolkit/panel/drag-transfer.js` only if stage ensure semantics need
  to be made truthful;
- focused tests under `tests/toolkit/`.

Runtime helper changes are allowed only if needed to make the live
materialization contract testable. Swift daemon changes should not be necessary
unless inspection proves the JS helper is using the daemon API incorrectly.

## Hard Boundaries / Non-Goals

- Do not move minimize/windowing policy into daemon.
- Do not remove the stage-backed chip design.
- Do not make the fallback WebView the default if the stage path can be fixed.
- Do not start Sigil migration work.
- Do not rename Surface Inspector or surface-inspector compatibility contracts.
- Do not change macOS permission handling.
- Do not run real pointer smoke without explicit idle keyboard/mouse handoff.

## Suggested Implementation Areas

- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/stage-affordance.test.mjs`
- `docs/api/toolkit/panel-window.md` only if public minimize state/contract
  changes
- `docs/design/aos-surface-system.md` only if the surface-stack status changes

## Verification

Run deterministic checks first:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/runtime-resource-scope.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/toolkit/desktop-world-stage.test.mjs
```

If helper imports or panel public API changed, also run:

```bash
node --test tests/toolkit/panel-public-api.test.mjs
node --test tests/toolkit/*.test.mjs
```

If `./aos ready` passes and a non-real-pointer deterministic live probe is
practical, run a bounded smoke such as:

1. `./aos clean` if stale canvases exist;
2. launch Surface Inspector;
3. use `./aos show eval --id surface-inspector --js` to trigger the minimize
   button or panel controller;
4. inspect `./aos show list --json` for `aos-desktop-world-stage` or
   `aos-chip-*`;
5. inspect Surface Inspector/daemon state for input regions and stage layer
   registry;
6. restore or remove the source and confirm cleanup.

If this cannot be automated safely, state why and leave real pointer
verification for Operator.

Do not run a real mouse-input scenario unless the user or Operator explicitly
hands over idle keyboard/mouse control.

## Completion Report

Include:

- root cause found;
- files changed;
- exact materialization contract implemented;
- whether stage ensure now has truthful status;
- fallback behavior after stage setup failure;
- rollback behavior after fallback failure;
- tests run with exact pass/fail results;
- `./aos ready` status;
- deterministic live probe result if run;
- whether Operator still needs to rerun the minimize/restore/close live smoke.
