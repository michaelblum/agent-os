# Employer Brand Live Evidence Capture Repair Promotion V0

## Context

The Operator filled the capture repair patch:

- 4 locator repairs approved:
  - Symphony Talent slot 1: `section#home-hero`
  - Symphony Talent slot 2: `section#section-2-2583`
  - Phenom slot 1: `page.locator('main section').filter({ hasText: /AI for Tomorrow.*Applied by Human Resources/ }).first()`
  - Radancy slot 1: `div.primary-hero`
- 1 source marked unavailable:
  - LinkedIn remains unavailable due to login/sign-in reliability; no bypass was attempted.
- Human input still needed:
  - LinkedIn alternate approved source URL, if that source should be replaced rather than unavailable.
- Current apply helper confirms filled repairs are accepted but not promoted:
  - `status: repair_decisions_pending_execution`
  - `new_locator_ready_slot_count: 0`
  - `promoted_capture_count: 0`

Build the deterministic promotion layer that consumes the filled repair patch and produces the next capture-attempt plan. Do not run capture.

## Inputs

Consume, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.application.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-failure-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/data-bundle.json`

## Deliverables

- Schema and docs under `shared/schemas/` for a first-class repair promotion/result artifact.
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/validate exports.
- Generator CLI under `scripts/`.
- Promotion fixture, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- Derived repaired capture plan fixture, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- Focused tests under `tests/toolkit/`.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.

## Required Behavior

The promotion layer should transform filled repair decisions into a deterministic next capture attempt plan:

- Promote exactly the 4 approved locator repair decisions into executable repaired capture slots.
- Preserve the original slot identity, target/work-unit identity, company, source category, URL, natural-language target, KILOS relevance, evidence goal, expected clip count, original failed locator, repaired locator, Operator repair notes, and failure provenance.
- Preserve the LinkedIn login/sign-in item as non-executable context with status like `source_unavailable` or equivalent. Do not turn it into a capture slot.
- Preserve the 14 existing non-executable context entries as context, not executable work.
- Reconcile counts explicitly:
  - repaired executable slots: 4
  - unavailable source slots: 1
  - previous failed executable slots: 5
  - accepted captures remain: 0
  - promoted capture count remains: 0
  - actual capture files remain: 0
- Keep all planned output clip/text paths null.
- Keep `full_page_grab=false` as an invariant.
- If the existing capture plan schema can safely represent repaired locator attempts, use it. Otherwise create a narrow derived repaired capture plan schema/artifact.

## Hard Boundaries

- Do not open URLs.
- Do not run browser/codegen/locator resolution.
- Do not capture screenshots, element clips, text extracts, or full-page grabs.
- Do not invent additional selectors, XPath, Playwright locators, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- The new schema validates the generated promotion fixture.
- The repaired capture plan validates.
- The promotion fixture has exactly 4 repaired executable slots and 1 source-unavailable slot.
- Repaired slots preserve the Operator-provided locator values exactly.
- All actual output/capture paths remain null.
- `full_page_grab=false` remains true across executable and context entries.
- Provenance wiring validates through comparative data bundle and artifact bundle tests.
- Existing capture repair patch, failure review pack, and live evidence element capture tests still pass.
