# Employer Brand Repaired Capture Visibility Review And Patch V0

## Context

The latest Operator retry got past the runtime/tooling failures and reached content semantics:

- `./aos ready` passed.
- Browser readiness passed with the Node API runner.
- Local fixture smoke passed.
- The gated repaired capture attempted exactly 4 repaired slots.
- Accepted repaired slots: 0.
- Failed repaired slots: 4.
- Each approved locator matched one element but failed at `element_visibility_check`.
- Failure classification for each slot: `reviewed_locator_element_not_visible`.
- Runner: `playwright_node_api`.
- No clip or text extract files were created.
- LinkedIn stayed `source_unavailable` and untouched.
- `full_page_grab=false` throughout.
- No crawling, locator resolution/codegen, report/export work, workflow execution, full-page grabs, or login/paywall/CAPTCHA/consent bypasses were performed.

Build the deterministic visibility failure review pack and repair patch template for this new failure state. Do not inspect live pages or run capture.

## Inputs

Consume, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/data-bundle.json`

## Deliverables

- First-class schema/docs for a repaired capture visibility failure review pack.
- First-class schema/docs for a repaired capture visibility repair patch.
- Toolkit helper(s) under `packages/toolkit/workbench/` with build/load/normalize/validate exports, and apply/no-op application if useful.
- Generator CLI(s) under `scripts/`.
- Fixtures, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-review-pack.json`
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-repair-patch.json`
  - optional no-op application fixture if that matches the existing patch pattern.
- Focused tests under `tests/toolkit/`.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.

## Required Behavior

- Classify exactly 4 actionable visibility failures.
- Preserve for each failed slot:
  - slot identity,
  - target/work-unit identity,
  - company,
  - source category,
  - URL,
  - original natural-language target,
  - KILOS relevance,
  - evidence goal,
  - expected clip count,
  - repaired locator value,
  - runner type,
  - failed phase `element_visibility_check`,
  - match count,
  - Operator/capture outcome notes,
  - prior repair/provenance metadata.
- Keep the LinkedIn source-unavailable item as non-actionable context.
- Preserve the other non-executable context entries as context.
- Keep accepted capture count at 0 and actual clip/text asset count at 0.
- Keep `full_page_grab=false` as an invariant.
- Distinguish these failures from:
  - runtime/preflight failures,
  - locator zero-match failures,
  - ambiguous multi-match failures,
  - login/source-unavailable blockers.
- Add nullable patch fields for later Operator/HITL work, such as:
  - `visibility_repair_decision`
  - `proposed_selector`
  - `proposed_xpath`
  - `proposed_playwright_locator`
  - `capture_precondition`
  - `scroll_strategy`
  - `wait_condition`
  - `viewport_hint`
  - `mark_target_hidden_reason`
  - `repair_notes`
  - `reviewed_by`
  - `reviewed_at`
- Model allowed decisions explicitly, including:
  - `edit_locator`
  - `add_scroll_strategy`
  - `add_wait_condition`
  - `adjust_viewport`
  - `mark_target_hidden`
  - `mark_source_unavailable`
  - `reject_target`
  - `keep_pending_review`
- Keep the checked-in patch fixture unfilled: all actual repair decision fields should be null.
- Applying the empty patch must be a no-op and must not promote captures or create new assets.

## Hard Boundaries

- Do not open live URLs.
- Do not run browser capture.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- New schemas validate generated fixtures.
- Review pack reconciles exactly 4 visibility failures, 0 accepted captures, and 0 clip/text assets.
- Patch fixture has exactly 4 patchable items and all repair fields null.
- Empty patch application is a no-op.
- Visibility failures remain distinct from runtime, zero-match, multi-match, and source-unavailable blockers.
- Repaired-run verifier still passes for the current visibility-failed manifest.
- Existing live evidence element capture and repaired diagnostics tests still pass.
- Provenance wiring validates through comparative data bundle and artifact bundle tests.
