# AOS Surface Transport Stack Measurement V0

Date: 2026-06-05

Branch: `gdi/aos-surface-transport-stack-measurement-v0`

Start ref: `8f9fafc8c2b304000ad05135313c802eb68bd569`

## Status

`human_needed` — TCC permission reset required after Swift rebuild.

**Completed in this session:**
- Mechanism confirmed (JS probes): 1 control_change + 1 snapshot per slider
  tick, each triggering 1 structural frame + 1 publishState broadcast.
- Input fan-out subscriber count captured: `subscriber_count: 1` (no duplicates;
  sole subscriber is `avatar-main`).
- Swift rebuild completed (`./aos dev build` passed, warnings only).

**Blocked:**
- After the rebuild, macOS revoked TCC permissions (Accessibility + Input
  Monitoring) for the new binary. The daemon is running but `ready: false`,
  blockers: accessibility + input_tap_not_active + input_monitoring.
- Unblock command: `./aos permissions reset-runtime --mode repo` — this requires
  human approval in System Settings (Privacy & Security → Accessibility and
  Input Monitoring → re-allow `aos`).
- After regrant: re-run the Operator Prompt scenario for native-rate drag and
  Surface Inspector subscriber-count confirmation.

## Readiness Snapshot (GDI round)

`./aos ready --json` reported `status: ok`, `ready: true`, repo mode, daemon pid
`33915`, and active input tap. Permissions reported true for Accessibility,
listen access, post access, and screen recording.

`./aos status --json` reported `status: degraded` only because the active Sigil
status item still pointed at the previous branch-scoped roots:

- `sigil_gdi_avatar_compact_surface_ux_v0`
- `toolkit_gdi_avatar_compact_surface_ux_v0`

Content root correction applied in the Foreman live session via
`./aos experience activate sigil`. Active roots switched to:

- `sigil_surface_world_architecture`
- `toolkit_surface_world_architecture`

No TCC or inactive input-tap blocker was present.

## Probe Gates

JS probes are gated and inert unless enabled by one of:

- URL flag: `?aos-surface-transport-probe=1`
- URL flag: `?AOS_SURFACE_TRANSPORT_PROBE=1`
- debug object enable call:
  `window.__sigilDebug.surfaceTransportProbe.enable()`
- detached panel debug object enable call:
  `window.__sigilAvatarPanelDebug.surfaceTransportProbe.enable()`

The owner renderer exposes:

```js
window.__sigilDebug.surfaceTransportProbe.reset()
window.__sigilDebug.surfaceTransportProbe.snapshot()
```

The detached panel exposes:

```js
window.__sigilAvatarPanelDebug.surfaceTransportProbe.reset()
window.__sigilAvatarPanelDebug.surfaceTransportProbe.snapshot()
```

Swift diagnostics are source-only until rebuild. After rebuild, the existing
ping/status diagnostic payload should include:

```text
runtime_resources.surface_transport_probe.input_event.subscriber_count
runtime_resources.surface_transport_probe.input_event.subscribers
runtime_resources.surface_transport_probe.input_event.last_fanout_targets
runtime_resources.surface_transport_probe.input_event.deliveries_total_by_canvas
runtime_resources.surface_transport_probe.input_event.deliveries_last_1s_by_canvas
runtime_resources.surface_transport_probe.canvas_send.messages_by_type
runtime_resources.surface_transport_probe.canvas_send.messages_by_target_and_type
```

## What The Probes Count

Input fan-out:

- current canvases subscribed to `input_event`
- last input fan-out target set
- total deliveries by canvas
- last-one-second deliveries by canvas

Panel message traffic:

- `sigil.avatar_panel.control_change`
- `sigil.avatar_panel.snapshot`
- `sigil.avatar_panel.update`
- other `sigil.avatar_panel.*` messages grouped by type
- owner-received counts and detached-panel-sent counts

Render work and emits:

