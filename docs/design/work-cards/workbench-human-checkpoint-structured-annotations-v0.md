# Workbench Human Checkpoint Structured Annotations V0

## Context

Workbench Human Checkpoint V0 proved the edit/resume/save loop works, but the
smoke test captured no annotations:

- The user edited `operator-smoke.md`.
- Resume detected and saved the file diff.
- `annotations: []` remained empty.

The next gap is not another Employer Brand repair loop. It is a reusable
annotation layer for human intent convergence: the user and Operator need to
point, comment, select, or mark a visible workbench/live surface without
necessarily editing the underlying file.

This slice should refine Workbench Human Checkpoint around structured
annotation intent records. Keep it generic. Do not build the full visual overlay
system yet.

## Prior Art To Inspect

Inspect these files as reference material:

- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/CLAUDE.md`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/unified-annotation.ts`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/annotation-classes.ts`
- `/Users/Michael/Documents/GitHub/syborg/ai/codex/syborg/src/content/overlay-manager.ts`
- `/Users/Michael/Documents/GitHub/syborg/docs/superpowers/specs/2026-03-22-unified-annotation-system-design.md`
- `/Users/Michael/Documents/GitHub/syborg/docs/superpowers/specs/2026-03-24-cross-tab-annotations.md`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/architecture/_briefs/draw_extension_brief.md`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/architecture/_reports/orchestrator_control_surface_framework_2026-03-03.md`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/docs/annotation_ancestor_picker_integration_plan_2026-03-14.md`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/.codex/skills/web-sherpa/scripts/semantic_workflow_runner.js`
- `/Users/Michael/Documents/GitHub/studio-gurulab/studio/orchestrator/overlay/overlay_debug_contract.test.js`

Treat these as prior art only. Do not port their Chrome extension/sidebar
architecture into AOS.

## AOS Inputs

Inspect, at minimum:

- `shared/schemas/annotation.schema.json`
- `shared/schemas/annotation.md`
- `shared/schemas/workbench-human-checkpoint-v0.schema.json`
- `packages/toolkit/workbench/human-checkpoint.js`
- `packages/toolkit/components/markdown-workbench/checkpoint.js`
- `packages/toolkit/components/markdown-workbench/index.js`
- `scripts/workbench-human-checkpoint-start.mjs`
- `scripts/workbench-human-checkpoint-resume.mjs`
- `scripts/workbench-human-checkpoint-validate.mjs`
- `docs/design/surface-annotation-intent-convergence-tracker.md`
- `docs/design/work-cards/workbench-human-checkpoint-refinement-v0.md`
- `tests/toolkit/workbench-human-checkpoint.test.mjs`
- `docs/api/toolkit.md`

## Deliverables

- A neutral structured annotation intent schema/docs, or a narrow extension of
  the existing annotation schema if that is clearly cleaner.
- Updated Workbench Human Checkpoint schema/docs to carry committed annotation
  intent records on resume.
- Toolkit helpers for building, normalizing, validating, adding, resolving, and
  preserving annotation intent records.
- A usable V0 annotation capture path for Markdown Workbench checkpoints.
  Acceptable V0 paths include:
  - a CLI/API to add annotations to a checkpoint before resume,
  - a companion annotation sidecar file referenced by the checkpoint,
  - a minimal in-workbench state channel for annotation events.
- A lightweight way for Operator to add annotations during the checkpoint smoke
  without editing the underlying Markdown content.
- Updated checkpoint start/resume/validate CLIs and help text.
- Fixtures for:
  - point comment annotation,
  - region comment annotation,
  - element/selection annotation when available,
  - resolved annotation,
  - resumed checkpoint containing committed annotations.
- Focused tests under `tests/toolkit/`.
- Docs update in `docs/api/toolkit.md` and/or `docs/recipes/`.

## Required Annotation Model

Treat annotations as structured intent records, not pixels.

Support at least:

- element or selection annotation,
- point comment annotation,
- rectangular/region comment annotation.

Optional later, not required in V0:

- freehand/draw annotations,
- live visual overlay editing,
- ancestor picker UI.

Each annotation record should include:

- `id`,
- `ordinal`,
- `kind`,
- `surface_id`,
- `source_url` or file path,
- coordinate space,
- point and/or viewport/page bounds,
- selector candidates where applicable,
- text excerpt where applicable,
- role/label where applicable,
- ancestor chain where applicable,
- human/operator note,
- actor,
- status such as `draft`, `committed`, `resolved`, or `rejected`,
- created/updated timestamps.

Preserve ordinal badges as a reference grammar. “Use annotation 2” should be
meaningful once a show layer renders them. Array position alone is not enough
for durable intent records; include an explicit `ordinal`.

## Lifecycle Requirements

- Support clear/commit/recover lifecycle in data, even if V0 UI is minimal.
- Include committed annotations in checkpoint resume/perception payloads.
- Preserve annotations through save and draft checkpoint resumes.
- Support resolving/rejecting annotations without deleting the record.
- Add prepare/restore fields around capture readiness so future capture steps
  can hide/collapse annotation controls while keeping target evidence visible.
  Do not implement live capture behavior in this slice.

## Workbench Human Checkpoint Refinements To Keep

Also carry forward the practical refinement from the prior checkpoint card:

- Start checkpoint records should distinguish content-root refresh/retry from
  final launch failure.
- The final checkpoint status should be `launched` only when the surface is
  actually open and usable.
- If launch ultimately fails, handoff instructions must not claim the surface
  opened.

## Hard Boundaries

- Do not rebuild the old Chrome extension/sidebar stack.
- Do not make selectors the only anchor. Use selectors plus bounds, text, role,
  ancestor chain, and surface identity where available.
- Do not make annotations only screenshot markup. They must be agent-readable
  intent data.
- Do not implement the full Surface Annotation Intent Convergence foundation.
- Do not implement live visual overlay annotation in this slice.
- Do not use the Employer Brand alignment pack in this refinement.
- Do not run live browser/capture work.
- Do not modify Employer Brand capture artifacts.
- Do not add report renderer/export/workflow-engine work.

## Verification

Verification should include:

- Schema validates structured annotation intent examples.
- Checkpoint schema validates resumed checkpoints carrying annotations.
- Focused checkpoint tests cover:
  - point comment annotation,
  - region comment annotation,
  - selection/element annotation when available,
  - annotation ordering/ordinals,
  - commit/resolve/reject lifecycle,
  - save and draft resume preserving committed annotations,
  - launch refresh/retry metadata.
- `scripts/workbench-human-checkpoint-validate.mjs` validates a resumed
  checkpoint containing at least one committed annotation.
- Existing Markdown Workbench model/layout/render tests still pass.
- `git diff --check` passes.
