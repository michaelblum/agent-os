@../../AGENTS.md
@../AGENTS.md

# Daemon Boundary

The daemon is AOS's native arbiter, not the default AOS window manager. It owns
state and routing that must outlive individual canvases: sockets,
subscriptions, display geometry, canvas lifecycle, content routing, input event
delivery, voice/communication routing, and cleanup.

The public socket may begin accepting work only after AppKit's launch callback
and one queued main-loop action. Native capability requests must never race a
merely initialized `NSApplication` that has not entered its event loop.
Status-item invoke and invoke-dry-run must pass the original envelope `data`
object to their typed controller before generic envelope shaping. Reserved
transport keys such as `action`, `__envelope_ref`, and `__envelope_active`
remain invalid request data and may not be overwritten into acceptance.

Scene transport owns only connection-scoped owner/resource leases and delivery
to the singleton toolkit DesktopWorld stage. Declarative validation and render
policy remain in the scene toolkit; disconnect always releases owned scenes.
Named framebuffer proofs travel only as an operation on that existing owner
stream. Admission binds the exact authorized extension digest, declared proof
ID, resource revision, and current topology before the normal all-segment
barrier dispatches; the daemon never accepts runtime pixel predicates or a
second proof connection. Successful proof results contain only the bounded
proof aggregate and must not inherit the ordinary scene snapshot projection.
`desktop-world-scene-controller.swift` is the single atomic owner for scene
lease admission, typed subscriptions, readiness, result/event routing, and
disconnect cleanup. `desktop-world-scene-transport-controller.swift` owns the
canvas I/O, extension admission, barrier timing, and bounded stage readiness
wait around that state aggregate. `UnifiedDaemon` only delegates transport
events and emits response envelopes. Do not recreate parallel scene ownership,
subscription maps, or transport orchestration in the connection handler.
`desktop-world-scene-authorization.swift` defines the capability and committed
input-generation authority aggregate; keep those values coupled rather than
reintroducing independent mutable maps.
Native-effect program catalogs are part of that scene authorization aggregate.
Program-changing operations are serialized globally, validated against the
committed cumulative pipeline budget before all-display dispatch, and published
only after the scene operation settles. `desktop-world-native-feedback-host.swift`
prepares complete candidate Metal contexts on its dedicated serial queue, then
atomically provisions one dormant Metal projection host for every segment in
the exact canvas and topology generation before effect admission opens;
`desktop-world-native-feedback-controller.swift` serializes availability
generation and the bounded main-actor context swap so stale candidates cannot
publish. Input remains closed during preparation. A preparation failure leaves
the browser scene usable and retains at most the previous prepared context;
context replacement, authorization loss, and shutdown deterministically release
the displaced GPU resources when their last active runtime lease ends.
Native pointer admission requires the exact all-display-committed input
generation for the resource. Visual-only scene revisions retain that generation;
interaction replacements remain unavailable until every display commits. Effect
requests retain that generation through capture and presentation, so interaction
replacement revokes in-flight work while visual-only revisions do not. Effect
reauthorization also compares the exact committed binding rather than unrelated
scene revision numbers, and release-phase failure revokes projection authority
before cleanup I/O.
Physical projection hosts belong to DesktopWorld segments, remain hidden,
paused, and delegate-free between effects, and are finalized only with their
segment, stage, or daemon. Effect sheets borrow those hosts and own only
transient mesh, renderer, texture, and captured-frame resources. Disposal
diagnostics count attached effect renderers rather than dormant stage
infrastructure.
Native-effect presentation and lifecycle use separate bounded watchdogs. The
timed effect duration and gesture watchdog begin only after the first frame is
confirmed presented across every active display. All segment renderers share
that presentation epoch; installation time and trigger-to-presentation latency
may not consume the declared effect duration or its cleanup grace.
V3 native-effect height fields are one shared effect-instance resource across
all display renderers. The engine owns fixed stepping, bounded swept emission,
aggregate work admission, immutable buffered state snapshots, backlog dropping,
trajectory easing, and disposal; product names
and effect presets remain outside the daemon.
Program preparation and runtime retirement are independent gates for queued
native-effect replacements. Reopening either gate must converge the same
pending request, and no replacement may start before both gates have settled.
DesktopWorld event-routing failures remain reason-coded and observable through
bounded daemon diagnostics; never log scene payloads, gesture coordinates,
labels, or product data to diagnose delivery.
`desktop-pixel-capture-filter.swift` owns qualified app-process self-exclusion
for warm internal consumers and exact explicit-window exclusion for public
capture. Public capture must not hide the AOS process implicitly.
`desktop-pixel-native.swift` owns ScreenCaptureKit snapshots and bounded warm
streams. Public still discovery and image acquisition use retained completion
callbacks with a bounded logical deadline. A missing callback keeps its exact
generation owner quarantined and blocks later admission without globally
poisoning unrelated settled generations. Only that callback's authoritative
settlement may release the quarantine; a late callback cannot redeliver the old
result or mutate newer state. When a public still has already settled logically,
that late authority automatically reconverges only the warm pool's still-current
desired source generation. A never-callback owner remains quarantined.
`src/shared/desktop-pixel-sample-admission.swift` owns the common usable-frame
and producer-advancement rules shared by runtime capture and native proofs.
`desktop-pixel-native-operation.swift` owns the exactly-once, callback-backed
native start/stop operation used by both paths.
`desktop-pixel-stream-lifecycle.swift` owns generic concurrent stream startup,
compensation, and acknowledged retirement. `desktop-pixel-broker.swift`
serializes that native acquisition across daemon consumers and owns warm-lease
lifecycle. They return in-memory pixel frames only; encoding, cropping,
redaction, persistence, and GPU delivery belong to downstream adapters.
Multi-display warm acquisition configures the
complete stream set before starting every display concurrently; partial startup
failure immediately requests aggregate retirement while retaining late
startup-completion ownership. A retained native-operation owner invokes each
Apple start and stop completion-handler request exactly once on a non-main
system QoS queue. It settles exactly once from either Apple's callback or the
stream delegate's terminal stop and owns no suspended Swift task or continuation.
Settlement before queue admission drops the pending native closure immediately;
the queue captures only the operation owner weakly.
Native start success or the first usable frame may establish startup, whichever
arrives first. A later start failure retires the complete aggregate. Only a stream
proven active receives a compensating stop; a failed start
is confirmed inactive without issuing an invalid stop, and its initiating error
remains authoritative. Both startup evidence and native retirement must settle
before later work is admitted.
That aggregate retirement
wait ignores caller cancellation but remains deadline-bounded, because
cancellation is the reason cleanup is often running. Superseding a warm
configuration does not cancel an in-flight ScreenCaptureKit `startCapture()`;
startup evidence settles before one acknowledged retirement begins, so native
start and stop never race. A startup that misses the settlement deadline fails
the broker closed while its coordinator retains ownership and retires any late
success. Caller cancellation does not cancel an in-flight native operation;
the coordinator waits for settlement and compensates a late start. Content-free
lifecycle diagnostics may record configured, start, first
sample, stop, and delegate-stop phases, but never display identity or pixels.
A native failure marker may retain only the stable `SCStreamError` numeric code;
it may not include localized descriptions, user info, source metadata, or paths.
AOS constructs each warm ScreenCaptureKit source on AppKit's main actor and
dispatches native start and stop requests off the main thread; main-thread
invocation can interrupt ScreenCaptureKit's application connection. An
app-bundle host may exclude its complete AOS process; a raw or otherwise
unqualified host must exclude the complete exact DesktopWorld surface-window set and fails before
stream creation when any requested window is unresolved. Merely appearing in
ScreenCaptureKit's application inventory does not qualify a raw process for app
exclusion. It uses bounded stream configurations selected by the admitted
consumer. Ordinary image products may fit within their declared pixel ceiling
and round down to positive even dimensions. Native DesktopWorld presentation
preserves each display's exact backing dimensions within the native resource
budget; it must fail before ScreenCaptureKit is invoked instead of silently
scaling. `SCDisplay.width` and `height` are point dimensions; derive native
capture pixels from the admitted `SCContentFilter.pointPixelScale` before
applying either sizing policy. The admitted generation-bound
`AOSDesktopWorldDisplayLayout` is authoritative for display identity, ordering,
global DesktopWorld bounds, and point-to-backing-pixel conversion. Daemon
DesktopWorld capture adapters validate against that mapping; they may not
maintain private display reconciliation or coordinate math.
Warm source discovery includes off-screen windows so hidden or suspended stage
windows retain stable identities for conservative source replacement and the
exact-window fallback. Explicit dimensions enforce the applicable pixel budget,
and the stream keeps ScreenCaptureKit's default capture-resolution mode.
A warm stream retains its latest complete or started native
sample, so it uses a fixed queue depth of three and cannot become ready
until every display has retained a usable frame and then delivered a later,
numeric producer timestamp. An idle callback proves liveness for a static
display but never replaces the retained image. Missing status metadata and
unusable timestamps fail closed.
`desktop-frame-capture-adapter.swift` converts a
snapshot into the private WebKit presentation format.
`desktop-frame-warm-pool.swift` owns capability-scoped prewarming for the
authorized DesktopWorld stage. It retains only the broker's latest bounded
native sample set, freezes on demand, and retires on authorization, consent,
topology, stage-window, or stage loss. Runtime freezes require
the exact generation-bound pool configuration and never cold-start
ScreenCaptureKit. A public still is one exclusive transaction on this same
pool: freeze the desired warm identity, await authoritative retirement, admit
exactly one broker still, then restore the still-current desired configuration
before returning. One 24-second monotonic daemon deadline covers quiescence,
capture, restoration, and disconnect cleanup without timer-clearing an
unsettled native owner. Reconciliation during the transaction updates
restoration state but cannot open an overlapping producer. If the frozen source
identity changes, the current desired source must become ready before the old
capture returns a topology-mismatch failure; a nil desired source restores to
idle. Cancellation in quiescing, capturing, and restoring also awaits
authoritative cleanup. Post-ready stream termination is
observed on the exact lease generation; one interrupted source may retire and
reopen once, stale callbacks are ignored, and a repeated current failure stays
unavailable. The capture controller gets
ordered consumers and excluded stage windows from one main-thread context
snapshot used for both prewarming and interaction. One-shot consent probes use
the broker's bounded still-snapshot path. Runtime warm freezes deliver an
encoded frame before asynchronous stream retirement settles; the broker remains
closed until native retirement is acknowledged. Delegate-observed and explicit
ScreenCaptureKit terminal states count as retirement. A successful explicit stop
is latched so repeated cleanup is idempotent; unknown stop failures remain
fail-closed.
`public-capture-controller.swift` accepts a closed request containing the full
canonical display-topology snapshot plus display-ID/ordinal selection mapping.
It rebuilds identity and geometry through the production topology builder and
rejects unknown keys, non-exact numbers, duplicate identities, non-finite
geometry, count overages, selection drift, and pixel-budget overflow before
native capture. For a requested window, one content observation and one broker
transaction admit both the preferred window still and a full-display fallback;
missing, moved, invalid, or failed window capture returns the display with
explicit source/fallback metadata and a consumer warning. Both native failures
remain a capture failure.
When the delegate reports a terminal error before Apple's startup callback,
retain the delegate error as authoritative and settle the retained native
operation immediately. The callback references that operation weakly, so a
missing or late callback cannot retain the broker ownership graph or settle the
operation twice.
The delegate's terminal callback is also authoritative retirement evidence for
that stream even while the native callback remains pending; a complete display
aggregate may settle without waiting for a duplicate native start callback,
but any stream lacking terminal evidence keeps the aggregate fail-closed.
Delegate retirement and explicit stop admission are linearized by one lifecycle
latch; at most one explicit stop may be admitted, and none after retirement.
`desktop-frame-capture-controller.swift` owns request admission for trusted
scene extensions. A request is bound to the exact scene revision, canvas and
topology generation, and current display WebViews. Native
capture, in-memory handle storage, per-segment decode readiness, and
acknowledged presentation form one bounded request aggregate with one deadline.
`desktop-frame-capture-consent.swift` separately owns process-lifetime direct
capture consent. Passive status never calls ScreenCaptureKit; only the explicit
permissions-prime action may request macOS screen-capture authorization. The
prime uses one bounded in-memory `SCScreenshotManager` snapshot through the
shared broker and discards it immediately; it does not cold-start the
DesktopWorld warm stream before stage surfaces exist. A timed-out probe remains
quarantined until the broker acknowledges settlement, then allows later
explicit retry without admitting overlap. Every prime deadline is bound to the
exact attempt token so an already-running superseded timer cannot settle a later
attempt. The non-interruptible
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
exclusive canvas host leases, committed canonical stage snapshots, and
recording admission. `desktop-world-devtools-stage.swift` owns the bounded v2
wire model, semantic and display-performance validation, and exact-generation
all-display receipt barrier. Its typed receipt outcome is rejected, pending,
or committed; only committed snapshots may publish to inspector hosts or
connection-scoped scene monitors. Host transfer reserves, suspends, activates,
and commits in that order; failure restores the previous host. The daemon may
create the stock AOS panel but owns no DevTools layout or product policy.
Connection-scoped scene monitors consume the same canonical stage snapshot and
existing probe cadence; they must not add another sampler or survive their
owning connection.
Each renderer segment reports performance against its exact canvas generation,
topology generation, and authoritative display ID/index. Refresh requests fail
closed on stale, unknown, or duplicate receipts and become ready only after the
complete expected display set converges; topology changes invalidate partial
receipts. Canonical asynchronous receipts retain the prior complete snapshot
while display segments cross between zero-sample and sampled performance, then
publish the new sampling class only after every expected display converges;
partial receipts never cross canvas, topology, or display identity. Published
metrics remain per-display stage-segment scalars, never a
resource attribution or a sum of rates, timings, DPR, or backing dimensions.
When a one-shot correlated refresh observes both sampling classes, retire that
request from correlated collection and bind its complete receipt set to the
exact canvas, topology, and display identity. Subsequent identity-matched
asynchronous receipts update that set until it is uniform; reusing the handled
request ID is not a convergence mechanism. Each segment probe increments its
producer-local snapshot sequence on every emission, so mutation of an existing
display receipt requires a strictly greater sequence. Equal sequences may be
shared across request receipts only when they came from the same admitted
asynchronous payload event. Every same-identity publication must cover the
current sequence at every display and advance at least one. Same-class
incomparable receipts merge their freshest per-display components; receipts in
different sampling classes wait until one complete vector postdates the other.
If several request-bound sets converge, the newest monotonic request admission
drives that publication, but only requests covered by the published vector
complete. Request tokens carry no lexical ordering, and asynchronous receipts
may update only display indexes already correlated to that request. Exact
canvas, topology, or display-identity replacement starts a new sequence fence.
At inspection read time, the daemon decorates canonical stage snapshots with
the native desktop-frame warm pool's state, display count, generation, and
redacted error code, plus bounded native-effect admission, presentation,
completion, disposal, rejection, and failure counters, active runtime/sheet and
retained buffer/texture/view counts, native trigger-to-presentation latency,
canonical last-execution
owner/resource/program identity and digest, and one redacted error code.
The same snapshot may expose only content-free native render workload facts:
the last backing-pixel count and percentage plus triangle count. It never
includes geometry, coordinates, parameters, texture dimensions, or pixels.
Browser snapshots do not own or cache those facts, and bounded warm lifecycle
transitions republish to active DevTools hosts without polling. DevTools never
includes pixels, handles, paths, frame timestamps, effect parameters,
coordinates, product state, or captured desktop facts. Successful runtime
disposal is recorded only after the runtime reports zero retained buffers,
textures, and views and the exact native sheet removal succeeds.

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
- pointer-session identity is derived independently from pointer consumption;
  `consumePolicy: never` may deliver a pointer-down native effect without
  creating native capture or changing pass-through behavior;
- phase-aware native cursor presentation is derived from the one hovered or
  captured input region. Hover/capture transitions remain independent from
  consumption; hide/show return codes are checked, bounded retries never
  unbalance the process hide count, and successful suppression restores after
  release, cancellation, fail-open, owner cleanup, permission loss, the input
  safety emergency exit, or orderly shutdown;
- generation-bound cursor enter/move/leave delivery contains only region,
  phase, mode, and DesktopWorld point. It is admitted to trusted scene visuals
  only after native hiding succeeds and never grants input or window authority;
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
