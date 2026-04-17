---
name: employer-brand-report-generation
description: >
  Prepare a report-ready employer-brand output from a completed comparison. Use when the user asks for a
  report outline, presentation-ready narrative, packaged deliverable, or the final handoff after competitor comparison.
version: "1.0.0"
author: agent-os
tags: [employer-brand, reporting, workflow]
triggers: ["generate employer brand report", "prepare report", "create presentation narrative", "package comparison output"]
requires: []
---

# Employer Brand Report Generation

Use this plugin after a comparison artifact exists.

## Purpose

Turn a completed [Employer Brand Comparison](../../entities/employer-brand-comparison.md) into a report-ready package without changing the analysis itself.

## Modes

| Mode | When |
|------|------|
| Outline | A narrative structure is needed first |
| Payload | A structured delivery package is needed |
| Portable report | The team wants a static package or HTML implementation path |

## Steps

1. Confirm the audience and delivery format.
2. Pull the core narrative from the comparison artifact.
3. Select the minimum evidence required to defend each claim.
4. Build the report outline, appendix plan, and asset checklist.
5. If a portable HTML package is requested, use the legacy schema references as implementation aids, not as the canonical workflow definition.

## Rules

- Do not introduce new analysis here.
- If the comparison is weak, say the report is draft-quality.
- Keep delivery artifacts traceable back to the comparison and underlying profiles.

## Implementation References

- [Prepare Employer Brand Report](../../concepts/prepare-employer-brand-report.md)
- [Brand Audit Report Data Schema](../../plugins/kilos-brand-audit-report/references/report-data-schema.md)
- [Brand Audit Report Folder Structure](../../plugins/kilos-brand-audit-report/references/folder-structure.md)

## PLACEHOLDER - Needs Definition

- [PLACEHOLDER] Canonical report outline for the demo flow
- [PLACEHOLDER] Required appendix depth for client-facing versus internal-only outputs
- [PLACEHOLDER] Whether a new repo-native report schema should replace the legacy HTML package contract
