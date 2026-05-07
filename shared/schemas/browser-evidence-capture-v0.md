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
for CompanyBrandAudit drafting. Analysts can cite `request_id` and
`screenshot_path`, inspect the extracted text, and decide which KILOS dimensions
or factors the evidence supports. Later Workflow or Work Record producers can
wrap this registry, but V0 deliberately stops at local element evidence.
