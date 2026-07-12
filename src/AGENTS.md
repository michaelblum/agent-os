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
- generic windowing semantics, panel chrome, minimize chips, and reusable
  workbench layout belong in `packages/toolkit/`;
- product themes, product UX, and product-specific surface behavior belong in
  the owning external product repository;
- product-specific daemon branches are prohibited unless an explicit temporary
  adapter names its external contract and removal gate.

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
