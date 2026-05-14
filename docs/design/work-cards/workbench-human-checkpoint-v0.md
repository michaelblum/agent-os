# Workbench Human Checkpoint V0

## Context

AOS already has a good readiness pattern: if runtime permissions are not ready,
the agent stops and leaves concrete repair instructions. We need the same shape
for human editing work, except the success path should put up the editable
surface before handing control to the human.

The durable primitive is not an Operator terminal loop. The durable primitive is
a human-required workbench checkpoint:

1. Agent checks AOS/runtime readiness.
2. If readiness fails, stop with repair instructions and no fake handoff.
3. If readiness passes, launch or attach the editable subject in a workbench.
4. Record the handoff: subject, canvas id, expected human action, resume
   condition.
5. Stop with concise instructions for the human: edit the surface, then reply.
6. On the next agent turn, resume by reading the workbench state, diffing,
   saving or preserving draft state, reading annotations, and continuing.

This should be generic enough for future workbench subjects, with Markdown
Workbench as the first concrete adapter.

## Inputs

Inspect, at minimum:

- `packages/toolkit/components/markdown-workbench/launch.sh`
- `packages/toolkit/components/markdown-workbench/save-current.sh`
- `packages/toolkit/components/markdown-workbench/model.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `packages/toolkit/workbench/subject.js`
- `docs/api/toolkit.md`
- `docs/design/aos-workbench-pattern.md`
- `docs/design/aos-surface-system.md`
- `docs/design/surface-annotation-intent-convergence-tracker.md`
- relevant Markdown Workbench tests under `tests/toolkit/`

## Deliverables

- First-class Workbench Human Checkpoint V0 schema/docs under
  `shared/schemas/`.
- Toolkit helper under `packages/toolkit/workbench/` with build/load/normalize/
  validate helpers for checkpoint records.
- Markdown Workbench adapter/helper that can:
  - launch or attach a Markdown file/wiki subject,
  - emit a checkpoint record,
  - read the current workbench state on resume,
  - compute a before/after diff summary,
  - optionally save through the existing save helper,
  - preserve draft/no-save state when requested.
- CLI(s) under `scripts/` or narrow extension to existing Markdown Workbench
  scripts for:
  - start checkpoint,
  - resume checkpoint,
  - validate checkpoint.
- Checkpoint fixture(s) under `docs/design/fixtures/` or an appropriate
  workbench fixture directory.
- Focused tests under `tests/toolkit/`.
- Docs update in `docs/api/toolkit.md` and/or `docs/recipes/` describing the
  Operator/human use pattern.

## Required Behavior

### Start Checkpoint

- Run or require an explicit AOS readiness check before launching the surface.
- If readiness fails, produce a checkpoint result with status like
  `blocked_readiness` and concrete repair instructions. Do not claim a surface
  was opened.
- If readiness passes, launch or attach the Markdown Workbench for the requested
  subject.
- Record:
  - checkpoint id,
  - subject path/source,
  - subject type,
  - canvas id,
  - launched/attached status,
  - initial content hash,
  - initial diagnostics,
  - expected human action,
  - resume condition,
  - created_at,
  - created_by.
- Emit human-facing instructions suitable for Operator to paste/say: edit the
  opened workbench surface, then reply when done.

### Resume Checkpoint

- Read the current Markdown Workbench state from the recorded canvas id.
- Compare it against the checkpoint's initial snapshot/hash.
- Produce a deterministic diff summary:
  - changed/unchanged,
  - line count delta,
  - heading/diagnostic delta,
  - optional unified diff snippet if practical.
- Support explicit save behavior:
  - save current content,
  - keep as draft,
  - reject/abort resume without saving.
- Post the appropriate `markdown_document.save.result` back to the canvas when
  saving through existing helper behavior.
- Preserve enough metadata for an agent to continue the next step without
  rereading chat history.

### Annotation V0

- Add a lightweight structured annotation model for editable subjects.
- V0 may be line/selection anchored rather than visual overlay anchored.
- Support annotations from both agent and human:
  - author role/id,
  - subject path,
  - anchor type (`line`, `line_range`, `selection`, or `document`),
  - anchor value,
  - note,
  - status (`open`, `resolved`, `rejected`),
  - created_at.
- Keep annotations as checkpoint metadata or a companion artifact; do not build
  a full overlay annotation system in this slice.

## Hard Boundaries

- Do not implement the full Surface Annotation Intent Convergence foundation.
- Do not build live visual overlay annotation.
- Do not modify Employer Brand capture artifacts.
- Do not run live browser/capture work.
- Do not add report renderer/export/workflow-engine work.
- Do not make Operator depend on hidden terminal state; the checkpoint record is
  the durable source of truth.

## Verification

Verification should include:

- Schema validates start, blocked-readiness, resumed, saved, draft, and
  annotated checkpoint examples.
- Markdown adapter tests cover:
  - start record creation,
  - readiness-blocked result,
  - resume with no changes,
  - resume with changes,
  - save versus draft behavior,
  - annotation add/resolve behavior.
- Existing Markdown Workbench model/layout/render tests still pass.
- `docs/api/toolkit.md` or recipe docs include a concise Operator pattern:
  readiness -> launch surface -> human edits -> human replies -> resume -> diff/save/continue.
- `git diff --check` passes.
