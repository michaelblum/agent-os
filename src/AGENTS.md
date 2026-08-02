@../AGENTS.md

# `src/` Native Layer

`src/` is the OS/kernel layer for AOS. It owns native capability and generic
contracts for the unified `aos` binary: perception, action, display, content,
voice, communication, daemon routing, and service/runtime management.

Keep this layer policy-light and aligned with
`docs/adr/0015-aos-tcc-capability-broker-boundary.md`. Before changing Swift,
prove the change cannot be externalized through manifests, scripts, packages,
recipes, schemas, or another composition layer. Native code may expose the
privileged facts, privileged actions, and privileged streams a surface system
needs, but public command policy and product UI policy belong above it:

- canvas lifecycle, native frames, display topology, content serving, input
  streams, and lifecycle routing belong here;
- DesktopWorld's per-display Metal projection hosts are generation-bound stage
  infrastructure. They are prepared before native-effect admission, stay
  dormant between effects, and retire only with their display segment, stage,
  or daemon;
  consumer effects own no native view lifecycle;
- A native-effect projection may bound its existing Metal view to the union of
  that segment's effect geometry. Mesh positions use that local projection
  frame while texture coordinates retain the complete display segment in the
  global DesktopWorld plane; bounding work may not create another window,
  renderer, capture, topology, or coordinate system.
- Stateful native-effect programs allocate one bounded height field per effect
  instance in the global DesktopWorld plane. Per-display renderers sample one
  immutable generation, share one clock that begins after every display first
  presents, GPU completion gates slot reuse, and no display may own an
  independent simulation clock or treat a bezel as a field boundary.
  Swept-emitter trajectory easing is engine-owned so route-aligned effects can
  remain coincident with their consumer-owned bodies.
- DesktopWorld WebViews share one non-persistent data store per logical surface,
  and `aos://` proxy responses retain the original request identity with
  no-store policy so a new AOS runtime cannot execute stale toolkit modules.
- the owner-scoped native status-item lease, exact-revision compare-and-swap,
  generation-scoped atomic action admission, AppKit-derived anchor facts, and
  native activation/menu bridge live in
  `display/status-item*.swift`; the successful installation anchor is also the
  committed registration/readiness anchor, so initial readiness may not depend
  on a second best-effort AppKit lookup; anchor updates track the current button
  and status-bar window across frame changes and AppKit rehosting; native clicks
  and programmatic invokes share the main-thread allocator, descriptor updates
  preserve it, new lease generations reset it, and failed delivery never rolls
  it back; consumer visuals and product actions do not;
- permission status and request primitives belong to the process that owns the
  privileged capability; daemon-owned microphone capture therefore uses
  daemon-owned authorization rather than foreground CLI authorization;
- daemon socket admission begins only after AppKit finishes launch and services
  one queued main-loop action, so clients cannot invoke native hosts against a
  merely initialized but not yet running application connection;
- generic windowing semantics, panel chrome, minimize chips, and reusable
  workbench layout belong in `packages/toolkit/`;
- product themes, product UX, and product-specific surface behavior belong in
  the owning external product repository;
- product-specific daemon branches are prohibited unless an explicit temporary
  adapter names its external contract and removal gate.
- `aos runtime probe desktop-pixels` is a supervised development baseline that
  runs directly in the foreground AOS process. Its `standalone` host is the
  known-working control; its `desktop-world` host reuses the canonical segment
  topology, windows, and lifecycle while preserving the same capture and Metal
  renderer. The DesktopWorld host installs one stable AOS-owned native sheet at
  `io.agent-os::native-sheet/main` and resolves that exact sheet before
  presentation; its bounded per-segment tessellated meshes carry global
  DesktopWorld coordinates. A process-wide lease permits one exact sheet
  identity, and its owning canvas binds that lease to one canvas and topology
  generation. A display-topology change retires the whole sheet before segment
  mutation; consumers must remount capture, renderers, and diagnostics as one
  new generation instead of partially reconciling them.
  Native DesktopWorld effects capture each display at its exact backing
  dimensions within the native resource budget. Ordinary image products may
  use an explicitly bounded fit policy, but native presentation never silently
  substitutes a lower-resolution texture. Capture dimensions must convert
  ScreenCaptureKit display points with the admitted filter's point-to-pixel
  scale. For native DesktopWorld projection,
  `src/shared/desktop-world-display-geometry.swift` owns the one
  generation-bound mapping among physical points, global DesktopWorld points,
  and backing pixels. Capture, rendering, and native-sheet damage modules in
  that path consume the mapping and may not derive or reconcile display
  coordinates or scale independently. A flat native sheet is a neutral
  pixel pass-through; material lighting and refraction apply only where the
  declared effect deforms the sheet.
  Both hosts must remain daemon-free, broker-free, prompt-free, content-free in
  output, and unavailable to product consumers. The public adapter and hidden
  primitive both require `AOS_ENABLE_DEVELOPMENT_PROBES=1` before any native
  resource is created.
- Historical embedded-product config residue may be retired only through an
  exact key and repo-path migration. Preserve external or user-defined content
  roots and never mutate the frozen product fixture during config cleanup.

Shared native response serialization lives in
`src/shared/response-envelope.swift`; direct replies and daemon connection
writers must use that single NDJSON envelope encoder.

When a WebView or toolkit implementation is slow, do not move the whole feature
into Swift by reflex. Identify the missing native primitive first, then keep the
policy at the lowest reusable layer that still preserves opt-in customization.

## Child DOX Index

- `act/AGENTS.md` governs native `aos do` action primitives, session-mode
  action execution, AX targeting, canvas action refs, and exact native app,
  menu, and window lifecycle controls.
- `daemon/AGENTS.md` governs daemon-specific native arbitration, sockets,
  subscriptions, display geometry, canvas lifecycle, content routing, input
  delivery, voice/communication routing, and cleanup.
