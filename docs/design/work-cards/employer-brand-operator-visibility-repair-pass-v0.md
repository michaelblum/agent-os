# Employer Brand Operator Visibility Repair Pass V0

## Context

GDI completed the repaired-capture visibility review and patch layer:

- Visibility review pack reconciles exactly 4 visibility failures.
- Accepted captures: 0.
- Clip/text assets: 0.
- LinkedIn remains source-unavailable context.
- Patch fixture has exactly 4 patchable items.
- All visibility repair fields are null.
- Empty patch application is a no-op.
- Visibility failures are distinct from runtime, zero-match, multi-match, and source-unavailable blockers.

This slice is a supervised HITL Operator pass to fill the visibility repair patch. It should inspect the approved pages and decide whether the hidden element can be captured with a narrow scroll/wait/viewport/locator repair, or whether the target should remain pending/hidden/unavailable/rejected.

## Inputs

Use, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`

## Operator Responsibilities

- Run `./aos ready` first and report blockers if AOS is not ready.
- Work only on the 4 patchable visibility items.
- Open only the approved URLs represented by those visibility items.
- Use the existing repaired locator as the starting point for each item.
- Determine whether the element is hidden because of:
  - offscreen position requiring scroll,
  - delayed rendering requiring wait,
  - viewport/responsive layout,
  - locator targeting a hidden duplicate,
  - cookie/consent/access UI,
  - source/page change,
  - genuinely unavailable target.
- Fill only the existing visibility repair patch fields needed to record the supervised decision.
- Preserve slot identity, target identity, natural-language target, KILOS relevance, and failure provenance.

## Acceptable Decisions

Use the schema-supported decision vocabulary:

- `edit_locator`
- `add_scroll_strategy`
- `add_wait_condition`
- `adjust_viewport`
- `mark_target_hidden`
- `mark_source_unavailable`
- `reject_target`
- `keep_pending_review`

Use `repair_notes` to explain the observed page condition. For any locator edit, provide the reviewed selector/XPath/Playwright locator that was actually verified. For scroll, wait, or viewport repairs, record the specific repair field rather than changing the evidence target.

## Hard Boundaries

- Do not broaden the target set.
- Do not crawl websites.
- Do not run codegen or autonomous locator resolution.
- Do not use unreviewed selectors.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not capture screenshots or element clips in this slice.
- Do not capture the LinkedIn source-unavailable item.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, or create full-page grabs.
- Do not fabricate selectors or evidence.

## Deliverable

Update only the existing visibility repair patch fixture unless a narrow note is necessary:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-repair-patch.json`

Then run the existing schema/helper validation for the edited patch. If the current apply helper does not yet promote filled visibility repairs into downstream capture readiness, report that as the next GDI slice instead of extending scope here.

## Completion Report

Report:

- How many of 4 visibility items received a concrete repair decision.
- How many locator repairs, scroll strategies, wait conditions, or viewport adjustments were approved.
- How many targets were marked hidden/unavailable/rejected/pending.
- Which items still need human input.
- Which verification commands passed.
- Confirmation that no captures, full-page grabs, codegen, report/export work, workflow execution, crawling, or login bypasses were performed.
