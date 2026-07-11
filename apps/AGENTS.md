@../AGENTS.md

# Applications

## Purpose

`apps/` contains frozen application fixtures retained for deterministic
compatibility proof. Active product consumers live in their owning repositories.

## Ownership

- External apps own product expression, domain state, theming, content, and
  special behavior.
- Reusable native capability belongs in `src/` or `shared/`.
- Reusable surface/windowing policy belongs in `packages/toolkit/`.

## Local Contracts

- Do not grow app-private platform subsystems when the capability belongs in the
  daemon or toolkit for future apps.
- Frozen fixtures must not expose active launch manifests, recipes, packaging,
  or live-product verification.

## Work Guidance

- Follow the fixture-specific child doc before changing retained bytes.

## Verification

- Use only deterministic fixture verification named by the child doc.

## Child DOX Index

- `sigil/AGENTS.md` governs the frozen legacy Sigil fixture.
