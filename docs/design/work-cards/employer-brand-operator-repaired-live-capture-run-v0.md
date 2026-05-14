# Employer Brand Operator Repaired Live Capture Run V0

## Context

The deterministic repair promotion layer is complete:

- Repaired executable slots: 4.
- LinkedIn source-unavailable slot: 1.
- Preserved non-executable context entries: 14.
- Accepted captures remain: 0.
- Promoted captures remain: 0.
- Actual capture files remain: 0.
- Planned output paths remain null.
- `full_page_grab=false` is preserved throughout.

This slice is a supervised Operator run that attempts capture only for the 4 repaired executable slots. It should not revisit the unavailable LinkedIn item except as read-only context.

## Inputs

Use, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-failure-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`

## Operator Responsibilities

- Run `./aos ready` first and report blockers if AOS is not ready.
- Execute only the 4 repaired executable slots from `live-evidence-repaired-locator-capture-plan.json`.
- Open only the approved URLs represented by those repaired slots.
- Use only the repaired locator values that were promoted from Operator-approved patch decisions:
  - Symphony Talent slot 1: `section#home-hero`
  - Symphony Talent slot 2: `section#section-2-2583`
  - Phenom slot 1: `page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()`
  - Radancy slot 1: `div.primary-hero`
- Capture element clips and text extracts only when the matched element is visibly the intended evidence target.
- If a repaired locator still matches zero elements, matches multiple ambiguous elements, matches the wrong element, or is visually questionable, stop that slot and record the blocker. Do not guess.
- Preserve the LinkedIn source-unavailable item and all other non-executable context entries as context.

## Deliverables

Update or create the narrowest appropriate live evidence capture artifact so it records this repaired run. Prefer the existing manifest path if that is the established capture output:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`

Generate element clip and text extract files only for successfully captured repaired slots. Keep failed/unavailable/context entries explicit.

## Hard Boundaries

- Do not broaden the target set.
- Do not crawl websites.
- Do not run locator resolution/codegen.
- Do not use unreviewed selectors.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not capture the LinkedIn source-unavailable item.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, or create full-page grabs.

## Verification

Run the focused verification available for live evidence element capture and manifest validation. If the acceptance verifier still exits non-zero because some slots remain failed/unavailable, report that explicitly as expected residual state instead of widening scope.

## Completion Report

Report:

- How many of 4 repaired slots were accepted.
- How many repaired slots failed and why.
- Clip/text extract files created.
- Confirmation that LinkedIn remained unavailable and untouched.
- Confirmation that `full_page_grab=false` throughout.
- Which verification commands passed and which, if any, intentionally failed due to incomplete residual state.
- Confirmation that no crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.
