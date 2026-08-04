@../AGENTS.md

# Shared Contracts

## Purpose

`shared/` contains cross-layer contracts used by native code, scripts, packages,
apps, and tests.

## Ownership

- `schemas/` owns JSON schemas and adjacent contract documentation.
- `gate/` owns shared gate request/record helpers.
- `swift/` owns reusable Swift IPC helpers shared by native modules.
- `user-signal/` owns shared user-signal policy helpers.

## Local Contracts

- Schema changes must update fixtures, docs, and tests that assert the contract.
- `schemas/display-topology-v1.*` owns the closed content-addressed display
  mapping snapshot embedded by spatial-topology 0.3.0 and explicit region
  captures; keep its canonical ordering, fallback, and binary identity encoding
  synchronized with the production Swift helper and deterministic fixtures.
- Shared helpers must stay product-neutral and layer-neutral.
- Do not hide app-specific semantics in shared schema fields.
- `swift/ipc/runtime-paths.swift` owns executable identity. Resolve the running
  Mach-O image authoritatively to an absolute, symlink-resolved path and begin
  repo-root discovery from that identity. If image lookup fails, normalize
  slash-bearing argv from the caller cwd; resolve bare argv by PATH order to an
  executable regular file, including empty and relative entries, with an
  absolute caller-relative path retained as the diagnostic fallback.
  User-facing invocation names remain owned by raw argv in
  `src/shared/invocation.swift`.

## Work Guidance

## Verification

- For schema changes, run the matching `node --test tests/schemas/*.test.mjs`
  file when present.
- For shared Swift IPC changes, run the native or daemon test named by the
  changed contract.

## Child DOX Index

- `gate/` contains shared gate helpers.
- `schemas/` contains schema contracts and documentation.
- `swift/` contains shared Swift helpers.
- `user-signal/` contains shared user-signal policy.
