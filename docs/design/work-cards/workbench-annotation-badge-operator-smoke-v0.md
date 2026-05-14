# Workbench Annotation Badge Operator Smoke V0

## Context

Workbench Human Checkpoint V0 now supports a visible, read-only annotation badge
layer in Markdown Workbench. GDI verified the deterministic API and helper path,
but Operator and the human should smoke-test the actual visible loop before
using this on the Employer Brand alignment pack.

This smoke should prove:

- Operator can open a checkpointed Markdown Workbench surface.
- Operator can add a committed structured annotation without editing the
  Markdown body.
- Operator can push checkpoint annotations into the open canvas.
- The human and Operator can refer to visible badge `1`.
- Resume preserves the annotation record and any human edit.

## Target

Use the disposable Markdown file:

- `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`

Use this canvas id:

- `markdown-workbench-annotation-badge-smoke`

Use these temp paths:

- checkpoint: `/tmp/aos-workbench-annotation-badge-smoke.json`
- annotated checkpoint:
  `/tmp/aos-workbench-annotation-badge-smoke.annotated.json`
- resumed checkpoint:
  `/tmp/aos-workbench-annotation-badge-smoke.resumed.json`

## Phase 1: Start Surface

Run:

```bash
./aos ready
node scripts/workbench-human-checkpoint-start.mjs \
  --target docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md \
  --output /tmp/aos-workbench-annotation-badge-smoke.json \
  --canvas-id markdown-workbench-annotation-badge-smoke
```

If readiness or launch fails, stop and report the blocker and launch metadata.
Do not claim the surface opened.

## Phase 2: Add And Push Annotation

Add a committed annotation without editing the Markdown body:

```bash
node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-workbench-annotation-badge-smoke.json \
  --output /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --annotation-json '{"id":"operator-badge-smoke-ann-1","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":7,"end_line":7},"text_excerpt":"qwerty","label":"Badge smoke focus","note":"Operator badge smoke: use annotation 1 as the visible shared reference.","actor":{"role":"operator","id":"operator-badge-smoke"},"status":"committed"}'
```

Validate the annotated checkpoint:

```bash
node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --require-committed-annotation
```

Push the annotation layer into the open canvas:

```bash
node scripts/workbench-human-checkpoint-annotations-push.mjs \
  --checkpoint /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --canvas-id markdown-workbench-annotation-badge-smoke
```

## Phase 3: Human Visual Check

Ask the human to confirm the visible surface shows:

- badge `1`,
- the annotation note,
- actor/status or equivalent metadata,
- an anchor summary for line 7 or the `qwerty` excerpt,
- the Markdown body itself is not changed by the annotation layer.

Then ask the human to make one small visible edit under `## Edit Target` and
reply when done.

## Phase 4: Resume And Validate

After the human replies:

```bash
node scripts/workbench-human-checkpoint-resume.mjs \
  --checkpoint /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --behavior save \
  --output /tmp/aos-workbench-annotation-badge-smoke.resumed.json

node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-workbench-annotation-badge-smoke.resumed.json \
  --require-committed-annotation
```

Confirm the resumed payload includes the annotation in `resume.annotations`.

## Optional Clear/Reload Check

If time permits, verify the badge layer can clear and reload without mutating
Markdown content:

```bash
node scripts/workbench-human-checkpoint-annotations-push.mjs \
  --checkpoint /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --canvas-id markdown-workbench-annotation-badge-smoke \
  --clear

node scripts/workbench-human-checkpoint-annotations-push.mjs \
  --checkpoint /tmp/aos-workbench-annotation-badge-smoke.annotated.json \
  --canvas-id markdown-workbench-annotation-badge-smoke
```

## Completion Report

Report:

- whether `./aos ready` passed,
- whether the workbench opened,
- checkpoint id and canvas id,
- whether badge `1` and the note were visible to Operator and the human,
- whether the Markdown body stayed unmodified by annotation push/clear/reload,
- whether the human edit was detected and saved,
- annotation id, ordinal, kind, source path, anchor/text range, note, actor,
  and status,
- whether the annotation appears in `resume.annotations`,
- validation commands run and results,
- any gap that requires a GDI refinement slice.

## Hard Boundaries

- Do not use the Employer Brand alignment pack in this smoke.
- Do not run live browser/capture work.
- Do not modify Employer Brand capture artifacts.
- Do not implement new annotation features.
- Use plain Operator HITL smoke instructions.
