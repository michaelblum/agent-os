# Spec: Hit-Area Canvas + Follow-Cursor Slice (Phase 3)

**Session:** hit-area-canvas
**Date:** 2026-04-12
**Status:** Approved (pre-plan)
**Parent brief:** handoff `01KNZTW54BNPB6D76Z3G2RWFGY` from `canvas-mutation-api`
**Arc:** Phase 3 of the avatar-streamline 5-phase plan (PoC spec `2026-04-11-avatar-streamline-poc.md`, post-PoC path)

## Problem

Phase 1 shipped a canvas mutation API from JS (`canvas.create` / `canvas.update` / `canvas.remove`) with ownership + cascade removal. The PoC proved daemon→canvas cursor push is smooth at 60Hz. Phase 3 is the first real consumer of both capabilities together: a JS-side state machine that drives a canvas's position in real time.

Two concerns must stay independently reasoned about:

- **Rendering** the avatar (visual, full-display, passthrough)
- **Capturing** mouse input where the avatar body is (interactive, small, event-consuming)

If these live in one canvas, we end up flipping `ignoresMouseEvents` per-frame or inventing a DOM-level hit-rect — either of which compromises the discipline we established in issue #2 (canvases default to passthrough).

## Goal

Prove that a JS state machine can drive two linked canvases via the Phase 1 mutation API at 60Hz without lock contention or visible jitter, using the simplest possible follow-cursor behavior.

**Success means:** a full-display drawing canvas renders a small avatar shape that lerps toward the cursor each frame, and a small hit-area canvas stays glued to the avatar body, absorbing clicks that would otherwise pass through to the desktop.

**Failure means:** 60Hz `canvas.update` shows lock contention symptoms (dropped frames, dot stutter), requiring fallback from the PoC spec's failure-modes table.

## Non-goals

- Three.js / real avatar geometry (Phase 5)
- Dock, undock, surge, possess, trace behaviors (Phase 5)
- Radial menu or drag gestures (Phase 4)
- Hit-area click handling (Phase 4; hit-area absorbs but does not yet react)
- Multi-display handoff (requires Phase 2 display geometry stream)
- Bundled renderer port (Phase 5)

## Architecture

### Canvas topology: two canvases, linked lifecycle

- **Drawing canvas** (`avatar-draw`) — full primary display, `ignoresMouseEvents=true`, subscribes to `input_event`, runs the follow-cursor state slice, renders the avatar shape, drives the hit-area via `canvas.update` each frame.
- **Hit-area canvas** (`avatar-hit`) — small (80×80), `ignoresMouseEvents=false`, near-empty HTML page. No subscriptions. No message handlers beyond the minimum required by `canvas.create`'s response contract. Its sole job is to exist at the avatar body's position so clicks land on it rather than the underlying desktop.

The drawing canvas creates the hit-area via `canvas.create` on startup. Phase 1's ownership model records `canvasCreatedBy[avatar-hit] = avatar-draw`. Cascade-remove means closing the drawing canvas (or the daemon tearing it down) takes the hit-area with it — no orphan cleanup needed.

### No launcher canvas

The drawing canvas itself is the entry point — `aos show create --url aos://sigil/avatar-streamline/draw.html` (or equivalent). On load, it issues `canvas.create` for the hit-area and enters the follow-cursor loop. This is leaner than a separate launcher page and still keeps ownership cleanly parented.

### Data flow

```
Cursor moves
  → Daemon broadcasts input_event (existing)
  → Drawing canvas headsup.receive(input_event)
  → Drawing canvas updates targetPos = {cursor.x, cursor.y}

requestAnimationFrame tick (60Hz)
  → currentPos = lerp(currentPos, targetPos, FOLLOW_ALPHA)
  → Clear drawing canvas, fill circle at currentPos (radius R)
  → postMessage canvas.update {
      id: "avatar-hit",
      frame: { x: currentPos.x - HIT_HALF, y: currentPos.y - HIT_HALF,
               w: HIT_SIZE, h: HIT_SIZE }
    }
```

`FOLLOW_ALPHA = 0.2` per frame (linear ease — simple exponential smoothing toward target). `HIT_SIZE = 80`, `HIT_HALF = 40`, `R = 20`. All constants, tuned later.

