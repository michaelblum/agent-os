---
name: aos-operator-annotations
description: Use AOS pending operator annotations safely. Trigger when an agent needs to list, read, consume, delete, or link compact operator annotations, especially annotations that point at saved refs, fallback targets, or Work Record evidence.
---

# AOS Operator Annotations

Use pending annotations as compact human/operator routing input. They are
consume-once records, not durable task plans.

## Loop

1. Inspect `./aos help see annotation --json` before using subcommands.
2. To start an AOS-owned status-item/operator annotation flow, inspect
   `./aos experience status <id> --json`, dry-run
   `./aos experience menu invoke <id> --item <item-id> --dry-run --json`, then
   run the same invoke command without `--dry-run` only when the mounted surface
   and menu item match.
3. List pending annotations, read the selected record, and inspect any saved ref
   or fallback reason before acting.
4. Consume exactly once only when you are ready to handle the annotation.
5. If the annotation drives an action, capture before/after evidence and link a
   Work Record when the command surface supports it.

## Boundaries

- Non-pending annotations fail closed; do not force reconsume.
- Fallback-only annotations are not proof that a direct action is safe.
- Keep annotation artifacts compact and cite linked evidence instead of
  replaying the action.
- `aos experience menu invoke` covers AOS-owned experience status-item entries,
  not arbitrary third-party macOS menu-extra scraping.

## Stop

Stop when the annotation lacks a saved ref or actionable target, names a missing
workspace/snapshot/ref, or returns a next command that would mutate state without
authorization.

## References

- `docs/api/aos.md`
- `docs/api/toolkit/runtime.md`
- `manifests/commands/source/aos/02-experience.json`
- `manifests/commands/source/aos/03-see-04-annotation.json`
- `tests/external-command-dispatch.sh`
