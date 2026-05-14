# Employer Brand Reviewed Locator Capture Plan V0

Pre-capture plan for live evidence targets whose locators were explicitly
approved by a human reviewer.

The plan consumes `live-evidence-locator-readiness.reviewed.json` and the human
locator approval/review fixtures. It creates executable capture units only for
`locator_ready` targets, carries the reviewed selector, XPath, or Playwright
locator as data, and preserves unresolved, blocked, and rejected targets as
non-executable context.

V0 defines planned manifest slots for future element clips and text extracts,
but all paths remain null and every acceptance status remains `not_run`. The
builder does not open URLs, resolve locators, run codegen, capture screenshots,
create clips, extract text, render reports, export files, run workflows, grab
full pages, crawl, or bypass site controls.

Canonical fixture:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json`
