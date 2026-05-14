# Employer Brand Live Evidence Capture Repair Patch V0

## Context

The capture failure review pack is complete and reconciles the failed Operator run:

- Accepted captures: 0.
- Failed executable slots: 5.
- Non-executable context entries: 14.
- Zero-match locator failures: 4.
- Login/sign-in blockers: 1.
- All repair fields remain null.
- `full_page_grab=false` is preserved throughout.

The next HITL repair pass should not edit the failure review pack directly. Build the deterministic patch contract and application skeleton that a later Operator/human repair pass can fill.

## Inputs

Consume, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-failure-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/data-bundle.json`

## Deliverables

- Schema and docs under `shared/schemas/` for `Employer Brand Live Evidence Capture Repair Patch V0`.
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/validate/apply exports.
- Generator CLI under `scripts/`.
- Patch template fixture at `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`.
- If useful for testability, a derived no-op application fixture that proves the empty patch does not promote any failed capture.
- Focused tests under `tests/toolkit/`.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.

## Required Behavior

The patch contract should make a later repair pass deterministic without fabricating fixes:

- Create one patchable repair item for each failed executable slot from the failure review pack.
- Preserve slot identity, target/work-unit identity, company, source category, URL, original natural-language target, KILOS relevance, expected clip count, prior reviewed locator fields, failure classification, Operator notes, and recommended next action.
- Support nullable repair fields for later work:
  - `repair_decision`
  - `proposed_selector`
  - `proposed_xpath`
  - `proposed_playwright_locator`
  - `refined_natural_language_target`
  - `replacement_url`
  - `replacement_source_category`
  - `source_unavailable_reason`
  - `repair_notes`
  - `reviewed_by`
  - `reviewed_at`
- Model allowed decisions explicitly, including:
  - `approve_repaired_locator`
  - `edit_locator`
  - `replace_url`
  - `refine_target`
  - `mark_source_unavailable`
  - `reject_target`
  - `keep_failed`
  - `keep_pending_review`
- Keep the checked-in fixture as an unfilled template: all actual repair decisions and proposed replacement fields should be null.
- Preserve the 14 non-executable context entries as read-only context, not patchable items.
- Applying the empty checked-in patch must leave readiness/capture readiness unchanged: 0 accepted captures, 5 failed executable slots still unresolved, no new locator-ready slots.

## Hard Boundaries

- Do not open URLs.
- Do not run browser/codegen/locator resolution.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- The new schema validates the generated patch template fixture.
- The fixture has exactly 5 patchable repair items and 14 read-only context entries.
- Zero-match and login-required failures retain distinct classifications and allowed next decisions.
- All actual repair fields remain null in the checked-in template.
- Empty patch application is no-op and does not promote readiness or captures.
- Provenance wiring validates through comparative data bundle and artifact bundle tests.
- Existing capture failure review pack and live evidence element capture tests still pass.
