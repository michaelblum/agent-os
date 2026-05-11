# Workbench Human Checkpoint Structured Annotation Operator Smoke V0

## Context

Workbench Human Checkpoint V0 now supports structured annotation intent records:

- annotation records have explicit ordinals,
- point/region/element/selection kinds exist,
- source identity is required by schema,
- committed annotations are preserved in `resume.annotations`,
- successful start records preserve launch metadata,
- validation can require at least one committed annotation.

Run a second Operator smoke before using the real Employer Brand alignment pack.
This smoke should prove that Operator can add annotation intent data without
editing the underlying Markdown file for that annotation.

## Target

Use the same disposable Markdown file:

- `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`

Use this canvas id:

- `markdown-workbench-operator-annotation-smoke`

Use these temp paths:

- checkpoint: `/tmp/aos-workbench-human-checkpoint-annotation-smoke.json`
- annotated checkpoint:
  `/tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json`
- resumed checkpoint:
  `/tmp/aos-workbench-human-checkpoint-annotation-smoke.resumed.json`

## Phase 1: Start And Handoff

Run:

```bash
node scripts/workbench-human-checkpoint-start.mjs \
  --target docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md \
  --output /tmp/aos-workbench-human-checkpoint-annotation-smoke.json \
  --canvas-id markdown-workbench-operator-annotation-smoke
```

If readiness or launch fails, stop and report the repair instructions/launch
metadata. Do not claim the surface opened.

If the workbench opens, ask the human to make one small visible edit under
`## Edit Target`, then reply to Operator when done.

## Phase 2: Add Structured Annotation

Before resume, add one structured annotation using the CLI. Use a document or
line/selection anchor if that is the most practical V0 path; do not encode the
annotation by editing the Markdown body.

Example shape, adjust line/text values to match the current smoke file if
needed:

```bash
node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-workbench-human-checkpoint-annotation-smoke.json \
  --output /tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json \
  --annotation-json '{"id":"operator-smoke-ann-1","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":7,"end_line":7},"text_excerpt":"qwerty","label":"Edit target note","note":"Operator annotation smoke: treat this line as the review focus.","actor":{"role":"operator","id":"operator-smoke"}}'
```

If the annotation defaults to draft, commit it:

```bash
node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json \
  --output /tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json \
  --commit
```

Validate the annotated checkpoint if practical:

```bash
node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json \
  --require-committed-annotation
```

## Phase 3: Resume

After the human replies that edits are done and the annotation has been added,
run:

```bash
node scripts/workbench-human-checkpoint-resume.mjs \
  --checkpoint /tmp/aos-workbench-human-checkpoint-annotation-smoke.annotated.json \
  --behavior save \
  --output /tmp/aos-workbench-human-checkpoint-annotation-smoke.resumed.json
```

Then validate:

```bash
node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-workbench-human-checkpoint-annotation-smoke.resumed.json \
  --require-committed-annotation
```

## Completion Report

Report:

- whether readiness passed,
- whether the workbench opened,
- checkpoint id and canvas id,
- whether launch metadata recorded any refresh/retry,
- whether the human edit was detected,
- whether the file was saved,
- concise diff summary,
- annotation id, ordinal, kind, source path, anchor/text range, note, actor,
  and status,
- confirmation that the same annotation appears in `resume.annotations`,
- validation commands run and results.

## Hard Boundaries

- Do not use the Employer Brand alignment pack in this smoke test.
- Do not run live browser/capture work.
- Do not modify capture artifacts.
- Do not implement new checkpoint features during the smoke; report gaps for a
  later GDI refinement slice.
