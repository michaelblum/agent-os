# Dock-Local Skills

Dock-local skills are repo-native instructions owned by a dock role. They live
under `.docks/<dock>/skills/<skill-name>/` and use `SKILL.md` as the entrypoint.

The uppercase entrypoint matches the wider skill convention. The `.docks` path
is what makes the skill local to agent-os and scoped to a dock persona.

## Scope

- Put Foreman coordination, transfer, review-routing, and git hygiene skills
  under `.docks/foreman/skills/`.
- Put GDI implementation, validation, completion-report, or retrospective
  skills under `.docks/gdi/skills/`.
- Put Operator live-evidence and supervised human-in-the-loop skills under
  `.docks/operator/skills/` when those workflows become reusable.

Do not import provider-managed global skills wholesale into `.docks`. Treat
Codex, Matt, Pi, Claude, or other provider skill registries as external
references unless the repo explicitly adopts a local variant.

## Shape

A dock-local skill directory may include:

- `SKILL.md` for the triggerable workflow;
- `references/` for recipient shapes, policy detail, or reusable examples;
- `scripts/` for bounded helper commands that the skill explicitly invokes;
- `assets/` for small static fixtures.

Keep `SKILL.md` focused on when to use the skill and where to read next. Move
long recipient contracts, examples, and domain detail into references so the
entrypoint stays quick to inspect.

## Naming

Use lowercase kebab-case directory names and uppercase `SKILL.md` files:

```text
.docks/foreman/skills/session-transfer/SKILL.md
.docks/gdi/skills/work-retrospective/SKILL.md
```

Avoid lowercase `skill.md`. Tests treat that as a legacy dock-local skill path.
