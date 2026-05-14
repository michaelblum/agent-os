# Operator Stage Chip Latency Live Smoke V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions
- Implementation card:
  `docs/design/work-cards/toolkit-stage-chip-minimize-latency-v0.md`
- Correction card:
  `docs/design/work-cards/toolkit-stage-chip-shared-readiness-and-fallback-cleanup-v0.md`

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume daemon, canvas,
permission, or prior verification state. Read and rediscover before observing.

## Goal

Live-smoke the Surface Inspector minimize path after the stage-chip latency
slice. Confirm whether prewarming the shared DesktopWorld stage moves cold stage
work off the real minimize click path and makes collapse feel prompt.

This is now a rerun after the shared-readiness correction. The previous latency
smoke failed because `aos-desktop-world-stage` existed before the click, but the
stage path used owner-gated `canvas.eval` for readiness and fell back with:

```text
stageEnsureStatus: ready_check_failed
error: FORBIDDEN: caller surface-inspector may not eval aos-desktop-world-stage
mode: fallback_webview
```

The correction changed shared stage readiness to use daemon-backed
`canvas.info`, while keeping arbitrary cross-canvas `canvas.eval` forbidden. It
also added fallback timeout cleanup for generated `aos-chip-*` canvases.

Foreman readiness before the first routing of this card recovered to:

```text
ready=true mode=repo daemon=reachable input_tap=active
```

## Read First

- `AGENTS.md`
- `docs/design/work-cards/toolkit-stage-chip-minimize-latency-v0.md`
- `docs/design/work-cards/toolkit-stage-chip-shared-readiness-and-fallback-cleanup-v0.md`
- `docs/design/work-cards/operator-surface-stack-minimize-live-smoke-v0.md`
- `docs/api/toolkit/panel-window.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos show list --json
```

If `./aos ready` reports `diagnosis=daemon_tcc_grant_stale_or_missing` or
`input_tap_not_active`, stop and report the blocker. Do not improvise a
permission repair loop.

## Setup

Start from a clean display state unless doing so would destroy evidence needed
for your report.

```bash
./aos show remove-all || true
packages/toolkit/components/canvas-inspector/launch.sh
./aos show wait --id surface-inspector --manifest canvas-inspector --timeout 5s
```

Before clicking minimize, check whether `aos-desktop-world-stage` has already
been created by panel chrome prewarm:

```bash
./aos show list --json
```

If the stage is not present immediately, wait briefly and check again. Report
how long it took from Surface Inspector launch to stage availability; that
startup cost is acceptable only if it is no longer paid during the minimize
click.

## Required Observations

- Real pointer minimize should collapse Surface Inspector into a visual
  stage-backed chip promptly.
- The default path should not create an interactive `aos-chip-*` WebView canvas.
- `aos-desktop-world-stage` should exist before or by the time minimize starts,
  not several seconds after the click.
- `stageEnsureStatus` should be successful through shared status/readiness, not
  `ready_check_failed`, and there should be no `FORBIDDEN ... may not eval
  aos-desktop-world-stage` failure.
- Minimize should create exactly one chip stage layer and three chip input
  regions: body, restore, close.
- Source suspension should occur only after stage layer and input regions exist.
- Restore through the chip region should resume `surface-inspector` and remove
  the chip layer plus all three input regions.
- Close through the chip region should remove `surface-inspector` and remove the
  chip layer plus all three input regions.
- Duplicate minimize should not create duplicate layers or duplicate regions.

## Timing Evidence

Collect at least one real-pointer timing trail. Useful sources include daemon
listener timestamps, show/list lifecycle timestamps if available, screenshots,
and controller state after restore.

After restoring the source panel, try to capture:

```bash
./aos show eval --id surface-inspector --js 'JSON.stringify(window.__aosPanelWindowController?.getState?.().minimize || null)'
```

Report:

- click/focus timestamp if available;
- stage availability time relative to launch and relative to click;
- region registration timestamps;
- source suspension timestamp;
- perceived click-to-collapse latency;
- `getState().timing` if available, especially `stageEnsureDurationMs`,
  `inputRegionRegistrationDurationMs`, `sourceSuspendDurationMs`, and
  `totalElapsedMs`.

## Pass/Fail Framing

Pass means the functional materialization behavior still works and the hot
minimize click no longer shows the previous roughly 5.3 second click-to-collapse
delay.

Partial pass means materialization still works but latency is still visibly
slow. In that case, include the timing fields so Foreman can route the next
slice to the right layer.

## Hard Boundaries / Non-Goals

- Do not implement fixes.
- Do not migrate Sigil.
- Do not rename Surface Inspector compatibility namespaces.
- Do not change daemon permissions except by reporting the documented blocker.

## Completion Report

Include:

- exact readiness result;
- whether `aos-desktop-world-stage` was prewarmed before minimize click;
- observed minimize, restore, close, duplicate-minimize, and cleanup results;
- whether any `aos-chip-*` WebView appeared in the default path;
- whether any stale `aos-chip-*` canvas remained after failed/duplicate
  minimize attempts;
- timing evidence and perceived latency;
- stale layers, input regions, subscriptions, or canvases, if any.
