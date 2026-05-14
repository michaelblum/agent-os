# Surface Inspector Native AX Candidate Adapter Correction V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Corrects the in-progress slice from:
  `docs/design/work-cards/surface-inspector-native-ax-candidate-adapter-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Work in `/Users/Michael/Code/agent-os`.
Do not revert the current native AX candidate adapter changes. Treat them as
the draft implementation to amend.

## Goal

Fix the native AX adapter integration gap found during Foreman review:

Surface Inspector now subscribes its canvas to `window_entered` and
`element_focused`, and `UnifiedDaemon.forwardSubscribedEventToCanvases` forwards
those events to subscribed canvases. However, canvas subscriptions currently do
not register a perception attention channel. With no other `aos see observe`
subscriber active, `perception.attention.channelCount` can remain `0`, so
`PerceptionEngine` does not emit depth-1/depth-2 cursor perception events for
the Surface Inspector to consume.

The fix must make an Annotation Mode canvas subscription to native perception
events sufficient to cause the needed current-cursor perception work. Do not
require a separate CLI observer process.

## Review Evidence

Foreman review commands:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
git diff --check
./aos status
```

The Node suites and diff check passed, but `./aos status` reported
`channels=0` while the draft relies on perception events gated by
`attention.hasSubscribers`.

Relevant code:

- `src/daemon/unified.swift`
  - `handleCanvasSubscription(...)`
  - `forwardSubscribedEventToCanvases(type:data:)`
  - `requestedInputEvents(...)`
  - connection cleanup around `perception.attention.removeChannels(...)`
- `src/perceive/daemon.swift`
  - `handleMouseEvent(...)`
  - `onCursorSettled()`
  - `checkWindowAndAppChange(at:)`
  - `queryAXElementAtCursor(_:)`
- `src/perceive/attention.swift`
- `packages/toolkit/components/canvas-inspector/index.js`
  - `syncInputSubscription(...)`

## Required Behavior

When a canvas subscribes to `window_entered`, `app_entered`,
`element_focused`, `cursor_moved`, or `cursor_settled`, the daemon should ensure
the perception attention envelope has a matching channel for that canvas while
the subscription is active.

Expected event-depth mapping:

- `window_entered` / `app_entered`: cursor scope, depth at least `1`, on-change
  or continuous enough that window hover feels responsive.
- `element_focused`: cursor scope, depth at least `2`; current behavior may wait
  for cursor settle, but it must not require a separate subscriber.
- `cursor_moved` / `cursor_settled`: preserve existing semantics if supported.

When the canvas unsubscribes, exits Annotation Mode, is removed, or its
connection is cleaned up, remove the daemon-owned perception channel(s) created
for that canvas.

Keep the original safety boundary:

- no broad AX tree harvesting;
- no browser DOM/CDP;
- no hover side effects;
- only current cursor/window/AX element perception.

## Suggested Implementation Shape

Add explicit bookkeeping in `UnifiedDaemon`, for example a
`canvasPerceptionChannels` map keyed by canvas id. `handleCanvasSubscription`
can compute whether the canvas subscription set needs depth-1 or depth-2 cursor
perception and reconcile a single channel per canvas. Removing a canvas
subscription should remove the associated attention channel when no remaining
canvas events require it.

Prefer deterministic tests or a small shell/assertion test that proves a canvas
subscription to `element_focused` registers a perception attention channel and
that unsubscribing removes it. If the existing Swift test harness has no direct
unit seam, add the narrowest runtime smoke or status-based check available.

Also tighten the Surface Inspector side if needed:

- avoid unnecessary repeated `subscribe(inputEvents, { snapshot: false })` calls
  when the active event set has not changed;
- keep `browser_dom_cdp_deferred` intact.

## Verification

Run:

```bash
node --test tests/toolkit/canvas-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/canvas-inspector-ax.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
./aos dev recommend --json
./aos dev build
bash tests/see-do-state-metadata.sh
git diff --check
```

If `./aos ready` is blocked by stale TCC grants after the Swift rebuild, do not
loop. Report the exact blocker. If ready passes, run the native AX bounded live
smoke from the original native AX work card.

## Completion Report

Report back with:

- changed files;
- how canvas subscriptions now drive perception attention;
- how cleanup/unsubscribe/removal avoids leaked attention channels;
- deterministic proof for the regression;
- verification commands and live smoke result or blocker.
