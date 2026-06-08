# Agent UI Target Workbench Nested Identity Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from:
  `origin/implementer/agent-ui-target-workbench-semantic-target-cutover-v0` at
  `10146ba1ecd63934fed9c31ba8f72d14a650ce2c`
- required_start_ref:
  `origin/implementer/agent-ui-target-workbench-semantic-target-cutover-v0` at
  `10146ba1ecd63934fed9c31ba8f72d14a650ce2c`
- PR:
  `https://github.com/michaelblum/agent-os/pull/398`
- expected output:
  update and push `implementer/agent-ui-target-workbench-semantic-target-cutover-v0`

Do not start from `origin/main`. This is a corrective update to the stacked PR
branch after outside review.

## Source Artifact

- PR under review:
  `https://github.com/michaelblum/agent-os/pull/398`
- Compatibility removal tracking issue:
  `https://github.com/michaelblum/agent-os/issues/399`
- Prior correction card:
  `docs/design/work-cards/implementer-agent-ui-target-workbench-semantic-target-cutover-correction-v0.md`
- Blocking outside-review finding:
  the PR achieved top-level `ref` cutover but reintroduced identity/source drift
  under nested `extension` and `provenance` fields, then made that redundancy
  required in `shared/schemas/aos-html-workbench-expression-v0.schema.json`.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, PR, or prior implementation state. Read and rediscover before
editing.

## Goal

Collapse the HTML workbench target record so canonical `ref` is the only target
identity and workbench source data has one durable home, before PR #398 is
eligible for merge.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/implementer-agent-ui-target-workbench-semantic-target-cutover-v0.md`
- `docs/design/work-cards/implementer-agent-ui-target-workbench-semantic-target-cutover-correction-v0.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/workbench/html-workbench-expression.js`
- `packages/toolkit/components/html-workbench-expression/index.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `shared/schemas/aos-html-workbench-expression-v0.schema.json`
- `tests/toolkit/agent-ui-target-conformance.test.mjs`
- `tests/toolkit/html-workbench-expression.test.mjs`
- `tests/toolkit/annotation-projection.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
gh pr view 398 --repo michaelblum/agent-os --json number,state,baseRefName,headRefName,mergeable,url
rg -n "source_payload_id|provenance\\.dom_id|extension\\?\\.dom_id|extension: \\{[^\\n]*dom_id|source_path|source_line_start|source_line_end|data_aos_ref|aos_ref|target_id" packages/toolkit/workbench/html-workbench-expression.js packages/toolkit/components/html-workbench-expression/index.js shared/schemas/aos-html-workbench-expression-v0.schema.json tests/toolkit/agent-ui-target-conformance.test.mjs tests/toolkit/html-workbench-expression.test.mjs
```

No live AOS runtime is required for this correction.

## Required Behavior

### Producer record shape

- Generated HTML workbench `semantic_targets` must keep exactly one top-level
  identity key: `ref`.
- Workbench targets must not emit `target_id`, `data_aos_ref`, `aos_ref`,
  `accessible_label`, `semantic_target_id`, `subject_id`, or `do_target` at the
  top level.
- Do not duplicate the workbench target slug across nested fields. The DOM slug
  needed for `data-semantic-target-id` must be single-sourced:
  - preferred outcome: store the DOM slug once as `provenance.dom_id`;
  - do not also store the same slug as `extension.dom_id`;
  - do not emit `provenance.source_payload_id` for generated workbench targets
    when it duplicates the same logical id.
- If the generic `normalizeAgentUiTarget(...)` currently forces
  `provenance.source_payload_id`, add a narrow option or equivalent scoped path
  so canonical workbench targets can suppress that duplicate without weakening
  existing runtime/control producer behavior.

### Source data

- Keep workbench source data only under `extension.source.{path,line_start,line_end}`.
- Delete generated `provenance.source_path`,
  `provenance.source_line_start`, and `provenance.source_line_end` from
  workbench targets.
- Keep `source_map`, `mermaid_blocks`, resume sidecars, and rendered HTML source
  attributes working from `extension.source`.