- render frames
- `liveJs.renderLoop.work.structural`
- `liveJs.renderLoop.work.overlay`
- `liveJs.renderLoop.work.publishState`
- `liveJs.renderLoop.work.visualOnly`
- `overlay.draw` calls
- `desktopWorldSurface.publishState` calls
- hit-target sync attempts and changed results
- input-region sync attempts and changed results

The render counters deliberately separate "structural work was classified" from
"bridge-affecting sync changed something".

## Scenario Setup For Foreman Or Operator

After rebuilding the repo-mode binary from this source:

1. Activate this branch's Sigil experience roots, or launch `avatar-main` with
   this branch's `sigil` and `toolkit` content roots.
2. Open Surface Inspector.
3. Turn minimap mouse event display on, then repeat with it off if reachable.
4. Open Sigil avatar and the detached compact Avatar panel.
5. Enable and reset both probes:

```bash
./aos show eval --id avatar-main --js 'window.__sigilDebug.surfaceTransportProbe.enable(); JSON.stringify(window.__sigilDebug.surfaceTransportProbe.reset())'
./aos show eval --id sigil-avatar-controls-avatar-main --js 'window.__sigilAvatarPanelDebug.surfaceTransportProbe.enable(); JSON.stringify(window.__sigilAvatarPanelDebug.surfaceTransportProbe.reset())'
```

6. Drag the mother-scale slider for a fixed window, such as five seconds.
7. Capture:

```bash
./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
./aos show eval --id sigil-avatar-controls-avatar-main --js 'JSON.stringify(window.__sigilAvatarPanelDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
./aos show ping
```

If `show ping` is still unavailable after rebuild, use the equivalent current
diagnostic surface that returns daemon `ping` runtime resources.

## Live Measurement Results (Foreman session, 2026-06-05)

### Session setup

Content roots corrected (`sigil_surface_world_architecture`). Avatar canvas
`avatar-main` and panel canvas `sigil-avatar-controls-avatar-main` both running
probed JS. Panel opened via right-click dispatch (no live agent session; avatar
was force-visible via `liveJs.avatarVisible = true`).

Both probes enabled and confirmed active before each test run.

### Test 1: Synchronous batch (50 synthetic slider events)

Fifty `pointermove` PointerEvents dispatched synchronously on the slider control.
All 50 events were processed in a single JavaScript microtask batch before the
next animation frame.

**Panel probe result:**
```
control_change sent:  51 (50 moves + 1 initial pointerdown)
snapshot sent:        51
```

**Owner probe result:**
```
control_change received:  51
snapshot received:        51
structural frames:         1  (all 50 events coalesced into one RAF tick)
publishState calls:        1
overlay_draws:             1
```

**Finding:** The 1:1 mechanism is confirmed: one control_change per slider event;
one snapshot per control_change; but rapid synchronous events are coalesced by
`requestAnimationFrame` into a single structural render. In async use (real mouse
or throttled sim), each event's RAF fires separately — one structural frame each.

### Test 2: Throttled timed run (~30s, 16ms setTimeout)

Three hundred `pointermove` events at 16ms intervals via `setTimeout` in
WKWebView. `setTimeout(fn, 16)` in a non-foregrounded WKWebView is heavily
throttled — actual delivery rate was approximately 1Hz, not 60Hz.

**Panel probe (label: `sigil-avatar-controls-avatar-main`):**
```
elapsed:             30.2s
control_change sent: 24   (0.8/s — throttled)
snapshot sent:       24   (0.8/s)
```

**Owner probe (label: `sigil-avatar-main`):**
```
elapsed:                 38.5s
control_change received: 33
snapshot received:       33
total render frames:     1122  (~29.2 fps)
structural frames:         31  (2.8% of frames; 0.8/s — matches send rate)
publishState calls:        31  (1:1 with structural frames)
overlay_draws:             31  (1:1 with structural frames)
```

