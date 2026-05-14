# Employer Brand Repaired Capture Runtime Diagnostics V0

## Context

The Operator attempted the repaired live capture run and updated:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`

Observed run state:

- Accepted repaired slots: 0/4.
- Failed repaired slots: 4/4.
- Failure reason for all four: `capture_command_failed: spawnSync playwright-cli ETIMEDOUT`.
- Clip/text extract files created: 0.
- LinkedIn source-unavailable slot remained `blocked_not_run` and untouched.
- `full_page_grab=false` throughout.
- No crawling, locator resolution/codegen, report/export work, workflow execution, login bypass, or lingering Playwright browser sessions.

Operator also added repaired-run capture and verifier scripts, updated the manifest schema to accept repaired-run metadata, and adjusted focused tests. The repaired locator values themselves were not disproven; the execution path timed out before useful capture evidence was produced.

Build the deterministic runtime diagnostics and hardening layer for this failure mode. Do not run another live capture attempt in this slice.

## Inputs

Consume or inspect, at minimum:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/source-artifacts/live-evidence-element-clip-manifest.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-locator-capture-plan.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-promotion.json`
- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-capture-repair-patch.json`
- `scripts/employer-brand-repaired-live-evidence-element-clip-verify.mjs`
- The repaired-run capture script added by Operator.
- `tests/toolkit/employer-brand-live-evidence-element-capture.test.mjs`
- `shared/schemas/employer-brand-live-evidence-element-clip-manifest-v0.schema.json`

## Deliverables

- A first-class runtime diagnostics artifact for repaired live capture attempts, with schema/docs under `shared/schemas/`.
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/validate exports.
- Generator CLI under `scripts/`.
- Fixture, preferably:
  - `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/live-evidence-repaired-capture-runtime-diagnostics.json`
- Focused tests under `tests/toolkit/`.
- Read-only provenance wiring into `data-bundle.json`, `sources.json`, and `subject.json`.
- If the current capture script invokes `playwright-cli` in a brittle way, harden it narrowly so the next Operator run gets deterministic preflight output and durable timeout classification.

## Required Behavior

The diagnostics layer should distinguish runtime/tooling failure from locator/content failure:

- Preserve the 4 repaired executable slots and their timeout outcomes.
- Classify all four as runtime capture invocation failures, not locator failures.
- Preserve the exact failed command surface, timeout duration if available, exit signal/error code, stdout/stderr snippets if available, working directory, environment assumptions, and capture script path.
- Add per-slot retry eligibility such as `retry_after_runtime_repair`.
- Preserve the LinkedIn source-unavailable slot as non-executable context.
- Preserve the 14 existing non-executable context entries as context.
- Keep accepted capture count at 0 and actual capture file count at 0.
- Keep all clip/text output paths null for failed slots.
- Keep `full_page_grab=false` as an invariant.

If hardening the capture script:

- Add a preflight that checks whether the intended Playwright command is resolvable before slot execution.
- Prefer the repo's existing dependency/tooling conventions over shelling out to a global command when a local command or Node API is available.
- Make timeout values explicit and recorded in the manifest/diagnostics.
- Ensure a preflight/runtime failure is reported once with clear metadata instead of turning every slot into an indistinguishable timeout when the command cannot run.
- Keep tests injectable/fakeable; do not require live browser execution for unit tests.

## Hard Boundaries

- Do not open live URLs.
- Do not run another browser capture attempt.
- Do not run locator resolution/codegen.
- Do not invent selectors, XPath, Playwright locators, screenshots, clips, text extracts, replacement URLs, or replacement evidence.
- Do not bypass login/paywall/CAPTCHA/consent blockers.
- Do not render reports, polish HTML/CSS, export PDF/DOCX, add workflow execution, crawl websites, or broaden the target set.

## Verification

Verification should include:

- The new diagnostics schema validates the generated fixture.
- The fixture reconciles the repaired run: 4 runtime failures, 0 accepted captures, 0 clip/text files, LinkedIn still unavailable.
- Runtime failure classification is distinct from locator/content blockers.
- The repaired-run verifier still passes for the current incomplete runtime-failed state.
- Existing live evidence element capture tests still pass.
- Existing schema tests still pass.
- Provenance wiring validates through comparative data bundle and artifact bundle tests.
