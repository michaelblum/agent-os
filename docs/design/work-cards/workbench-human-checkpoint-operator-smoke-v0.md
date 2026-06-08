# Workbench Human Checkpoint Operator Smoke V0

## Context

Workbench Human Checkpoint V0 is implemented. Before using it on the Employer
Brand alignment pack, run a tiny supervised smoke test on a disposable Markdown
fixture. The purpose is to prove the loop:

1. Operator starts a checkpoint.
2. A Markdown Workbench surface opens.
3. Human edits the surface.
4. Human replies to Operator.
5. Operator resumes, snapshots, diffs, optionally saves, and reports the
   outcome.

This is an Operator/HITL validation pass, not a Implementer implementation slice.

## Target

Use this disposable Markdown file:

- `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`

Use this canvas id:

- `markdown-workbench-operator-smoke`

Use this checkpoint output path:

- `/tmp/aos-workbench-human-checkpoint-operator-smoke.json`

Use this resume output path:

- `/tmp/aos-workbench-human-checkpoint-operator-smoke.resumed.json`

## Phase 1: Start And Handoff

Run:

```bash
node scripts/workbench-human-checkpoint-start.mjs \
  --target docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md \
  --output /tmp/aos-workbench-human-checkpoint-operator-smoke.json \
  --canvas-id markdown-workbench-operator-smoke
```

If readiness fails, stop and report the repair instructions. Do not claim the
surface opened.

If the workbench opens, stop and tell the human:

- the workbench surface is open,
- edit the disposable smoke file in the surface,
- make one small visible edit under `## Edit Target`,
- optionally add a short note under `## Annotation Target`,
- reply to Operator when done.

Do not resume in Phase 1 until the human replies.

## Phase 2: Resume After Human Reply

After the human replies that edits are done, run:

```bash
node scripts/workbench-human-checkpoint-resume.mjs \
  --checkpoint /tmp/aos-workbench-human-checkpoint-operator-smoke.json \
  --behavior save \
  --output /tmp/aos-workbench-human-checkpoint-operator-smoke.resumed.json
```

Then validate:

```bash
node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-workbench-human-checkpoint-operator-smoke.resumed.json
```

Run focused tests only if needed because the smoke changes code-path behavior:

```bash
node --test tests/toolkit/workbench-human-checkpoint.test.mjs
```

## Completion Report

Report:

- whether readiness passed,
- whether the workbench opened,
- checkpoint id and canvas id,
- whether the human edit was detected,
- whether the file was saved,
- concise diff summary,
- annotations found or note that none were captured,
- validation commands run and results.

## Hard Boundaries

- Do not use the Employer Brand alignment pack in this smoke test.
- Do not run live browser/capture work.
- Do not modify capture artifacts.
- Do not start Implementer work.
- Do not implement new checkpoint features during the smoke; report gaps for a
  later Implementer refinement slice.
