---
name: aos-core-orientation
description: Use AOS as Playwright CLI for desktop agents through direct ./aos commands. Trigger when an agent is new to AOS, needs the capability map, or must avoid stale wrappers and competing workflow language.
---

# AOS Core Orientation

Use this skill when you need the shortest safe route into AOS from a coding
agent shell. The product model is:

```text
Playwright CLI, but for the desktop.
```

The rule is:

```text
direct ./aos commands first, help/manifests for command truth, docs for durable concepts
```

## Start

1. Read `docs/api/aos-capabilities.md` when choosing a capability group.
2. Run `./aos help --json` to inspect the current command registry.
3. Run `./aos help <command> --json` before relying on argument shape.
4. Use `./aos ready` for the front-door runtime gate before live runtime work.
5. Use `./aos status`, `./aos doctor`, and command-specific readbacks for
   passive diagnostics.
6. Prefer direct AOS command families over downstream repo-local wrapper
   facades when direct `./aos` is available.

## Boundaries

- Skills are guidance packages, not Recipes, Workflows, Runs, or Work Records.
- Recipes are executable procedures discovered through `./aos recipe`.
- Work Records are durable receipts inspected through `./aos work-record`.
- Wiki plugins are runtime wiki/plugin content, not installed root skills.
- Project-agent orchestration and provider role material stay out of active AOS
  core unless a future ADR supersedes ADR 0019.

## Stop

Stop and inspect the owning help or docs when:

- a command returns structured `recommended_next` or `recommended_next_command`;
- a live action would mutate UI, browser, filesystem, GitHub, or user-global
  skill trees;
- docs or old work cards teach `aos ops`, loose workflow language, or local
  wrappers as the primary path;
- the needed browser primitive is not wrapped by AOS.

For browser escape hatches that AOS does not wrap, consult upstream Playwright
CLI skills instead of copying Playwright skill content into AOS.

## References

- `docs/adr/0018-installable-aos-skills.md`
- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
