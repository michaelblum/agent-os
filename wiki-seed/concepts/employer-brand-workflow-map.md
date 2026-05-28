---
type: concept
name: Employer Brand Workflow Map
description: End-to-end map for the canonical employer-brand workflow set from intake through comparison and report prep.
tags: [employer-brand, workflow, process]
---

# Employer Brand Workflow Map

This is the canonical path for turning a loose employer-brand request into a reusable comparison artifact.

## Stages

1. Intake and scope definition
2. Artifact collection planning
3. Evidence collection
4. Evidence normalization
5. Single-company profile synthesis
6. Cross-company comparison
7. Report preparation

## Stage Contracts

| Stage | Primary output | Canonical page |
|------|------|------|
| Intake | Brief with scope, audience, market, and company set | [employer-brand-profile-intake](../plugins/employer-brand-profile-intake/SKILL.md) |
| Collection planning | Capture manifest and surface checklist | [employer-brand-artifact-collection-planner](../plugins/employer-brand-artifact-collection-planner/SKILL.md) |
| Normalization | Evidence-ready bundle with gaps called out | [Normalize Employer Brand Evidence](normalize-employer-brand-evidence.md) |
| Synthesis | One [Employer Brand Profile](../entities/employer-brand-profile.md) per company | [employer-brand-profile-synthesis](../plugins/employer-brand-profile-synthesis/SKILL.md) |
| Comparison | One [Employer Brand Comparison](../entities/employer-brand-comparison.md) | [employer-brand-competitor-comparison](../plugins/employer-brand-competitor-comparison/SKILL.md) |
| Report prep | Narrative package, outline, or delivery payload | [employer-brand-report-generation](../plugins/employer-brand-report-generation/SKILL.md) |

## Operating Principles

- Keep knowledge separate from workflow instructions.
- Preserve provenance through every stage.
- Do not skip profile synthesis when the end request is comparison.
- Unknowns should become explicit placeholders, not hidden assumptions.

## AOS Execution Model Boundary

This workflow map is a downstream domain projection over the AOS Execution
Model, not the source of truth for that model. Browser capture and Employer
Brand artifacts are reference material until a separate platform slice maps
them onto the stack:

```text
target control primitive -> capture/evidence block -> reusable capture recipe -> workflow orchestration -> run -> work record + evidence
```

Do not treat this page as authorization to implement browser collection,
capture repair, report export, replay, or a workflow engine.

## Execution-Model Decomposition

Employer Brand material stays useful as domain reference material, but it maps
onto AOS concepts rather than defining them:

| Current material | AOS classification | Notes |
|------|------|------|
| This workflow map, evidence model, scoring scale, message dimensions, collection, synthesis, comparison, and report-prep concept pages | Guide/SOP and domain reference | Reusable judgment and method guidance. They can guide a run but are not executable Recipes. |
| `employer-brand-*` wiki plugins under `wiki-seed/plugins/` | Plugin packaging with Skills | Each plugin packages a `SKILL.md` and optional references. The Plugin/Skill activates or guides work; it is not an execution ladder rung. |
| Intake, collection planning, synthesis, comparison, and report generation skills | Skill | Agent-loadable instructions. A future Skill may call Recipes or Workflows, but the Skill itself is not the Recipe or Workflow. |
| Capture manifest and surface checklist | Evidence template or future Recipe input | The manifest can become input to a source-backed capture Recipe once a generic capture block exists. |
| Browser/source collection steps | Possible Recipe plus Workflow orchestration | A reusable capture Recipe would own bounded capture blocks. A Workflow would own gates, retries, human review, and multi-company orchestration. |
| One completed company/profile/comparison attempt | Run | A Run is the execution instance, whether it is ad-hoc, Recipe-backed, or Workflow-backed. |
| Evidence registry, citations, screenshots, text extracts, source bundles, verifier output | Evidence and Work Record inputs/outputs | Durable proof belongs in Work Records and evidence artifacts, not in the workflow map. |
| Employer Brand schemas and fixtures under `shared/schemas/` and `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/` | Domain schemas, fixtures, and evidence templates | Retained as reference and test data. They do not authorize new generic browser-capture behavior. |
| Report outlines, narrative packages, PDFs, HTML/SPAs, and wiki report pages | UI/report artifacts | Delivery surfaces downstream of Runs and Work Records. |

This decomposition means future implementation should extract generic capture
capabilities into AOS primitives, blocks, Recipes, Workflows, Runs, Work
Records, schemas, and toolkit UI only when the capability is not Employer
Brand-specific. Employer Brand-specific analysis, scoring, and report language
should stay in the domain guides, Skills, Plugins, fixtures, and report
artifacts.

## PLACEHOLDER - Needs Definition

- [PLACEHOLDER] Which stages should eventually become deterministic scripts rather than agent-authored documents
- [PLACEHOLDER] Canonical storage location for intake briefs, manifests, and output artifacts outside the wiki
- [PLACEHOLDER] Review/approval checkpoints before comparison is shared externally

## Related

- [Employer Brand Evidence Model](employer-brand-evidence-model.md)
- [Collect Employer Brand Profile Artifacts](collect-employer-brand-profile-artifacts.md)
- [Synthesize Employer Brand Profile](synthesize-employer-brand-profile.md)
- [Compare Employer Brand Profiles](compare-employer-brand-profiles.md)
- [Employer Brand Audit Pipeline](employer-brand-audit-pipeline.md)
