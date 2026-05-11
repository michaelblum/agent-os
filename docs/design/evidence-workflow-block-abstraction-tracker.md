# Evidence Workflow Block Abstraction Tracker

Status: planning tracker only. Do not implement or extract the abstraction yet.
GitHub tracker: https://github.com/michaelblum/agent-os/issues/293

The Employer Brand comparative audit pilot is exposing a repeatable evidence workflow block pattern. Track the candidate neutral abstraction here so the current pilot can keep moving without broad refactor churn.

## Repeated Block Pattern

The pilot has repeatedly used this sequence:

1. Source target plan.
2. Review pack.
3. Approval patch.
4. Locator readiness.
5. Capture plan.
6. Capture manifest.
7. Acceptance report.
8. Failure review pack.
9. Repair patch.
10. Runtime diagnostics.
11. Data bundle.

## Neutral Candidate Names

| Neutral block | Responsibility |
| --- | --- |
| Evidence source target plan | Declare desired sources/elements, expected counts, capture type, acceptance criteria, and nullable later locator fields. |
| Evidence target review pack | Present planned targets for human review without mutating the target plan. |
| Evidence target approval patch | Record reviewed approvals, edits, rejections, and exclusions as a separate patch. |
| Evidence locator readiness | Classify approved targets by locator-ready, needs locator, needs human review, blocked, or rejected. |
| Evidence capture plan | Convert ready locators into executable capture slots while preserving non-executable context. |
| Evidence capture manifest | Record attempted captures, produced assets, failed slots, blocked slots, and invariant metadata. |
| Evidence acceptance report | Verify captures against structural and domain acceptance criteria. |
| Evidence failure review pack | Classify failed captures into actionable repair queues without fabricating fixes. |
| Evidence repair patch | Record supervised repair decisions, replacement candidates, unavailable sources, or rejections. |
| Evidence runtime diagnostics | Separate tooling/runtime failures from target, locator, content, and access-control failures. |
| Evidence data bundle | Normalize target, capture, acceptance, repair, citation, coverage, and provenance metadata for downstream consumers. |

## Generic Versus Domain-Specific Inventory

Likely generic:

- Artifact lifecycle shape: plan, review, patch, readiness, execution plan, manifest, acceptance, failure review, repair, diagnostics, bundle.
- Count reconciliation: planned slots, attempted slots, accepted captures, failed captures, blocked/not-run context.
- HITL state separation: draft, approved, rejected, blocked, repaired, unavailable.
- Capture invariants: no full-page grabs unless explicitly authorized, nullable future locator/codegen fields, explicit non-goal controls.
- Runtime diagnostics taxonomy: preflight, command availability, navigation, locator evaluation, element screenshot, text extraction, browser close.
- Provenance wiring: source artifacts, derived artifacts, read-only subject/index metadata.

Employer Brand specific:

- KILOS relevance and dimension semantics.
- Company and competitor comparison model.
- Employer brand source categories and evidence goals.
- Slide/deck/SPv5 audit references.
- Report-specific comparative audit inputs and narrative requirements.
- Any employer-brand-specific acceptance wording beyond generic clip/text validity.

## Extraction Gate

Do not extract neutral schemas, helpers, CLI surfaces, or workflow primitives yet. Revisit extraction only after one of these is true:

- The Employer Brand pilot completes enough of the end-to-end evidence loop to show stable boundaries.
- A second non-employer-brand workflow repeats the same block pattern and proves the reuse point.

Until then, keep changes local to the Employer Brand artifacts and use this tracker to classify emerging reusable seams.

## Conservative Next Step

When the extraction gate is met:

1. Inventory every Employer Brand artifact and classify fields as neutral, domain-specific, or adapter/provenance-only.
2. Propose neutral schemas and names before code changes.
3. Define domain adapters for KILOS/company-comparison semantics.
4. Migrate only one block at a time with compatibility fixtures.
5. Keep report rendering/export outside the evidence-block abstraction until evidence data contracts are stable.

## Non-Goals

- No broad refactor during the current capture path.
- No new workflow engine.
- No report renderer/export work.
- No generic abstraction that forces Employer Brand fields into global contracts.
- No deletion or migration of pilot fixtures until the pilot proves the stable shape.
