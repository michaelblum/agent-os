# Spec: Display Geometry Stream

**Session:** drag-capture
**Date:** 2026-04-12
**Status:** Historical; subscription mechanics landed, but the coordinate contract details below are partially superseded by the DesktopWorld re-anchor
**Parent brief:** handoff `01KNZWQ68B1FHQ67SP2N8FTE13` from `hit-area-canvas`
**Arc:** First of four specs in the avatar-streamline continuation. Prerequisite for all subsequent avatar-streamline work (gesture state machine, fast-travel, radial menu).

> **Supersession note:** The channel/subscription mechanics in this spec remain
> relevant, but references below to "top-left of primary = origin" and
> `global_bounds` describe the legacy native desktop compatibility payload, not
> the canonical shared-world contract. Current spatial authority lives in
> `shared/schemas/spatial-topology.md` and
> `docs/superpowers/plans/2026-04-19-spatial-runtime-and-governance.md`.

## Problem

JS running in an AOS canvas has no way to learn the global arrangement of displays — where each display sits in global coordinates, which is primary, what scale factor applies, or when the arrangement changes (plug/unplug, System Settings rearrangement, rotation). Phase 3 worked around this by hard-coding the primary display's frame in `aos show create --at 0,0,1512,982`. Every subsequent phase of the avatar-streamline arc needs real multi-display awareness:

- The avatar needs a drawing canvas on every display so it can render anywhere.
- The hit-area needs to expand to the bounding rect of *all* displays during a drag gesture (locked interaction model in the prior brainstorm).
- Fast-travel animations need to cross displays visually.

Today that data is produced on demand by `side-eye list` as a snapshot — suitable for batch perception, not for live JS consumers that need to react to changes.

## Goal

Add a subscribable, change-broadcasting channel for the display subset of the existing `spatial-topology.schema.json`. Any AOS canvas can subscribe, receive the current snapshot immediately, and receive a new snapshot whenever the macOS display configuration changes.

**Success means:** a test page subscribes, receives the current geometry within one daemon eval tick, and receives fresh snapshots when an external display is plugged/unplugged or the arrangement is changed in System Settings — with no polling, no CPU cost when idle, and clean cleanup on canvas removal.

## Non-goals

- New coordinate model. Reuses the existing spatial-topology Global CG convention (top-left of primary = origin, logical points, per-display `scale_factor`).
- Per-window display assignment. `aos show create --display <uuid>` is unchanged.
- Window or app data. This channel only carries display info; the full spatial-topology snapshot remains the province of `side-eye list`.
- Separate DPI-change notifications. If `scale_factor` changes (resolution mode switch), a new geometry snapshot fires — that's the notification.
- CLI surface. No new `aos` subcommand; this is a daemon-internal subscription channel consumed via the existing postMessage path from a canvas.

## Architecture

### Event shape

One event type, `display_geometry`, sent on subscribe and on change. Payload is a strict subset of `spatial-topology.schema.json`'s `displays[]` structure, plus a derived convenience field:

```json
{
  "type": "display_geometry",
  "displays": [
    {
      "display_id": 1,
      "display_uuid": "37D8832A-2B0A-4DFB-8C3E-...",
      "bounds": { "x": 0, "y": 0, "w": 1512, "h": 982 },
      "visible_bounds": { "x": 0, "y": 25, "w": 1512, "h": 957 },
      "scale_factor": 2.0,
      "rotation": 0,
      "is_main": true
    },
    {
      "display_id": 2,
      "display_uuid": "B9A4C...",
      "bounds": { "x": 1512, "y": 0, "w": 1920, "h": 1080 },
      "visible_bounds": { "x": 1512, "y": 0, "w": 1920, "h": 1080 },
      "scale_factor": 1.0,
      "rotation": 0,
      "is_main": false
    }
  ],
  "global_bounds": { "x": 0, "y": 0, "w": 3432, "h": 1080 }
}
```

`global_bounds` is the union of every display's `bounds` — a convenience for the common "expand to all displays" case. Derivable by consumers but pre-computed to keep the hot path on the consumer side trivial.

### Subscription semantics

Reuses the Phase 3 subscribe/forward machinery (`canvasEventSubscriptions` in `src/daemon/unified.swift`). The existing `subscribe` postMessage handler already accepts an `events: [...]` list; this spec extends the allow-list to include `"display_geometry"` alongside `"input_event"`.

Semantics:

- Canvas JS: `postToHost('subscribe', { events: ['display_geometry'] })`.
- On receipt, daemon adds the canvas to the `display_geometry` subscriber set AND sends the current snapshot immediately via the existing `evalAsync(headsup.receive(...))` path. No separate "query" call is needed — state replay is built into the subscribe handshake.
- Daemon registers an `NSApplication.didChangeScreenParametersNotification` observer exactly once at daemon boot (process lifetime). On firing, daemon recomputes the snapshot and broadcasts to every canvas currently subscribed.
- Subscription is dropped automatically when the canvas is removed, via the `canvas_lifecycle` cleanup path already established in Phase 3. No explicit unsubscribe is required (though `unsubscribe` continues to work for live canvases that want to drop a specific subscription).
- Canvases can subscribe to `display_geometry` alongside `input_event`; each event type has its own subscriber set, and the per-canvas removal cleanup drops both atomically.

