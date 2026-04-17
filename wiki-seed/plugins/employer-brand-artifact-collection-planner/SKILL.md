---
name: employer-brand-artifact-collection-planner
description: >
  Plan the artifact collection phase for employer-brand work. Use when the user asks for a capture plan,
  manifest, research checklist, evidence plan, or the next step after defining an employer-brand brief.
version: "1.0.0"
author: agent-os
tags: [employer-brand, collection, workflow]
triggers: ["collection plan", "artifact manifest", "evidence plan", "research checklist"]
requires: []
---

# Employer Brand Artifact Collection Planner

Use this plugin to turn a brief into a collection manifest.

## Purpose

Define what should be collected, from where, and why, without performing collection in the planning step.

## Modes

| Mode | When |
|------|------|
| Plan | Brief exists, no manifest yet |
| Refine | Manifest exists but coverage or priorities changed |
| Gap-fill | Collection happened and missing requests must be replanned |

## Steps

1. Read the intake brief.
2. Enumerate required surfaces per company.
3. Write stable request identifiers, priorities, and intended evidence for each request.
4. Call out asymmetries across companies and explain them.
5. Save the manifest using [Collection Manifest Template](references/collection-manifest-template.md).
6. Hand off to collection execution or evidence normalization, depending on what already exists.

## Rules

- Planning only: do not browse or collect during this step.
- Keep coverage symmetric unless there is a documented reason not to.
- Preserve unresolved access problems as explicit gaps.

## Decision Rules

- If the user already has artifacts, switch to a gap-fill manifest rather than recreating the full plan.
- If one company lacks an expected surface, note it directly instead of forcing a fake equivalent.
- If the brief is underspecified, return a manifest draft with `PLACEHOLDER` fields instead of blocking.

## Related

- [Collect Employer Brand Profile Artifacts](../../concepts/collect-employer-brand-profile-artifacts.md)
- [Employer Brand Evidence Model](../../concepts/employer-brand-evidence-model.md)
