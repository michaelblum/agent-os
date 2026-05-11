# Employer Brand Live Evidence Locator Resolution Result V0

`employer-brand-live-evidence-locator-resolution-result-v0` records the output of
a supervised locator resolution pass after the URL Open Harness gate.

The artifact consumes `live-evidence-supervised-locator-plan.json` and
`live-evidence-url-open-run.json`. It only attempts locator resolution when the
caller passes an explicit execution gate and supplies an injected resolver. A
target is eligible only when the URL-open result is reachable or a same-domain
redirect. Non-executable, blocked, not-run, cross-domain, login, paywall,
CAPTCHA, consent, timeout, and network-error results remain blocked or not-run.
Rejected targets are preserved as not-run exclusions from the URL-open run.

Each result records target and work-unit identity, company, source category,
original and final URLs, URL-open status, resolution status, selector
candidates, preferred selector, Playwright locator candidate, confidence,
blocker reason, reviewer/operator notes, nullable `resolved_at`, and locator
provenance. Unresolved entries keep selector fields and `resolved_at` null.

This schema does not authorize screenshots, element clips, report rendering,
exports, workflow execution, full-page grabs, autonomous crawling, or bypassing
login/paywall/CAPTCHA/consent blockers.
