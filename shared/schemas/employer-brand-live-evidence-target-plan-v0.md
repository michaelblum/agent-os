# Employer Brand Live Evidence Target Plan v0

Status: human-authored live website evidence targeting schema for Employer Brand
audits.

This contract records the user's live website evidence intentions before any
locator/codegen pass, supervised browsing, capture execution, renderer, export,
or workflow engine is allowed to run. It is separate from local SPv5/deck source
artifact targets: those source-artifact targets describe checked-in files, while
this live plan describes exact company website pages and page elements the
human wants to turn into evidence later.

Every target is page-element scoped. A target names the company, company role,
source category, page name, URL, desired element in natural language, evidence
goal, KILOS relevance, capture type, expected clip count, acceptance criteria,
review status, notes, and nullable locator placeholders. The locator placeholder
object intentionally keeps selector, XPath, Playwright locator, codegen hint,
crawl/discovery notes, and capture script slot as null until a later
deterministic locator pass.

The required controls are explicit non-authorizations:

- `full_page_grabs=false`
- `autonomous_browsing_authorized=false`
- `live_collection_authorized=false`
- `report_renderer_authorized=false`
- `export_execution_authorized=false`
- `workflow_engine_authorized=false`

The first fixture lives at:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.json`

That fixture is draft planning metadata only. It seeds representative entries
for the existing Symphony Talent, Phenom, and Radancy audit companies and source
categories, but entries remain `human_review_required` placeholders until a
human approves the exact page URLs and desired elements.
