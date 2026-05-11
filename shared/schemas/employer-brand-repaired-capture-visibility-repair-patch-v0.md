# Employer Brand Repaired Capture Visibility Repair Patch V0

This schema defines the HITL patch template for repairing repaired-capture
visibility failures. Each patch item maps one-to-one to a visibility failure
from `live-evidence-repaired-capture-visibility-review-pack.json`.

The checked-in fixture is intentionally unfilled. The repair fields
`visibility_repair_decision`, `proposed_selector`, `proposed_xpath`,
`proposed_playwright_locator`, `capture_precondition`, `scroll_strategy`,
`wait_condition`, `viewport_hint`, `mark_target_hidden_reason`, `repair_notes`,
`reviewed_by`, and `reviewed_at` must all be `null`.

Allowed later decisions are explicit: `edit_locator`, `add_scroll_strategy`,
`add_wait_condition`, `adjust_viewport`, `mark_target_hidden`,
`mark_source_unavailable`, `reject_target`, and `keep_pending_review`.
Applying the empty patch is a no-op: it does not promote captures, create
assets, open URLs, run capture, resolve locators, run codegen, or invent
replacement evidence.
