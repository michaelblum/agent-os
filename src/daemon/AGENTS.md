@../../AGENTS.md
@../AGENTS.md

# Daemon Boundary

The daemon is AOS's native arbiter, not the default AOS window manager. It owns
state and routing that must outlive individual canvases: sockets,
subscriptions, display geometry, canvas lifecycle, content routing, input event
delivery, voice/communication routing, and cleanup.

Use generic nouns in daemon contracts. Prefer `canvas`, `surface`,
`input_region`, `binding`, `channel`, and `lifecycle` over product names such as
`sigil`, `avatar`, or `chat`. Existing Sigil-specific input ownership logic is
convergence debt, not a pattern to copy.

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
- platform events that toolkit and apps can subscribe to.

Avoid daemon-side surface policy:

- no default chip layout, panel theme, snap preference, or workbench layout;
- no app-specific input state machines;
- no toolkit-only UI decisions unless they are expressed as generic primitives.
