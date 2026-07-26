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
remains fail-closed and late results cannot alter the newer state.

The broker supports two acquisition forms:

- **snapshot** uses one bounded `SCScreenshotManager` operation;
- **warm snapshot** opens one `SCStream` per admitted display, excludes the
  owning DesktopWorld windows, and retains only the latest complete sample per
  display for a whole-display freeze.

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
All admitted display streams are configured before any startup begins, then
started concurrently as one aggregate. Readiness still requires a fresh sample
from every display. Startup failure or cancellation retires the complete
configured set. A canceled startup remains owned through its eventual callback;
a late success performs compensating retirement. Missing startup or retirement
settlement faults the broker before it can admit later work. Failure diagnostics
contain only the startup phase, bounded elapsed milliseconds, and a reason code.
Cancellation, permission loss, topology mismatch, source failure, daemon
shutdown, or consumer cleanup stops all streams and suppresses late callbacks.
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
