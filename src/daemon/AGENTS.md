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

Use generic nouns in daemon contracts. Prefer `canvas`, `surface`,
`input_region`, `binding`, `channel`, and `lifecycle` over product names such as
`sigil`, `avatar`, or `chat`. Product-specific daemon logic is prohibited unless
an explicit temporary adapter names its external contract and removal gate.

Allowed daemon-side surface work:

- cheap canvas lifecycle and visibility operations;
- native frame and display-topology mutation;
- generic input/hit-region registration and consumption decisions;
- exact `input_region.event` delivery through canonical routed-v1 payloads;
  raw and routed serializers must share the input descriptor in
  `src/shared/input-event.swift`, and incomplete routed input must resolve to
  the tested fail-open decision without leaving capture state active; successful
  delivery keeps typed destination and diagnostic metadata until final serialization;
- lifecycle parentage, cascade cleanup, ownership checks, and recovery;
- platform events that toolkit and external consumers can subscribe to.

Voice transport follows ADR 0022. `voice-transport.swift` owns exact global
hotkey leases, bounded microphone-to-WAV capture, streamed system-speech
playback, meters, and connection cleanup. It must not own transcription,
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

Avoid daemon-side surface policy:

- no default chip layout, panel theme, snap preference, or workbench layout;
- no app-specific input state machines;
- no toolkit-only UI decisions unless they are expressed as generic primitives.
