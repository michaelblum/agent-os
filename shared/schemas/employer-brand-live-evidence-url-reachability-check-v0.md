# Employer Brand Live Evidence URL Reachability Check V0

`employer-brand-live-evidence-url-reachability-check-v0.schema.json`
describes the supervised, read-only URL reachability preflight layer for live
evidence targets.

The V0 check consumes
`live-evidence-supervised-locator-plan.json` and records one result for every
work unit that survived target approval. Executable approved URL targets are
represented as `not_checked` in the dry-run fixture until an explicitly
supervised URL opener exists. Blocked draft or otherwise non-executable work
units are preserved as `safety_gate_blocked` entries so counts reconcile with
the supervised locator plan. Rejected targets remain excluded by the input
plan.

V0 does not open URLs by default. It does not resolve locators, run codegen,
identify elements, take screenshots, capture clips, render reports, export
files, run workflows, crawl, bypass login/paywall/CAPTCHA/consent barriers, or
perform full-page grabs. `final_url`, `checked_at`, and HTTP metadata stay null
unless a future bounded supervised opener can safely know them.

Fixture:
`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-reachability-check.json`
