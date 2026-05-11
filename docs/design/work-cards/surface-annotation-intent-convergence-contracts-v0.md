# Surface Annotation Intent Convergence Contracts V0

## Context

The Employer Brand pilot has built a strong evidence control plane: target
plans, review packs, approval and repair patches, readiness, capture manifests,
diagnostics, acceptance reports, and data bundles. The remaining weakness is
the HITL intent loop. The human still communicates indirectly by editing patch
files after inspecting pages.

The platform needs a general Surface Annotation Intent Convergence foundation:
agent and user converge on live-surface intent directly, then the agent emits a
domain plan, patch, or execution gate.

This is foundational AOS planning work. Employer Brand is the first consumer,
not the abstraction owner.

## Inputs

Read, at minimum:

- `docs/design/surface-annotation-intent-convergence-tracker.md`
- `shared/schemas/annotation.md`
- `shared/schemas/annotation.schema.json`
- `docs/design/aos-workbench-pattern.md`
- `docs/design/aos-surface-system.md`
- `docs/design/evidence-workflow-block-abstraction-tracker.md`
- the current Employer Brand live evidence target/review/patch/capture repair
  artifacts under `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/`

## Deliverables

- A concise contracts planning note under `docs/design/` that defines the V0
  neutral contract shapes before implementation.
- An inventory table classifying existing AOS primitives and Employer Brand
  artifacts as:
  - reusable primitive,
  - candidate neutral contract,
  - domain adapter,
  - Employer Brand-specific field,
  - out of scope.
- Proposed neutral names and responsibilities for:
  - surface binding,
  - overlay anchors,
  - agent proposal layer,
  - human annotation layer,
  - intent convergence record,
  - patch emission,
  - execution gate.
- A minimal event/data-flow sketch from user annotation to emitted patch.
- Explicit non-goals and implementation gates.

## Required Scope

- Keep the output provider-neutral and domain-neutral.
- Preserve Employer Brand as first consumer only.
- Identify which fields remain domain-specific, including KILOS, company
  comparison, employer-brand source categories, and report semantics.
- Treat current patch artifacts as audit records that future convergence should
  emit into, not bypass.
- Describe how execution gates prevent accidental live capture, crawling,
  external writes, or bypass work.

## Hard Boundaries

- Do not implement schemas, helpers, CLIs, overlays, browser controls, or
  runtime code.
- Do not alter Employer Brand capture artifacts.
- Do not run live browser/capture work.
- Do not start report renderer/export/workflow-engine work.
- Do not refactor current evidence workflow blocks.

## Verification

Verification is documentation-only:

- The new planning note exists and links to the tracker.
- It names the neutral contracts and separates generic from domain-specific
  responsibilities.
- It states implementation gates and non-goals.
- It does not modify current capture-path artifacts.
