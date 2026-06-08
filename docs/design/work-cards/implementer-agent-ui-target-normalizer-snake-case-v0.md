# Agent UI Target Normalizer Snake Case V0

## Recipient

Implementer implementation round.

## Branch / Base

- branch_from:
  `implementer/agent-ui-target-conformance-fixtures-v0` at
  `99cb50f048e843bf0acf56c206f65de208898abf`
- required_start_ref:
  `implementer/agent-ui-target-conformance-fixtures-v0` at
  `99cb50f048e843bf0acf56c206f65de208898abf`
- expected output branch:
  `implementer/agent-ui-target-normalizer-snake-case-v0`

Do not start this card from `origin/main`. Slice 1's conformance fixtures are
the required guardrail for this breaking migration.

## Source Artifact

- Direction and gates:
  `docs/design/agent-ui-affordance-synthesis-v0-review.md`
- Problem statement:
  `docs/design/agent-ui-affordance-synthesis-v0.md`
- Accepted Slice 1 fixture pack:
  `docs/design/fixtures/agent-ui-target-conformance-v0/`
- Accepted Slice 1 test:
  `tests/toolkit/agent-ui-target-conformance.test.mjs`
- Prior dispatch card:
  `docs/design/work-cards/implementer-agent-ui-target-conformance-fixtures-v0.md`

Treat review Sections 0.5, 8, 9, and 10 as controlling. The owner sanctioned
breaking frozen in-repo contracts for cohesion. That means this round should
hard-cut migrated in-repo callers to snake_case and a single `ref`, not add
aliases or shims.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Formalize the producer-side structural target record by adding
`normalizeAgentUiTarget(...)`, migrating the semantic target base to snake_case
and a single canonical `ref`, and cutting toolkit panel/Sigil compact producer
records over to that shape without changing live DOM attribute names.

## Read First