### Schema

- Update `shared/schemas/aos-html-workbench-expression-v0.schema.json` so the
  canonical workbench record does not require or describe the deleted duplicate
  fields.
- `WorkbenchTargetExtension` should require source and reveal/annotation
  eligibility, not `dom_id`.
- `WorkbenchTargetProvenance` should require only fields that are actually
  part of the durable workbench provenance contract. It may require
  `selector` and a single `dom_id` reveal hint, but must not require
  `source_payload_id` or duplicated source path/line fields.

### Consumer helpers

- Simplify workbench-local helpers so they no longer sniff equivalent nested id
  spellings. For workbench-produced targets, derive the DOM slug from the one
  canonical provenance field or from `ref` if no separate slug is present.
- Keep rendered DOM attributes unchanged:
  `data-aos-ref`, `data-aos-surface`, `data-semantic-target-id`,
  source line attrs, and target kind attrs.

### Transitional consumer compatibility

- Existing shared consumers may keep old-spelling fallbacks for Sigil/browser
  producers that have not cut over yet.
- Add explicit removal-gate comments at those fallback sites pointing to
  `https://github.com/michaelblum/agent-os/issues/399`.
- Do not make those comments broad TODO clutter; place them next to the old
  spelling arms in `annotation-projection.js` and
  `surface-inspector/index.js`.

### Conformance and tests

- Strengthen the conformance gate so it catches nested duplication of the same
  logical workbench id/source data across `extension` and `provenance`, not only
  old top-level identity keys.
- Add an assertion for the workbench conformance fixture or generated fixture
  that:
  - `ref` is the sole target identity;
  - DOM slug appears in at most one nested field;
  - source path/line data appears only under `extension.source`;
  - `provenance.source_payload_id` is absent for generated workbench targets
    if it would duplicate the target slug/ref.
- Regenerate checked-in deterministic workbench fixtures if the schema or target
  shape changes require it.

## Scope

HTML workbench producer/consumer helpers, canonical target normalizer only if a
scoped suppression option is needed, the HTML workbench expression schema,
workbench/conformance fixtures, and focused tests.

## Hard Boundaries / Non-Goals

- Do not remove old-spelling fallback support needed by Sigil, browser DOM, or
  other producers outside this PR. Mark it with the #399 removal gate instead.
- Do not change rendered DOM attribute names.
- Do not change source map or resume sidecar top-level source fields unless a
  test proves they are part of the duplicated semantic target record problem.
- Do not broaden into Surface Inspector extraction work.
- Do not run live pointer or supervised Operator checks.
- Do not touch unrelated untracked work-card/source/report artifacts.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/html-workbench-expression.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/schemas/aos-html-workbench-expression-v0.test.mjs
```

Run a final drift search and include the output summary:

```bash
rg -n "source_payload_id|extension\\.dom_id|provenance\\.source_path|provenance\\.source_line_start|provenance\\.source_line_end|target_id|data_aos_ref|aos_ref|accessible_label" docs/design/fixtures/aos-html-workbench-expression-v0 docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/*.expression.json packages/toolkit/workbench/html-workbench-expression.js packages/toolkit/components/html-workbench-expression/index.js shared/schemas/aos-html-workbench-expression-v0.schema.json tests/toolkit/html-workbench-expression.test.mjs tests/toolkit/agent-ui-target-conformance.test.mjs
```

Remaining matches are acceptable only for source maps/sidecars that are not
semantic target producer records, for explicitly external contracts, or for
test code proving absence. Explain each remaining match.

## Completion Report

Report:

- changed files;
- final workbench semantic target shape with one small JSON example;
- whether `normalizeAgentUiTarget(...)` changed and why;
- schema fields removed or made optional;
- conformance gate added for nested duplication;
- transitional fallback comments added with #399 references;
- exact verification commands and pass/fail results;
- final drift-search summary;
- branch push status and new head SHA for PR #398;
- unrelated dirty or untracked local-only state;
- remaining blockers or follow-up recommendations.
