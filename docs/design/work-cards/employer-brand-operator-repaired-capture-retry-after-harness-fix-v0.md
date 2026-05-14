# Employer Brand Operator Repaired Capture Retry After Harness Fix V0

## Context

The repaired capture runtime harness has been hardened:

- Runtime diagnostics now distinguish command availability failure, exact-invocation smoke failure before live URL opens, and post-preflight slot timeout metadata.
- Diagnostics schema has narrow runtime metadata fields.
- Focused diagnostics and live evidence element capture tests pass.
- Repaired-run verifier passes for the current runtime-failed manifest.
- Current manifest still reconciles:
  - Accepted captures: 0.
  - Runtime-failed repaired slots: 4.
  - Actual clip/text files: 0.
  - LinkedIn remains source-unavailable.
  - `full_page_grab_count=0`.

This slice is a supervised Operator retry of the four repaired executable slots using the fixed runtime harness.

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
- Run the repaired capture harness preflight, including the exact-invocation local smoke check that does not open live target URLs.
- If command availability or exact smoke preflight fails, do not open live URLs and do not attempt slot capture. Record/report the preflight metadata and stop.
- If preflight passes, execute only the 4 repaired executable slots from `live-evidence-repaired-locator-capture-plan.json`.
- Open only the approved URLs represented by those repaired slots.
- Use only the repaired locator values in the repaired capture plan:
  - Symphony Talent slot 1: `section#home-hero`
  - Symphony Talent slot 2: `section#section-2-2583`
  - Phenom slot 1: `page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()`
  - Radancy slot 1: `div.primary-hero`
- Capture element clips and text extracts only when the matched element is visibly the intended evidence target.
- If a locator matches zero elements, matches multiple ambiguous elements, matches the wrong element, is visually questionable, or times out, stop that slot and record the precise blocker. Do not guess.
- Preserve the LinkedIn source-unavailable item and all other non-executable context entries as context.

## Deliverables

Update the established repaired-run manifest path:

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
- Focused repaired runtime diagnostics tests if runtime metadata changed.

If the verifier exits non-zero because some slots remain failed/unavailable, report that explicitly as expected residual state rather than widening scope.

## Completion Report

Report:

- Whether `./aos ready` passed.
- Whether command availability preflight passed.
- Whether exact-invocation smoke preflight passed.
- How many of 4 repaired slots were attempted.
- How many repaired slots were accepted.
- How many repaired slots failed and why.
- Clip/text extract files created.
- Confirmation that LinkedIn remained unavailable and untouched.
- Confirmation that `full_page_grab=false` throughout.
- Which verification commands passed and which, if any, intentionally failed due to incomplete residual state.
- Confirmation that no crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.
