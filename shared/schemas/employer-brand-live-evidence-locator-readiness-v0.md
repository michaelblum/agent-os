# Employer Brand Live Evidence Locator Readiness v0

Status: planning-only readiness gate for reviewed live evidence targets.

This contract consumes the reviewed live evidence target plan created by the
approval patch layer. The named readiness input is
`live-evidence-target-plan.reviewed.json`; the earlier
`live-evidence-reviewed-target-plan.json` fixture remains as the approval
layer's persisted reviewed-plan artifact. Rejected targets are excluded from the
readiness target list, while approved and draft targets remain visible for the
next supervised locator/codegen session.

Each readiness target carries the target ID, company, source category, URL,
review status, approval decision, desired element summary, capture type,
expected clip count, KILOS relevance, nullable locator placeholders, URL
reachability state, readiness state, blockers, required next action, and
provenance back to the reviewed plan, approval patch, review pack, and data
bundle.

Readiness states are:

- `locator_ready`
- `needs_locator`
- `needs_human_target_review`
- `rejected_excluded`
- `not_checked`

V0 does not invent selectors. URL reachability is represented as `not_checked`
unless a later explicitly checked fixture is added. The fixture therefore
classifies approved targets with null locators as `needs_locator` and draft
targets as `needs_human_target_review`.

Controls keep live browser collection, URL reachability checks, locator/codegen
execution, screenshot capture, clip generation, report rendering, HTML/CSS
polish, PDF/DOCX export, workflow execution, and full-page grabs disabled.

The first fixture lives at:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.json`
