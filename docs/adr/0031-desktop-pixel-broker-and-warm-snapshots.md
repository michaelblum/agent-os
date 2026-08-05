# ADR 0031: Desktop Pixel Broker And Warm Snapshots

- Status: Accepted; amended by ADR 0040
- Date: 2026-07-25

## ADR 0040 Transition Boundary

ADR 0040 amends the AOS authority and observation semantics in this decision.
ScreenCaptureKit and macOS TCC remain platform-owned mechanical constraints,
and the broker's bounded serialization, identity checks, settlement, and
cleanup remain correctness mechanics. The explicit direct-capture consent
probe and omission or redaction of facts already admitted to bounded public
health, diagnostic, proof, or inspection observation contracts below are
current legacy implementation behavior and ADR 0040 migration gaps; they are
not AOS-owned permission or privacy policy. The target contract uses ambient
TCC authority, preserves those raw observation facts, and applies omission or
redaction only as an explicit caller-owned transform. This amendment does not
widen the trusted projection realm: desktop pixels, native or WebKit handles,
private broker or stage messages, and product state remain outside bounded
public scene and DevTools contracts.

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
instance, which serializes native acquisition and rejects overlapping work with
a content-free reason code. The explicit pre-surface prime uses one bounded
`SCScreenshotManager` snapshot and discards it immediately. It verifies the
daemon's direct ScreenCaptureKit permission without cold-starting a continuous
stream before DesktopWorld surfaces exist. Runtime DesktopWorld capture uses the
warm-snapshot path only after an authorized stage provides its exact display and
window identity. A timed-out prime remains quarantined through broker settlement,
then permits a later explicit retry; late results cannot alter newer state. Each
timeout is bound to its exact attempt token, so canceling a superseded timer is
not treated as sufficient protection from an already-running callback.

The broker supports two acquisition forms:

- **snapshot** uses one bounded `SCScreenshotManager` operation;
- **warm snapshot** opens one `SCStream` per admitted display, excludes either
  the qualified app-hosted AOS process or the complete exact AOS surface-window
  set, and retains only the latest complete sample per display for a
  whole-display freeze. Each stream uses a fixed queue depth of three: one slot
  may remain retained by the latest sample while two bounded producer slots
  permit frame advancement.

Production `aos see capture` native pixels use the same daemon broker through a
private strict `see.capture` request. The foreground pipeline observes display
topology once, resolves display/window/region policy against that immutable
snapshot, and sends the full canonical topology with a display-ID/ordinal
selection mapping to the daemon. The daemon reconstructs the content identity
and native/DesktopWorld geometry with the production topology builder; caller
geometry or a separate hash is not an authority. It rejects unknown nested
keys, non-exact numeric values, non-finite geometry, duplicates, count overages,
selection drift, and pixel-budget overflow before native work. The daemon
quiesces and authoritatively retires any warm owner, admits exactly one public
still, then restores the still-current desired warm configuration before the
caller can complete. A 24-second monotonic transaction deadline covers
quiescence, still callbacks, restoration, and disconnect cleanup; the foreground
consumer uses one 25-second monotonic deadline inside its existing 30-second
outer budget. Neither deadline clears an unsettled native owner. Reconciliation
during this transaction updates the restore target without opening a second
producer. If the source changes from A to B, B must become ready before A's
capture fails with topology mismatch; a nil target restores to idle. Browser
capture remains daemon-free;
the gated foreground development probe remains a non-production control.

Public still discovery and screenshot acquisition use Apple's completion
handlers, not unbounded async still awaits. Each callback has a retained token
and a bounded logical deadline. A missing callback keeps its exact generation
owner quarantined and blocks later native admission without converting that
uncertainty into a global terminal state. Only authoritative settlement of that
callback releases the quarantine; a late callback cannot redeliver the old
logical result or mutate a newer transaction. After a public still has already
settled logically, late authoritative settlement automatically reconverges only
the warm pool's still-current desired source generation. It does not reopen the
frozen source or admit before authority. If the callback never arrives, the
exact owner remains occupied indefinitely.
Warm streams report post-ready terminal failure to the exact lease generation.
One current connection interruption may perform one retirement-confirmed
reopen; a stale callback is ignored and a repeated current failure remains
unavailable.

