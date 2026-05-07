# Browser Evidence Capture v0

Status: pilot schema for the Employer Brand comparative audit workflow.

This contract describes a narrow, local-fixture browser evidence collector. It
does not define a public `aos` command, autonomous browsing loop, report
renderer, or AOS-native Browser Host. The immediate producer is the scriptable
Playwright-backed collector in `packages/toolkit/workbench/browser-evidence-capture.js`.

## Manifest

The manifest is the analyst-authored intent list. Each request has a stable
`request_id` that survives capture, analysis, and reruns.

```json
{
  "type": "aos.browser_evidence_capture_manifest",
  "schema_version": "2026-05-browser-evidence-capture-v0",
  "manifest_id": "manifest:example-health-eba",
  "requests": [
    {
      "request_id": "example_health_careers_hero",
      "company": "Example Health",
      "source_category": "careers_site",
      "url": "html/example-careers.html",
      "selector": "main .hero",
      "xpath": null,
      "evidence_goal": "capture careers hero employer value proposition",
      "kilos_relevance": ["impact", "opportunity"],
      "kilos_factors": ["innovation and invention", "career progression"],
      "notes": "Hero section frames the talent promise."
    }
  ]
}
```

`url` is intentionally local in V0: relative fixture paths, `file:` URLs,
`data:` URLs, or localhost HTTP(S). Remote public sites are blocked so the pilot
can exercise the artifact shape without autonomous browsing.

Employer Brand Audit Project V0 fixtures can also be compiled into manifest
skeletons by
`compileBrowserEvidenceManifestFromEmployerBrandAuditProject()` in
`packages/toolkit/workbench/employer-brand-project-browser-evidence.js`, or by
the script wrapper
`node scripts/employer-brand-project-browser-evidence-manifest.mjs --project <project.json> --out <manifest.json>`.
That compiler is a deterministic planning bridge only. It derives request
stubs from the fixture's explicit client company, competitor companies, and
source categories; it emits local placeholder page paths and selectors; and it
does not collect websites, infer competitors, generate reports, execute
exports, or run a workflow.

## Registry

The registry is the normalized execution output. Each evidence object keeps the
request intent fields beside repairable execution fields:

- intent: `request_id`, `company`, `source_category`, `evidence_goal`,
  `kilos_relevance`, `kilos_factors`, and `notes`
- execution: `url`, `selector`, `xpath`, `screenshot_path`, `extracted_text`,
  `status`, `error`, `caveat`, and `selector_resolution`
- capture metadata: timestamp, backend, local URL policy, resolved page URL,
  element visibility, bounding box, screenshot bytes, and backend session

Failure is represented as evidence, not as a missing row. A request whose
selector does not resolve emits `status: "missing_selector"` with the attempted
selector/XPath candidates and no screenshot path.

## Pilot Feed

The Employer Brand audit pilot consumes this registry as the raw evidence pool
for Company Brand Audit V0 fixture drafting. Analysts can cite `request_id` and
`screenshot_path`, inspect the extracted text, and decide which KILOS dimensions
or factors the evidence supports. Later Workflow or Work Record producers can
wrap this registry, but V0 deliberately stops at local element evidence. The
local audit fixture shape is documented in
`shared/schemas/company-brand-audit-v0.md`.

The Employer Brand Artifact Bundle fixture carries a concrete local handoff at:

```text
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/planning-manifest-skeleton.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/manifest.json
docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/browser-evidence/registry.json
```

The planning manifest skeleton is derived from `intake/project.json` and is
linked as read-only planned-request provenance, separate from the captured
manifest and registry. The registry is linked from `subject.json` and
`work-record.json` as read-only, provenance-only evidence. It uses local fixture
HTML pages and local crop assets only; neither file is evidence of live web
collection or report generation.
