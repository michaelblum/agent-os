# Employer Brand Live Evidence Capture Repair Patch V0

This schema defines a deterministic human-in-the-loop repair patch for failed
live evidence element-capture slots. It is generated from the capture failure
review pack and does not mutate that source review pack.

The checked-in fixture is an unfilled template. It contains exactly one
patchable repair item for each failed executable capture slot and preserves the
14 non-executable context entries as read-only context. All actual repair fields
remain `null` until a later Operator or human repair pass supplies reviewed
values.

Allowed repair decisions are explicit:

- `approve_repaired_locator`
- `edit_locator`
- `replace_url`
- `refine_target`
- `mark_source_unavailable`
- `reject_target`
- `keep_failed`
- `keep_pending_review`

The contract is intentionally bounded. It does not authorize URL opening,
browser/codegen work, locator resolution, selector invention, XPath invention,
Playwright locator invention, screenshots, clip generation, text extraction,
login/paywall/CAPTCHA/consent bypasses, report rendering, document export,
workflow execution, full-page grabs, or target broadening.

Applying the empty checked-in patch is a no-op: it leaves accepted captures at
zero, leaves all five failed executable slots unresolved, and creates no new
locator-ready slots.
