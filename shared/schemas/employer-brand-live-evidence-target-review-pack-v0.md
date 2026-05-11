# Employer Brand Live Evidence Target Review Pack v0

Status: data-only human review checklist for live website evidence targets.

This contract turns a Live Evidence Target Plan into a grouped checklist that a
human can inspect and later edit before any locator readiness, URL reachability,
codegen, browsing, capture, report rendering, export, or workflow execution.

The review pack is grouped first by company and then by source category. Each
review item carries the target ID, company, company role, source category, page
name, URL, desired element in natural language, evidence goal, KILOS relevance,
capture type, expected clip count, acceptance criteria, review status, approval
status, locator readiness summary, notes, and explicit non-goal flags.

Review affordance fields are present but empty by default:

- `reviewer_notes=null`
- `suggested_target_edits=null`
- `approval_decision=null`
- `decision_timestamp=null`

The pack intentionally preserves null locator placeholders until a later
deterministic locator/codegen pass is explicitly authorized. V0 controls keep
live collection, URL reachability checks, locator codegen, screenshot capture,
clip generation, report rendering, HTML/CSS polish, export execution, workflow
execution, and full-page grabs disabled.

The first fixture lives at:

`docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-target-review-pack.json`
