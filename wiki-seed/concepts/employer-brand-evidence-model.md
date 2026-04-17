---
type: concept
name: Employer Brand Evidence Model
description: Provenance model for collected employer-brand evidence, including request identity, evidence states, and gap handling.
tags: [employer-brand, evidence, provenance, schema]
---

# Employer Brand Evidence Model

The evidence model defines how raw captures, extracted quotes, and analyst notes become reusable evidence.

## Core Objects

### Capture Request

The planning object that says what to collect and why. Request identity should remain stable from planning through analysis.

### Evidence Item

The smallest reusable unit of proof. An evidence item can be a quote, image, rating, metric, excerpt, or analyst-observed claim.

### Evidence Bundle

The grouped output for one company or one audit scope. Bundles should be comparison-ready only after normalization.

## Minimum Evidence Fields

- `evidence_id`
- `company_slug`
- `request_id`
- `source_type`
- `source_url`
- `collected_at`
- `content_type`
- `directness`
- `confidence`
- `citation_or_asset_path`
- `notes`

## Evidence States

- `direct` - explicitly shown in the source
- `inferred` - analyst interpretation grounded in direct evidence
- `missing` - expected evidence was not captured
- `stale` - evidence exists but may no longer reflect the current employer brand
- `conflicted` - different sources disagree materially

## Gap Handling

Do not fake completeness. Missing evidence should survive into the profile and comparison layers as a visible limitation.

## Practical Rules

- Keep quotes and screenshots tied to the same request when possible.
- Record whether a message appears on owned channels, earned channels, or both.
- Distinguish source facts from analyst synthesis.
- Preserve enough metadata that another analyst can retrace the claim.

## PLACEHOLDER - Needs Definition

- [PLACEHOLDER] Whether OCR and transcript extraction become first-class evidence types
- [PLACEHOLDER] Confidence rules for review-platform data that cannot be reproduced exactly
- [PLACEHOLDER] Freshness window for considering social evidence current enough for comparison

## Related

- [Collect Employer Brand Profile Artifacts](collect-employer-brand-profile-artifacts.md)
- [Normalize Employer Brand Evidence](normalize-employer-brand-evidence.md)
- [Employer Brand Profile](../entities/employer-brand-profile.md)
- [KILOS Competitor Audit Output Schema](../plugins/kilos-competitor-audit/references/output-schema.md)
