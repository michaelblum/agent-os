# ADR 0031: Desktop Pixel Broker And Warm Snapshots

- Status: Accepted
- Date: 2026-07-25

## Context

AOS had independent ScreenCaptureKit implementations for native perception and
DesktopWorld textures. They could overlap despite ScreenCaptureKit callers
needing serialized access. The first DesktopWorld proof also paid cold
`SCScreenshotManager` acquisition cost after pointer-down, which was too slow
for interactive distortion effects.

## Decision

The AOS daemon owns one `AOSDesktopPixelBroker` for native desktop pixels. The
broker is product-neutral and returns bounded in-memory frame sets. It creates
no file, base64 value, evidence record, texture URL, or persisted artifact.
Encoding, cropping, redaction, hashing, evidence persistence, and GPU delivery
are downstream adapters.

The direct-capture consent probe and DesktopWorld runtime share the same broker
instance and the same bounded warm-snapshot acquisition path. The broker
serializes native acquisition and rejects overlapping work with a content-free
reason code. A timed-out prime remains quarantined through the broker's cleanup
acknowledgement, then permits a later explicit retry; uncertain retirement
remains fail-closed and late results cannot alter the newer state. An explicit
prime may recover from one ScreenCaptureKit
`failedApplicationConnectionInterrupted` result only after the failed probe has
retired authoritatively. A second interruption fails closed, and ordinary
runtime interaction does not perform this prime-specific retry. Each timeout is
bound to its exact attempt token, so canceling a superseded timer is not treated
as sufficient protection from an already-running callback.

The broker supports two acquisition forms:

- **snapshot** uses one bounded `SCScreenshotManager` operation;
- **warm snapshot** opens one `SCStream` per admitted display, excludes either
  the qualified app-hosted AOS process or the complete exact AOS surface-window
  set, and retains only the latest complete sample per display for a
  whole-display freeze. Each stream uses a fixed queue depth of three: one slot
  may remain retained by the latest sample while two bounded producer slots
  permit frame advancement.

Process-level self-exclusion is used only when AOS has an app-bundle identity;
ScreenCaptureKit listing a raw executable's PID does not prove that application
exclusion is viable. Raw and otherwise unqualified hosts exclude the complete
exact authorized stage-window set instead. Exact-window exclusion fails before
stream creation if any requested window is unresolved. Warm source discovery
includes off-screen windows so that raw-host capture remains valid while a
stage window is hidden or suspended.

Warm snapshots have two lifecycles. Explicit consent probes stop every stream
immediately after one freeze. Runtime DesktopWorld requests never use that
one-shot path and fail with `DESKTOP_FRAME_NOT_READY` until their
capability-scoped pool is ready. An authorized mounted scene extension declaring
`aos.scene.desktop_frame_texture` may instead keep one daemon-owned warm lease
open after explicit direct-capture consent is ready. That lease is scoped to
the exact current canvas and topology generations, ordered stage displays, and
excluded stage windows captured atomically on the main thread. It is retired on
capability removal, permission failure, topology or stage loss, or daemon
shutdown. Pointer interaction never starts ScreenCaptureKit and never requests
permission; it only freezes the already available latest sample set.

