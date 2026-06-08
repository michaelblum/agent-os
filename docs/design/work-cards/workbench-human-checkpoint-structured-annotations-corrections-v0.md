# Workbench Human Checkpoint Structured Annotations Corrections V0

## Context

Implementer completed the structured annotation checkpoint slice. Foreman reviewed the
actual implementation and found the core direction correct:

- structured annotation records have explicit ordinals,
- selectors are optional supporting anchors,
- point/region/element/selection kinds exist,
- role/label/text/ancestor/source fields exist,
- committed annotations are preserved in `resume.annotations`,
- legacy Markdown line and line-range anchors are lifted through `text_range`
  rather than dropped,
- no live overlay/browser/capture scope was added.

Before the next Operator smoke, fix two narrow correctness gaps.

## Inputs

Inspect, at minimum:

- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation.md`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `packages/toolkit/workbench/human-checkpoint.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `scripts/workbench-human-checkpoint-start.mjs`
- `scripts/workbench-human-checkpoint-annotate.mjs`
- `scripts/workbench-human-checkpoint-validate.mjs`
- `tests/toolkit/workbench-human-checkpoint.test.mjs`
- checkpoint fixtures under `docs/design/fixtures/workbench-human-checkpoint-v0/`

## Corrections

### 1. Schema source identity must be non-null

The helper correctly rejects annotations without source identity, but the JSON
Schema currently accepts a structured annotation if `source_path` exists with
`null`, or `source_url` exists with `null`.

Fix the annotation schema so a structured intent record requires at least one
real source identity:

- non-empty `source_path`, or
- non-empty `source_url`.

Keep legacy `{ bounds, label }` region annotations accepted for old capture
producers.

Add tests proving:

- `source_path: null` and no usable `source_url` fails schema validation,
- `source_url: null` and no usable `source_path` fails schema validation,
- a non-empty `source_path` passes,
- a non-empty `source_url` passes.

### 2. Successful start records should preserve launch attempts

`scripts/workbench-human-checkpoint-start.mjs` records launch attempts for
failure paths, but successful checkpoints do not currently preserve the
successful launch/verify metadata. That loses useful context when launch had a
content-root refresh/retry on the way to success.

Fix start records so successful launched/attached checkpoints can carry
launch metadata in `metadata.launch_attempts` or a similarly stable field.

Required metadata:

- launch command,
- exit code,
- stdout/stderr snippets,
- canvas verification result,
- detected content-root refresh/restart signal when visible in stdout/stderr,
- final launch result.

Do not mark the checkpoint `launched` unless canvas state is verified usable.
If launch ultimately fails, keep the current failure behavior.

Add tests covering:

- successful launch record preserves launch/verify metadata,
- refresh/restart text in launch output is classified without making the final
  status a failure,
- launch failure still produces `aborted` with `canvas_id: null`.

## Hard Boundaries

- Do not implement live visual overlay annotation.
- Do not implement full Surface Annotation Intent Convergence.
- Do not use the Employer Brand alignment pack.
- Do not run live browser/capture work.
- Do not modify Employer Brand capture artifacts.
- Do not add report renderer/export/workflow-engine work.
- Keep this as a narrow correction; do not redesign the annotation model.

## Verification

Verification should include:

- `node --test tests/toolkit/workbench-human-checkpoint.test.mjs`
- `node --test tests/schemas/*.test.mjs`
- `scripts/workbench-human-checkpoint-validate.mjs docs/design/fixtures/workbench-human-checkpoint-v0/resumed-with-annotations.json --require-committed-annotation`
- Existing Markdown Workbench model/layout/render tests if touched.
- `git diff --check`
