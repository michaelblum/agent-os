# Workbench Annotation Badges V0

## Context

Workbench Human Checkpoint V0 now has a working structured annotation data path:

- Operator can add structured annotation intent records without editing the
  underlying Markdown.
- Checkpoint resume preserves committed annotations in `resume.annotations`.
- Validation can require committed annotations.
- The Operator smoke proved a `selection_comment` annotation can be created,
  committed, resumed, and validated.

The next gap is visible shared reference. The user and Operator need to see the
same annotation ordinals on the workbench surface so “annotation 1” is a real
visual grammar, not only JSON in a checkpoint.

Build the first visible annotation layer for Markdown Workbench. Keep it
read-only and bounded: render committed/resolved/rejected checkpoint
annotations as visible badges/notes. Do not implement interactive drawing or
live capture yet.

## Inputs

Inspect, at minimum:

- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation.md`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `packages/toolkit/workbench/human-checkpoint.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/components/markdown-workbench/styles.css`
- `scripts/workbench-human-checkpoint-start.mjs`
- `scripts/workbench-human-checkpoint-annotate.mjs`
- `scripts/workbench-human-checkpoint-resume.mjs`
- `docs/design/fixtures/workbench-human-checkpoint-v0/resumed-with-annotations.json`
- `/tmp/aos-workbench-human-checkpoint-annotation-smoke.resumed.json` if present
- `tests/toolkit/workbench-human-checkpoint.test.mjs`
- Markdown Workbench layout/model/render tests
- `docs/api/toolkit.md`

## Deliverables

- Markdown Workbench support for loading/displaying structured annotation
  intent records.
- A message/API path or script helper that can push checkpoint annotations into
  an open Markdown Workbench canvas without editing the Markdown source.
- Visible annotation badges/notes in the workbench surface:
  - ordinal badges,
  - annotation note text,
  - actor/status metadata,
  - anchor summary such as document, line, line range, selection, point, region,
    or element.
- A deterministic smoke fixture or script path showing a checkpoint annotation
  rendered in the workbench.
- Focused tests for the annotation rendering/model behavior.
- Docs update in `docs/api/toolkit.md` and/or `docs/recipes/`.

## Required Behavior

- Render only structured annotation intent records, not legacy screenshot-only
  `{ bounds, label }` records unless they are first normalized to the intent
  shape.
- Preserve explicit ordinal as the visible badge number.
- Preserve status in presentation:
  - committed/open annotations should be visually active,
  - resolved/rejected annotations should remain visible but clearly secondary,
    or appear in an annotation list.
- Show the annotation note and enough anchor metadata for the user to understand
  what is being referenced.
- For Markdown text anchors:
  - line and line_range anchors should be represented in a source/preview
    annotation rail or equivalent visible marker;
  - selection/text_range anchors should show the target line/range and excerpt.
- For point/region/element anchors:
  - render the badge in a bounded overlay area when the coordinate space maps
    cleanly to the current workbench pane;
  - otherwise show it in the annotation list with coordinate/source metadata.
- Do not mutate the Markdown body to display annotations.
- Do not require saving the Markdown file to display annotations.
- Keep annotations in `window.__markdownWorkbenchState` or an equivalent
  inspectable state so Operator can verify what is visible.
- The badge layer must be clearable/reloadable from state without losing the
  source Markdown content.

## Operator Smoke Path

After implementation, the intended smoke should be possible:

1. Start a checkpoint on
   `docs/design/fixtures/workbench-human-checkpoint-v0/operator-smoke.md`.
2. Add a committed annotation with
   `scripts/workbench-human-checkpoint-annotate.mjs`.
3. Push/load that annotation set into the open Markdown Workbench.
4. Verify that badge `1` and the annotation note are visible without editing
   the Markdown body.
5. Resume the checkpoint and confirm the annotation remains in
   `resume.annotations`.

## Hard Boundaries

- Do not implement interactive annotation creation/drawing in this slice.
- Do not implement live surface overlay outside Markdown Workbench.
- Do not implement the full Surface Annotation Intent Convergence foundation.
- Do not use the Employer Brand alignment pack yet.
- Do not run live browser/capture work.
- Do not modify Employer Brand capture artifacts.
- Do not add report renderer/export/workflow-engine work.

## Verification

Verification should include:

- Focused tests prove Markdown Workbench can accept and expose structured
  annotations in state.
- Focused tests prove the rendered workbench includes ordinal badge text,
  annotation note text, status, and anchor metadata.
- Checkpoint tests still pass, including resumed checkpoints with committed
  annotations.
- Markdown Workbench model/layout/render tests still pass.
- `scripts/workbench-human-checkpoint-validate.mjs` still validates
  `docs/design/fixtures/workbench-human-checkpoint-v0/resumed-with-annotations.json`
  with `--require-committed-annotation`.
- `git diff --check` passes.
