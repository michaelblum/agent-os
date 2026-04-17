---
name: employer-brand-profile-synthesis
description: >
  Turn employer-brand evidence into one or more reusable employer brand profiles. Use when the user asks
  to synthesize a brand profile, summarize a company's employer positioning, map messaging dimensions, or
  convert collected artifacts into a stable profile artifact.
version: "1.0.0"
author: agent-os
tags: [employer-brand, profile, synthesis, workflow]
triggers: ["synthesize employer brand profile", "build employer brand profile", "map employer brand messaging"]
requires: []
---

# Employer Brand Profile Synthesis

Use this plugin after evidence has been collected.

## Purpose

Produce a reusable [Employer Brand Profile](../../entities/employer-brand-profile.md) for each company in scope.

## Modes

| Mode | When |
|------|------|
| Single-company | One company profile is needed |
| Batch | Multiple company profiles are needed before comparison |
| Resume | A profile exists and must be completed or updated |

## Steps

1. Check whether the inputs are raw artifacts or normalized evidence.
2. If inputs are still raw, normalize them first using [Normalize Employer Brand Evidence](../../concepts/normalize-employer-brand-evidence.md).
3. Map direct evidence to the default dimensions.
4. Write the summary, proof structure, voice notes, and open unknowns.
5. Save the result using [Employer Brand Profile Template](references/employer-brand-profile-template.md).

## Rules

- Keep the output company-specific.
- Cite evidence or state that evidence is unavailable.
- Preserve contradictions instead of flattening them into a clean story.

## Decision Rules

- If comparison is the final request but profiles do not exist, build the profiles first.
- If the evidence bundle is thin, produce a thin profile with explicit caveats rather than inventing completeness.
- If one source dominates the evidence set, say so in the profile.

## Related

- [Synthesize Employer Brand Profile](../../concepts/synthesize-employer-brand-profile.md)
- [Employer Brand Message Dimensions](../../concepts/employer-brand-message-dimensions.md)
