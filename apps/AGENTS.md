@../AGENTS.md

# Applications

## Purpose

`apps/` contains opinionated AOS application consumers built on daemon
primitives and reusable toolkit policy.

## Ownership

- Apps own product expression, domain state, theming, content, and special
  behavior.
- Reusable native capability belongs in `src/` or `shared/`.
- Reusable surface/windowing policy belongs in `packages/toolkit/`.

## Local Contracts

- Do not grow app-private platform subsystems when the capability belongs in the
  daemon or toolkit for future apps.
- Keep app launch, content roots, and verification understandable from the app's
  nearest child `AGENTS.md`.

## Work Guidance

- Follow the app-specific child doc before editing a concrete app.

## Verification

- Use app-specific verification from the child doc.

## Child DOX Index

- `sigil/AGENTS.md` governs the Sigil avatar presence app.
