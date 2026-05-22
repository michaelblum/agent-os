# Recipes

`docs/recipes/` holds durable, role-neutral operating procedures for agent-os.
Use these Markdown recipes when a repeated engineering, product, verification,
or documentation procedure should shape human and agent judgment without being
owned by one dock persona.

Recipes are not one-off handoffs, successor-session memory, role instructions,
or provider skill registries. Put those elsewhere:

- dock roles and persona contracts live under `.docks/`;
- dock-local skills live under `.docks/<dock>/skills/<name>/SKILL.md`;
- GDI work cards live under `docs/design/work-cards/`;
- design plans and specs live under `docs/design/`;
- cross-tool contracts live under `docs/api/`, `shared/schemas/`, or
  `ARCHITECTURE.md`.

## Recipe Types

Agent-os currently has two recipe surfaces:

- Markdown SOPs under `docs/recipes/`. These are documentation-only procedures
  that guide classification, implementation, review, or verification.
- Source-backed recipes under top-level `recipes/*.json`. These are executable
  `aos ops` manifests with explicit inputs, outputs, and runtime behavior.

ADR 0009 defines the broader distinction between Recipe, Playbook, and
Workflow. Do not collapse these surfaces with a mechanical rename until the
recipe/playbook/workflow model and `aos ops` naming are ready to move together.

## Good Recipe Fit

A Markdown recipe belongs here when it is:

- reusable across more than one dock role;
- about a bounded procedure rather than a whole persona;
- durable enough to cite from docs, tests, work cards, or API contracts;
- specific enough to stop stale-doc drift or repeated bad choices.

Examples include context-doc maintenance, AOS surface interaction decisions,
accessibility surface expectations, layered subject expressions, and controlled
smoke procedures.

## Poor Recipe Fit

Do not add or keep a Markdown recipe here when it is:

- a successor Foreman handoff or session continuation memory;
- GDI-specific prompt scaffolding better owned by Foreman transfer references;
- GDI exit-interview or retrospective behavior better owned by GDI skills;
- obsolete startup guidance superseded by dock-first cold-start docs;
- a provider-managed global skill or local provider registry entry.

When moving a misplaced recipe, update links and tests in the same change. If a
recipe is pinned by a test or current work card, migrate it in a dedicated slice
instead of deleting it opportunistically.

## Structured Steps

Markdown recipes may use light structure when it makes the procedure more
reliable:

- classification choices from a closed set, such as adopt, adapt, reject, or
  defer;
- required authority surfaces to inspect before acting;
- bounded commands or grep checks;
- stop conditions for human-needed conflicts;
- evidence the user or next agent should receive.

This structure should clarify judgment. It should not turn every recipe into a
schema before the shape has proved useful.

If the reusable result is only a judgment of the form "given these inputs and
this evidence, classify/choose/route this way," cite the Decision Contract /
Inference Block vocabulary in
`docs/design/durable-agent-cognition-and-afk-primitives.md` instead of treating
it as a new recipe type.
