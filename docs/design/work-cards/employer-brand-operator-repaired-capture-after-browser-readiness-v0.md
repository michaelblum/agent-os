# Employer Brand Operator Repaired Capture After Browser Readiness V0

## Context

GDI completed Playwright browser readiness:

- `./aos ready` passed.
- `playwright install chromium-headless-shell` was run.
- `node scripts/employer-brand-repaired-live-element-capture.mjs --check-browser-readiness --json` passed.
- Local fixture smoke via the Node API helper passed without opening live URLs.
- Current checked-in repaired evidence state remains:
  - Accepted captures: 0.
  - Failed repaired slots: 4.
  - Clip/text assets: 0.
  - LinkedIn remains `source_unavailable`.
  - `full_page_grab_count=0`.
  - Failed slot `current_url=null`.
- No live target capture or locator resolution was run in the readiness slice.

This slice is a supervised Operator retry of the four repaired executable slots now that browser readiness and local smoke are fixed.

## Inputs

Use, at minimum:

- `scripts/employer-brand-repaired-live-element-capture.mjs`
- `scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`

## Operator Responsibilities

- Run `./aos ready` first and report blockers if AOS is not ready.
- Run `node scripts/employer-brand-repaired-live-element-capture.mjs --check-browser-readiness --json`.
- If browser readiness fails, do not open live URLs and do not attempt slot capture. Report the readiness metadata and stop.
- Use the gated repaired capture command with the default Node API runner:
  - `node scripts/employer-brand-repaired-live-element-capture.mjs --execution-gate execute-repaired-live-element-capture-v0`
- Let the script run local fixture smoke before live URL opens.
- If local fixture smoke fails, do not open live URLs and do not attempt slot capture. Report the phase-specific metadata and stop.
- If preflight passes, execute only the 4 repaired executable slots from `live-evidence-repaired-locator-capture-plan.json`.
- Open only the approved URLs represented by those repaired slots.
- Use only the repaired locator values in the repaired capture plan:
  - Symphony Talent slot 1: `section#home-hero`
  - Symphony Talent slot 2: `section#section-2-2583`
  - Phenom slot 1: `page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()`
  - Radancy slot 1: `div.primary-hero`
- Accept a slot only when the matched element is visibly the intended evidence target.
- If a locator matches zero elements, matches multiple ambiguous elements, matches the wrong element, is visually questionable, or times out, stop that slot and record the precise phase/blocker. Do not guess.
- Preserve the LinkedIn source-unavailable item and all other non-executable context entries as context.

## Deliverables

Update the established repaired-run manifest path:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`

Generate element clip and text extract files only for successfully accepted repaired slots.

If browser readiness or local fixture smoke fails and no slots are attempted, update/report only the runtime metadata needed to show why the retry stopped. Do not fabricate slot outcomes.

## Hard Boundaries

- Do not broaden the target set.
- Do not crawl websites.
- Do not run locator resolution/codegen.
- Do not use unreviewed selectors.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not capture the LinkedIn source-unavailable item.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, or create full-page grabs.

## Verification

Run:

- `node scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs --json`
- Schema validation for the updated manifest.
- Focused live evidence element capture tests.
- Focused repaired runtime diagnostics tests if runtime metadata changed.

If the verifier exits non-zero because some slots remain failed/unavailable, report that explicitly as expected residual state rather than widening scope.

## Completion Report

Report:

- Whether `./aos ready` passed.
- Whether browser readiness passed.
- Whether local fixture smoke passed.
- How many of 4 repaired slots were attempted.
- How many repaired slots were accepted.
- How many repaired slots failed and why, including phase metadata.
- Clip/text extract files created.
- Confirmation that LinkedIn remained unavailable and untouched.
- Confirmation that `full_page_grab=false` throughout.
- Which verification commands passed and which, if any, intentionally failed due to incomplete residual state.
- Confirmation that no crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.
