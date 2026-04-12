# Spec: Avatar-Streamline PoC — Daemon→Canvas Cursor Push

**Session:** avatar-streamline
**Date:** 2026-04-11
**Status:** Approved
**Parent brief:** handoff from `avatar-config` session
**Scratchpad:** `memory/scratchpad/avatar-sub-elimination.md`

## Problem

`avatar-sub` is a standalone Swift binary that subscribes to daemon events, runs a state machine, and sends scene position updates to the avatar renderer canvas. It is the last piece of Sigil that lives outside the daemon. This creates three recurring problems:

1. **Cylance AV kills it on every recompile.** Whitelisting is by hash, not path. The daemon is whitelisted and works.
2. **`file://` vs content server drift.** avatar-sub loads `renderer/index.html` via `file://`, which forces a bundled single-file renderer. The ES module version served by the content server drifts out of sync (exposed concretely during the #19 avatar-config work).
3. **Single binary, single pattern.** Every future overlay tool (desktop inspect, highlight, radial menu) would benefit from the same "JS reacts to system events and controls what appears on screen" pattern that avatar-sub implements in Swift.

The target architecture eliminates `avatar-sub` entirely. Its role splits between:
- **Daemon-side** — generic event forwarding and canvas-property mutation primitives
- **JS-side** — state machine, choreography, and rendering in the content-served renderer

Before committing to that migration, one unknown must be resolved: **can the daemon push cursor events to a canvas fast enough and smoothly enough to drive JS-based cursor following?** This spec defines the proof-of-concept that answers that question.

## Goal

Build the smallest possible vertical slice that proves daemon→canvas cursor event push is viable as a replacement for avatar-sub's Swift-side event loop.

**Success means:** a transparent full-display canvas renders a dot that tracks the cursor with no perceptible lag, driven entirely by daemon-pushed events.

**Failure means:** cursor tracking is janky or latent in a way that would degrade the avatar experience. In that case the larger plan needs redesign (different transport, higher broadcast rate, etc.) before any Swift code is ported to JS.

## Non-goals

- Porting `avatar-sub`'s state machine
- Hit-area canvas
- Expand-on-mousedown pattern for drag capture
- Multi-event stream (display geometry, AX elements)
- Canvas mutation API callable from JS
- Three.js rendering
- Any behavior parity with current avatar

All of the above depend on the PoC succeeding. They are the next iteration.

## Architecture

### Current state (for reference)

```
User moves mouse
  → Daemon receives NSEvent
  → Daemon broadcasts input_event over Unix socket (NDJSON)
  → avatar-sub (Swift) reads socket subscriber stream
  → avatar-sub state machine computes target scene position
  → avatar-sub → daemon "eval" action → headsup.receive(scene_position) on renderer canvas
  → Three.js repositions avatar
```

### PoC state

```
User moves mouse
  → Daemon receives NSEvent (unchanged)
  → Daemon broadcasts input_event over Unix socket (unchanged)
  → [NEW] Daemon also evals headsup.receive(input_event) on each canvas
          that has subscribed to input_event
  → Canvas JS updates stored cursor position
  → requestAnimationFrame redraws dot at cursor position
```

The PoC is a direct daemon-to-canvas path. No intermediate binary.

## Daemon changes

All changes in `src/daemon/unified.swift`.

### 1. Canvas subscription table

Add a map tracking which canvases want which event types:

```swift
// Keyed by canvas ID. Values are sets of event-type strings.
var canvasEventSubscriptions: [String: Set<String>] = [:]
let canvasSubscriptionLock = NSLock()
```

### 2. Subscription handler

Canvases already post messages to the daemon via `window.webkit.messageHandlers.headsup.postMessage({ type: '<name>', payload: ... })`. These arrive in the daemon via `canvasManager.onEvent(canvasID, payload)` and are currently broadcast as `canvas_message` events.

Intercept two message types in that callback before the broadcast:

```json
{ "type": "subscribe",   "payload": { "events": ["input_event"] } }
{ "type": "unsubscribe", "payload": { "events": ["input_event"] } }
```

When seen, update `canvasEventSubscriptions` and return without broadcasting. Unknown event names in the array are silently ignored (forward-compatible).

### 3. Forwarding in the broadcast path

For the PoC, only `broadcastInputEvent` needs forwarding — that is the path for cursor movements. After the existing Unix-socket fan-out in that function, iterate `canvasEventSubscriptions`, find canvases that subscribed to `"input_event"`, and eval `headsup.receive(<base64>)` on each via the same mechanism used today for `scene_position` pushes.

Encoding matches the existing `headsup.receive` contract: base64-encoded JSON, decoded and dispatched in the canvas. The JSON envelope sent to the canvas contains the daemon's input-event data directly (for mouse events: `type` like `"mouse_moved"` plus `x`/`y` coordinates — see `src/perceive/daemon.swift:140` `inputEventPayload`).

`broadcastEvent` (non-input events like `canvas_lifecycle`, `channel_post`) is untouched in the PoC. Generalizing forwarding to the other path is a follow-on once this one is proven.

### 4. Cleanup on canvas close

When a canvas is removed (existing `canvas_lifecycle` remove path), drop its row from the subscription table.

**Estimated scope:** 60–100 lines including the table, lock, subscribe/unsubscribe handler, forwarding iteration, and cleanup.

## JS test page

New file: `apps/sigil/test-cursor/index.html`

Single self-contained HTML page. No ES module imports (keeps the PoC independent of the renderer's module structure). Contents:

- Full-viewport `<canvas>` element, CSS-sized to fill the document
- `window.headsup.receive(b64)` handler that decodes the payload and, when the inner event is `mouse_moved` (or any mouse event with `x`/`y`), stores `{ x, y }` in a module-level variable
- On load, sends a subscribe message via `window.webkit.messageHandlers.headsup.postMessage({ type: 'subscribe', payload: { events: ['input_event'] } })` (matching the existing canvas→daemon API in `apps/sigil/avatar-hit-target.html`)
- `requestAnimationFrame` loop clears the canvas and draws a small filled circle at `(cursor.x, cursor.y)` in screen-pixel coordinates
- Optional: logs a rolling event-rate estimate to the console for verification

The page assumes the canvas is positioned at `(0, 0)` covering the primary display, so screen coordinates equal canvas pixel coordinates without transformation. This is the 1:1 coordinate mapping we established in brainstorm.

## Running the PoC

```bash
aos show create --id test-cursor --url aos://sigil/test-cursor/index.html
# Move mouse, observe the dot
aos show remove --id test-cursor
```

The canvas is created passthrough by default (`ignoresMouseEvents = true`), which is exactly the configuration we need — the dot is driven by pushed events, not captured events.

## Success criteria

| Criterion | How measured |
|-----------|--------------|
| Smooth tracking, no perceptible lag | Subjective visual check. Move cursor in circles; dot should visually sit on the cursor. |
| Event rate ≥30Hz | Log timestamps in the canvas console; inspect via Safari Web Inspector attached to the WKWebView. |
| No stutter or jumps | Visual check during rapid cursor movement across the display. |
| Multi-display handoff | Drag cursor across displays; dot should continue tracking without visible discontinuity (or a clear explanation if it can't — e.g., canvas lives on only one display). |
| No measurable CPU spike | `top -pid <daemon pid>` and `top -pid <WebContent pid>` during idle and during mouse thrashing. |

The primary criterion is the first. Numbers are sanity checks.

## Failure modes and fallback plan

| Observation | Likely cause | Next step |
|-------------|--------------|-----------|
| Dot lags cursor visibly | eval per-frame latency too high, or daemon coalescing/queueing adds lag | Check the rate of events arriving at the daemon's CGEventTap vs. the rate delivered to the canvas. If eval is the bottleneck, investigate batched eval or alternate transport. |
| Dot stutters / drops frames | Event coalescing dropping intermediate positions | Add pass-through mode that skips coalescing for subscribed canvases. |
| Dot tracks but CPU pins | eval per-frame too expensive | Look at WKWebView direct IPC (e.g., JS-callable functions via `WKScriptMessageHandler` response, shared memory) |
| Events don't arrive at all | Subscribe wiring broken | Verify postMessage reaches daemon, verify forwarding iteration runs, verify eval target canvas ID matches. |
| Multi-display broken | Canvas only exists on one display | Expected — full multi-display requires the primitive we're building next. Not a PoC failure. |

If the PoC reveals a fundamental problem with the architecture, we document findings and revisit the larger plan before porting any Swift code.

## What the PoC does not validate

- Behavior parity with current avatar
- Hit-area capture (requires canvas mutation API)
- Display geometry stream (separate event type)
- State machine correctness
- Three.js rendering performance under load

These belong to the post-PoC iteration. If the PoC succeeds, the next spec covers the canvas mutation API and the first real behavior port.

## Post-PoC path (informational)

Assuming PoC succeeds, the staged work that follows:

1. **Canvas mutation API from JS** — postMessage actions for `canvas.create`, `canvas.update` (frame, ignoresMouseEvents), `canvas.remove`
2. **Display geometry stream** — second event type through the same forwarding mechanism
3. **Hit-area canvas + avatar follow** — persistent small interactive canvas tracks the avatar, plus JS state machine handles cursor-follow behavior
4. **Expand-on-mousedown for drag** — hit-area resizes to bounding rect of all displays during drag, snaps back on release
5. **State machine port** — remaining avatar behaviors (dock, undock, surge, possess, trace) in JS
6. **Retire avatar-sub binary** — once JS renderer reaches behavior parity, remove Swift files and launchd hooks

Each of those is a separate spec/plan cycle.

## Dependencies

- Content server already serves from `apps/sigil/` (confirmed working for Studio, inspector, chat)
- `headsup.receive` API already exists on canvases
- Canvas postMessage → daemon relay already exists (`canvas_message` path)
- `broadcastInputEvent` already runs in the daemon for every input event

No new infrastructure. The PoC composes existing mechanisms with the two additions described above.
