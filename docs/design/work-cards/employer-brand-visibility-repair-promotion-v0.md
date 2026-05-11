# Employer Brand Visibility Repair Promotion V0

## Context

Operator completed the visibility repair pass for:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-repair-patch.json`

Operator results:

- 4 of 4 visibility items have concrete repair decisions.
- Locator repairs: 0.
- Scroll strategies: 1.
- Wait conditions: 3.
- Viewport adjustments: 0.
- Hidden/unavailable/rejected/pending targets: 0.
- Human input still needed: none for this pass.
- Operator verified live DOM state only for the four approved URLs/locators.
- No screenshots, clips, full-page grabs, codegen, crawling, report/export work, workflow execution, or login/access bypasses were performed.
- Validation passed:
  - `./aos ready`
  - `node --test tests/toolkit/employer-brand-repaired-capture-visibility-review-and-patch.test.mjs`

Current gap:

- The apply helper leaves filled visibility repairs as `visibility_repairs_pending_execution`.
- It does not promote them into capture readiness.
- It does not create assets.
- The capture runner needs deterministic support for the approved visibility preconditions before the next Operator capture retry.

## Inputs

Consume or inspect, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-visibility-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`
- `packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js`
- `packages/toolkit/workbench/employer-brand-repaired-capture-runtime-diagnostics.js`
- `packages/toolkit/workbench/employer-brand-repaired-capture-visibility-review-and-patch.js`
- `scripts/employer-brand-repaired-live-element-capture.mjs`
- `tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs`
- `tests/toolkit/employer-brand-repaired-capture-visibility-review-and-patch.test.mjs`
- `tests/toolkit/employer-brand-repaired-capture-runtime-diagnostics.test.mjs`

## Deliverables

- Deterministic visibility repair promotion/result artifact, with schema/docs if a new artifact shape is needed.
- Derived visibility-adjusted capture plan fixture, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-visibility-adjusted-capture-plan.json`
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/validate exports, or a narrow extension to the existing visibility repair helper if that is cleaner.
- Generator CLI under `scripts/`.
- Capture runner support for the approved visibility preconditions:
  - scroll strategy,
  - wait condition,
  - viewport hint if present in future patches.
- Focused tests under `tests/toolkit/`.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.

## Required Behavior

- Promote exactly 4 filled visibility repair decisions into executable visibility-adjusted capture slots.
- Preserve for each slot:
  - slot identity,
  - target/work-unit identity,
  - company,
  - source category,
  - URL,
  - natural-language target,
  - KILOS relevance,
  - evidence goal,
  - expected clip count,
  - repaired locator value,
  - approved scroll/wait/viewport precondition,
  - Operator repair notes,
  - prior failure and provenance metadata.
- Preserve LinkedIn as source-unavailable context.
- Preserve all other non-executable context entries as context.
- Keep accepted capture count at 0.
- Keep actual clip/text asset count at 0.
- Keep planned output paths null.
- Keep `full_page_grab=false` as an invariant.
- If extending the capture runner, support the approved preconditions deterministically before the element visibility check:
  - apply scroll before visibility check when requested,
  - apply explicit wait conditions before visibility check when requested,
  - record phase-specific metadata if preconditions fail.
- Prove precondition behavior with local/static fixture tests only. Do not open live target URLs.

## Hard Boundaries

- Do not open live URLs.
- Do not run live capture.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- New or updated schemas validate generated fixtures.
- Promotion fixture/plan reconciles exactly 4 visibility-adjusted executable slots and 0 accepted captures/assets.
- Operator-approved scroll/wait values are preserved exactly.
- Empty/non-executable context is preserved and not promoted.
- Local fixture tests prove scroll/wait preconditions are applied before visibility check without live URLs.
- Repaired-run verifier still passes for the current manifest.
- Existing live evidence element capture, visibility review/patch, runtime diagnostics, comparative data bundle, and artifact bundle tests pass.
