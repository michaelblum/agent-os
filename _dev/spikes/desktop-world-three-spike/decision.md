# DesktopWorld Three.js Spike Decision

Status: GO for a BroadcastChannel-backed Three.js adapter.

This spike ran on April 26, 2026 against an isolated repo-mode daemon using the
same two-display topology reported by `./aos graph displays --json`:

- display 1: `1512x982 @ 0,0`, scale factor 2
- display 2: `1920x1080 @ -185,982`, scale factor 1

The surface was created with:

```bash
./aos show create \
  --id dws-three-spike \
  --surface desktop-world \
  --url aos://dws-three-spike/index.html
```

## Visual Coherence

Result: pass.

The captured surface was composited as one logical image with two physical
segments. The capture metadata reported one logical surface with two segments,
matching `CanvasInfo.segments`.

Observed capture summary:

```json
{
  "bounds_global": { "x": -185, "y": 0, "width": 1920, "height": 2062 },
  "bounds_local": { "x": 0, "y": 0, "width": 3840, "height": 4124 },
  "capture_scale_factor": 2,
  "displays": [1, 2],
  "segments": [
    { "display_id": 1, "bounds_global": { "x": 0, "y": 0, "width": 1512, "height": 982 } },
    { "display_id": 2, "bounds_global": { "x": -185, "y": 982, "width": 1920, "height": 1080 } }
  ]
}
```

A moving Three.js cube rendered in the follower segment while the primary owned
the animation clock. HUD state on each segment showed the expected primary and
follower roles.

## Latency

Result: pass.

The primary published one state per frame over `BroadcastChannel`. The follower
reported:

- received frames: 322
- median latency: 0 ms
- p95 latency: 3 ms
- last receive age: 10 ms at the final tick

These numbers are comfortably below a frame budget for Sigil's current visual
needs.

## CPU/GPU Cost

Result: acceptable for a two-segment surface.

This spike did not run a heavyweight profiler. The practical observation was
that both segments rendered continuously for the 7 second sample window, capture
completed, and the isolated daemon stayed responsive. Production migration
should keep the adapter lightweight and avoid duplicating primary-only side
effects.

## Hot-Plug

Result: not exercised.

No physical display add/remove was performed during the spike. The adapter
responds to `canvas_topology_settled` and rebuilds its camera on topology
changes, but hot-plug remains a manual integration check before this should be
called fully hardened.

## Capture Composition

Result: pass.

`aos see capture --canvas dws-three-spike --perception` returned one logical
surface entry with per-segment metadata. This matches the intended contract:
callers see one DesktopWorld surface while perception keeps segment detail for
debugging.

## Decision

GO.

Use `BroadcastChannel` as the first production shared-state transport for the
Three.js adapter. Keep the daemon renderer-agnostic. The adapter should expose
segment-carved camera helpers and primary/follower gates; Sigil should classify
boot side effects so subscriptions, marks, hit-target creation, and daemon
position writes happen once per logical surface.

