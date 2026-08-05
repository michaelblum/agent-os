---
name: aos-recipes
description: Use AOS source-backed executable recipes without confusing them with skills or workflows. Trigger when an agent needs to list, explain, dry-run, or run an AOS recipe.
---

# AOS Recipes

Use recipes for source-backed executable procedures. Skills teach workflows;
recipes execute declared procedure steps.

## Loop

1. Inspect `./aos help recipe --json` before relying on arguments.
2. List recipes, explain the selected id, and run it. Use dry-run only when an
   optional static expansion preview is useful.
3. Use `aos recipe` as the canonical noun.

## Boundaries

- Do not call a markdown guide, playbook, or skill a recipe unless it is
  discoverable through `aos recipe`.
- Dry-run and explain do not grant permission; they are optional inspection mechanics.
- Preserve recipe evidence and cite immutable outputs where available.

## Stop

Stop when a named recipe is not discoverable, expansion is mechanically invalid,
or its declared resources, bounds, or cleanup contract cannot be satisfied.

## References

- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `manifests/commands/source/aos/06-recipe.json`
- `recipes/AGENTS.md`
- `tests/recipe-contract.sh`