- `AGENTS.md`
- `docs/design/agent-ui-affordance-synthesis-v0-review.md`
- `docs/design/fixtures/agent-ui-target-conformance-v0/mapping-table.md`
- `tests/toolkit/agent-ui-target-conformance.test.mjs`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `apps/sigil/context-menu/compact-surface-session.js`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `tests/toolkit/panel-form.test.mjs`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`
- `tests/renderer/context-menu-snapshot-projection.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
rg -n "aosRefForTarget|\\baosRef\\b|parentCanvasId|normalizeSemanticTarget|normalizeAgentUiTarget|controlRecordFor|getControlRecords\\(|data_aos_ref|aos_ref|target_id" packages apps tests docs/design/fixtures/agent-ui-target-conformance-v0
```

No live AOS runtime is required for this slice. If you need runtime state for
some reason, run `./aos ready` first and use
the manual TCC blocker report path if repo-mode permissions block live
checks.

## Required Behavior

### Semantic target base

- `normalizeSemanticTarget(...)` must return snake_case producer fields:
  `ref` and `parent_canvas_id`, not `aosRef` or `parentCanvasId`.
- The canonical ref precedence is explicit `ref`, then generated
  `${surface}:${id}` when `surface` exists, then `id`.
- Replace `aosRefForTarget(...)` with a canonical `refForTarget(...)` export
  unless inspection finds a real external release boundary. Do not keep an
  in-repo alias just to preserve the old name.
- `normalizeSemanticTargets(...)` must preserve the existing guardrails:
  missing stable ids throw, and `action` is never defaulted to identity.
- DOM attribute helpers still stamp the existing attributes
  `data-aos-ref`, `data-aos-parent-canvas`, `data-aos-surface`,
  `data-semantic-target-id`, and `data-aos-action`. This slice changes the
  JavaScript record contract, not the HTML attribute names or DOM
  `dataset.aosRef` mechanics.

### Agent UI target composer

- Add `normalizeAgentUiTarget(...)` as the producer-side canonical composer
  using review Section 8 and the Slice 1 candidate fixtures as the expected
  shape.
- It should compose `normalizeSemanticTarget(...)` without re-casing and emit a
  structural producer record with top-level `ref`, `surface`, `role`, `name`,
  `kind`, `enabled`, `state`, `actions`, `extension`, and `provenance`.
- It must not emit projection fields such as `current_render_status`,
  `display_space_rect`, `refreshed_at`, or `blocker_reason(s)`.
- It must not emit alternate identity fields such as `aosRef`, `aos_ref`,
  `data_aos_ref`, `target_id`, `subject_id`, `semantic_target_id`, or
  `do_target`.

### Toolkit panel and Sigil compact producers

- Migrate `packages/toolkit/panel/form.js` control records to the canonical
  `agent_ui_target` shape and a single `ref`.
- Rewrite the frozen duplicate assertions in
  `tests/toolkit/panel-form.test.mjs`; `aosRef` must disappear from the record
  contract.
- Migrate `apps/sigil/avatar-editor/compact-surface.js` tab/control records to
  the same canonical shape.
- Keep existing operation fields lossless by placing descriptor ids, field ids,
  options, hidden state, tab metadata, section metadata, labels, source data,
  and local frames in `extension` or `provenance` according to the Slice 1
  mapping table.
- Update context-menu snapshot expectations only to reflect the canonical
  control record shape. Do not redesign context menu behavior.

### Call site cutover

- Update in-repo semantic helper inputs from `aosRef`/`parentCanvasId` to
  `ref`/`parent_canvas_id` wherever they are constructing semantic target
  records.
- Do not rename literal HTML/data attribute strings such as `data-aos-ref`, and
  do not treat DOM `dataset.aosRef` assertions as producer record drift.
- Workbench `aos_ref`/`data_aos_ref`/`target_id` remains a known producer drift
  for Slice 3. Do not delete or re-derive `semanticTarget()` in this round.

### Fixture pack

- Update the Slice 1 conformance fixtures and mapping table so "current source
  records" remain true after this migration for the migrated producers.
- The fixture pack should continue to expose the still-unmigrated workbench
  identity drift until Slice 3.
- Keep the cardinality fixture: at least two projection records for the same
  canonical `ref`, keyed by `(adapter_id, ref)`.

## Scope

Toolkit runtime, toolkit panel form records, Sigil compact control records,
focused tests, conformance fixtures, and directly affected docs/API references
only.

## Hard Boundaries / Non-Goals

- Do not delete or re-derive
  `packages/toolkit/workbench/html-workbench-expression.js` `semanticTarget()`;
  that is Slice 3.
- Do not collapse projection records into producer records.
- Do not settle the review Section 11 open questions: projection nested vs
  flat, children vs `parent_ref`, or #164 Playwright dialect.
- Do not add compatibility aliases, transitional wrappers, or duplicate
  identity fields for migrated in-repo contracts.
- Do not run live pointer or supervised Operator checks for this deterministic
  migration.
- Do not touch unrelated untracked work-card/source/report artifacts.

## Stop Conditions

Stop with a clear report instead of continuing if:

- the canonical `agent_ui_target` shape cannot preserve panel/Sigil control
  operation data without reintroducing duplicate identity fields;
- migrating helper inputs requires changing DOM attribute names or external
  HTML semantics;
- a live consumer outside the focused surface depends on top-level `aosRef` in
  a way that cannot be migrated in the same branch;
- the work would require deleting or redesigning workbench `semanticTarget()`.

## Suggested Implementation Areas

Likely files:

- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/runtime/index.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `apps/sigil/context-menu/compact-surface-session.js` if record access moves
- focused tests under `tests/toolkit/` and `tests/renderer/`
- `docs/design/fixtures/agent-ui-target-conformance-v0/`
- `docs/api/` only if it documents the old producer record field names

Use `rg` to find all in-repo object-field call sites that pass `aosRef` or
`parentCanvasId` into semantic target helpers. Update those to `ref` and
`parent_canvas_id`. Leave raw `data-aos-ref` attribute strings and
`dataset.aosRef` DOM mechanics intact.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/runtime-semantic-targets.test.mjs
node --test tests/toolkit/panel-form.test.mjs
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/context-menu-snapshot-projection.test.mjs tests/renderer/context-menu-hit-test.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/html-workbench-expression.test.mjs tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
```

Also run a focused drift search and include the output summary in the report:

```bash
rg -n "aosRefForTarget|\\baosRef\\b|parentCanvasId" packages apps tests docs/design/fixtures/agent-ui-target-conformance-v0
```

Remaining matches must be either DOM attribute/dataset mechanics, deliberately
unmigrated workbench/Slice 3 evidence, or explicitly justified external
documentation references. There should be no migrated producer record contract
that still exposes top-level `aosRef`.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- exact semantic target output contract after migration;
- where `normalizeAgentUiTarget(...)` lives and which producers use it;
- what happened to `aosRefForTarget(...)`;
- how panel/Sigil record consumers were migrated;
- fixture pack changes and whether workbench drift remains isolated for Slice 3;
- exact verification commands and pass/fail results;
- drift-search summary for remaining `aosRef`/`parentCanvasId` matches;
- confirmation that DOM `data-aos-ref` attributes were preserved;
- any remaining blockers or the next Slice 3 readiness recommendation.
