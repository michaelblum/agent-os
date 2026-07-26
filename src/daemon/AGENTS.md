@../../AGENTS.md
@../AGENTS.md

# Daemon Boundary

The daemon is AOS's native arbiter, not the default AOS window manager. It owns
state and routing that must outlive individual canvases: sockets,
subscriptions, display geometry, canvas lifecycle, content routing, input event
delivery, voice/communication routing, and cleanup.

Scene transport owns only connection-scoped owner/resource leases and delivery
to the singleton toolkit DesktopWorld stage. Declarative validation and render
policy remain in the scene toolkit; disconnect always releases owned scenes.
`desktop-world-scene-controller.swift` is the single atomic owner for scene
lease admission, typed subscriptions, readiness, result/event routing, and
disconnect cleanup. `desktop-world-scene-transport-controller.swift` owns the
canvas I/O, extension admission, barrier timing, and bounded stage readiness
wait around that state aggregate. `UnifiedDaemon` only delegates transport
events and emits response envelopes. Do not recreate parallel scene ownership,
subscription maps, or transport orchestration in the connection handler.
DesktopWorld event-routing failures remain reason-coded and observable through
bounded daemon diagnostics; never log scene payloads, gesture coordinates,
labels, or product data to diagnose delivery.
`desktop-pixel-native.swift` owns ScreenCaptureKit snapshots and bounded warm
streams. `desktop-pixel-stream-lifecycle.swift` owns generic concurrent stream
startup, compensation, and acknowledged retirement. `desktop-pixel-broker.swift`
serializes that native acquisition across daemon consumers and owns warm-lease
lifecycle. They return in-memory pixel
frames only; encoding, cropping, redaction, persistence, and GPU delivery
belong to downstream adapters. Multi-display warm acquisition configures the
complete stream set before starting every display concurrently; partial startup
failure retains late completion ownership and retires that complete set before
later work is admitted. That aggregate retirement wait ignores caller
cancellation but remains deadline-bounded, because cancellation is the reason
cleanup is often running. A warm stream retains its latest native sample, so it
uses a fixed queue depth of three and cannot become ready until every display
has delivered two distinct complete frame timestamps. This proves producer
advancement instead of mistaking a retained first frame for a live source.
`desktop-frame-capture-adapter.swift` converts a
snapshot into the private WebKit presentation format.
`desktop-frame-warm-pool.swift` owns capability-scoped prewarming for the
authorized DesktopWorld stage. It retains only the broker's latest bounded
native sample set, freezes on demand, and retires on authorization, consent,
topology, or stage loss. Runtime freezes require the exact generation-bound pool
configuration and never cold-start ScreenCaptureKit. The capture controller gets
ordered consumers and excluded stage windows from one main-thread context
snapshot used for both prewarming and interaction. One-shot consent probes
deliver a frozen encoded frame
before asynchronous stream retirement settles; the broker remains closed until
native retirement is acknowledged. Delegate-observed and explicit
ScreenCaptureKit terminal states count as retirement. A successful explicit
stop is latched so repeated cleanup is idempotent; unknown stop failures remain
fail-closed.
`desktop-frame-capture-controller.swift` owns request admission for trusted
scene extensions. A request is bound to the exact scene revision, canvas and
topology generation, and current display WebViews. Native
capture, in-memory handle storage, per-segment decode readiness, and
acknowledged presentation form one bounded request aggregate with one deadline.
`desktop-frame-capture-consent.swift` separately owns process-lifetime direct
capture consent. Passive status never calls ScreenCaptureKit; only the explicit
permissions-prime action may request macOS screen-capture authorization and
probe it through the same warm-snapshot path as runtime capture. A timed-out
probe remains quarantined until the broker acknowledges retirement, then allows
a later explicit retry without admitting overlap. The non-interruptible
authorization request runs on a dedicated serial worker so AppKit remains
responsive, while its bounded deadline remains independent of that worker.
Runtime capture must
atomically claim that gate before emitting a started event or invoking native capture.
The consent probe and runtime controller must share the daemon's one pixel
broker instance so their ScreenCaptureKit work cannot overlap. Disconnect,
replacement, cancellation, partial presentation, delivery failure,
or timeout cancels native work and clears the complete capture set.
`UnifiedDaemon` only routes exact-generation
messages; it must never forward pixels, paths, handles, or frame URLs through
public scene transport, events, diagnostics, or consumer processes.
The singleton full-display stage must be created hidden and resume only after
every physical display segment in the exact current canvas and topology
generation reports ready following transparent renderer initialization.
Readiness failure leaves the stage hidden. The scene result coordinator owns
all-segment prepare/commit barriers and emits one public result only after the
exact generation settles. Topology changes, segment faults, and failed cleanup
retire the complete affected stage generation, invalidate its leases, and leave
no partially healthy projection behind.
`desktop-world-devtools-session.swift` owns revisioned inspector state,
exclusive canvas host leases, bounded canonical stage snapshots, and recording
admission. Host transfer reserves, suspends, activates, and commits in that
order; failure restores the previous host. The daemon may create the stock AOS
panel but owns no DevTools layout or product policy. Connection-scoped scene
monitors consume the same canonical stage snapshot and existing probe cadence;
they must not add another sampler or survive their owning connection.

