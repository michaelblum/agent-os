# Workbench Human Checkpoint Refinement V0

## Context

The Operator smoke test proved the basic Workbench Human Checkpoint roundtrip:

- `./aos ready` passed.
- Markdown Workbench opened on bounded retry.
- Checkpoint id: `workbench-checkpoint-moyofhdz-08615021`.
- Canvas id: `markdown-workbench-operator-smoke`.
- Human edit was detected.
- Resume behavior `save` persisted the file through
  `markdown-workbench/save-current.sh`.
- Validation passed for `/tmp/aos-workbench-human-checkpoint-operator-smoke.resumed.json`.

The smoke also exposed two refinement gaps before using the loop on the real
Employer Brand alignment pack:

1. The first launch attempt failed because content-root refresh surfaced as a
   launch failure before bounded retry succeeded. This should become an
   explicit launch/retry status, not a confusing failure.
2. `annotations: []` remained empty. The user edited the `## Annotation Target`
   text, but there is no usable workbench/operator annotation capture path yet.

Refine the checkpoint system before using it on the real alignment artifact.

## Inputs

Inspect, at minimum:

- `/tmp/aos-workbench-human-checkpoint-operator-smoke.json`
- `/tmp/aos-workbench-human-checkpoint-operator-smoke.resumed.json`
- `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`
- `docs/design/work-cards/workbench-human-checkpoint-operator-smoke-v0.md`
- `scripts/workbench-human-checkpoint-start.mjs`
- `scripts/workbench-human-checkpoint-resume.mjs`
- `scripts/workbench-human-checkpoint-validate.mjs`
- `packages/toolkit/workbench/human-checkpoint.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `packages/toolkit/components/markdown-workbench/launch.sh`
- `packages/toolkit/components/markdown-workbench/save-current.sh`
- `packages/toolkit/components/markdown-workbench/index.js`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `tests/toolkit/workbench-human-checkpoint.test.mjs`
- `docs/api/toolkit.md`

## Deliverables

- Refine checkpoint start/launch records so content-root refresh and bounded
  launch retry are represented explicitly.
- Add a practical Markdown Workbench Annotation V0 path so either Operator or
  human-entered annotation metadata can be captured on resume.
- Update schema/docs only as needed.
- Update CLI help/usage for the refined start/resume/annotation behavior.
- Update fixtures and focused tests.
- Add or update an Operator smoke recipe/work-card if the human-facing steps
  change.

## Required Behavior

### Launch/Retry Metadata

- A start checkpoint should distinguish:
  - readiness blocked,
  - content-root refresh/restart needed,
  - launch retried,
  - launch succeeded,
  - launch failed after retry.
- The final checkpoint status should remain `launched` only when the surface is
  actually open and usable.
- The handoff instructions should not mention a launched surface if launch
  ultimately fails.
- Preserve enough metadata for Operator to report the initial refresh/retry
  without treating it as a user-facing failure when the retry succeeds.

### Annotation V0

Add one narrow, usable path for annotations. Keep it simple and durable.

Acceptable implementation options:

- Add CLI support to `workbench-human-checkpoint-resume.mjs` such as repeated
  `--annotation-json` or `--annotation-note` arguments with line/document
  anchors.
- Add a tiny Markdown Workbench annotation state surface that lets Operator
  inject annotation events into `window.__markdownWorkbenchState` before
  resume.
- Add a companion annotation sidecar file referenced by the checkpoint.

Whichever path is chosen, annotations must support:

- author role/id,
- subject path,
- anchor type: `line`, `line_range`, `selection`, or `document`,
- anchor value,
- note,
- status: `open`, `resolved`, or `rejected`,
- created_at.

Resume should include annotations in the resumed checkpoint record and preserve
them through validation.

## Hard Boundaries

- Do not implement live visual overlay annotation.
- Do not implement full Surface Annotation Intent Convergence.
- Do not use the Employer Brand alignment pack in this refinement.
- Do not run live browser/capture work.
- Do not modify Employer Brand capture artifacts.
- Do not add report renderer/export/workflow-engine work.

## Verification

Verification should include:

- Focused checkpoint tests cover:
  - content-root refresh/retry metadata,
  - launch success after retry,
  - launch failed after retry,
  - annotation capture on resume,
  - annotation validation for document and line/line_range anchors,
  - save and draft behavior still work.
- Checkpoint schema validates updated fixtures.
- `scripts/workbench-human-checkpoint-validate.mjs` validates a resumed
  checkpoint containing at least one annotation.
- Existing Markdown Workbench model/layout/render tests still pass.
- `git diff --check` passes.
