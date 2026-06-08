# Toolkit Stage Chip Minimize Latency V0

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
  - `docs/design/work-cards/toolkit-stage-chip-live-materialization-correction-v0.md`
  - `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, runtime readiness, or prior implementation state. Read and
rediscover before editing.

## Goal

Make the default Surface Inspector minimize path feel prompt while preserving
the corrected materialization ordering.

Operator's real-pointer rerun was a functional partial pass: minimize created
`aos-desktop-world-stage`, upserted one chip stage layer, registered body,
restore, and close input regions, suspended the source only after those
resources existed, restored/closed cleanly through input regions, did not create
an `aos-chip-*` WebView in the default path, and did not duplicate resources on
double-click.

But it was not prompt. Operator's listener timestamps showed roughly:

- real click/focus: `1778560610.318`
- stage canvas creation: `1778560613.426`
- input region registration: `1778560615.578` through `1778560615.609`
- source suspension: `1778560615.640`

That is about 5.3 seconds from click to collapse. This slice should reduce the
interactive minimize latency and make the remaining timing visible.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/aos-surface-system.md`
- `docs/recipes/aos-surface-interaction-decision-tree.md`
- `docs/design/work-cards/toolkit-stage-chip-live-materialization-correction-v0.md`
- `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/runtime/canvas-lifecycle.js`
- `packages/toolkit/components/desktop-world-stage/index.js`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/stage-affordance.test.mjs`
- `tests/toolkit/panel-drag-transfer.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
rg -n "createMinimizeController|createStageChip|createStageAffordance|ensureDesktopWorldStage|waitForCanvasReady|warmCanvas|aos-desktop-world-stage|desktop-world-stage" packages/toolkit tests docs
tail -n 260 ~/.config/aos/repo/daemon.log 2>/dev/null || true
```

The worktree is expected to be substantially dirty from the surface-stack
workstream. Do not revert unrelated changes.

If `./aos ready` reports `input_tap_not_active` or a TCC blocker, continue with
deterministic code/tests and skip real-pointer live smoke. Do not improvise a
permission loop.

## Starting Hypotheses

Treat these as hypotheses to verify, not conclusions:

- The cold `aos-desktop-world-stage` create is still in the click-to-collapse
  critical path.
- `ensureDesktopWorldStage()` waits for the stage manifest before allowing layer
  delivery, which is correct for materialization, but too expensive to start on
  the minimize click.
- The stage canvas should behave like the platform's shared DesktopWorld stage:
  a reusable singleton that panel/window chrome can warm before the first
  minimize interaction.
- The region registration gap after stage create may be mostly stage readiness
  polling, but the controller does not expose enough phase timing to confirm.

## Required Behavior

### Keep The Atomic Contract

Do not regress the correction from the previous slice. After `minimize()`
returns success and suspends the source panel, one of these must still be true:

- stage path:
  - `aos-desktop-world-stage` exists or was already present;
  - the chip stage layer upsert was delivered;
  - body, restore, and close input regions were registered;
- fallback path:
  - an `aos-chip-*` WebView was created and resumed;
  - controller state reports `mode: "fallback_webview"`.

If neither path materializes, the source panel must remain active or be resumed
during rollback.

### Move Cold Stage Work Off The Click Path

Default stage-backed panel chrome should begin ensuring or warming the shared
DesktopWorld stage before the first minimize click when practical. Suitable
places include `mountChrome()` / `createPanelWindowController()` initialization,
or a narrowly scoped helper called from that path.

The click path may await an existing in-flight stage readiness promise, but it
should not normally be the first code path to create and wait for the
DesktopWorld stage.

If the stage is unavailable, keep the explicit fallback/rollback behavior from
the materialization correction.

### Add Useful Timing State

Add small, inspector-friendly timing diagnostics to the minimize controller
state. At minimum, expose enough timestamps or durations to distinguish:

- minimize handler start;
- stage ensure start/end and status;
- stage layer upsert sent;
- input region registration start/end and count;
- source suspend start/end;
- fallback create/resume start/end when used;
- total elapsed time.

Use monotonic browser timing when available. Keep the state compact and avoid
building a new UI.

### Latency Target

For V0, optimize for the hot/default path where the DesktopWorld stage has been
prewarmed by panel chrome:

- materialized stage chip resources should be ready before source suspend;
- source suspension should start within a sub-second budget after the minimize
  handler begins, unless the controller explicitly reports a fallback or
  unavailable-stage reason;
- the 4-5 second cold collapse observed by Operator should not remain the normal
  default path.

Do not fake promptness by suspending the source before the restore/close
affordance exists.

## Tests

Add or update focused tests that would catch latency regressions without relying
on wall-clock sleeps:

- default panel/window chrome starts a shared stage ensure/warm operation before
  minimize is clicked;
- `minimize()` reuses the prewarm/in-flight stage ensure instead of starting a
  separate cold ensure;
- hot stage path records timing state and still registers all three input
  regions before source suspend;
- slow or failed stage ensure falls back before source suspend, preserving the
  previous rollback tests;
- existing duplicate-minimize, restore, close, source-removal cleanup, and
  fallback tests still pass.

If you add a helper such as `prewarmDesktopWorldStage()` or extend
`ensureDesktopWorldStage()`, cover promise reuse and failure retry semantics.

## Verification

Minimum:

```bash
git diff --check
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-drag-transfer.test.mjs
node --test tests/toolkit/runtime-canvas.test.mjs
```

If relevant files or routing rules indicate broader checks, use
`./aos dev recommend --json` to choose them.

If `./aos ready` is clean, run a bounded non-real-pointer probe that confirms
the stage is already present or warming before minimize. Do not run real pointer
smoke unless the work card explicitly hands off to Operator or the human has
made input ownership available for that purpose.

## Hard Boundaries / Non-Goals

- Do not move minimize/windowing policy into daemon.
- Do not remove the stage-backed chip design.
- Do not make the daemon own a mandatory window manager.
- Do not hide latency by suspending the source before a stage chip or fallback
  chip exists.
- Do not migrate Sigil in this slice.
- Do not rename Surface Inspector or surface-inspector compatibility namespaces.

## Completion Report

Include:

- root cause or confirmed timing breakdown;
- code paths changed;
- before/after latency expectation for cold and hot paths;
- timing fields added to controller state;
- tests and command results;
- whether live pointer smoke was run or why it was skipped.
