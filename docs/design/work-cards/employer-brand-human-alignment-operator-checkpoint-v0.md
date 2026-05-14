# Employer Brand Human Alignment Operator Checkpoint V0

## Context

The Markdown Workbench annotation badge smoke passed. Use the same visible
checkpoint loop on the real Employer Brand Human Alignment Pack before
dispatching more capture, repair, or report work.

This is a human alignment pass. It should help the human correct intent,
companies, KILOS interpretation, source policy, capture scope, and report
direction directly in the pack.

## Target

Open this Markdown file:

- `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`

Use this canvas id:

- `markdown-workbench-employer-brand-human-alignment`

Use these temp paths:

- checkpoint:
  `/tmp/aos-employer-brand-human-alignment-checkpoint.json`
- annotated checkpoint:
  `/tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json`
- resumed checkpoint:
  `/tmp/aos-employer-brand-human-alignment-checkpoint.resumed.json`

## Phase 1: Start Surface

Run:

```bash
./aos ready
node scripts/workbench-human-checkpoint-start.mjs \
  --target docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.json \
  --canvas-id markdown-workbench-employer-brand-human-alignment
```

If readiness or launch fails, stop and report the blocker and launch metadata.
Do not claim the surface opened.

## Phase 2: Add Visible Decision Badges

Add these committed annotations. Keep them as annotation intent records only;
do not edit the Markdown body to display them.

```bash
node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.json \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --annotation-json '{"id":"employer-brand-align-ann-1","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":7,"end_line":7},"text_excerpt":"accepted live captures remain at 0","label":"Assumptions and capture state","note":"Annotation 1: confirm whether the current assumptions and 0-accepted-capture state are accurate enough to continue alignment.","actor":{"role":"operator","id":"employer-brand-alignment"},"status":"committed"}'

node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --annotation-json '{"id":"employer-brand-align-ann-2","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":49,"end_line":49},"text_excerpt":"direct talent-platform competitors","label":"Competitor set decision","note":"Annotation 2: decide whether Symphony Talent vs Phenom/Radancy is the right comparison set or whether aspirational examples should be added.","actor":{"role":"operator","id":"employer-brand-alignment"},"status":"committed"}'

node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --annotation-json '{"id":"employer-brand-align-ann-3","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":73,"end_line":73},"text_excerpt":"4 visibility-adjusted executable slots","label":"Live capture scope","note":"Annotation 3: choose whether the next capture work should stay limited to the 4 visibility-adjusted slots or pause for broader source-category correction.","actor":{"role":"operator","id":"employer-brand-alignment"},"status":"committed"}'

node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --annotation-json '{"id":"employer-brand-align-ann-4","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":93,"end_line":93},"text_excerpt":"inaccessible LinkedIn context","label":"LinkedIn policy","note":"Annotation 4: confirm whether LinkedIn remains source-unavailable context, gets an approved accessible substitute, or is excluded entirely.","actor":{"role":"operator","id":"employer-brand-alignment"},"status":"committed"}'

node scripts/workbench-human-checkpoint-annotate.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --annotation-json '{"id":"employer-brand-align-ann-5","kind":"selection_comment","coordinate_space":"document","text_range":{"start_line":103,"end_line":103},"text_excerpt":"positioning changes for Symphony Talent","label":"Report direction","note":"Annotation 5: decide whether the eventual report should emphasize positioning recommendations, competitive parity gaps, or evidence quality and next collection steps.","actor":{"role":"operator","id":"employer-brand-alignment"},"status":"committed"}'
```

Validate:

```bash
node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --require-committed-annotation
```

Push the annotation layer:

```bash
node scripts/workbench-human-checkpoint-annotations-push.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --canvas-id markdown-workbench-employer-brand-human-alignment
```

## Phase 3: Human Review

Confirm with the human that badges 1-5 are visible and refer to the intended
decision points.

Ask the human to edit the Markdown directly where the pack is wrong or
underspecified. The human may answer in chat instead of editing, but prefer file
edits when they want durable wording changes.

Guide the review around:

- annotation 1: current assumptions and capture state,
- annotation 2: company/competitor set,
- annotation 3: whether to resume only the 4 visibility-adjusted capture slots,
- annotation 4: LinkedIn/source-unavailable policy,
- annotation 5: eventual report direction.

Do not run capture based on the answers. This pass only records alignment.

## Phase 4: Resume And Validate

After the human says the review is done:

```bash
node scripts/workbench-human-checkpoint-resume.mjs \
  --checkpoint /tmp/aos-employer-brand-human-alignment-checkpoint.annotated.json \
  --behavior save \
  --output /tmp/aos-employer-brand-human-alignment-checkpoint.resumed.json

node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-employer-brand-human-alignment-checkpoint.resumed.json \
  --require-committed-annotation
```

Confirm the resumed payload includes all five annotations in
`resume.annotations`.

## Completion Report

Report:

- whether `./aos ready` passed,
- whether the Workbench opened,
- checkpoint id and canvas id,
- whether badges 1-5 were visible to Operator and the human,
- whether the Markdown body stayed unmodified by annotation push,
- whether the human edited the pack or answered only in chat,
- concise diff summary if edits were made,
- the human decisions or unresolved questions for each annotation,
- whether the file was saved,
- whether all five annotations appear in `resume.annotations`,
- validation commands run and results,
- the recommended next dock and next work slice.

## Hard Boundaries

- Do not resume live capture.
- Do not run URL opening, locator resolution, codegen, screenshots, clips, or
  report rendering/export.
- Do not modify Employer Brand capture manifests, repair patches, diagnostics,
  or data bundles in this Operator pass.
- Do not implement new annotation features.
- Do not use `/goal`; this is an Operator HITL alignment checkpoint.
