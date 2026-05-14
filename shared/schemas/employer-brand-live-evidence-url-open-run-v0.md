# Employer Brand Live Evidence URL Open Run V0

`employer-brand-live-evidence-url-open-run-v0.schema.json` describes the
bounded supervised URL-open layer for approved Employer Brand live evidence
targets.

The V0 run consumes `live-evidence-supervised-locator-plan.json` and optionally
uses `live-evidence-url-reachability-check.json` and
`live-evidence-target-approval-patch.json` for provenance. Only executable
approved work units are eligible for URL opening. Blocked draft or otherwise
non-executable work units are preserved as `safety_gate_blocked` entries, and
rejected targets are preserved in `rejected_exclusions` without being opened.

The harness records only safely observable navigation metadata:
`original_url`, `final_url`, `same_domain`, redirect summary, HTTP status,
page title when available, blocker reason, `checked_at`, operator notes, and
harness notes.

V0 does not resolve locators, run codegen, identify elements, take screenshots,
capture clips, render reports, export files, run workflows, crawl, follow page
links beyond initial redirect handling, bypass login/paywall/CAPTCHA/consent
barriers, or perform full-page grabs.

Fixture:
`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
