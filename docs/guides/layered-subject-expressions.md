# Recipe: Layered Subject Expressions

Use this recipe before adding or refactoring an AOS browser, workbench, editor,
inspector, artifact panel, replay surface, or verifier view. The goal is to
avoid private one-off UI models when the surface is really another projection
of an editable or inspectable subject.

## Core Pattern

A Layered Subject Expression is one subject projected through several
synchronized layers:

```text
narrative intent/description
  -> structured descriptor or execution map
  -> generated controls or specialized editor
  -> artifacts and evidence
  -> health or verification
```

Not every subject needs every layer. The important rule is that the surface
names the layers it owns or consumes before it invents UI, persistence, replay,
or verification logic.

## Examples

- A wiki page can be the narrative/catalog layer for a concept, app, workflow,
  or artifact.
- A radial menu can expose Markdown narrative, JSON menu descriptors, generated
  menu/item controls, 3D preview artifacts, and validation state.
- A 3D item can expose a natural-language shape/effect description, structured
  object descriptors, transform/material controls, render artifacts, and health.
- A work record exposes intent, execution map, evidence, and health.
- A verifier report consumes claims and evidence, then writes verification
  status back as the health/trust layer for the subject.

## Checklist

1. Name the subject and its source of truth.
2. Identify the narrative layer that survives drift.
3. Identify any structured descriptor or execution map.
4. Identify which controls are generated from structure and which are
   specialized editors.
5. Identify artifacts, evidence, and provenance the subject can produce or
   consume.
6. Identify health, validation, or verifier status.
7. Reuse toolkit/workbench primitives for chrome, panes, controls, patching,
   and persistence instead of duplicating private panel logic.
8. Classify generated outputs with
   `docs/design/generated-artifact-lifecycle-policy.md`: name the lifecycle
   class, storage location, cleanup/archive trigger, privacy policy, source
   hash/provenance, and surviving structured result before adding a producer.

## Source Notes

The design seed lives in `docs/design/aos-workbench-pattern.md`. Work records
are the replay, evidence, and verification specialization of the same pattern;
see `docs/design/aos-work-records-and-self-healing-recipes.md`.
