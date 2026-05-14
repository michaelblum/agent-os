# Employer Brand Element Capture Planning Bundle v0

Planned-only expansion layer between the hand-authored source artifact target
plan and a future deterministic element capture runner.

The bundle records stable work-unit IDs, source artifact references, company
refs for repeated company elements, KILOS relevance, capture type, expected clip
count, readiness state, blockers, locator hints, and acceptance criteria. It may
carry reviewed SPv5 selector and Playwright hints only where the local HTML has
stable DOM ids or stable direct-child structure.

V0 does not authorize live browser collection, screenshots, element clip
generation, report rendering, HTML/CSS polish, PDF/DOCX export, workflow engine
execution, or full-page grabs.

Fixture:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/element-capture-planning-bundle.json`

Generator:

`node scripts/employer-brand-element-capture-planning-bundle.mjs`
