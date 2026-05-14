# Employer Brand Operator Repaired Capture Node Runner Retry V0

## Context

GDI completed the slot capture runner fix:

- `scripts/employer-brand-repaired-live-element-capture.mjs` now defaults to the Playwright Node API runner.
- `--runner playwright-cli-run-code` remains available only as an explicit fallback.
- The default runner performs a local fixture smoke preflight before any approved live URL can be opened.
- Phase metadata is available for:
  - `runner_preflight`
  - `browser_launch`
  - `page_navigation`
  - `locator_evaluation`
  - `element_screenshot`
  - `text_extraction`
  - `browser_close`
- Current checked-in live evidence state is unchanged:
  - Accepted captures: 0.
  - Runtime-failed repaired slots: 4.
  - Actual clip/text files: 0.
  - LinkedIn remains `source_unavailable`.
  - `full_page_grab_count=0`.

This slice is a supervised Operator retry of the four repaired executable slots using the new default Node API runner.

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
- Use the gated repaired capture command with the default runner:
  - `node scripts/employer-brand-repaired-live-element-capture.mjs --execution-gate execute-repaired-live-element-capture-v0`
- Do not pass `--runner playwright-cli-run-code` unless reporting that the default Node API runner is unavailable and stopping for Foreman/GDI guidance.
- Let the script run its local fixture smoke preflight before live URL opens.
- If command availability, Node API runner preflight, or local fixture smoke fails, do not open live URLs and do not attempt slot capture. Record/report the phase-specific metadata and stop.
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

If preflight fails and no slots are attempted, update/report only the runtime metadata needed to show why the retry stopped. Do not fabricate slot outcomes.

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
- Whether the Node API runner preflight passed.
- Whether local fixture smoke passed.
- How many of 4 repaired slots were attempted.
- How many repaired slots were accepted.
- How many repaired slots failed and why, including phase metadata.
- Clip/text extract files created.
- Confirmation that LinkedIn remained unavailable and untouched.
- Confirmation that `full_page_grab=false` throughout.
- Which verification commands passed and which, if any, intentionally failed due to incomplete residual state.
- Confirmation that no crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.
