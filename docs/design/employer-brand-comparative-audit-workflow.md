# Employer Brand Comparative Audit Workflow

Status: draft pilot workflow

Date: 2026-05-07

## Purpose

This note captures the working shape of the Employer Brand Audit to Employer Brand Competitor Comparative Audit workflow. It is intentionally more concrete than a strategy note, but less formal than a schema. The immediate goal is to support a near-term proof artifact while leaving enough structure for later workflow productization.

The pilot should not assume a default client company or default competitors. It should start from a dynamic intake form and allow the user to either name companies directly or ask the agent to suggest likely competitors.

## Current References

Two rough references informed this workflow:

- `KILOS comp audit template.pdf`: a slide-style reference for report structure and narrative flow.
- `SPv5.html`: a data-rich SPA reference that objectizes a Sanofi Immunoscience competitor audit.
- `/Users/Michael/Downloads/KILOS`: local KILOS methodology source documents.
- [Legacy Claude KILOS competitor audit reference](references/employer-brand-legacy-claude/README.md): non-canonical older workflow shape, useful for manifest/executor and local-path provenance patterns.

The deck is the stronger reference for story arc and deliverable shape. The SPA is the stronger reference for the structured data model. Neither is canonical as-is.

The local KILOS methodology documents are the current source for the KILOS dimensions and factor vocabulary.

## KILOS Lens

KILOS is a proprietary motivation model used to understand the desires that create a differentiated and more emotional reason to work for an organization. In this workflow, KILOS is the analysis lens for employer brand evidence.

The five dimensions are:

- `kinship` (orange): culture, community, DEI, psychological safety, wellbeing.
- `impact` (purple): customer focus, internal influence, sustainability, innovation.
- `lifestyle` (blue): job security, benefits, work-life balance, flexibility, tools.
- `opportunity` (green): skills attainment and development, internal mobility, advancement.
- `status` (wine/maroon): heritage, ethics, reputation, commercial success, recognition.

The factor-level vocabulary should remain editable per project, but the current working factor set is:

- Kinship: diverse and inclusive, wellbeing, safe to voice opinions, fairness and respect, sense of belonging.
- Impact: meaningful work for people, meaningful work for the planet, empowerment and autonomy, influence strategy, impact on a big scale, innovation and invention.
- Lifestyle: good benefits, work environment, policies, flexibility in hours, flexibility in location, balance, stability.
- Opportunity: skills attainment, professional expertise, challenge and stretch, career mobility, task variety, career progression.
- Status: brand name recognition, industry reputation, tools and technologies, market position, professional reputation.

For the pilot, evidence should be tagged against one or more KILOS dimensions and, when clear, one or more factor-level labels. The workflow should not force every evidence item into exactly one bucket; employer brand evidence often carries multiple signals.

Brand archetypes can be used as optional interpretation labels when useful, especially in narrative sections. They are not core KILOS dimensions and should not be required for every company audit.

## Core Model

The atomic unit is a Company Employer Brand Audit through the KILOS lens.

The comparative audit is a composition of:

- one client company audit,
- zero or more competitor company audits,
- comparative synthesis,
- source/citation evidence,
- and final artifacts.

In shorthand:

```text
EmployerBrandComparativeAudit
  = n CompanyBrandAudits
  + comparative analysis
  + artifact bundle
  + evidence/work record trail
```

## Dynamic Intake

The workflow begins with an intake interaction. The first version should support:

- asking whether the user already has companies in mind,
- accepting one client company and any number of competitor companies,
- offering likely competitor suggestions when the user wants help,
- accepting optional talent segment,
- accepting optional geography or market,
- accepting optional audience or use case,
- and accepting optional output preferences.

Talent segment and geography are not required. When omitted, the agent should infer reasonable defaults from available evidence and clearly record the assumption.

For the pilot, expect four or five companies. The model should not impose that limit.

## Missing Coverage Policy

Review platforms are always part of this audit version. Glassdoor and Indeed should be attempted first. Other sources can be used when relevant or available.

Missing review coverage is not a workflow failure. It should be recorded as a caveat with a coverage status such as:

- `sufficient`
- `weak`
- `unavailable`
- `blocked`
- `not_applicable`

