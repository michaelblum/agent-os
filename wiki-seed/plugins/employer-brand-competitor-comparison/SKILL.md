---
name: employer-brand-competitor-comparison
description: >
  Compare two or more employer brand profiles and produce a competitive readout. Use when the user asks for
  an employer brand competitor comparison, competitive audit, cross-company positioning view, or whitespace analysis.
version: "1.0.0"
author: agent-os
tags: [employer-brand, comparison, workflow]
triggers: ["competitor comparison", "competitive audit", "compare employer brands", "whitespace analysis"]
requires: []
---

# Employer Brand Competitor Comparison

Use this plugin when the task is no longer single-company synthesis and has become competitive interpretation.

## Purpose

Produce one [Employer Brand Comparison](../../entities/employer-brand-comparison.md) from two or more comparable profiles.

## Modes

| Mode | When |
|------|------|
| Compare profiles | Profiles already exist |
| Compare from mixed inputs | Some profiles exist and some must be synthesized first |
| Refresh comparison | A previous comparison needs revision based on new evidence |

## Steps

1. Confirm the company profiles are comparable in scope.
2. Build any missing profiles before comparing.
3. Score and summarize each company by the agreed dimensions.
4. Identify common themes, differentiators, and whitespace.
5. Preserve risk notes and evidence gaps.
6. Save the output using [Employer Brand Comparison Template](references/employer-brand-comparison-template.md).

## Rules

- Do not compare raw notes when profiles can be synthesized first.
- Keep evidence limitations visible in the final comparison.
- Distinguish "crowded category language" from truly owned differentiation.

## Decision Rules

- If the user wants a fast answer from incomplete data, produce a draft comparison with explicit confidence limits.
- If company scopes differ too much, state that the comparison is provisional.
- If the client brand is missing its own profile, do not pretend the competitor comparison is complete.

## Related

- [Compare Employer Brand Profiles](../../concepts/compare-employer-brand-profiles.md)
- [Employer Brand Scoring Scale](../../concepts/employer-brand-scoring-scale.md)