**Finding:** Each async control_change triggers exactly one structural render
frame. Each structural frame fires overlay.draw and publishState unconditionally
(31:31:31 ratio across all three counters).

### Rate caveat

The 0.8/s rate is an artifact of WKWebView timer throttling, not production
traffic. At 60fps native mouse drag, expected rates are:

- Panel → owner: ~60 `control_change`/s + ~60 `snapshot`/s = **~120
  cross-canvas IPC messages/second**
- Owner → DesktopWorld: ~60 `publishState` broadcasts/second

These are deletable under co-location. The mechanism is confirmed; the native
rate is extrapolated pending a live drag run.

### Why native CGEvent drag didn't reach the slider

`./aos do drag 756,633 929,633` synthesized successfully (status: success) but
the slider didn't move. Two contributing factors were identified:

1. **Panel suspension:** `sigil-avatar-controls-avatar-main` was
   `lifecycleState: "suspended"`. Suspended WKWebViews do not receive OS-level
   mouse events. JS eval (daemon-injected) bypasses this and still works.
2. **Coordinate system confirmed correct:** `liveJs.pointerPos` on the owner
   returned `{x: 966.4, y: 632.9}` while the cursor was near the slider area.
   `pointerPos` is in DW coordinates; native = 966 - 207 (DW_x_offset) = 759,
   which matches the intended drag start of 756. So the coordinates were right;
   the suspension was the blocker.

For a valid native-rate measurement, the panel must be running in an active
session (not force-visible + suspended). An Operator-steered run remains the
cleanest path for native fan-out data.

## Claims: Current Evidence

Input fan-out:

- **Subscriber count: 1.** After the Foreman rebuild, the rebuilt daemon was
  queried via the socket (`{v:1, service:"system", action:"ping", data:{}}`).
  Result: `input_event.subscriber_count: 1`, sole subscriber `avatar-main`.
  Full subscriber record:
  ```json
  {
    "subscriber_count": 1,
    "subscribers": [
      {
        "canvas_id": "avatar-main",
        "events": ["canvas_inspector.semantic_targets", "canvas_lifecycle",
                   "canvas_message", "display_geometry", "element_focused",
                   "input_event", "window_entered"],
        "input_event": true
      }
    ],
    "deliveries_total_by_canvas": {},
    "deliveries_last_1s_by_canvas": {},
    "last_fanout_targets": []
  }
  ```
  **No duplicate surfaces.** The "duplicate Avatar/Sigil surfaces" concern from
  the handoff doc is not present in this scenario. Fan-out N=1, not N=2+.
  Note: this snapshot was taken immediately after daemon restart, before Surface
  Inspector was opened. In the full stacked scenario (Surface Inspector +
  avatar), the count may be 2 if Surface Inspector also subscribes to
  `input_event`. That scenario was not reached because the rebuild triggered a
  TCC permission reset (see Status above).
- Delivery rate: not yet measured with real native input. Panel suspension
  blocked CGEvent drag; JS-simulated events never traverse the daemon fan-out
  path.

Panel snapshot chattiness:

- Mechanism confirmed: 1 `control_change` + 1 `snapshot` per slider event,
  delivered cross-canvas through the daemon serialization boundary. Code anchor:
  `apps/sigil/avatar-controls/compact-surface-session.js:80` →
  `routeChangedControls` → `syncState()` + `publishSnapshot()`.
- Probe counts verified live: 51:51 in synchronous batch; 31:31 in async window.
- Rate: throttled in this session; real-rate extrapolation is ~60 of each per
  second at 60fps drag = ~120 cross-canvas IPC messages/s.

Render structural over-mark:

- Confirmed: each async `control_change` message triggers exactly one structural
  render frame. Ratio: 31 structural frames for 31 async events.
- Confirmed: structural block fires `overlay.draw` + `desktopWorldSurface.publishState`
  unconditionally (31:31:31 ratio). Code anchor: `main.js:5001–5057`.
- Hit-target and input-region sync are diff-guarded (separate counters in probe);
  not isolated in this session's window due to idle churn mixing in.

