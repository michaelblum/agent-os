# Employer Brand Repaired Capture Visibility Review Pack V0

This schema records the deterministic review queue for repaired live evidence
capture slots that matched exactly one element but failed the
`element_visibility_check` phase.

The artifact is read-only and local-input derived. It preserves slot identity,
target/work-unit identity, source metadata, KILOS context, evidence goals,
expected clip counts, the repaired locator, runner details, match counts,
operator outcome notes, and prior repair provenance. It also keeps LinkedIn
`source_unavailable` and all other non-executable entries as non-actionable
context.

The pack must not contain new selectors, screenshots, clips, text extracts,
replacement URLs, report/export output, or evidence from live page inspection.
For the current fixture, it reconciles exactly four actionable visibility
failures, zero accepted captures, zero clip/text assets, and
`full_page_grab=false` throughout.
