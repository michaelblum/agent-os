# Work Card: Sigil Status Item WindowServer Watchdog

## Tracker

Workstream branch: `codex/sigil-idle-render-fix`

Related prior cards on this branch:

- `docs/design/work-cards/sigil-render-performance-regression-v0.md`
- `docs/design/work-cards/sigil-status-item-summon-latency-v0.md`
- `docs/design/work-cards/sigil-radial-reticle-drift-repair-v0.md`

Fresh crash evidence captured by Foreman:

- `/tmp/aos-windowserver-crash-2026-05-14-0308/WindowServer-2026-05-14-030755.ips`
- `/tmp/aos-windowserver-crash-2026-05-14-0308/WindowServer_2026-05-14-030801_LM-170585.userspace_watchdog_timeout.spin`

Foreman stopped the repo daemon after preserving evidence:

```bash
./aos service stop --mode repo
```

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## User Report

The user clicked the AOS menu bar status icon and the computer crashed to a
WindowServer Problem Report window.

Crash evidence summary:

- Date/time: `2026-05-14 03:07:55 -0400`
- OS: `macOS 26.4.1 (25E253)`
- Process: `WindowServer`
- Termination namespace: `WATCHDOG`
- Termination indicator: `monitoring timed out for service`
- Watchdog detail says WindowServer failed to answer watchdog pings for about
  40 seconds.
- The stackshot includes an `aos` process at PID `82575`, running build commit
  `9bc8c6e Sync status item state from canvas` before Foreman rebased the branch
  onto current `main`; after rebase, that commit is `7193369`.
- The captured `aos` process main thread is in AppKit/HIToolbox/QuartzCore
  event/update paths, with `com.apple.NSEventThread`, `WebCore: Scrolling`, and
  logging threads also present.
- After WindowServer restarted, launchd/service brought AOS back up; Foreman
  then stopped repo mode to avoid another status-icon click before mitigation.

## Goal

Make the Sigil/AOS status item left-click path safe enough that a status-icon
click cannot synchronously drive heavy canvas/window lifecycle work in a way
that can wedge WindowServer.

This is a crash-risk mitigation first. Preserve behavior where possible, but
prefer a conservative status-item path over latency optimizations if there is a
tradeoff.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- This work card
- The three related Sigil work cards listed above

## Rediscover State

Start from the repo root:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
./aos dev recommend --json
./aos service status --mode repo
```

The daemon is expected to be stopped at handoff time. Do not start it just to
reproduce the crash before you have inspected and mitigated the status-item
path.

## Existing Code To Inspect

- `src/display/status-item.swift` - owns `NSStatusItem`, click handling,
  persistent tracked canvas toggles, fallback suspend/resume, context menu,
  and icon updates.
- `src/commands/serve.swift` - wires status item state callbacks onto the main
  thread.
- `src/daemon/unified.swift` - owns status-item visible-state propagation from
  canvas messages.
- `apps/sigil/renderer/live-modules/main.js` - receives status-item toggle
  messages and reports visible state.
- `apps/sigil/renderer/live-modules/render-loop.js` - recent idle render-loop
  changes that affect status-item latency and renderer readiness.
- `tests/sigil-status-item-lifecycle.sh` - existing status-item lifecycle
  shell coverage.
- `tests/renderer/sigil-render-loop.test.mjs` - deterministic coverage for the
  render-loop changes on this branch.

## Required Behavior

- A left-click on the status item for a persistent tracked canvas must not do
  heavyweight lifecycle work directly inside the status-item action callback.
- Persistent tracked status-item toggles should prefer an asynchronous renderer
  intent path over daemon-side suspend/resume fallback behavior.
- If the persistent canvas is missing, recreate it through the existing warm
  canvas path, but avoid immediately chaining multiple synchronous canvas/window
  operations inside the same click action.
- `persistentVisible` and the icon state must remain eventually consistent with
  renderer-reported visible state.
- Context menu behavior should remain available, but do not broaden this slice
  into menu feature work.
- Add targeted diagnostic logging around status-item click entry, deferred
  action execution, persistent show/hide intent, fallback paths, and missing
  canvas recovery so a future watchdog can be correlated without relying only
  on macOS stackshots.

## Suggested Implementation Areas

These are suggestions, not a fixed design:

- In `StatusItemManager.handleClick`, capture event type/modifiers and origin,
  then defer persistent tracked left-click work with `DispatchQueue.main.async`
  so the AppKit status-item action can return before canvas work begins.
- For `usesPersistentCanvas`, remove or narrow the no-state-source
  `resumeCanvas()` / `suspendCanvas()` fallback from `showPersistentCanvas()` and
  `hidePersistentCanvas()`. The status item should post a renderer intent and
  let renderer state sync correct the icon.
- Cache the filled/unfilled `NSImage` icons instead of redrawing a fresh image on
  every `updateIcon()` if inspection suggests repeated status-item image
  replacement is part of the risk.
- Keep daemon-native capability in `src/display/status-item.swift`; do not move
  Sigil-specific product behavior into the daemon.

## Hard Boundaries

- Do not reopen or repeatedly click the live status item before mitigation.
- Do not continue unrelated Sigil UI polish, annotation reticle work, branch
  cleanup, or PR publication.
- Do not move broad Sigil behavior into daemon primitives.
- Do not delete or rewrite the captured crash artifacts under `/tmp`.
- Do not ask the user to reset macOS Accessibility/Input Monitoring for this
  issue unless `./aos ready` later reports a concrete TCC blocker.

## Verification

Run the workflow router first. If Swift files changed, use the repo build
surface:

```bash
./aos dev recommend --json
./aos dev build
```

Run focused deterministic checks:

```bash
node --test tests/renderer/sigil-render-loop.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/renderer/radial-menu-target-surface.test.mjs
git diff --check
```

If `./aos ready` passes after the mitigation and build, run exactly one bounded
live smoke:

```bash
./aos ready
./aos show list --json
```

Then perform one status-item left-click smoke only after mitigation. Prefer a
supervised/manual click with the user as sensor if the WindowServer crash risk
still feels non-trivial. Record whether the click shows/hides Sigil, whether the
daemon remains reachable, and whether a new WindowServer report appears.

If live readiness is blocked, report the exact blocker and keep the deterministic
evidence separate from the skipped live proof.

## Completion Report

Report back to Foreman with:

- changed files;
- status-item behavior changed;
- which crash hypothesis the change mitigates;
- exact test/build commands and results;
- whether repo daemon was restarted or left stopped;
- live smoke result, or exact reason live smoke was skipped;
- any remaining risk or follow-up slice.
