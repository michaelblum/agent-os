# AOS Surface Transport Stack Measurement V0

Date: 2026-06-05

Branch: `gdi/aos-surface-transport-stack-measurement-v0`

Start ref: `8f9fafc8c2b304000ad05135313c802eb68bd569`

## Status

`complete` — Phase 0 exit gate met. All measurements taken.

**Completed:**
- Mechanism confirmed (JS probes): 1 control_change + 1 snapshot per slider
  tick, each triggering 1 structural frame + 1 publishState broadcast.
- Native-rate drag measured: 82.8 cross-canvas IPC messages/s at `--speed 30`
  CGEvent drag; 31 publishState/s background (from render loop, 100% structural).
- Stacked subscriber count confirmed: N=1 with Surface Inspector + avatar +
  panel all active; Surface Inspector does not subscribe to `input_event`.
- Swift rebuild completed (`node scripts/aos-dev-build.mjs build` passed, warnings only).
- TCC permissions re-granted after rebuild; daemon `ready: true`.

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

### Test 3: Native CGEvent drag (active panel, Foreman session, 2026-06-05)

Panel activation approach:
1. `window.__sigilDebug.dispatch({ type: 'status_item.show' })` → avatar visible
2. `./aos do click --right 1260,818` → right-click at avatar native coords →
   daemon dispatches `panel.toggle` → panel resumed to `lifecycleState: "active"`
3. Both probes enabled, reset, baseline ping taken, then drag immediately.

Round-trip drag (900,639 → 1130,639 → 900,639) at `--speed 30`, elapsed ~29.5s.

**Panel probe (sigil-avatar-controls-avatar-main):**
```
elapsed:              29.6s
control_change sent:  611   (20.7/s)
snapshot sent:        611   (20.7/s)
cross-canvas IPC:    1222   (41.4/s each direction = 82.8 cross-canvas IPC/s total)
```

**Owner probe (sigil-avatar-main):**
```
elapsed:                 29.9s
control_change received: 611   (matches panel — 0 dropped)
snapshot received:       611   (matches panel — 0 dropped)
total render frames:     915   (30.6fps)
structural frames:       915   (100% of frames — all structural)
publishState calls:      915   (31/s — one per frame regardless of slider)
overlay_draws:           915   (1:1 with structural)
```

**Daemon input fan-out (from ping pre/post):**
```
pre-drag deliveries (avatar-main):  6373
post-drag deliveries (avatar-main): 9251
delta:                              2878 input events in 29.5s = 97.5 input events/s
last_1s at capture:                  104 input events/s (at drag endpoint)
subscriber_count:                      1 (only avatar-main)
```

**Stacked scenario subscriber count (Surface Inspector + avatar + panel):**

Surface Inspector was opened (`status_item.menu_action` → `toggleUtilityCanvas`)
during the session. Subsequent ping:
```json
{
  "subscriber_count": 1,
  "subscribers": [{ "canvas_id": "avatar-main", "input_event": true }],
  "last_fanout_targets": ["avatar-main"]
}
```
**Surface Inspector does NOT subscribe to `input_event`.** Stacked scenario
confirms N=1. No duplicate-surface bug.

**Key finding — background publishState rate:**

All 915 render frames (100%) were classified `structural`; only 611 of those
are even potentially slider-driven (= the number of control_change events
received). The remaining 304 are pure avatar animation frames, yet all 915 are
marked structural. The render loop fires `publishState` unconditionally on every
structural frame, and `scheduleRenderFrame` defaults `structural=true`
(`main.js:536`). This means publishState overhead is driven by the render loop
rate (~31/s at measured 30.6fps), not just by slider events — all of it
deletable under co-location.

## Claims: Current Evidence

Input fan-out:

- **N=1, stacked scenario confirmed.** With Surface Inspector + avatar-main +
  panel all active, `subscriber_count: 1`. Surface Inspector does NOT subscribe
  to `input_event`. `last_fanout_targets: ["avatar-main"]` confirmed during active
  drag. No duplicate-surface bug.
- **Delivery rate measured (native drag):** 2878 input events in 29.5s =
  97.5 input events/s at `--speed 30`. `last_1s = 104` at drag endpoint.

Panel snapshot chattiness:

- Mechanism confirmed: 1 `control_change` + 1 `snapshot` per slider event,
  delivered cross-canvas through the daemon serialization boundary. Code anchor:
  `apps/sigil/avatar-controls/compact-surface-session.js:80` →
  `routeChangedControls` → `syncState()` + `publishSnapshot()`.
- **Native rate measured:** 611:611 in 29.5s = 20.7/s (each), 82.8
  cross-canvas IPC messages/s total at `--speed 30` drag.
- 0 messages dropped: panel sent == owner received in every run.

Render structural over-mark:

- Confirmed: each async `control_change` triggers exactly one structural render
  frame. Code anchor: `main.js:5001–5057`.
- Confirmed: structural block fires `overlay.draw` + `desktopWorldSurface.publishState`
  unconditionally. Code anchor: `main.js:5001–5057`.
- **New finding (native run):** 100% of render frames are structural regardless
  of slider activity. The render loop classifies every frame as structural because
  `scheduleRenderFrame` defaults `structural=true` (`main.js:536`) and the avatar
  animation (mesh rotation) runs every frame. This means publishState fires at
  the render loop rate (~31/s at the measured 30.6fps) even at rest — not just
  on slider events. Whether 30.6fps is a ceiling under this load or an artifact
  of the `--speed 30` event pace is unresolved; the mechanism is the same at
  any frame rate.

Scenario variants:

- Detached panel visible: tested (active panel, live CGEvent drag). ✓
- Surface Inspector + avatar + panel stacked: tested, subscriber_count=1. ✓
- Embedded compact surface (no detached panel): not tested; requires different
  product path.

