---
type: concept
name: Normalize Employer Brand Evidence
description: Process for turning raw captures into reusable evidence items with provenance, gap handling, and consistent labels.
tags: [employer-brand, evidence, normalization, process]
---

# Normalize Employer Brand Evidence

Normalization is the bridge between raw collection and profile synthesis.

## Inputs

- Raw screenshots, page text, source files, and notes
- Collection manifest
- Gap log

## Outputs

- Evidence-ready bundle
- Extracted quotes and proof points
- Explicit unresolved gaps

## Recommended Steps

1. Group artifacts by company and request.
2. Separate direct captures from analyst notes.
3. Extract reusable quotes, proof points, metrics, and visual evidence.
4. Label each evidence item with dimension, source type, and confidence.
5. Deduplicate repeated proof without discarding the strongest citation.
6. Mark stale, missing, or conflicting evidence.

## Rules

- Do not rewrite the company voice during extraction.
- Preserve original phrasing for important quotes.
- Keep one evidence item small enough to reuse in multiple outputs.
- Promote uncertainty forward instead of burying it in notes.

## PLACEHOLDER - Needs Definition

- [PLACEHOLDER] Canonical structure for extracted visual evidence descriptions
- [PLACEHOLDER] Whether normalization should produce machine-readable JSON, markdown, or both
- [PLACEHOLDER] Threshold for when duplicate evidence can be collapsed into one citation

## Related

- [Employer Brand Evidence Model](employer-brand-evidence-model.md)
- [Synthesize Employer Brand Profile](synthesize-employer-brand-profile.md)
