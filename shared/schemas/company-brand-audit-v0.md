# Company Brand Audit v0

Status: pilot fixture schema for the Employer Brand comparative audit workflow.

This contract describes one Company Employer Brand Audit through the KILOS lens.
V0 is intentionally scoped to local fixture evidence that already exists in a
Browser Evidence Capture V0 registry. It does not define a report generator,
workflow engine, public `aos` command, autonomous browser collection path,
replay, repair, or macro surface.

## Scope

Each audit records company identity, source coverage, employer value
proposition, KILOS analysis, messaging themes, voice and tone, visual notes,
review-site coverage, differentiators, weak spots, evidence-backed claims, and
caveats.

The required provenance fields keep V0 local and fixture-bound:

```json
{
  "scope": {
    "framework": "KILOS",
    "evidence_scope": "local_fixture_browser_evidence",
    "registry_path": "browser-evidence/registry.json",
    "local_fixture_evidence_only": true,
    "live_websites": false,
    "report_generation": false
  }
}
```

## Evidence Citations

`cited_evidence[]` is the audit's citation spine. Each entry repeats the
Browser Evidence registry `request_id`, `source_url`, `status`,
`captured_at`, and `screenshot_path`. The `screenshot_path` is registry-relative
and must match the registry row exactly, for example:

```json
{
  "request_id": "symphony_talent_fixture_evp_hero",
  "company": "Symphony Talent",
  "source_category": "careers_site",
  "source_url": "html/symphony-talent-careers.html",
  "screenshot_path": "screenshots/symphony-talent/symphony-talent-fixture-evp-hero.png",
  "status": "captured",
  "captured_at": "2026-05-07T15:11:01Z",
  "extracted_text_excerpt": "Build talent experiences with people who care about craft and impact."
}
```

Analysis sections use `request_ids[]` to point back to that citation spine.
Cross-file tests enforce that those IDs and screenshots resolve against the
local registry fixture.

## Pilot Fixture Location

The first concrete Company Brand Audit fixtures live inside the Employer Brand
Artifact Bundle:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/company-audits/symphony-talent.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/company-audits/phenom.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/company-audits/radancy.json
```

The Artifact Bundle workbench treats these files as read-only source and
provenance metadata. They are not new gallery artifacts and do not add a
Company Brand Audit viewer.
