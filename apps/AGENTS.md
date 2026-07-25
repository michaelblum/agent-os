@../AGENTS.md

# Applications

## Purpose

`apps/` is intentionally empty of product source and compatibility fixtures.
Active product consumers live in their owning repositories; frozen compatibility
payloads live under `tests/fixtures/`.

## Ownership

- External apps own product expression, domain state, theming, content, and
  special behavior.
- Reusable native capability belongs in `src/` or `shared/`.
- Reusable surface/windowing policy belongs in `packages/toolkit/`.

## Local Contracts

- Do not grow app-private platform subsystems when the capability belongs in the
  daemon or toolkit for future apps.
- Do not restore active or fixture product trees under `apps/`.

## Work Guidance

- Put reusable runtime or toolkit capability in its owning source boundary and
  product composition in the external product repository.

## Verification

- Run active-authority checks when changing this boundary.

## Child DOX Index
