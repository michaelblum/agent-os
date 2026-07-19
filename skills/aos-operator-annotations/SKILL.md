---
name: aos-operator-annotations
description: Use AOS pending operator annotations safely. Trigger when an agent needs to list, read, consume, delete, or link compact operator annotations, especially annotations that point at saved refs, fallback targets, or Work Record evidence.
---

# AOS Operator Annotations

Use pending annotations as compact human/operator routing input. They are
consume-once records, not durable task plans.

## Loop

1. Inspect `./aos help see annotation --json` before using subcommands.
2. For status-item driven annotation flows, use the product-neutral host lease:
   validate/register the descriptor with `./aos status-item`, follow typed
   events on that owning process, then let the consumer translate the received
   action id into the annotation command it owns. Separate inspect/invoke calls
   must carry the exact registered generation and descriptor revision. Refresh
   declarative menu state only through compare-and-swap `status-item update`
   with a strictly newer descriptor while the register-follow owner remains
   alive.
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
- `aos status-item` covers only AOS-hosted owner-scoped leases, not arbitrary
  third-party macOS menu-extra scraping.

## Stop

Stop when the annotation lacks a saved ref or actionable target, names a missing
workspace/snapshot/ref, or returns a next command that would mutate state without
authorization.

## References

- `docs/api/aos.md`
- `docs/api/toolkit/status-item.md`
- `manifests/commands/source/aos/40-status-item.json`
- `manifests/commands/source/aos/03-see-04-annotation.json`
- `tests/external-command-dispatch.sh`
