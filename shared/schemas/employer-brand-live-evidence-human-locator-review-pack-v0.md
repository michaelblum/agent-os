# Employer Brand Human Locator Review Pack v0

Status: data-only human/operator review layer for ambiguous locator attempts.

This contract turns durable live-evidence locator planning artifacts into a
human review queue. It includes only actionable locator ambiguity:

- attempted locator results with `resolution_status=ambiguous`
- targets whose locator readiness is `needs_human_target_review`

Rejected, excluded, network-blocked, and other hard-blocked targets stay outside
the actionable queue and appear only as optional `excluded_context`.

Each review item carries target and work-unit IDs, company, source category, URL
and final URL, page name, natural-language desired element, evidence goal, KILOS
relevance, capture type, expected clip count, acceptance criteria, the ambiguity
or blocker reason, metadata-only unconfirmed selector candidates, and a pending
human decision. Allowed human decisions are `approve_selector`, `edit_selector`,
`provide_xpath`, `provide_playwright_locator`,
`refine_natural_language_target`, `mark_blocked`, `keep_draft`, and
`reject_target`.

Locator fields in this review pack must remain null. Candidate selectors are
metadata only and never make an item locator-ready. Only a later valid
human-locator patch may provide a locator and move downstream readiness toward
`locator_ready`.

V0 does not execute locators, codegen, URL opens, screenshots, element clips,
capture, report rendering, export work, workflow engines, full-page grabs,
autonomous crawling, or bypasses.

The fixture lives at:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-human-locator-review-pack.json`
