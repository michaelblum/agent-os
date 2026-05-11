# Employer Brand Live Evidence Capture Failure Review Pack V0

## Context

The Operator run confirmed this state:

- `./aos ready` passes.
- Live capture manifest already exists at `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`.
- The run preserved 4 reviewed-ready units / 5 planned slots.
- Accepted captures: 0.
- Failed executable slots: 5.
- Non-executable context entries preserved: 14.
- `full_page_grab=false` throughout.
- Failure reasons:
  - Symphony Talent careers slots 1-2: `reviewed_locator_matches_zero_elements`.
  - Phenom careers slot 1: `reviewed_locator_matches_zero_elements`.
  - Radancy careers slot 1: `reviewed_locator_matches_zero_elements`.
  - Symphony Talent LinkedIn slot 1: `login_required`; Operator rejected the matched element because it was a LinkedIn sign-in prompt, not intended evidence.
- Schema validation passed.
- `node --test tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs` passed.
- `node scripts/employer-brand-live-evidence-element-clip-verify.mjs --json` exits 1 as expected because the manifest is incomplete/not accepted.

Build the deterministic failure triage / repair-queue layer for this result.

## Inputs

Consume, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-human-locator-approval-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/data-bundle.json`

## Deliverables

- Schema and docs under `shared/schemas/`.
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/validate exports.
- Generator CLI under `scripts/`.
- Fixture at `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-failure-review-pack.json`.
- Focused tests under `tests/toolkit/` and any schema tests needed by existing schema test patterns.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.

## Required Behavior

The review pack should make the failed state actionable without fabricating fixes:

- Preserve every executable planned slot and its outcome.
- Group failures by target/work-unit and slot.
- Separate zero-match locator failures from login/sign-in blockers.
- Preserve the original target natural-language description, KILOS relevance, evidence goal, expected clip count, reviewed locator fields, URL-open provenance, and Operator outcome notes.
- Add nullable repair fields for later human/operator work, such as `proposed_selector`, `proposed_xpath`, `proposed_playwright_locator`, `refined_natural_language_target`, `replacement_url`, `repair_decision`, `repair_notes`, and `reviewed_by`.
- Add a deterministic recommended next action per failure, for example `needs_operator_locator_repair` for zero-match failures and `needs_human_source_decision` for login-required LinkedIn evidence.
- Preserve the 14 non-executable context entries as context, not actionable repair items.
- Keep accepted capture count at 0 and failed executable slot count at 5.
- Keep `full_page_grab=false` as an invariant.

## Hard Boundaries

- Do not open URLs.
- Do not run browser/codegen/locator resolution.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- The new schema validates the generated fixture.
- The fixture reconciles counts from the live manifest: 5 failed executable slots, 0 accepted captures, 14 non-executable context entries.
- Zero-match and login-required blockers are classified distinctly.
- All repair fields remain null.
- Provenance wiring validates through the comparative data bundle and artifact bundle tests.
- Existing live evidence element capture tests still pass.