## Workflow Shape

### 1. Audit Intake

Collect the companies, optional scope, and desired output. If competitors are not supplied, suggest likely competitors and ask for approval.

### 2. Collection Manifest

Create a per-company source plan. The baseline source categories are:

- careers or jobs site,
- employer brand, culture, mission, values, or benefits pages,
- LinkedIn company/life/jobs presence,
- review platforms,
- social or campaign examples,
- awards, rankings, or employer recognition,
- employee story or talent community examples when available.

Each collection request should have a stable request ID that survives collection, analysis, and reruns. The request ID is the anchor that lets an execution map, evidence registry, and final citation trace back to the same intended capture.

### 3. Company Evidence Collection

This is the hardest mini-workflow. It should produce a structured evidence registry, not just notes.

Each evidence item should record an intent layer:

- company,
- source category,
- evidence goal,
- KILOS relevance,
- why this evidence matters,
- and analyst notes.

Each evidence item should also record a repairable execution layer:

- URL,
- request ID,
- selector, XPath, locator, or manual target note,
- extracted text,
- screenshot or crop path,
- capture timestamp,
- status,
- error or caveat,
- and fallback notes.

This mirrors the Work Record intent-spine / execution-map split without requiring the final workflow authoring system to exist yet.

Expected capture artifact types:

- `page_text`: scraped page text.
- `page_source`: raw HTML or equivalent source snapshot.
- `full_page_screenshot`: full-page visual context.
- `element_screenshot`: precise crop of a DOM element.
- `viewport_clip`: screenshot of a viewport region at a recorded scroll position.

For employer brand audits, `element_screenshot` is the most important visual primitive. It is the right shape for careers hero sections, EVP modules, values blocks, award badges, social post cards, and review-site ratings widgets.

### 4. Company KILOS Audit

For each company, transform the evidence registry into one CompanyBrandAudit. The company audit should include:

- company identity,
- source coverage summary,
- employer value proposition and main promise,
- KILOS framework analysis,
- messaging themes,
- brand voice and tone,
- visual identity notes,
- employee sentiment and review-site summary,
- differentiators,
- generic messaging or weak spots,
- evidence-backed claims,
- and caveats.

The KILOS dimensions and working factor vocabulary are defined above. Do not freeze a universal scoring or weighting formula yet. The local mapping workbook shows survey-style factor mapping, but the comparative audit pilot should first use KILOS as a structured evidence and messaging lens.

### 5. Company Audit Review

Each company audit should be reviewable before comparative synthesis. The workflow should also support auto-approval so a pilot can continue end-to-end without human interruption.

### 6. Comparative Synthesis

After company audits are approved or auto-approved, generate:

- shared themes,
- key differentiators,
- whitespace opportunities,
- comparative positioning snapshots,
- KILOS messaging matrix,
- review-site comparison,
- standout engagement examples,
- and recommendations or implications for the client company.

### 7. Artifact Assembly

The first durable output should be structured data. Rendered artifacts can come later.

The near-term Artifact Bundle should include:

- structured comparative audit JSON,
- company audit JSON files,
- evidence registry JSON,
- screenshot/crop assets,
- Markdown report draft,
- source/citation log,
- and a Work Record-style provenance file.

All artifact references should prefer local relative paths inside the artifact bundle. The pilot should avoid Google Drive IDs, absolute paths, or hidden uploads as provenance anchors. Analysis should only cite files that are already present in the evidence pool.

## Browser Evidence Capture V0

Before hand-building the full audit, one high-value substrate slice is Browser Evidence Capture V0.

The goal is a narrow Playwright-backed collector that accepts local or browser-accessible pages plus CSS selectors and/or XPath, then produces normalized evidence objects with cropped screenshots and extracted text.

This is not a public AOS command, not autonomous browsing, and not the final workflow engine. It is a pragmatic bridge for the pilot and a concrete target for later AOS-native browser evidence capture.

Minimum request shape:

```json
{
  "request_id": "example_company_careers_home_hero",
  "company": "Example Company",
  "source_category": "careers_site",
  "url": "https://example.com/careers",
  "selector": "main .hero",
  "xpath": null,
  "evidence_goal": "capture careers hero employer value proposition",
  "kilos_relevance": ["impact", "opportunity"],
  "kilos_factors": ["innovation and invention", "career progression"],
  "notes": "Hero section frames the talent promise."
}
```

