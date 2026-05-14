# Employer Brand Repaired Capture Runtime Harness Fix V0

## Context

The Operator repaired-capture retry completed with this state:

- `./aos ready` passed.
- `playwright-cli --help` exited 0.
- The repaired capture script attempted exactly the 4 approved repaired slots.
- Accepted captures: 0/4.
- Failed captures: 4/4.
- Failure reason for all four: `capture_command_failed: spawnSync playwright-cli ETIMEDOUT`.
- No clip or text extract files were created.
- LinkedIn remained `source_unavailable` and untouched.
- `full_page_grab=false` throughout; manifest `full_page_grab_count=0`.
- No crawling, locator resolution/codegen, report/export work, workflow execution, or login/paywall/CAPTCHA/consent bypass was performed.
- Operator normalized repaired runtime diagnostics so transient `playwright-cli -s=... run-code ...` payloads do not destabilize diagnostics and aligned focused tests with `retry_after_runtime_repair`.

The current preflight is insufficient because command availability succeeds while the actual capture invocation times out. Fix the capture runtime harness so a future Operator retry can fail early with precise metadata or execute through a non-hanging path.

## Inputs

Inspect, at minimum:

- The repaired-run capture script.
- `scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs`
- `packages/toolkit/workbench/employer-brand-live-evidence-element-capture.js`
- `packages/toolkit/workbench/employer-brand-repaired-capture-runtime-diagnostics.js`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs`
- `tests/toolkit/employer-brand-repaired-capture-runtime-diagnostics.test.mjs`

## Deliverables

- Harden the repaired capture runtime harness narrowly so command availability, exact invocation smoke, slot execution, and timeout classification are distinct.
- Prefer the repo's existing local dependency/tooling path or Playwright Node API over a brittle global `playwright-cli` shell invocation if that is the cause of the hang.
- Add an exact-invocation local smoke/preflight that does not open live target URLs. A local fixture page, `about:blank`, or injectable fake runner is acceptable.
- Update runtime diagnostics generation so the latest manifest timeout is represented without unstable payload fields.
- Update focused tests for the new classification.
- If needed, update schema/docs for runtime diagnostics or manifest metadata, keeping changes narrow.
- Wire any changed diagnostics metadata through existing provenance only if the artifact shape changed.

## Required Behavior

The fixed harness should make the next Operator retry deterministic:

- If the exact capture invocation cannot run, stop before slot execution and record a single preflight/runtime blocker with command, timeout, cwd, tool path, stdout/stderr snippets, and retry recommendation.
- If preflight passes but a slot times out, record per-slot timeout metadata that clearly identifies the execution phase and timeout budget.
- Do not classify this failure as locator zero-match, content mismatch, or source unavailability.
- Preserve the current evidence state: 0 accepted captures, 4 runtime-failed repaired slots, LinkedIn source-unavailable, no actual clip/text files.
- Keep `full_page_grab=false` invariant.
- Keep tests injectable/fakeable and fast.

## Hard Boundaries

- Do not open live target URLs.
- Do not run another live evidence capture attempt.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- Focused live evidence element capture tests pass.
- Focused repaired runtime diagnostics tests pass.
- Repaired-run verifier still passes for the current runtime-failed manifest.
- Schema validation for updated manifest/diagnostics artifacts passes.
- If an exact local smoke/preflight is added, it passes without opening live target URLs.
- The current manifest still reconciles: 0 accepted captures, 4 repaired runtime failures, 0 actual clip/text files, LinkedIn source-unavailable, `full_page_grab_count=0`.