Use generic nouns in daemon contracts. Prefer `canvas`, `surface`,
`input_region`, `binding`, `channel`, and `lifecycle` over product names such as
`sigil`, `avatar`, or `chat`. Product-specific daemon logic is prohibited unless
an explicit temporary adapter names its external contract and removal gate.

Allowed daemon-side surface work:

- cheap canvas lifecycle and visibility operations;
- native frame and display-topology mutation;
- generic input/hit-region registration and consumption decisions;
- atomic owner-generation input-region replacement: validate every candidate
  and retired ID before mutation, keep the old generation routable until the
  complete replacement commits under one registry lock, and fail closed when
  capture or ownership prevents the switch;
- exact `input_region.event` delivery through canonical routed-v1 payloads;
  daemon input-region pointer and scroll delivery preserves distinct native and
  DesktopWorld coordinates, and downstream code must not infer one coordinate
  space from the other;
  raw and routed serializers must share the input descriptor in
  `src/shared/input-event.swift`, and incomplete routed input must resolve to
  the tested fail-open decision without leaving capture state active; successful
  delivery keeps typed destination and diagnostic metadata until final serialization;
  owner-generation key leases may opt into canonical non-printable Escape
  cancellation; delivery is deduplicated, redacted, and always passes through
  to macOS, and no other key or text may reach the lease owner;
- lifecycle parentage, cascade cleanup, ownership checks, and recovery;
- platform events that toolkit and external consumers can subscribe to.

Voice transport follows ADR 0022. `voice-transport.swift` owns exact global
hotkey leases, bounded microphone-to-WAV capture, streamed system-speech
playback, bounded owner-only WAV playback, meters, and connection cleanup. It
must not own transcription,
conversation policy, product presence state, or branded voice behavior. Voice
events must never carry audio bytes, spoken text, or local paths.
`microphone-authorization.swift` owns the daemon process's four-state macOS
authorization view and the only `AVCaptureDevice.requestAccess(for:.audio)`
call. First capture may request from `not_determined`; denied, restricted, and
unknown states fail before file creation. Health must publish the live daemon
state so foreground CLI preflight can never substitute for capture-owner
authorization.

`connection-outbound-writer.swift` owns daemon socket output. Each connection
has one bounded serial writer for responses and events; slow-client timeout or
overflow shuts down only that connection, and queued work must quiesce before
its file descriptor is closed or reusable.

`annotation-selection.swift` owns connection-scoped lease admission,
cancellation, terminal routing, and the point, rectangle, freehand, and text
sessions. `annotation-target-selection.swift` owns the complete semantic-target
session, including admission, highlighting, ancestor-to-leaf drill-down,
commit, and cleanup. `perceive/ax-semantic-target.swift` owns the typed,
deadline-bounded AX traversal behind injectable reader and clock boundaries.
Accessibility permission is checked once at target-session admission; pointer
tracking must never probe TCC and must coalesce AX hit tests through one
daemon-owned serial resolver. Canceled sessions suppress stale results and may
not create parallel resolver threads. These modules emit bounded
product-neutral evidence and never own pending-annotation persistence,
consumer routing, or project policy.

Avoid daemon-side surface policy:

- no default chip layout, panel theme, snap preference, or workbench layout;
- no app-specific input state machines;
- no toolkit-only UI decisions unless they are expressed as generic primitives.
