---
name: aos-recipes
description: Use AOS source-backed executable recipes without confusing them with skills or workflows. Trigger when an agent needs to list, explain, dry-run, or run an AOS recipe.
---

# AOS Recipes

Use recipes for source-backed executable procedures. Skills teach workflows;
recipes execute declared procedure steps.

## Loop

1. Inspect `./aos help recipe --json` before relying on arguments.
2. List recipes, explain the selected id, then dry-run before run.
3. Use `aos recipe` as the canonical noun.

## Boundaries

- Do not call a markdown guide, playbook, or skill a recipe unless it is
  discoverable through `aos recipe`.
- Do not run a mutating recipe when dry-run or explain is enough for the task.
- Preserve recipe evidence and cite immutable outputs where available.

## Stop

Stop when a named recipe is not discoverable, dry-run reports unsafe expansion,
or the requested operation would mutate runtime state without authorization.

## References

- `docs/api/aos.md`
- `manifests/commands/source/aos/06-recipe.json`
- `recipes/AGENTS.md`
- `tests/recipe-contract.sh`
