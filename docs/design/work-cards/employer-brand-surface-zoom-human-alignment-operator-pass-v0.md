# Employer Brand Surface-Zoom Human Alignment Operator Pass V0

## Context

The fixed-position annotation badge path is superseded for this review. Use the
Surface-Zoom Inspector model instead. The current inspector is a human-facing
spatial workbench: use the primary `Synthetic Subject Map`, the summary-first
right inspector, the rendered Markdown preview in `Both` map mode, and the
`Targets` secondary tab. Open `Drafts` or `Diagnostics` only when needed.

```text
Markdown alignment pack
  -> deterministic Spatial Subject Tree seed
  -> Surface-Zoom Inspector rendered Markdown preview + synthetic subject map
  -> hit-test decision targets
  -> human alignment decisions
```

This is an Operator HITL pass. The goal is to help the human review and edit the
Employer Brand Human Alignment Pack using the Surface-Zoom decision targets, not
to resume capture work.

## Inputs

Use:

- Markdown pack:
  `docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md`
- Spatial tree seed:
  `docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json`
- Surface-Zoom Inspector launch:
  `packages/toolkit/components/surface-zoom-inspector/launch.sh`

Use this canvas id:

- `surface-zoom-employer-brand-alignment`

Use this checkpoint path if you also open the editable Markdown Workbench:

- checkpoint:
  `/tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.json`
- resumed checkpoint:
  `/tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.resumed.json`

## Phase 1: Readiness And Surface-Zoom Launch

Run:

```bash
./aos ready
AOS_SURFACE_ZOOM_INSPECTOR_ID=surface-zoom-employer-brand-alignment \
AOS_SURFACE_ZOOM_INSPECTOR_TREE_URL=aos://repo_codex_docks_session_roots/docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json \
packages/toolkit/components/surface-zoom-inspector/launch.sh
```

If the content root name differs in this session, derive it from
`scripts/aos-content-scope.sh` or rerun the launch with the correct repo content
root. Stop and report if readiness or launch fails.

## Phase 2: Deterministic Inspect Checks

Use `./aos show eval` to call `window.surfaceZoomInspector.inspectPoint(...)`
for the generated tree's decision targets. Verify from structured state that the
selected target ids are the expected targets. In the browser surface, the map
mode should default to `Both`: rendered Markdown is the readable layer and
synthetic bounds are the structured overlay.

Minimum checks:

- company/competitor set:
  `target:line-041-company-and-competitor-set`
- live capture scope:
  `target:line-057-desired-evidence-elements-4-visibility-adjusted-slots`
- LinkedIn/source-unavailable policy:
  `target:line-089-linkedin-source-unavailable-policy`
- report tone and direction:
  `target:line-099-report-tone-and-direction`

Choose points inside each target from the tree fixture bounds. Do not use
screenshot pixels as the oracle. Use `window.surfaceZoomInspector.snapshot()`
to report `last_inspect.selected_candidate.id`, selected line range,
highlighted source lines, draft id, and verification seed presence. After the
company/competitor check, the rendered Markdown preview should visibly focus
`Companies And Competitor Set` and highlight lines 41-49.

Verified fixture points for the required checks:

```bash
./aos show eval --id surface-zoom-employer-brand-alignment --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 850, coordinate_space: "viewport" }).selected_candidate.id'
./aos show eval --id surface-zoom-employer-brand-alignment --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 1180, coordinate_space: "viewport" }).selected_candidate.id'
./aos show eval --id surface-zoom-employer-brand-alignment --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 1800, coordinate_space: "viewport" }).selected_candidate.id'
./aos show eval --id surface-zoom-employer-brand-alignment --js 'window.surfaceZoomInspector.inspectPoint({ x: 64, y: 2000, coordinate_space: "viewport" }).selected_candidate.id'
```

Expected selected candidate ids, in order:

- `target:line-041-company-and-competitor-set`
- `target:line-057-desired-evidence-elements-4-visibility-adjusted-slots`
- `target:line-089-linkedin-source-unavailable-policy`
- `target:line-099-report-tone-and-direction`

If a point selects `document:human-alignment-pack-md`, the point landed in the
whole-document layer rather than a decision target. Pick a point from the target
row bounds or use the target list to orient, then retry the structured
`inspectPoint` check.

## Phase 3: Human Alignment Review

Guide the human through the Surface-Zoom decision targets:

- current assumptions / 0 accepted live captures,
- company and competitor set,
- desired evidence elements and 4 visibility-adjusted executable slots,
- what not to collect,
- KILOS interpretation,
- LinkedIn/source-unavailable policy,
- report tone and direction,
- explicit human decision table.

Use the `Targets` tab as the primary navigator and the rendered Markdown preview
as the main human-readable review surface. Treat `Diagnostics` as a fallback for
troubleshooting structured state, not as the main review surface.
Ask the human to make durable edits in the Markdown pack if wording or decisions
should change. If they prefer to answer in chat, record the decisions in your
completion report and recommend the next GDI slice to apply them.

## Optional Editable Markdown Workbench Checkpoint

If the human wants direct edits in the Markdown surface, open a Workbench
checkpoint on the same pack:

```bash
node scripts/workbench-human-checkpoint-start.mjs \
  --target docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md \
  --output /tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.json \
  --canvas-id markdown-workbench-employer-brand-human-alignment
```

After the human says edits are done:

```bash
node scripts/workbench-human-checkpoint-resume.mjs \
  --checkpoint /tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.json \
  --behavior save \
  --output /tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.resumed.json

node scripts/workbench-human-checkpoint-validate.mjs \
  /tmp/aos-employer-brand-surface-zoom-alignment-checkpoint.resumed.json
```

Do not require this checkpoint if the human only wants to make decisions in
chat.

## Completion Report

Report:

- whether `./aos ready` passed,
- whether Surface-Zoom launched with the Employer Brand Markdown tree seed,
- each inspected decision target and selected candidate id,
- whether drafts and verification seeds were present,
- whether the human edited the Markdown or answered in chat,
- concise diff summary if the Markdown was edited,
- human decisions or unresolved questions for each decision target,
- whether checkpoint resume/save/validate ran, if used,
- recommended next dock and work slice.

## Hard Boundaries

- Use plain Operator HITL pass instructions.
- Do not resume live Employer Brand capture.
- Do not open target company URLs.
- Do not run locator resolution, codegen, screenshots, clips, report
  rendering/export, or workflow execution.
- Do not modify Employer Brand capture manifests, repair patches, diagnostics,
  or data bundles.
- Do not implement new Surface-Zoom, annotation, or checkpoint features.
