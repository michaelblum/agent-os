---
name: employer-brand-profile-intake
description: >
  Start or refine an employer-brand workflow brief. Use when the user asks to build an employer brand profile,
  start an employer brand audit, define comparison scope, create an intake brief, or gather the inputs needed
  before artifact collection.
version: "1.0.0"
author: agent-os
tags: [employer-brand, intake, workflow]
triggers: ["employer brand profile", "start employer brand audit", "create intake brief", "define comparison scope"]
requires: []
---

# Employer Brand Profile Intake

Use this plugin as the first step in the employer-brand workflow set.

## Purpose

Create or refine the brief that downstream planning, synthesis, and comparison work will consume.

## Modes

| Mode | When |
|------|------|
| New brief | The user has a rough ask but no stable scope artifact |
| Refine brief | A brief exists but key fields are incomplete |
| Resume | Prior workflow artifacts exist and the task is restarting |

## Steps

1. Capture the core ask: client, comparison goal, target audience, market, and company set.
2. Record delivery intent: profile only, comparison, or comparison plus report.
3. Fill missing but important fields with explicit `PLACEHOLDER` markers instead of silently guessing.
4. Save the result using [Intake Brief Template](references/intake-brief-template.md).
5. Hand off to [employer-brand-artifact-collection-planner](../employer-brand-artifact-collection-planner/SKILL.md).

## Rules

- Do not collect evidence in this step.
- Do not expand the competitor set without noting that it was inferred.
- A partial brief is acceptable if the unknowns are visible.

## Decision Rules

- If the user asks for a comparison without a stable company set, create a brief with `[PLACEHOLDER: competitor set]`.
- If the user already has collected evidence, keep intake short and hand off quickly to synthesis.
- If timing, market, or target audience are unclear, preserve the ambiguity in the brief.

## Related

- [Employer Brand Workflow Map](../../concepts/employer-brand-workflow-map.md)
- [Employer Brand Profile](../../entities/employer-brand-profile.md)