Minimum output shape:

```json
{
  "request_id": "example_company_careers_home_hero",
  "company": "Example Company",
  "source_category": "careers_site",
  "source_url": "https://example.com/careers",
  "evidence_goal": "capture careers hero employer value proposition",
  "kilos_relevance": ["impact", "opportunity"],
  "kilos_factors": ["innovation and invention", "career progression"],
  "status": "captured",
  "captured_at": "2026-05-07T00:00:00Z",
  "selector": "main .hero",
  "xpath": null,
  "extracted_text": "Example extracted copy...",
  "screenshot_path": "evidence/example-company/careers-hero.png",
  "error": null,
  "caveat": null
}
```

V0 implementation surface:

- Shape source of truth: `shared/schemas/browser-evidence-capture-v0.schema.json`
  and `shared/schemas/browser-evidence-capture-v0.md`.
- Scriptable collector:
  `node scripts/browser-evidence-capture.mjs --manifest <manifest.json> --out <registry.json>`.
- Toolkit helper:
  `packages/toolkit/workbench/browser-evidence-capture.js`.
- Stable fixture manifest:
  `shared/schemas/fixtures/browser-evidence-capture-v0/valid/manifest.json`.

The collector writes a normalized `aos.browser_evidence_registry` with one row
per request. Successful rows carry extracted text, selector/XPath resolution,
and a local `element_screenshot` crop path. Failed rows, such as missing
selectors, remain in the registry with their original intent fields and
repairable execution metadata. Company audit drafting should consume only this
registry and its local crop assets; it should not browse again or synthesize
missing evidence.

## Capability Gaps

The pilot can proceed manually with Playwright and structured files, but the final product needs these capabilities:

- workflow authoring through conversation, examples, pointing, annotation, and correction,
- dynamic intake forms generated from workflow requirements,
- browser evidence capture by selected element, not just full-page screenshot,
- selector/XPath/locator repair tied to durable evidence goals,
- evidence registry generation,
- citation log generation,
- CompanyBrandAudit schema,
- EmployerBrandComparativeAudit schema,
- human review and auto-approval gates,
- artifact bundle generation from structured data,
- Work Record emission for audit execution,
- and renderers for report app, Markdown/PDF, and slide-style deliverables.

## Next Implementation Prompt

Use this prompt for the next GDI substrate session:

```md
We are in `/Users/Michael/Code/agent-os`.

Goal: Browser Evidence Capture V0.

Build a narrow Playwright-backed evidence collector for the Employer Brand audit pilot. It should capture precise browser page elements into structured evidence objects we can use for the EBA/EBCCA workflow.

Read first:
- `AGENTS.md`
- `docs/api/toolkit.md`
- `shared/schemas/aos-work-record-v0.md`
- `docs/design/employer-brand-comparative-audit-workflow.md`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/subject.json`

Rediscover state first:
- `git status --short --branch`
- `git worktree list`
- `./aos ready`
- `./aos show list --json`
- `./aos dev recommend --json`

Implement the smallest useful slice:
- Add a manifest/request shape for browser evidence captures.
- Support local/fixture URL plus CSS selector and/or XPath.
- Capture element screenshot crop, extracted text, source URL, timestamp, and capture metadata.
- Output normalized evidence registry JSON.
- Include intent fields: company, source_category, evidence_goal, KILOS relevance, notes.
- Include execution fields: URL, selector/XPath, screenshot path, extracted text, status, error/caveat.
- Add stable local HTML fixtures, not live websites.
- Add tests for successful capture and missing selector failure.
- Document how this feeds the Employer Brand audit pilot.

Guardrails:
- No public `aos` command.
- No full workflow engine.
- No autonomous browsing.
- No report renderer.
- No AOS-native Browser Host work.
- Keep it callable from scripts/tests for immediate pilot use.

Verification:
- Run `./aos dev recommend --json --files ...` after edits.
- Run focused tests and router-selected tests.
- Run `git diff --check`.
- Run `./aos ready`.
- Commit the slice.
```
