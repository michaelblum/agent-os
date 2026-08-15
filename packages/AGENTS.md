@../AGENTS.md

# Packages

## Purpose

`packages/` contains reusable package layers that sit above daemon primitives
and below app-specific product expression.

## Ownership

- `toolkit/` owns reusable AOS surface policy and stock surfaces.
- `cli/`, `daemon/`, and `design-tokens/` own package-scoped support surfaces.

## Local Contracts

- Keep generic reusable behavior in packages; keep product-specific behavior in
  the owning external product repository.
- Do not move native-bound capability into packages when it belongs in `src/` or
  shared Swift/IPC contracts.
- Product orchestration, ingress, model execution, retries, budgets, memory,
  and run state belong in the owning external product repository.

## Work Guidance

- Read a package-local child doc when present before editing that package.

## Verification

- Use the package's existing tests or the repo tests that cover the changed
  package path.

## Child DOX Index

- `toolkit/AGENTS.md` governs reusable AOS surface policy and indexes
  `contracts/`, `controls/`, `panel/`, and `runtime/`.
- `cli/`, `daemon/`, and `design-tokens/` do not have child `AGENTS.md` files
  yet; follow this package contract plus the nearest source, schema, or test doc
  that covers the changed surface.
