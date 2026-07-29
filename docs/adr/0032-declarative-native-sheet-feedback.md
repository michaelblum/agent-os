# ADR 0032: Declarative Native Sheet Feedback

- Status: Accepted
- Date: 2026-07-28

## Context

ADR 0031 proved a warm, in-memory ScreenCaptureKit frame set and an AOS-owned
Metal sheet for every DesktopWorld display segment. A product such as Sigil
needs to bind an already recognized companion gesture to a low-latency desktop
effect without receiving pixels, native graphics handles, or arbitrary code
execution inside the privileged daemon.

The WebKit/Three.js stage remains the general object-scene lane. Passing a
captured desktop frame through JPEG and WebKit is useful for reviewed browser
effects and image products, but it is not the shortest path for a transient
whole-desktop distortion.

## Decision

AOS owns a narrow native-feedback lane beneath the existing transparent
WebKit/Three.js projection. It reuses the same DesktopWorld topology, segment
windows, global coordinate plane, gesture events, warm pixel broker, and native
sheet established by ADRs 0024, 0026, 0030, and 0031. It creates no second
desktop model or input system.

Scene interactions may include one optional declarative `nativeEffect` with:

- a trusted AOS implementation ID;
- either native `pointer_down` input or a recognized gesture phase of `start`
  or `end`; and
- an exact bounded parameter object.

V1 registers only `aos.scene.effect.desktop-ripple`. Its parameters control
amplitude, decay, duration, frequency, radius, and speed. The effect is a
product-neutral rendering primitive, not Sigil state or behavior. A consumer
cartridge chooses the interaction, trigger phase, and values. AOS compiles and
runs the Metal program; consumer JavaScript, Metal source, functions, remote
assets, and unknown implementations are rejected.

Admission requires the digest-bound scene extension to declare both
`aos.scene.desktop_frame_texture` and `aos.scene.native_sheet_effect`. Native
effect bindings become authoritative only after the exact scene mount or
transaction commits across every display segment. Failed, stale, aborted, or
removed operations cannot change the active binding. Each event is revalidated
against owner, resource, revision, canvas generation, topology generation,
interaction ID, and phase immediately before capture and presentation.

Gesture recognition and the native response execute inside AOS. A
`pointer_down` trigger resolves its declared primary, middle, or secondary
button against the committed generation-scoped native hit region before browser
gesture arbitration; its owner, resource, affordance, and scene revision must
match the committed authorization. The button defaults to primary/left. This
allows immediate visual feedback without forcing a tap recognizer to claim
before it can distinguish a tap from a drag. Triggering does not require a
public `scene-follow` subscription or a round trip through the consumer. Public
gesture delivery remains independent and content-free.

The runtime freezes the current complete warm frame set; it does not start a
capture stream on pointer input. Pixel buffers move directly into private Metal
textures and never enter JSON, the CLI, WebKit, diagnostics, DevTools,
telemetry, files, or consumer processes. Existing image-product adapters may
derive encoded or cropped outputs from the same broker only at their own
bounded boundary.

The native sheet remains transparent outside the moving effect envelope. A
bounded capture texture may therefore be sampled where displacement is visible
without replacing an unaffected display with a lower-resolution copy. Every
display segment evaluates the same DesktopWorld origin and clock, so a
consumer-supplied radius, speed, and duration can carry one continuous wave
across display boundaries rather than restarting per display.

One native effect may be active per DesktopWorld stage. Concurrent triggers are
rejected rather than queued. Once a committed scene declares the two required
capabilities, AOS prepares the trusted Metal library, pipeline, command queue,
and texture cache before input; it does not capture pixels or install a sheet
at that point. The renderer uses one shared clock and global origin across all
display segments, runs only for the bounded effect duration, and then releases
render delegates, pixel buffers, CVMetal textures, Metal textures, the native
sheet, and active-operation state. Prepared GPU infrastructure is released when
the last authorization disappears or the daemon shuts down. Timeout,
authorization loss, topology change, cancellation, construction failure, and
daemon shutdown follow the same deterministic disposal path. An independent
duration-plus-grace deadline retires the effect even when an occluded, sleeping,
or lost display stops producing draw callbacks. Missing consent, warm readiness,
or GPU support degrades only the effect; it never blocks the gesture or other
DesktopWorld behavior.

## Consequences

- Sigil can bind pointer-down to a cross-display desktop ripple without owning
  capture or native rendering authority.
- AOS gains one reviewed native material primitive, not a general arbitrary-code
  extension ABI or a second scene engine.
- Additional native effects require separately reviewed implementation IDs,
  parameter schemas, resource budgets, and lifecycle proofs.
- Three.js and Metal remain distinct renderers coordinated through the same
  DesktopWorld identity, coordinates, events, clocks, and lifecycle.
- Continuous backdrop capture, native-handle export, and consumer-authored Metal
  remain unsupported.