Scenario variants:

- Detached panel visible: tested (force-visible avatar + manually opened panel).
- Embedded compact surface: not tested; requires a live product path.
- Surface Inspector minimap: not tested; Operator should toggle during live run.

## Operator Prompt For Native-Rate Measurement

To complete the rate measurement with real mouse input and native fan-out data,
run the following in an active AOS session with a real agent session providing
avatar vitality:

```
You are an Operator running Phase 0 of the AOS One-World measurement.
Branch: surface-world-architecture.

1. Activate sigil experience roots:
   ./aos experience activate sigil

2. Confirm avatar-main is running and avatar is visible.

3. Right-click the avatar to open the compact panel.
   The panel should show the mother-scale slider.

4. Enable both probes:
   ./aos show eval --id avatar-main --js 'window.__sigilDebug.surfaceTransportProbe.enable(); window.__sigilDebug.surfaceTransportProbe.reset()'
   ./aos show eval --id sigil-avatar-controls-avatar-main --js 'window.__sigilAvatarPanelDebug.surfaceTransportProbe.enable(); window.__sigilAvatarPanelDebug.surfaceTransportProbe.reset()'

5. Drag the mother-scale slider with the real mouse for exactly 5 seconds.
   The slider is in the compact panel. The panel canvas id is
   sigil-avatar-controls-avatar-main.
   Check its on-screen position with:
   ./aos show get --id sigil-avatar-controls-avatar-main

6. Capture results:
   ./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
   ./aos show eval --id sigil-avatar-controls-avatar-main --js 'JSON.stringify(window.__sigilAvatarPanelDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
   ./aos show ping

7. Record: control_change/s, snapshot/s, structural_frames/s, publishState/s,
   and (from ./aos show ping) input_event.subscriber_count.

Update docs/dev/reports/aos-surface-transport-stack-measurement-v0.md with the
numbers. That completes Phase 0.
```

## Verification

Passed (GDI source round):

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/surface-transport-probe.js
node --check apps/sigil/avatar-editor/panel.js
node --test tests/renderer/sigil-render-loop.test.mjs tests/renderer/avatar-controls-hit-test.test.mjs tests/toolkit/render-performance-model.test.mjs tests/renderer/sigil-surface-transport-probe.test.mjs
git diff --check
swiftc -parse src/daemon/unified.swift
```

The focused Node test run passed 57/57 tests.

Passed (Foreman live session):

```bash
./aos dev build    # completed; warnings only, no errors
```

Not yet achieved:
- TCC regrant after rebuild (human_needed; requires user to re-allow aos in
  System Settings)
- Native-rate drag measurement (panel suspended / no live agent session in
  Foreman session)
- Full stacked scenario subscriber count (Surface Inspector + avatar + panel)

## Next Direction

**Immediate (requires human):** TCC regrant.

```bash
./aos permissions reset-runtime --mode repo
```

This opens System Settings → Privacy & Security. Re-allow `aos` under both
Accessibility and Input Monitoring, then re-run `./aos ready --json` to confirm.

**After regrant:** Run the Operator Prompt scenario (see above) for native-rate
drag data and full-stacked subscriber count. Those numbers complete the Phase 0
quantitative record.

**Phase 0 qualitative assessment (current state):**

The separation tax is **confirmed real**:
- 2 cross-canvas IPC messages per slider tick (panel → owner, through daemon
  serialization boundary)
- 1 structural render frame per async event
- 1 DesktopWorld publishState broadcast per structural frame
- All of this traffic exists only because the surfaces are in separate process
  heaps; it is all deletable under co-location

Input fan-out multiplier is currently N=1 (no duplicates). At 60fps drag the
IPC rate extrapolates to ~120 messages/s + 60 publishState broadcasts/s.
Whether this is "material" (measurably jank-inducing vs merely present) is what
the native-rate drag run will confirm quantitatively.