A warm lease is owner-bound, singular, cancelable, and valid only while its
latest samples remain fresh. A different owner cannot freeze or release it.
The exact normalized DesktopWorld window set is part of native stream identity.
A window-set change therefore retires and replaces the warm producer before a
later freeze can be admitted; canvas, topology, display, and pixel-budget changes
do the same.
All admitted display streams are configured before any startup begins, then
started concurrently as one aggregate. Warm ScreenCaptureKit sources are
constructed on AppKit's main actor. A retained operation invokes each native
async start and stop exactly once. Its detached task retains only the native
stream operands and completion until Apple settles; delegate-proven retirement
may release the higher-level coordinator and broker ownership graph first.
Caller cancellation does not cancel Apple's in-flight operation; the
coordinator waits for authoritative startup or retirement evidence and
compensates a late active start when required. The consent probe and runtime
use the same one-megapixel-per-display stream profile. Explicit width and height bounds
control the output surface; the warm stream retains ScreenCaptureKit's default
capture-resolution mode, matching the proven low-latency native path without
requesting a second high-resolution resampling policy.
Readiness requires a usable complete or started sample from every display,
followed by a later producer callback with a
numeric, monotonically advancing timestamp. The later callback may be idle
because ScreenCaptureKit uses that status when a live display has not changed;
it proves liveness but does not replace the retained image. Missing status
metadata, nonnumeric times, blank, suspended, and stopped callbacks fail closed.
The exact normalized DesktopWorld window set remains part of warm-source
identity even when app-hosted process self-exclusion is available, so a surface
replacement conservatively retires the prior producer. Under exact-window
fallback, an absent requested window fails startup before stream creation. The
pre-surface consent probe declares no excluded windows and may use an empty
window fallback until any AOS surface exists.
The native start result or the first usable frame may establish startup,
whichever arrives first. A late start failure still faults that stream and
retires the complete aggregate even when a frame established startup first.
Startup failure or cancellation immediately
requests aggregate retirement while retaining every native operation owner. A
stream proven active receives exactly one compensating stop. A failed start is
confirmed inactive without an invalid stop call, and its initiating error
remains authoritative. The aggregate does not report cleanup complete until
every startup signal settles and every active native stream confirms retirement;
a late success therefore cannot escape cleanup. Missing startup evidence or
retirement settlement faults the broker before it can admit later work. Failure
diagnostics contain only lifecycle markers, the startup phase, bounded elapsed
milliseconds, reason codes, and the stable numeric `SCStreamError` identity;
they contain no localized error description, display identity, or pixels.
An authoritative `didStopWithError` callback records native retirement but does
not cancel the task awaiting `startCapture()`. That task does not retain its
operation owner, and its completion references the startup coordinator weakly,
so bounded failure can release the broker ownership graph without replaying or
canceling the uncertain native operation. Delegate retirement and explicit
stop admission share one atomic lifecycle gate: only one stop may be admitted,
and none may be admitted after retirement.
Scaled warm-stream IOSurfaces round down to even dimensions while remaining
within the declared per-display pixel budget. A budget or aspect ratio that
cannot produce two positive even axes fails before native stream creation.
Cancellation, permission loss, topology mismatch, source failure, daemon
shutdown, or consumer cleanup stops all streams and suppresses late results.
An unexpected source failure permits one retirement-confirmed reopen for the
same scene generation; a repeated source failure remains honestly unavailable
until the authorized configuration changes.
Once a whole-display frame set is frozen and encoded, the presentation adapter
delivers it without waiting for `SCStream` shutdown. Stream retirement proceeds
in the background while the broker remains closed to overlapping acquisition.
The explicit consent probe still waits for that retirement acknowledgement
before reporting the capability ready. Canceled work receives a bounded
retirement interval. A delegate-observed stop or ScreenCaptureKit's explicit
already-stopped, user-stopped, or system-stopped result is a successful
retirement acknowledgement. An unknown stop failure or missing acknowledgement
faults that broker instance permanently instead of admitting overlapping native
capture. There is no frame history, continuous GPU upload, or permanently
rendered desktop backdrop. The warm lease receives frames only while an
authorized capability needs low-latency sampling and stores at most one native
sample per display.

The broker enforces fixed display-count, per-display pixel, and aggregate pixel
ceilings before invoking ScreenCaptureKit. Downstream consumers may set stricter
limits but cannot raise the broker-owned ceilings.

At read time, the daemon decorates DesktopWorld inspection with only the warm
pool's content-free native stage health: `state`, `displayCount`, `generation`,
and a redacted `errorCode`. The browser-produced stage snapshot remains the
canonical engine record, while each inspection observes current native state.
This lets agents and acceptance harnesses wait for `ready` without probing
capture or guessing a delay. Warm lifecycle transitions also republish to an
already-active DevTools host; this is transition-driven and adds no sampler or
frame loop. Pixels, handles, paths, frame timestamps, and desktop facts do not
enter DevTools.

Named framebuffer proof completion is also content-free. It returns the
all-display proof aggregate only and does not attach the ordinary scene snapshot
used by mount, transaction, and inspection results.

For compatibility, DesktopWorld's existing `desktop_frame.acquire` request now
uses one warm snapshot internally and retains the exact lease, topology,
all-segment presentation, expiry, and content-free public contracts from ADR
0030. `aos see capture` keeps its existing output contract until it is migrated
behind daemon broker IPC in a separate slice.

JPEG encoding remains temporarily at the private WebKit presentation adapter.
This is not a zero-copy IOSurface-to-WebGL contract. Native acquisition latency,
freeze latency, decode latency, and cleanup are measured separately before any
additional transport optimization. Retained native samples are quiesced before
stream shutdown, and multi-display streams retire concurrently so cleanup time
is bounded by the slowest display rather than their sum. Native stream shutdown
uses an acknowledgement budget with a one-second settlement margin inside the
broker's five-second fail-closed deadline; it does not delay delivery of an
already frozen frame set.

## Consequences

- DesktopWorld no longer cold-starts `SCScreenshotManager` for its effect path.
- Capability-scoped DesktopWorld effects pay stream startup before interaction;
  pointer-down performs only a bounded freeze, encode, and presentation.
- Consent probing and scene capture cannot contend inside one daemon.
- Native perception still has an independent legacy capture path until its
  explicit compatibility migration.
- Browser-native screenshots and AX-only perception remain separate.
- Predictive hover warming, frame history, continuous texture presentation, and
  persistent desktop textures remain unsupported.
