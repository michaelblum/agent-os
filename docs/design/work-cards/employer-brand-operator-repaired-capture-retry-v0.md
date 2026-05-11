# Employer Brand Operator Repaired Capture Retry V0

## Context

The repaired capture runtime diagnostics layer is complete:

- The previous repaired run failed before evidence capture with 4 runtime invocation failures.
- Failures are now classified as capture runtime/tooling failures, not locator/content failures.
- Accepted captures remain 0.
- Actual capture files remain 0.
- LinkedIn remains source-unavailable.
- The repaired capture execution path now has Playwright preflight and durable runtime metadata.

This slice is a supervised Operator retry for the 4 repaired executable slots. The Operator should only proceed past preflight when the repaired capture tooling reports it is ready.

## Inputs

Use, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- The repaired-run capture script.
- `scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs`

## Operator Responsibilities

- Run `./aos ready` first and report blockers if AOS is not ready.
- Run the repaired capture script preflight first.
- If preflight fails, do not attempt slot capture. Record/report the preflight failure metadata and stop.
- If preflight passes, execute only the 4 repaired executable slots from `live-evidence-repaired-locator-capture-plan.json`.
- Open only the approved URLs represented by those repaired slots.
- Use only the repaired locator values in the repaired capture plan:
  - Symphony Talent slot 1: `section#home-hero`
  - Symphony Talent slot 2: `section#section-2-2583`
  - Phenom slot 1: `page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()`
  - Radancy slot 1: `div.primary-hero`
- Capture element clips and text extracts only when the matched element is visibly the intended evidence target.
- If a locator matches zero elements, matches multiple ambiguous elements, matches the wrong element, or is visually questionable, stop that slot and record the blocker. Do not guess.
- Preserve the LinkedIn source-unavailable item and all other non-executable context entries as context.

## Deliverables

Update the repaired-run manifest/output using the established path:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`

Generate element clip and text extract files only for successfully captured repaired slots.

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

- The repaired-run manifest verifier.
- Focused live evidence element capture tests.
- Schema validation for the updated manifest.

If the verifier exits non-zero because some slots remain failed/unavailable, report that explicitly as expected residual state rather than widening scope.

## Completion Report

Report:

- Whether preflight passed.
- How many of 4 repaired slots were attempted.
- How many repaired slots were accepted.
- How many repaired slots failed and why.
- Clip/text extract files created.
- Confirmation that LinkedIn remained unavailable and untouched.
- Confirmation that `full_page_grab=false` throughout.
- Which verification commands passed and which, if any, intentionally failed due to incomplete residual state.
- Confirmation that no crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.
