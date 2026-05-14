# Employer Brand Live Evidence Supervised Locator Plan V0

Planning-only operator work plan for supervised locator/codegen sessions against
reviewed live evidence targets.

The plan consumes `live-evidence-locator-readiness.json` plus the reviewed target
plan. It creates executable work units only when a target is approved and has
readiness state `needs_locator`. Draft or `needs_human_target_review` targets
remain present as blocked, non-executable entries so operators can see the
remaining review gap without accidentally running locator work.

V0 never performs URL reachability checks, browsing, locator/codegen execution,
screenshots, live capture, clip generation, report rendering, exports,
workflows, or full-page grabs. The later locator patch output slots are present
but intentionally null: `selector`, `xpath`, `playwright_locator`,
`codegen_trace_path`, `locator_notes`, `confidence`, `reviewer_metadata`, and
`operator_metadata`.

Every work unit carries the safety gates required for supervised use:

- human approval required
- same-domain constraint
- no autonomous crawl
- no full-page screenshots
- no live capture
- stop on login, paywall, CAPTCHA, or consent blockers
- stop on unexpected redirects
- stop when the target element cannot be identified without guessing

Canonical fixture:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-supervised-locator-plan.json`