Public capture uses explicit excluded window IDs and never implicitly hides the
AOS process. A window request prepares the full-display still and, when the
window is valid in the same single content observation, the preferred window
still within one broker transaction. Missing, moved, invalid, or failed window
capture falls back to the display and emits exact source/fallback metadata plus
a generic consumer warning; if both stills fail, capture fails. Encoded PNGs
cross the normal bounded outbound writer as ordered
384 KiB `see.capture_chunk` events with capture/topology/display/frame/chunk
identity, total byte count, and SHA-256. The final response contains metadata
only. This permits frames above the writer's 32 MiB queued-byte ceiling while
keeping one bounded event admitted at a time and creating no daemon artifact or
alternate byte channel. The foreground consumer validates order, counts,
digest, topology identity, and decoded geometry before applying existing crop,
overlay, perception, saved-ref, or output policy. It accepts only exact integer
JSON tokens within the safe-integer and native field bounds, rejects floating
tokens and closed-shape drift, and reads bounded NDJSON frames under one
monotonic absolute deadline even when a peer drips partial bytes.

The foreground error projection is closed: broker busy maps to `CAPTURE_BUSY`,
screen-capture permission failure to `PERMISSION_DENIED`, missing display or
topology drift to `CAPTURE_TOPOLOGY_MISMATCH`, and every other admitted capture,
transfer, retirement, unsupported, unauthorized, unknown, timeout, or read-loss
failure to `CAPTURE_FAILED`. `DAEMON_UNREACHABLE` is reserved for failure to
connect before admission.

Process-level self-exclusion is used only when AOS has an app-bundle identity;
ScreenCaptureKit listing a raw executable's PID does not prove that application
exclusion is viable. Raw and otherwise unqualified hosts exclude the complete
exact authorized stage-window set instead. Exact-window exclusion fails before
stream creation if any requested window is unresolved. Warm source discovery
includes off-screen windows so that raw-host capture remains valid while a
stage window is hidden or suspended.

Warm snapshots have one runtime lifecycle. DesktopWorld requests fail with
`DESKTOP_FRAME_NOT_READY` until their capability-scoped pool is ready. An
authorized mounted scene extension declaring
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
constructed on AppKit's main actor. A retained operation dispatches each native
start and stop completion-handler request exactly once on an explicit non-main
QoS queue. This matches the proven ScreenCaptureKit path and avoids immediate
application-connection interruption observed when invoking startup on the main
thread.
The operation settles from either Apple's completion callback or the stream
delegate's terminal stop, whichever is accepted first. It owns no suspended
Swift task or continuation. Delegate-proven retirement therefore cannot leave a
detached waiter retaining the stream after ScreenCaptureKit drops its callback.
If settlement wins before queue admission, the pending native closure is released
immediately and the weakly owned queue block becomes a no-op.
Caller cancellation does not cancel Apple's in-flight operation; the
coordinator waits for authoritative startup or retirement evidence and
compensates a late active start when required. Runtime warm capture selects an
explicit sizing policy for its admitted use. Ordinary encoded image products
fit within a one-megapixel-per-display profile. Native DesktopWorld presentation
instead preserves each display's exact backing dimensions within the native
resource budget and fails closed when that exact surface cannot be admitted.
ScreenCaptureKit reports `SCDisplay` dimensions in points, so the capture
profile derives backing pixels from the admitted filter's `pointPixelScale`;
using the point dimensions directly is not an exact native capture.
The generation-bound `AOSDesktopWorldDisplayLayout` is the sole native mapping
between physical display points, global DesktopWorld points, and backing
pixels. Capture, Metal presentation, damage accounting, and future image
adapters consume that mapping rather than reconciling display scale or
coordinates independently.
Explicit width and height bounds control the output surface; the warm stream
retains ScreenCaptureKit's default capture-resolution mode without requesting a
second resampling policy.
Readiness requires a usable complete or started sample from every display,
followed by a later producer callback with a
numeric, monotonically advancing timestamp. The later callback may be idle
because ScreenCaptureKit uses that status when a live display has not changed;
it proves liveness but does not replace the retained image. Missing status
metadata, nonnumeric times, blank, suspended, and stopped callbacks fail closed.
The exact normalized DesktopWorld window set remains part of warm-source
identity even when app-hosted process self-exclusion is available, so a surface
replacement conservatively retires the prior producer. Under exact-window
fallback, an absent requested window fails startup before stream creation.
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
An authoritative `didStopWithError` callback records native retirement and
settles the retained native operation. Apple's completion callback references
that operation weakly and becomes a no-op if it arrives later, so bounded
failure can release the broker ownership graph without replaying or canceling
the uncertain native operation. Delegate retirement and explicit
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
Canceled work receives a bounded retirement interval. A delegate-observed stop
or ScreenCaptureKit's explicit
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
0030. `aos see capture` keeps its existing output and saved-ref contracts while
its native pixel acquisition is routed through daemon broker IPC.

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
- Native perception and direct/saved `aos see capture` share the daemon's single
  production native-pixel owner while retaining their existing projections.
- Browser-native screenshots and AX-only perception remain separate.
- Predictive hover warming, frame history, continuous texture presentation, and
  persistent desktop textures remain unsupported.
