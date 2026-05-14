@../AGENTS.md

# `src/` Native Layer

`src/` is the OS/kernel layer for AOS. It owns native capability and generic
contracts for the unified `aos` binary: perception, action, display, content,
voice, communication, daemon routing, and service/runtime management.

Keep this layer policy-light. Native code can expose the primitives a surface
system needs, but product UI policy belongs above it:

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
