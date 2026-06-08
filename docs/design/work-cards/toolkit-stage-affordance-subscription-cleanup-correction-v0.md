# Toolkit StageAffordance Subscription Cleanup Correction V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #122 Toolkit-owned DesktopWorld hit-region controller
- Corrects: `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- Related issue: #304 Toolkit minimized chips should use DesktopWorld stage
  layers and hit regions

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Correct StageAffordance subscription cleanup so an affordance cleanup cannot
drop shared `canvas_lifecycle` delivery for other code running in the same
canvas.

## Foreman Review Finding

`packages/toolkit/panel/stage-affordance.js` currently calls
`unsubscribeEvents(lifecycleEvents)` during `cleanup()` when it subscribed
during `setup()`.

That is unsafe with the current runtime/daemon subscription model:

- `packages/toolkit/runtime/subscribe.js` exposes set-style subscribe and
  unsubscribe calls, not reference-counted handles.
- `src/daemon/unified.swift` stores one event set per canvas and removes the
  event from that set on unsubscribe.
- `packages/toolkit/panel/chrome.js` already subscribes the same canvas to
  `['display_geometry', 'canvas_lifecycle']` for panel frame/lifecycle tracking.

Therefore, a minimized-chip StageAffordance cleanup can remove
`canvas_lifecycle` from the canvas event set even though panel chrome still
needs it.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- `packages/toolkit/runtime/subscribe.js`
- `packages/toolkit/panel/stage-affordance.js`
- `packages/toolkit/panel/chrome.js`
- `src/daemon/unified.swift`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
```

If `./aos ready` reports the known repo-mode TCC blocker, do not run live
pointer smoke. Use deterministic tests and report the blocker.

## Required Behavior

- Default StageAffordance cleanup must not call `unsubscribe(['canvas_lifecycle'])`
  in a way that can remove shared subscriptions owned by panel chrome or another
  toolkit helper.
- Keep source-removal cleanup working. It is acceptable for StageAffordance to
  ensure the lifecycle event is subscribed, but cleanup must respect that the
  subscription is canvas-wide and shared.
- If you add an explicit opt-in mode for exclusive subscription cleanup, it must
  default to the safe shared-subscription behavior and be documented.
- The bridge handler may continue using an inactive/active guard; do not attempt
  a broad bridge unregistration system in this correction.
- Preserve minimized-chip behavior and public API shape unless a small option is
  needed for the correction.

## Suggested Fix

Prefer the smallest safe correction:

- make StageAffordance default to retaining shared lifecycle subscriptions on
  cleanup;
- expose cleanup state that makes this explicit, such as
  `cleanupStatus.subscriptionRetained` or `cleanupStatus.unsubscribed === false`;
- update tests so the default path proves `unsubscribeEvents` is not called;
- optionally add an explicit `unsubscribeOnCleanup: true` or similar option only
  if there is a real exclusive-owner use case.

Do not implement the broader toolkit runtime resource-scope/ref-counting system
in this slice. That is a follow-up roadmap item.

## Verification

Run:

```bash
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/panel-public-api.test.mjs
git diff --check
```

If the fix touches runtime subscription helpers or broader toolkit behavior,
also run:

```bash
node --test tests/toolkit/*.test.mjs
```

## Completion Report

Include:

- files changed;
- exact subscription cleanup behavior after the correction;
- whether minimized chips still subscribe/receive source removal events;
- tests run with exact result;
- live smoke result or exact readiness blocker.

## Foreman Review Status

Accepted. The default StageAffordance cleanup path no longer calls
`unsubscribeEvents(['canvas_lifecycle'])`; it retains the shared canvas-wide
subscription and reports `cleanupStatus.subscriptionRetained`. Explicit
exclusive cleanup remains available through `unsubscribeOnCleanup: true`.

Focused and broad deterministic checks passed. Live smoke remains blocked by
repo-mode `daemon_tcc_grant_stale_or_missing`.
