@../AGENTS.md

# Recipes

## Purpose

`recipes/` contains repeatable operational procedures for AOS runtime, canvas,
and app workflows.

## Ownership

- Recipes are operational procedure artifacts, not architecture decisions.
- Durable architecture belongs in `docs/adr/`, `docs/api/`, or
  `shared/schemas/`.
- Executable helpers belong in `scripts/`.

## Local Contracts

- Keep recipes runnable, scoped, and explicit about prerequisites, side effects,
  and cleanup.
- When a recipe becomes canonical workflow guidance, link it from the owning
  guide or dev doc.

## Work Guidance

## Verification

- Run the recipe-specific command or smoke check when changing executable steps.

## Child DOX Index

- `canvas/` contains canvas recipes.
- `runtime/` contains runtime recipes.
- `sigil/` contains Sigil recipes.
