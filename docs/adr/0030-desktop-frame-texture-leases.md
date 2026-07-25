# ADR 0030: Desktop Frame Texture Leases

- Status: Accepted
- Date: 2026-07-25

## Context

DesktopWorld effects such as distortion, magnification, masking, redaction, and
guided visual emphasis need a recent view of the pixels beneath the passive
stage. Sending screenshots through a consumer process, the public CLI, JSON, or
base64 would duplicate sensitive desktop content, add avoidable latency, and
make cleanup difficult to prove.

A trusted scene extension already runs in the AOS-owned DesktopWorld realm
under the same-UID trust decision in ADR 0029. It still must not receive a
general TCC, filesystem, process, or daemon bridge.

## Decision

AOS owns an opt-in `aos.scene.desktop_frame_texture` extension capability. The
capability is part of the extension manifest and digest identity. Only the
singleton DesktopWorld stage may request it.

Direct desktop capture also has a process-lifetime consent gate distinct from
the broad Screen Recording readiness check. A new daemon starts with
`screen_capture_direct=permission_required`, without probing ScreenCaptureKit.
Only the explicit operator command
`aos permissions prime screen-capture --json` may request authorization and
perform a bounded in-memory probe. The request uses
`CGRequestScreenCaptureAccess()` on the AppKit main thread so macOS can present
its consent UI before AOS asks ScreenCaptureKit for pixels. Its human-response
deadline is independent of the AppKit thread. Once granted, the probe captures
at most 4,096 pixels from the main display, discards the result immediately,
and creates no file, frame lease, opaque handle, screenshot record, or
diagnostic payload.

Ordinary frame requests fail with `DESKTOP_FRAME_CONSENT_REQUIRED` before
ScreenCaptureKit is called until that explicit probe succeeds. Denial,
permission loss, timeout, and unsupported systems remain latched as
content-free status. Companion or scene interaction can therefore never cause
the first macOS capture dialog. A later explicit prime may retry a settled
denial or failure; a timed-out native operation remains quarantined until its
late completion arrives, preventing overlapping probes.

One trigger creates a bounded capture set across one validated display
topology snapshot. AOS:

- captures every physical display concurrently through its existing Screen
  Recording authority and one `SCShareableContent` snapshot;
- excludes every window belonging to the DesktopWorld stage;
- limits each decoded frame to 1,048,576 pixels;
- holds encoded bytes only in an in-memory, owner-bound store;
- returns one opaque random handle per display with a five-second lease;
- binds each handle to the exact canvas, topology generation, scene revision,
  display segment, and WebView that requested it;
- serves each handle exactly once through the local AOS WebKit scheme;
- stages each decoded segment privately, then updates the stable AOS-created
  Three textures only after every exact display consumer reports ready;
- keeps the capture aggregate active until every exact consumer acknowledges
  presentation, rolling back every staged or visible segment if that barrier
  fails; and
- clears native bytes after the first load while clearing the GPU allocation
  after the effect, failure, cancellation, expiry, or projection disposal.

The store holds at most 16 live handles and 8 MiB of encoded bytes. It schedules
expiry independently of later store access. Capture completion revalidates the
scene owner, resource, extension digest, canvas generation, topology generation,
scene revision, and exact display consumers before making the capture set
available. The daemon delivers admission, handles, and the final presentation
commit only to that exact consumer generation. Scene authorization changes
cancel the same request aggregate synchronously. A canceled, superseded,
timed-out, partially presented, or disconnected request retains no late frame
or visible texture.

No screenshot, path, pixel payload, handle URL, or encoded bytes enter
`scene-follow`, public events, DevTools, diagnostics, or consumer persistence.
The private stage message carries only the opaque per-display handles needed by
the exact authorized WebViews. Content-free extension status may report
dimensions, epoch, capture duration, readiness, and a redacted error code.

The trusted extension receives the Three texture source inside the AOS stage
realm. This is not a sandbox boundary: same-realm reviewed code can inspect
objects it is given. The product daemon, renderer, cartridge, scene transport,
and public adapter receive neither pixels nor the native capture API.

Physical pointer-down may invoke an optional synchronous
`applyPointerVisual()` hook. It is a passive visual notification only. AOS still
owns hit regions, recognition, arbitration, capture, cancellation, and
canonical gesture events; the hook cannot consume input or commit product
state.

V1 deliberately uses one-shot ScreenCaptureKit capture through
`SCScreenshotManager`, JPEG encoding, WebKit decode, and GPU upload. It is not a
zero-copy IOSurface contract and is not a continuous desktop stream. Individual
display captures may have bounded temporal skew even though storage admission
and presentation are whole-set barriers. This is the smallest supported path
that proves the privacy and compositor boundary.
Measured input-to-texture latency and repeated-effect resource evidence decide
whether AOS replaces only the native capture backend with a prewarmed
`SCStream` latest-frame broker. That optimization must retain the same lease,
authorization, topology, and pixel-free public contracts.

## Consequences

- Multiple consumer-owned effects can share one product-neutral desktop-frame
  source without adding effect vocabulary to AOS.
- Blur, masks, black-box redaction, ripple, wake, tear, and magnification remain
  consumer visual recipes.
- Desktop pixels remain transient and outside public scene and product
  transports.
- Consent state is daemon-memory-only and resets when the daemon exits.
- `permissions check` reports direct-capture status passively and never prompts.
- Extension capability changes require a new reviewed digest.
- Continuous capture, frame history, persistence, export, and untrusted
  extension access remain unsupported.
