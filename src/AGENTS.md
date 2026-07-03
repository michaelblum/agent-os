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
- default windowing semantics, panel chrome, minimize chips, workbench layout,
  theme decisions, and app-specific surface behavior belong in
  `packages/toolkit/` or `apps/`;
- app-specific daemon branches are convergence debt unless a nearby design note
  names the temporary adapter and removal gate.

When a WebView or toolkit implementation is slow, do not move the whole feature
into Swift by reflex. Identify the missing native primitive first, then keep the
policy at the lowest reusable layer that still preserves opt-in customization.

## Child DOX Index

- `daemon/AGENTS.md` governs daemon-specific native arbitration, sockets,
  subscriptions, display geometry, canvas lifecycle, content routing, input
  delivery, voice/communication routing, and cleanup.
