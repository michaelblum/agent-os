# Employer Brand Playwright Browser Readiness V0

## Context

The latest Operator repaired-capture retry stopped before live URL opens:

- `./aos ready` passed.
- Local fixture smoke failed at `browser_launch`.
- Failure cause: Playwright Chromium headless-shell executable is missing from the local cache.
- Live URL opens / live slot attempts: 0.
- The manifest marks all 4 repaired executable slots failed from the preflight stop.
- Each repaired slot has `current_url: null`.
- Accepted repaired slots: 0.
- Failed repaired slots: 4.
- Failure classification: `capture_preflight_local_fixture_smoke_failed`.
- Failed phase: `browser_launch`.
- Runner: `playwright_node_api`.
- Clip/text files created: none.
- LinkedIn source-unavailable item remained `blocked_not_run` and untouched.
- `full_page_grab=false` throughout; `full_page_grab_count=0`.
- No crawling, locator resolution/codegen, report/export work, workflow execution, or login/paywall/CAPTCHA/consent bypass was performed.

The next fix is deterministic environment/tooling readiness, not another Operator capture attempt.

## Inputs

Inspect, at minimum:

- `scripts/employer-brand-repaired-live-element-capture.mjs`
- `packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js`
- `packages/toolkit/workbench/employer-brand-repaired-capture-runtime-diagnostics.js`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs`
- `tests/toolkit/employer-brand-repaired-capture-runtime-diagnostics.test.mjs`
- Project package metadata for Playwright dependency conventions.

## Deliverables

- Add a deterministic Playwright browser readiness check for the Node API runner.
- If missing browser binaries are detected, report the exact missing executable/cache path and the exact repair command.
- Prefer repo-local/package-managed Playwright install conventions over global commands.
- Add a gated repair path only if it fits existing repo tooling conventions. If adding a repair flag, make it explicit and non-default.
- Update the repaired capture script preflight so missing browser cache is classified distinctly from generic `browser_launch` failure.
- Update runtime diagnostics metadata/schema/docs only if needed.
- Add or update focused tests for:
  - browser executable present,
  - browser executable missing,
  - repair command recommendation,
  - local fixture smoke blocked before live URL opens.
- If possible, run the local fixture smoke after repair/readiness without opening live target URLs.

## Required Behavior

- Do not open live target URLs.
- Do not run another live evidence capture attempt.
- Do not mark repaired locators as bad because the local browser cache is missing.
- Preserve current live evidence state unless regenerating diagnostics is necessary:
  - accepted captures: 0,
  - repaired runtime/preflight failures: 4,
  - actual clip/text files: 0,
  - LinkedIn source-unavailable,
  - `full_page_grab_count=0`.
- When the browser cache is missing, diagnostics should say that clearly and recommend the exact deterministic repair.
- Once browser readiness is fixed, the local fixture smoke should be able to prove browser launch, locator match, element screenshot, text extraction, and browser close without live URLs.

## Hard Boundaries

- Do not open live target URLs.
- Do not run live slot capture.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence for the live audit.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- Focused live evidence element capture tests pass.
- Focused repaired runtime diagnostics tests pass.
- Repaired-run verifier still passes for the current preflight-failed manifest.
- Schema validation for updated manifest/diagnostics artifacts passes.
- Browser readiness check produces deterministic output for the current environment.
- If browser cache repair is performed, local fixture smoke passes without opening live target URLs.
