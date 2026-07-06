@../AGENTS.md

# Experiences

## Purpose

`experiences/` contains experience activation material and app-facing runtime
composition metadata.

## Ownership

- Experience files connect apps to AOS runtime activation and status surfaces.
- App implementation remains in `apps/`.
- Generic experience schema or validation belongs in `shared/schemas/` and
  tests.

## Local Contracts

- Keep experience ids, content roots, status-item targets, and app references
  aligned with the owning app.
- Menu entries with a `surface` must target declared mounted surfaces.
  Activation projects matching manifest menu data into the mounted status
  surface through the generic mounted-surface menu projection contract; smoke
  surfaces must not duplicate fixture menu data as their source of truth.
- `mounted-surface-menu-projection.mjs` owns the activation-side projection
  envelope and query parameter for mounted status surfaces.
- Do not encode app-private behavior here when it belongs in app source or
  toolkit policy.

## Work Guidance

## Verification

- Run the existing experience or status command check named by the changed file
  when present.

## Child DOX Index

- `sigil/` contains Sigil experience material.
- `operator-fixture/` contains the non-Sigil fixture experience for app-owned
  operator annotation status-menu contracts.
