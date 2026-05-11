# Employer Brand Live Evidence Slot Capture Runner V0

## Context

The Operator retry after the runtime harness fix completed with this state:

- `./aos ready` passed: `ready=true mode=repo daemon=reachable tap=active`.
- Command availability preflight passed.
- Exact-invocation smoke preflight passed against `about:blank` with `match_count: 1`.
- The harness attempted exactly the 4 repaired slots.
- Accepted captures: 0/4.
- Failed captures: 4/4.
- Failure reason for all four: `capture_command_failed: spawnSync playwright-cli ETIMEDOUT` during `slot_element_capture_run_code`.
- No clip or text extract files were created.
- LinkedIn remained `source_unavailable` and untouched.
- `full_page_grab=false` throughout.
- No crawling, locator resolution/codegen, report/export work, workflow execution, or login bypasses were performed.

The failure is now specifically in the per-slot capture invocation path, not command discovery, not exact smoke availability, and not the reviewed locator contract.

Build a deterministic slot capture runner layer that avoids the brittle per-slot `playwright-cli run-code` timeout path, or isolates it with enough local diagnostics to prove exactly where it hangs. Do not run another live evidence capture attempt in this slice.

## Inputs

Inspect, at minimum:

- The repaired-run capture script.
- `packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js`
- `packages/toolkit/workbench/employer-brand-repaired-capture-runtime-diagnostics.js`
- `scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs`
- `tests/toolkit/employer-brand-repaired-capture-runtime-diagnostics.test.mjs`

## Deliverables

- Add a first-class, testable slot capture runner surface for live evidence element capture.
- Prefer Playwright's local Node API or a repo-local deterministic runner over shelling out to global `playwright-cli run-code` for each slot.
- Add local fixture smoke coverage that captures an element clip and text extract from a local/static page or injected HTML without opening live target URLs.
- Add timeout metadata by phase, such as:
  - runner_preflight
  - browser_launch
  - page_navigation
  - locator_evaluation
  - element_screenshot
  - text_extraction
  - browser_close
- Update repaired runtime diagnostics so post-preflight slot failures report the runner type and exact phase instead of only `slot_element_capture_run_code`.
- Update the repaired capture script to use the new runner path behind the same operator-facing command, or add an explicit flag/default that the next Operator card can invoke.
- Keep tests injectable/fakeable and fast.
- Update schema/docs only if artifact fields change.
- Wire changed diagnostics metadata through existing provenance only if artifact shape changed.

## Required Behavior

The fixed runner should make the next Operator retry deterministic:

- If the local Node/API runner is unavailable, preflight should stop before opening live target URLs and record the missing dependency/tool path.
- If the local fixture smoke fails, preflight should stop before opening live target URLs and record phase-specific metadata.
- If preflight passes, a future Operator retry should be able to attempt slots without the `playwright-cli run-code` shell path.
- Local fixture smoke must prove the runner can:
  - match a locator,
  - capture an element screenshot,
  - extract text when requested,
  - close browser resources,
  - preserve `full_page_grab=false`.
- Preserve the current live evidence state unless regenerating diagnostics is necessary:
  - 0 accepted captures,
  - 4 runtime-failed repaired slots,
  - 0 actual clip/text files,
  - LinkedIn source-unavailable,
  - `full_page_grab_count=0`.
- Do not reclassify current failures as locator zero-match, content mismatch, or source unavailability.

## Hard Boundaries

- Do not open live target URLs.
- Do not run another live evidence capture attempt.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence for the live audit.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- Local fixture smoke proves the new slot capture runner can produce an element screenshot and text extract without live URLs.
- Focused live evidence element capture tests pass.
- Focused repaired runtime diagnostics tests pass.
- Repaired-run verifier still passes for the current runtime-failed manifest.
- Schema validation for updated manifest/diagnostics artifacts passes.
- Current manifest still reconciles: 0 accepted captures, 4 repaired runtime failures, 0 live audit clip/text files, LinkedIn source-unavailable, `full_page_grab_count=0`.