### Daemon implementation

Files to touch:

- `src/daemon/unified.swift` — extend the subscribe handler's event-name allow-list; add `displayGeometrySubscribers` (mirroring the existing per-event-type tracking used for `input_event`); register the `didChangeScreenParametersNotification` observer at daemon init; implement `broadcastDisplayGeometry()` that iterates subscribers and calls the existing `CanvasManager.evalAsync` helper with the JSON payload.
- `src/display/display-geometry.swift` (new) — `snapshotDisplays() -> [DisplayInfo]` helper that walks `NSScreen.screens` and builds the schema-shaped structs. If `side-eye`'s existing list command has a reusable display enumerator, factor it out into this helper and call it from both sites; otherwise implement fresh and leave a note for follow-up DRY'ing.
- `shared/schemas/` — no new file. The payload is documented inline in this spec; the shape is a subset of `spatial-topology.schema.json`. If a standalone `display-geometry.schema.json` proves useful later (e.g., for an external consumer), it can be added without breaking anything.

Non-changes:

- No CLI surface.
- No daemon config keys.
- No new launchd wiring.
- No change to `aos show create --display`.

### Coordinate model

Unchanged from spatial-topology:

- Origin: top-left of primary display, `(0, 0)`.
- Axes: X right, Y down.
- Units: logical points. Multiply by a display's `scale_factor` to get physical pixels on that display (per-display, like Windows' per-monitor DPI).
- `display_uuid` is the stable cross-session identifier; `display_id` (CGDirectDisplayID) is session-scoped and can churn — consumers should prefer UUID for any persistence.

## Test harness

New page: `apps/sigil/test-display-geometry/index.html`, modeled on `test-mutation/` and `test-cursor/`.

Behavior:

- Subscribes to `display_geometry` on load.
- Renders the latest snapshot as visible boxes on-page: one `<div>` per display showing `display_id`, UUID (truncated), bounds, visible_bounds, scale, is_main, rotation.
- Logs each new snapshot to an on-page console with a timestamp and a monotonic count.
- Draws a second panel showing `global_bounds`.

Manual test procedure:

1. Launch the page as a canvas: `./aos show create --id display-test --url aos://sigil/test-display-geometry/index.html --at 100,100,800,600`.
2. Verify snapshot appears immediately and matches `side-eye list` output for the displays block.
3. Plug an external display. Verify a new snapshot arrives with both displays and correctly computed `global_bounds`.
4. Unplug the external display. Verify a new snapshot arrives with only the remaining display(s).
5. In System Settings → Displays, rearrange the displays. Verify a new snapshot arrives with updated `bounds.x`/`bounds.y`.
6. Toggle primary display in System Settings. Verify `is_main` updates.
7. Rotate a display (if hardware allows). Verify `rotation` and `bounds` update.
8. `./aos show remove --id display-test`. Verify in `daemon.log` that the `display_geometry` subscription is cleaned up (same log line as the existing subscription cleanup).

## Acceptance criteria

- Subscribing to `display_geometry` delivers the current snapshot within one daemon eval tick (observable via the test page's log).
- External display plug/unplug produces a new snapshot reflecting the current set.
- System Settings arrangement changes produce a new snapshot reflecting the new `bounds`.
- Rotation changes produce a new snapshot reflecting the new `rotation` and `bounds`.
- Canvas removal cleanly drops the `display_geometry` subscription — no leaked observer references, no post-removal delivery attempts.
- Daemon CPU is idle when no display changes occur (observer-driven, no polling). A `top`/`ps` sample during steady state is indistinguishable from pre-change idle.
- A canvas subscribing to both `input_event` and `display_geometry` receives both independently and has both cleaned up on removal.

## Failure modes and fallbacks

| Failure | Symptom | Fallback |
|---|---|---|
| `didChangeScreenParametersNotification` misses an event (rare on macOS but possible during sleep/wake) | Stale snapshot after a change | Add a lightweight recovery: on any `canvas_lifecycle` event, if the cached snapshot is older than N minutes, recompute and rebroadcast. Not needed for v1; file an issue if observed. |
| `evalAsync` to a subscribed canvas fails (canvas navigated, crashed) | Broadcast call errors for that canvas | Existing `evalAsync` error handling applies; canvas gets cleaned up via `canvas_lifecycle` removed on the next lifecycle tick. No special handling here. |
| Payload size for many-display setups | Excessive JSON per snapshot | 4-display setups produce ~1KB payloads; not a concern. If someone plugs in 16 displays, we have bigger problems. |

## Out of scope (will come later)

- Bringing `display_geometry` into `shared/schemas/` as a first-class reusable schema. Defer until a second consumer appears.
- A CLI snapshot command (`aos display list --json`) mirroring `side-eye list` but scoped to displays only. Useful for scripting; not needed for the avatar-streamline arc.
- Push-based window/app topology (the rest of `spatial-topology`). That's a bigger design and has different consumers; `side-eye list` on demand is fine for now.
