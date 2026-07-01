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
- Shared helpers must stay product-neutral and layer-neutral.
- Do not hide app-specific semantics in shared schema fields.

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
