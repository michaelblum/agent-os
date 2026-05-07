# Employer Brand Audit Project v0

Status: generic intake/project fixture schema for Employer Brand comparative
audits.

This contract records the project scope that starts an Employer Brand
comparative audit. It is intentionally separate from the Symphony
Talent/Phenom/Radancy output fixture: the same shape can describe any client,
any competitor set, optional talent segment and geography, audience/use case,
output preferences, and intended source categories.

V0 is provenance metadata only. It does not authorize remote web collection,
autonomous browsing, report generation, export execution, replay, repair, macro
playback, or a workflow engine.

## Intake Shape

The required intake fields are:

- `client_company`: the organization being audited.
- `competitor_companies`: zero or more comparison organizations.
- `talent_segment`: optional talent audience or role family, or `null`.
- `geography`: optional market scope, or `null`.
- `audience_use_case`: the intended reader and reason for the audit.
- `output_preferences`: requested artifact types and metadata-only export
  preferences.
- `source_categories`: the intended source coverage plan, such as careers
  sites, employer brand pages, LinkedIn presence, review platforms, social
  campaigns, awards, and employee stories.

The schema does not require a completed audit artifact. `artifact_links` is
optional so a project can exist as intake before any Browser Evidence, Company
Brand Audit, Comparative Brand Audit, Artifact Bundle, or Work Record fixture
exists.

## Local Fixture Links

When a project does point at existing local fixtures, `artifact_links` carries
relative paths to the read-only provenance files:

```json
{
  "artifact_bundle_id": "artifact-bundle:employer-brand-comparative-audit",
  "artifact_bundle_subject_path": "docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/subject.json",
  "work_record_id": "work-record:employer-brand-comparative-audit-fixture",
  "work_record_path": "work-record.json",
  "browser_evidence_manifest_path": "browser-evidence/manifest.json",
  "browser_evidence_registry_path": "browser-evidence/registry.json",
  "company_brand_audit_schema": "shared/schemas/company-brand-audit-v0.schema.json",
  "company_brand_audit_paths": [
    "company-audits/symphony-talent.json",
    "company-audits/phenom.json",
    "company-audits/radancy.json"
  ],
  "comparative_brand_audit_schema": "shared/schemas/comparative-brand-audit-v0.schema.json",
  "comparative_brand_audit_paths": [
    "comparative-audits/symphony-talent-phenom-radancy.json"
  ],
  "read_only": true,
  "provenance_only": true
}
```

Those links make an output bundle traceable to the intake/project fixture, but
they do not make that project the workflow itself.

## Pilot Fixture Location

The first concrete project instance lives inside the Employer Brand Artifact
Bundle fixture:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/intake/project.json
```

That fixture uses Symphony Talent as the client and Phenom/Radancy as
competitors. It is one example project instance of this generic contract, not a
default company set and not a workflow definition.
