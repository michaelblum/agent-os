# AOS Runtime Resource Accumulation Forensics V0 Report

## Summary

This slice added a repeatable read-only telemetry helper and captured a
post-readiness idle drift run. The live dirty state from the original user
report was not preserved: `./aos ready` initially reported
`input_tap_not_active` and performed its bounded restart/recheck before later
runtime snapshots reported `tap=active`.

In the captured 120 second post-restart idle drift run, canvas count stayed
stable and process load did not accumulate. The earlier Foreman snapshot remains
the stronger evidence for the reported jank state: stable canvas count was
paired with non-idle daemon/WebKit CPU. This run proves the next diagnosis needs
resource counters and a preserved pre-restart runtime, not just canvas count.

## Telemetry Artifacts

The reusable helper is `scripts/aos-resource-snapshot`. It writes one
timestamped read-only snapshot containing `./aos status`, `./aos show list
--json`, repo `aos serve` and WebKit process rows, per-process fd/thread counts,
`vm_stat`, `memory_pressure`, and `summary.json`.

Captured artifacts:

- `docs/design/fixtures/aos-runtime-resource-forensics-v0/20260520T015302Z/`
- `docs/design/fixtures/aos-runtime-resource-forensics-v0/idle-drift-fixed-20260520T015454Z/`

## Runtime State

Start state after branch setup:

```text
./aos ready:
ready=false phase=runtime_blocked diagnosis=input_tap_not_active mode=repo daemon=reachable tap=unavailable blocked=do,listen,see
```

After the readiness command's bounded restart/recheck, direct status returned:

```text
status=ok mode=repo daemon=reachable pid=65507 tap=active focused_app=Code displays=2 windows=57 channels=0 stale_canvases=0 branch=gdi/aos-runtime-resource-accumulation-forensics-v0 ahead=0 dirty=0
```

End state after `node scripts/aos-dev-build.mjs build` and one canonical readiness recheck:

```text
ready=false phase=human_required diagnosis=daemon_tcc_grant_stale_or_missing mode=repo daemon=reachable tap=retrying blocked=do,inspect,listen,see
```

The build changed the repo-mode `aos` binary identity enough that macOS
Accessibility/Input Monitoring grants now need the targeted reset/setup flow:
`./aos permissions reset-runtime --mode repo`, `./aos permissions setup --once`,
then `./aos ready --post-permission`.

## Idle Drift

Fixed-cadence snapshots were captured at `t=0s, 15s, 30s, 60s, 90s, 120s`
under `idle-drift-fixed-20260520T015454Z`.

| offset | captured_at | canvases | active | suspended | windows | aos CPU | WebKit GPU CPU | WebContent CPU | WebContent RSS KB | WebContent fd | WebContent threads |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| t-0s | 2026-05-20T01:54:56.267Z | 7 | 4 | 3 | 9 | 0.2 | 0 | 0 | 184784 | 251 | 87 |
| t-15s | 2026-05-20T01:55:10.903Z | 7 | 4 | 3 | 9 | 0.3 | 0 | 0.1 | 192096 | 251 | 86 |
| t-30s | 2026-05-20T01:55:26.446Z | 7 | 4 | 3 | 9 | 1.4 | 0 | 0 | 181024 | 251 | 83 |
| t-60s | 2026-05-20T01:55:56.053Z | 7 | 4 | 3 | 9 | 0.3 | 0 | 0 | 178400 | 251 | 83 |
| t-90s | 2026-05-20T01:56:25.601Z | 7 | 4 | 3 | 9 | 0.3 | 0 | 0 | 175520 | 251 | 83 |
| t-120s | 2026-05-20T01:56:56.217Z | 7 | 4 | 3 | 9 | 0.2 | 0 | 0 | 178032 | 251 | 83 |

Answers:

- Daemon CPU did not stay materially non-idle after the restart; it briefly
  reported 1.4% at `t-30s`, then returned to 0.2-0.3%.