Hit-area does not post back. The drawing canvas already sees all cursor and click events via `input_event` because CGEventTap runs before any per-window event dispatch. If Phase 4 later needs native DOM events on the hit-area, that's a separate wire.

### State machine

One state: `followCursor`. Entered on load. Internal state `{ targetPos: {x, y}, currentPos: {x, y} }`. Initialized from the first `input_event` received (or (0,0) if none arrives within one frame — the first real event will snap it). No transitions in Phase 3.

## File layout

```
apps/sigil/avatar-streamline/
  draw.html        # drawing canvas — subscribes, state machine, rendering, drives hit-area
  hit-area.html    # near-empty page, transparent background, no logic
```

Single directory; neither file depends on the toolkit component base (keeping this slice self-contained for debugging, matching Phase 1 harness philosophy). If the pattern repeats in Phase 4/5, promote shared pieces to the toolkit.

## Daemon changes

None. Phase 1's mutation API and the PoC's subscribe/forward path are sufficient. This spec is pure JS-side work.

## Running it

```bash
aos show create --id avatar-draw --url aos://sigil/avatar-streamline/draw.html
# Move mouse, observe avatar shape ease toward cursor, hit-area glued underneath
aos show remove --id avatar-draw
# avatar-hit removed automatically via cascade
```

## Success criteria

| Criterion | How measured |
|-----------|--------------|
| Avatar lerps smoothly toward cursor, no stutter | Visual: circles, diagonals, rapid swipes. Should trail softly, no jumps. |
| Hit-area stays glued to avatar body | Visual: open an app behind the avatar, click on the avatar body — click should be consumed (not reach the app). Click just outside avatar — should hit the app. |
| No lock contention at 60Hz | Daemon CPU sampled during sustained motion (PoC baseline was ~0%); watch for elevated sampled CPU or visible dropped frames. |
| Cascade cleanup works | `aos show remove --id avatar-draw` removes both canvases. `aos show list --json` confirms. |
| Hit-area absorbs clicks without jitter during drag | Click and drag on avatar body; hit-area must track during the drag without lagging behind enough to lose capture. (If it lags, Phase 4's expand-on-mousedown solves it structurally — document observed lag if any for Phase 4 context.) |

The primary criterion is smoothness; the others are sanity checks and Phase-4 groundwork.

## Failure modes and fallback plan

| Observation | Likely cause | Next step |
|-------------|--------------|-----------|
| Avatar tracks but hit-area lags visibly | 60Hz `canvas.update` queuing latency in daemon | Check serial queue depth; if the fire-and-forget path coalesces or backs up, per-canvas locks (PoC spec's failure-modes row) are the fallback. |
| Hit-area loses click capture during fast drag | Expected for fixed-size hit-area at speed | Document for Phase 4; expand-on-mousedown resolves it. |
| Drawing canvas stutters during rapid cursor motion | Event coalescing dropping intermediate positions (PoC scenario) | Already addressed in PoC — if it reappears, check whether canvases pre-subscribed before the test run. |
| CPU pin | `canvas.update` per-frame too expensive | Compare cost to eval-only path (PoC); if structurally too heavy, consider only updating hit-area when position delta exceeds a threshold. |
| Clicks pass through to desktop despite hit-area | Hit-area created with `ignoresMouseEvents=true` or behind drawing canvas in z-order | Verify `interactive: true` in `canvas.create` payload; check z-order. Cascade test harness from Phase 1 has patterns. |

## Dependencies

- Phase 1 canvas mutation API (`canvas.create`, `canvas.update`, `canvas.remove` with ownership) — shipped
- PoC cursor subscribe + `headsup.receive` forwarding — shipped
- Content server serving `apps/sigil/` — shipped

No new daemon work.

## What this validates for the broader arc

- The two-canvas (render + hit) pattern as the shape of every future avatar behavior
- 60Hz `canvas.update` in real use (Phase 4 and 5 assume it works)
- Cascade ownership as real lifecycle management, not just a test-harness feature
- JS-side state machine as the home for all future behaviors
