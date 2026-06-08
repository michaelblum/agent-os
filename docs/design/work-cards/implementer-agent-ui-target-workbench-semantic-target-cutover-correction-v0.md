# Agent UI Target Workbench Semantic Target Cutover Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from:
  `origin/implementer/agent-ui-target-workbench-semantic-target-cutover-v0` at
  `bd9212b23cb5f7fdfc4f524f98b74f663f3945e1`
- required_start_ref:
  `origin/implementer/agent-ui-target-workbench-semantic-target-cutover-v0` at
  `bd9212b23cb5f7fdfc4f524f98b74f663f3945e1`
- expected output:
  update and push `implementer/agent-ui-target-workbench-semantic-target-cutover-v0`

Do not start this correction from `origin/main`. This is a correction on the
Slice 3 cutover branch after Foreman review.

## Source Artifact

- Original card:
  `docs/design/work-cards/implementer-agent-ui-target-workbench-semantic-target-cutover-v0.md`
- Reviewed head:
  `bd9212b23cb5f7fdfc4f524f98b74f663f3945e1`
- Foreman review finding:
  producer records and schemas were cut over to canonical `ref`, but
  `tests/toolkit/annotation-projection.test.mjs` and
  `tests/toolkit/surface-inspector.test.mjs` still assert old HTML workbench
  inputs using `target_id`, `data_aos_ref`, and `aos_ref`. That keeps the old
  workbench identity spelling as a tested compatibility boundary instead of
  locking the Surface Inspector bridge to canonical `agent_ui_target` records.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Close the review gap by making the annotation projection and Surface Inspector
workbench tests use canonical `agent_ui_target` inputs joined by `ref`, with no
old workbench identity values asserted as required reveal payload behavior.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/implementer-agent-ui-target-workbench-semantic-target-cutover-v0.md`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/toolkit/annotation-projection.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`
- `tests/toolkit/html-workbench-expression.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
rg -n "data_aos_ref: 'html-workbench|aos_ref: 'html-workbench|target_id: 'goal'|target_id: 'suggested-verification'|html-workbench-expression:goal|html-workbench-expression:suggested-verification" tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
```

No live AOS runtime is required for this correction.

## Required Behavior

### Annotation projection test

- Replace the old HTML workbench-shaped test record in
  `tests/toolkit/annotation-projection.test.mjs` with a canonical
  `agent_ui_target` style record:
  - top-level `ref`, `surface`, `role`, `name`, `kind`, `enabled`, `state`,
    `actions`, `extension`, and `provenance`;
  - source/reveal data under `extension` and selector/source payload data under
    `provenance`;
  - no `target_id`, `data_aos_ref`, `aos_ref`, or `accessible_label` in that
    workbench fixture.
- Assert the projection joins by canonical `ref`, including `subject_id` and
  `subject_path`.

### Surface Inspector reveal payload test

- Replace the old HTML workbench-shaped target in
  `tests/toolkit/surface-inspector.test.mjs` with a canonical workbench target
  record.
- Assert `buildSurfaceInspectorTargetNodeForAnnotation(...)` and
  `buildRevealPayloadForSurfaceInspectorPin(...)` carry canonical `ref`,
  source path from `extension.source`, and reveal selector from
  `provenance.selector`.
- Do not assert old workbench identity values as required output. If legacy
  keys still exist on the returned JS object for generic projection reasons,
  they must be `undefined` for a canonical workbench source record and must not
  be used for the join.

### Surface Inspector fallback code

- Inspect `buildRevealPayloadForSurfaceInspectorPin(...)` and
  `buildRevealTargetEvalScript(...)`.
- If canonical workbench inputs require a small code adjustment, prefer
  `ref`, top-level `selector`, `source_tree_node_metadata.provenance.selector`,
  `extension.dom_id`, and `data-aos-ref` derived from `ref`.
- Do not broad-remove unrelated `target_id` contracts from employer-brand live
  evidence, browser DOM, or other external/projection fixtures.

## Scope

This is a test/contract correction for the HTML workbench semantic-target
projection and Surface Inspector reveal bridge. Keep edits path-scoped unless
the tests expose one small production fallback gap in the two inspected toolkit
files.

## Hard Boundaries / Non-Goals

- Do not change generated workbench expression fixtures unless a deterministic
  test proves they are stale.
- Do not alter the canonical producer schema from the reviewed branch.
- Do not run live pointer, TCC, or supervised Operator checks.
- Do not touch unrelated untracked work-card/source/report artifacts.
- Do not continue adjacent Sigil, employer-brand, or browser DOM target-id
  migrations.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
```

Also rerun the rediscovery `rg` command and report any remaining old
HTML-workbench-shaped test fixtures. It is acceptable for unrelated test or
production areas to retain `target_id` where they are outside this slice.

## Completion Report

Report:

- changed files;
- exact old workbench-shaped test assertions removed or replaced;
- whether any production fallback code changed;
- exact verification commands and pass/fail results;
- whether the branch was pushed and the new head SHA;
- unrelated dirty or untracked local-only state;
- remaining blockers or follow-up recommendations.