- WebKit GPU did not stay non-idle in this run.
- WebContent RSS did not trend upward over 120 seconds; it ended lower than it
  started. Thread count also dropped from 87 to 83 and fd count stayed flat.
- Canvas count remained stable while process load stayed low.
- Suspended canvases still have warm WebViews by design, but this run did not
  show CPU activity attributable to suspended canvases.

## Lifecycle And Cleanup Audit

`Canvas.close()` removes the `headsup` WKScriptMessageHandler, cancels TTL, orders
out the native window, and closes it. `DesktopWorldSurfaceCanvas.close()` does
the same for every segment and clears the segment array. Segment rebuild removes
the script message handler and closes orphaned segment windows.

`CanvasManager.handleRemove()` and `handleRemoveAll()` set lifecycle state to
`removed`, close windows/WebViews, abandon lifecycle waiters for removed canvas
IDs, and emit lifecycle removal. `handleSuspend()` intentionally orders windows
out and keeps the WebView warm; `handleResume()` waits up to one second for
renderer ACKs and then shows windows.

Daemon lifecycle cleanup removes input regions on remove and removes
suspend-retained=false regions on suspend. On removal it also clears
`canvasEventSubscriptions`, `canvasPerceptionChannels`,
`canvasObjectRegistries`, `canvasReadyManifests`, parent/child tracking, and the
underlying perception channel.

Suspended canvases can keep daemon subscription entries and warm WebViews. That
is expected lifecycle behavior, but it is exactly why `stale_canvases=0` and
stable canvas count are insufficient health signals.

Sigil's renderer handles `lifecycle:suspend` by setting `rendererSuspended`,
removing Sigil input regions, and suspending the render loop. It handles
`lifecycle:resume` by clearing suspension, resuming the scheduler, syncing input
regions, and scheduling one frame. The render-loop continuation helper is
reason-gated rather than unconditional.

Surface Inspector disables annotation mode and removes annotation runtime
canvases on suspend. Its manifest requires lifecycle, display geometry, marks,
registry, and input region streams; when warm-suspended, the daemon may still
retain subscriptions unless the canvas is removed or unsubscribes.

## Instrumentation Added

`system.ping` now includes a `runtime_resources` block with:

- canvas counts by lifecycle state and surface type;
- native window count and window levels;
- active interactive canvas count;
- active full-desktop canvas count;
- DesktopWorld segment count;
- pending lifecycle waiter count;
- canvas event subscription counts by event type;
- canvas perception channel, ready manifest, and object registry counts;
- input region count and active capture snapshot.

These counters are daemon primitive health data and do not move toolkit or app
policy into the daemon.

## Diagnosis

The likely ownership layer is still daemon/display/toolkit runtime health rather
than canvas count alone. The original Foreman snapshot showed non-idle daemon
and WebKit load with seven canvases. This run, after an unavoidable readiness
restart, did not reproduce the load. The evidence therefore points to an
accumulated runtime state that can be lost across daemon restart, likely in
warm WebViews, WebKit process state, subscriptions, input/perception streams, or
surface-specific render/event loops.

The root cause is not proven in this slice. The narrow fix was to add reusable
resource telemetry and primitive health counters so the next preserved dirty
runtime can be classified without cleanup.

## Interaction Run

Skipped. `./aos ready` initially failed with `input_tap_not_active`, and the
work card requires human approval for live interaction. No broad synthetic mouse
interaction was run against the live desktop.

## Recommended Next Repair Card

Run `scripts/aos-resource-snapshot` before any readiness repair when the user
reports jank again, then compare `runtime_resources` from `system.ping` and the
snapshot summary across a 2-5 minute idle window. If counters show stable
canvas/window counts but growing WebKit CPU/RSS, isolate by launching controlled
single-surface conditions in an isolated daemon state root: simple interactive
canvas, full-desktop `track=union`, `avatar-main`, `aos-desktop-world-stage`,
`surface-inspector`, Sigil hit/radial surfaces, and one warm-suspended canvas.
