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
- Do not encode app-private behavior here when it belongs in app source or
  toolkit policy.

## Work Guidance

## Verification

- Run the existing experience or status command check named by the changed file
  when present.

## Child DOX Index

- `sigil/` contains Sigil experience material.
