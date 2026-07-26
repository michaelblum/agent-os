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
instance. The broker serializes native acquisition and rejects overlapping work
with a content-free reason code.

The broker supports two acquisition forms:

- **snapshot** uses one bounded `SCScreenshotManager` operation;
- **warm snapshot** opens one `SCStream` per admitted display, excludes the
  owning DesktopWorld windows, retains only the latest complete sample per
  display, freezes one whole-display set, and stops every stream immediately.

A warm lease is owner-bound, singular, cancelable, and valid only while its
latest samples remain fresh. A different owner cannot freeze or release it.
Cancellation, permission loss, topology mismatch, source failure, daemon
shutdown, or consumer cleanup stops all streams and suppresses late callbacks.
Canceled work receives a bounded retirement interval. A stop failure or missing
retirement acknowledgement faults that broker instance permanently instead of
admitting overlapping native capture. There is no frame history and no
permanently running desktop backdrop.

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
additional transport optimization.

## Consequences

- DesktopWorld no longer cold-starts `SCScreenshotManager` for its effect path.
- Consent probing and scene capture cannot contend inside one daemon.
- Native perception still has an independent legacy capture path until its
  explicit compatibility migration.
- Browser-native screenshots and AX-only perception remain separate.
- Predictive hover warming, continuous capture, frame history, and persistent
  desktop textures remain unsupported.