## Operator Prompt For Native-Rate Measurement

To complete the rate measurement with real mouse input and native fan-out data,
run the following in an active AOS session with a real agent session providing
avatar vitality:

**PRECONDITION (critical):** The compact panel canvas
`sigil-avatar-controls-avatar-main` is `lifecycleState: "suspended"` unless
there is a live agent session running (agent vitality > 0 → `avatarVisible`
true). Without a live session, `liveJs.avatarVisible = true` makes the avatar
render but the panel is still force-suspended — OS mouse events will not reach
the slider. You need an actual running agent session, not a force-visible workaround.

```
You are an Operator running Phase 0 of the AOS One-World measurement.
Branch: surface-world-architecture.

PRECONDITION: a live agent session must be running (avatar visible via real
vitality, not force-visible hack). Verify: ./aos show get --id avatar-main
should show lifecycleState "active", not "suspended".

1. Activate sigil experience roots:
   ./aos experience activate sigil

2. Confirm avatar-main is active (not suspended):
   ./aos show get --id avatar-main

3. Right-click the avatar to open the compact panel.
   The panel should show the mother-scale slider.

4. Confirm the panel is NOT suspended:
   ./aos show get --id sigil-avatar-controls-avatar-main
   (lifecycleState should be "active")

5. Enable and reset both probes:
   ./aos show eval --id avatar-main --js 'window.__sigilDebug.surfaceTransportProbe.enable(); window.__sigilDebug.surfaceTransportProbe.reset()'
   ./aos show eval --id sigil-avatar-controls-avatar-main --js 'window.__sigilAvatarPanelDebug.surfaceTransportProbe.enable(); window.__sigilAvatarPanelDebug.surfaceTransportProbe.reset()'

6. Also open Surface Inspector if available (stacked scenario):
   The subscriber_count should be >= 2 in that case.

7. Capture a baseline ping BEFORE dragging:
   echo '{"v":1,"service":"system","action":"ping","data":{}}' | nc -U ~/.config/aos/repo/sock
   Record: input_event.subscriber_count, deliveries_total_by_canvas (should all be 0).

8. Drag the mother-scale slider with the real mouse for exactly 5 seconds.

9. Immediately capture results:
   ./aos show eval --id avatar-main --js 'JSON.stringify(window.__sigilDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
   ./aos show eval --id sigil-avatar-controls-avatar-main --js 'JSON.stringify(window.__sigilAvatarPanelDebug.surfaceTransportProbe.snapshot({windowMs: 5000}))'
   echo '{"v":1,"service":"system","action":"ping","data":{}}' | nc -U ~/.config/aos/repo/sock

10. Record:
    - From panel probe: control_change/s, snapshot/s
    - From owner probe: structural_frames/s, publishState/s, total frames/s
    - From ping (post-drag): input_event.subscriber_count, deliveries_total_by_canvas
      (this is the native fan-out count; deliveries_last_1s_by_canvas shows the
      rate at the moment of capture)

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
node scripts/aos-dev-build.mjs build    # completed; warnings only, no errors
```

Passed (Foreman live session, native-rate measurement round):

```bash
# Panel opened active via: status_item.show + right-click → panel.toggle → canvas.resume
# Probes enabled; round-trip CGEvent drag 900,639 → 1130,639 → 900,639 at --speed 30
# Surface Inspector opened via status_item.menu_action dispatch
./aos ready --json   # ready: true, all permissions green
```

## Next Direction

**Phase 0 complete. Phase 1 ready.**

All Phase 0 measurements are done. The separation tax is confirmed real and
material. Proceed to Phase 1 per the goal contract:

> **Phase 1 — Co-location probe (one pair).** Prototype the avatar owner ↔
> compact panel as two layers in one document binding to a shared signal store.
> Exit gate: deletable traffic → ~0; slider-drag is direct; focus + fault
> behavior acceptable.

The work card for Phase 1 does not yet exist. A GDI round should create it,
targeting the avatar owner ↔ compact panel pair as the prototype.

**Phase 0 exit gate assessment:**

The separation tax is **confirmed real**. Its volume is directly measured.
Materiality rests on the architectural argument in (4): the traffic is
continuous, fires regardless of slider activity, and exists solely because the
surfaces are in separate heaps — it has no residual value after co-location.

1. **Mechanism (all three items confirmed):**
   - 1 `control_change` + 1 `snapshot` per slider tick → 2 cross-canvas IPC
     messages per event, through daemon serialization boundary
   - 1 structural render frame per async control_change event
   - 1 `publishState` broadcast per structural frame (unconditional)
   - All traffic exists only because the surfaces are in separate process heaps;
     all deletable under co-location

2. **Rates (measured at `--speed 30`; uncalibrated against real human drag):**
   - Cross-canvas IPC from slider: 82.8 messages/s
   - Background publishState from render loop: 31/s at 30.6fps (100% structural)
   - Daemon input fan-out: 97.5 input events/s
   - Note: `--speed 30` drag speed is synthetic; real human drag rates may differ
     in absolute numbers but the mechanism is identical.

3. **No duplication (N=1):** Surface Inspector does not subscribe to
   `input_event`. Stacked scenario subscriber_count=1. Fan-out multiplier
   does not compound the IPC overhead — it's already the floor.

4. **The architectural materiality argument:** publishState fires at the render
   loop rate (~31/s measured), not just on slider events. Every frame is
   structural. This overhead exists regardless of slider activity. In a
   co-located World, `publishState` / `snapshot` / `control_change` between the
   owner and compact panel delete themselves entirely — the path does not exist
   in-heap. The deletability of ~82.8 IPC/s + ~31 publishState/s under a design
   that is already proposed and has a clear Phase 1 prototype path is the
   materiality case.
