# Comparative Brand Audit v0

Status: pilot fixture schema for the Employer Brand comparative audit workflow.

This contract describes one Comparative Employer Brand Audit through the KILOS
lens. V0 composes already-reviewed Company Brand Audit V0 fixtures and the
Browser Evidence request IDs those company audits cite. It is intentionally
local-fixture only and does not define a report generator, workflow engine,
public `aos` command, autonomous browser collection path, replay, repair, macro
surface, or viewer.

## Scope

Each comparative audit records the company set, source company audit fixtures,
comparative synthesis, shared themes, key differentiators, whitespace
opportunities, a KILOS positioning matrix, review-site coverage comparison,
standout engagement examples, client implications, evidence-backed claims,
caveats, citations, and provenance.

The required provenance fields keep V0 local and fixture-bound:

```json
{
  "scope": {
    "framework": "KILOS",
    "evidence_scope": "local_fixture_company_brand_audits",
    "company_audit_scope": "local_fixture_browser_evidence",
    "registry_path": "browser-evidence/registry.json",
    "local_fixture_evidence_only": true,
    "live_websites": false,
    "report_generation": false
  }
}
```

## Evidence Citations

`citations[]` is the comparative audit's citation spine. Each entry points to an
existing Company Brand Audit fixture ID and the Browser Evidence registry
`request_id`s used by that company audit:

```json
{
  "company_audit_id": "company-brand-audit:symphony-talent",
  "company": "Symphony Talent",
  "role": "client",
  "request_ids": ["symphony_talent_careers_site_planning"]
}
```

Analysis sections use `company_audit_ids[]` and `request_ids[]` to point back to
that citation spine. Cross-file tests enforce that those IDs resolve to the
existing Company Brand Audit fixtures and Browser Evidence registry rows.

## Pilot Fixture Location

The first concrete Comparative Brand Audit fixture lives inside the Employer
Brand Artifact Bundle:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/comparative-audits/symphony-talent-phenom-radancy.json
```

The Artifact Bundle workbench treats this file as read-only source and
provenance metadata. It is not a new gallery artifact and does not add a
Comparative Brand Audit viewer.
