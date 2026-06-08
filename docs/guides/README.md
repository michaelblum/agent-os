# Guides And SOPs

`docs/guides/` is the canonical directory for durable, role-neutral Markdown
operating guidance for agent-os. Under the AOS Execution Model V0
([ADR-0013](../adr/0013-aos-execution-model-v0.md)), these files are
**Guides/SOPs**: they shape human and agent judgment, but they are not
executable Recipes.

Guides/SOPs are not one-off handoffs, successor-session memory, role
instructions, executable recipe manifests, or provider skill registries. Put
those elsewhere:

- dock roles and persona contracts live under `.docks/`;
- dock-local skills live under `the session root/skills/<name>/SKILL.md`;
- Implementer work cards live under `docs/design/work-cards/`;
- design plans and specs live under `docs/design/`;
- cross-tool contracts live under `docs/api/`, `shared/schemas/`, or
  `ARCHITECTURE.md`.

## Execution Model Boundary

Agent-os has two separate surfaces that must not be collapsed:

- Markdown Guides/SOPs under `docs/guides/`. These are documentation-only
  procedures that guide classification, implementation, review, or verification.
- Source-backed executable Recipes under top-level `recipes/*.json`. These are
  `aos recipe` manifests with explicit inputs, outputs, blocks, resources, and
  runtime behavior.

`Recipe` now means the executable source-backed procedure. The old `aos ops`
noun is only a compatibility alias for `aos recipe`; do not add new current
guidance that makes `aos ops` canonical.

## Good Guide/SOP Fit

A Markdown Guide/SOP belongs here when it is:

- reusable across more than one dock role;
- about a bounded procedure rather than a whole persona;
- durable enough to cite from docs, tests, work cards, or API contracts;
- specific enough to stop stale-doc drift or repeated bad choices.

Examples include context-doc maintenance, AOS surface interaction decisions,
workstream checkpoint continuation, accessibility surface expectations,
layered subject expressions, and controlled smoke procedures.

For test harness selection and lightweight prep before runtime, canvas, input,
status-item, lifecycle, visual, supervised, or cross-layer work, use
`docs/guides/test-harness-ladder-and-prep.md`.

## Poor Guide/SOP Fit

Do not add or keep a Markdown Guide/SOP here when it is:

- a successor Foreman handoff or session continuation memory;
- Implementer-specific prompt scaffolding better owned by Foreman transfer references;
- Implementer exit-interview or retrospective behavior better owned by Implementer skills;
- obsolete startup guidance superseded by dock-first cold-start docs;
- a provider-managed global skill or local provider registry entry.

When moving misplaced guidance, update links and tests in the same change. If a
guide is pinned by a test or current work card, migrate it in a dedicated slice
instead of deleting it opportunistically.

## Structured Steps

Markdown Guides/SOPs may use light structure when it makes the procedure more
reliable:

- classification choices from a closed set, such as adopt, adapt, reject, or
  defer;
- required authority surfaces to inspect before acting;
- bounded commands or grep checks;
- stop conditions for manual-intervention conflicts;
- evidence the user or next agent should receive.

This structure should clarify judgment. It should not turn every guide into a
schema before the shape has proved useful.

If the reusable result is only a judgment of the form "given these inputs and
this evidence, classify/choose/route this way," cite the Decision Contract /
Inference Block vocabulary in
`docs/design/durable-agent-cognition-and-afk-primitives.md` instead of treating
it as a new executable Recipe type.
