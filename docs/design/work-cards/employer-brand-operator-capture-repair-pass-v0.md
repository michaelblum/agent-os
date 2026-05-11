# Employer Brand Operator Capture Repair Pass V0

## Context

The deterministic capture repair patch contract is ready:

- `live-evidence-capture-repair-patch.json` has exactly 5 repair items.
- `live-evidence-capture-repair-patch.application.json` proves the empty patch is a no-op.
- The current live capture manifest still has 0 accepted captures and 5 failed executable slots.
- Failures are:
  - 4 zero-match locator failures.
  - 1 LinkedIn login/sign-in blocker.
- The 14 non-executable context entries are read-only context.

This slice is a supervised HITL repair pass. Use the Operator dock persona.

## Inputs

Use, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-failure-review-pack.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-reviewed-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-locator-readiness.reviewed.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-url-open-run.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-plan.reviewed.json`

## Operator Responsibilities

- Run `./aos ready` first and report blockers if AOS is not ready.
- Work only on the 5 patchable repair items from `live-evidence-capture-repair-patch.json`.
- Open only the approved URLs already represented by the failed repair items.
- For the 4 zero-match failures, inspect the page and decide whether a precise repaired selector/XPath/Playwright locator can be identified without guessing.
- For the LinkedIn login/sign-in blocker, do not bypass login. Decide whether the source should remain unavailable, be rejected, or need a human-provided alternate source URL.
- Fill only the patch fixture fields needed to record the supervised repair decisions.
- Preserve slot identity, target identity, original natural-language target, KILOS relevance, and failure provenance.

## Acceptable Patch Decisions

Use the schema-supported decision vocabulary:

- `approve_repaired_locator`
- `edit_locator`
- `replace_url`
- `refine_target`
- `mark_source_unavailable`
- `reject_target`
- `keep_failed`
- `keep_pending_review`

For repaired locator decisions, provide the reviewed selector/XPath/Playwright field that was actually verified. For unavailable/login-blocked sources, use `source_unavailable_reason` and notes instead of inventing evidence.

## Hard Boundaries

- Do not broaden the target set.
- Do not crawl websites.
- Do not use unapproved URLs except to record a proposed `replacement_url` when human judgment determines the original source is unavailable.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not capture screenshots or element clips in this slice.
- Do not run report rendering, HTML/CSS polish, PDF/DOCX export, workflow execution, or full-page grabs.
- Do not fabricate selectors or evidence.

## Deliverable

Update only the existing patch fixture unless a narrow supporting note is necessary:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`

Then run the existing patch/schema verification that applies to the edited patch. If the current apply helper does not yet promote filled repairs into downstream capture readiness, report that as the next GDI slice instead of extending scope here.

## Completion Report

Report:

- How many of 5 repair items received a concrete repair decision.
- How many locator repairs were approved.
- How many sources were marked unavailable/rejected/pending.
- Which items still need human input.
- Which verification commands passed.
- Confirmation that no captures, full-page grabs, report/export work, workflow execution, or login bypasses were performed.
