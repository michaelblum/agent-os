# Agent UI Target Conformance Fixtures V0

## Historical Status

This card is historical for target identity guidance. It predates the accepted
#429 target descriptor contract and #432 drift cleanup. Current work should use
`shared/schemas/aos-semantic-targets.md` for target identity: state-scoped refs
plus `target.target_id` scoped by `target.owner_namespace`, with labels and
accessible names only as presentation or reacquisition hints.

## Recipient

GDI audit and fixture round.

## Branch / Base

- branch_from:
  `gdi/sigil-context-menu-compact-surface-lifecycle-extraction-v0` at
  `f38768bd62e45245fe83e9881ca0d5b81da76c75`
- required_start_ref:
  `gdi/sigil-context-menu-compact-surface-lifecycle-extraction-v0` at
  `f38768bd62e45245fe83e9881ca0d5b81da76c75`
- expected output branch:
  `gdi/agent-ui-target-conformance-fixtures-v0`

Do not start this card from `origin/main`. The source synthesis and review are
local design artifacts on the required start ref. If either source artifact is
missing, stop and report `source_artifact_missing` instead of reconstructing it.

## Source Artifact

- Problem statement:
  `docs/design/agent-ui-affordance-synthesis-v0.md`
- Authoritative direction and gates:
  `docs/design/agent-ui-affordance-synthesis-v0-review.md`

Treat the review as the controlling document. Its verdict is REVISE: the
two-layer producer/projection model already ships in tested code, and this
round must formalize the current shape pressure before any runtime migration.
Use review Section 8 as the authoritative candidate canonical shape for this
round unless the fixtures prove it cannot represent the current producers
losslessly.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Add a read-only conformance and fixture pack proving whether the four current
producer shapes and the live projection consumer shape can map losslessly to the
candidate canonical `agent_ui_target` / projection model, with zero runtime
behavior changes.

## Read First

- `AGENTS.md`
- `docs/design/agent-ui-affordance-synthesis-v0-review.md`
- `docs/design/agent-ui-affordance-synthesis-v0.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `packages/toolkit/panel/form.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/snapshot-projection.js`
- `packages/toolkit/workbench/html-workbench-expression.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/renderer/context-menu-snapshot-projection.test.mjs`
- Current focused tests named below under Verification.

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD
rg -n "aosRef|aos_ref|data_aos_ref|target_id|subject_id|semantic_target_id|do_target|normalizeSemanticTarget|controlRecordFor|function semanticTarget|buildSemanticTargetProjectionAdapterResult" packages apps tests docs/design/agent-ui-affordance-synthesis-v0-review.md
```

No live AOS runtime is required for this slice. If you need runtime state for
some reason, run `./aos ready` first and use
`.docks/gdi/scripts/human-needed-tcc-reset` if repo-mode permissions block live
checks.

## Existing Code To Inspect

- `packages/toolkit/runtime/semantic-targets.js` - current semantic target
  base normalizer and DOM attribute stamping.
- `packages/toolkit/panel/form.js` - current form control record producer,
  including the test-locked `ref` plus `aosRef` duplicate.
- `apps/sigil/avatar-editor/compact-surface.js` - Sigil compact tab/control
  records composed from toolkit form records and semantic targets.
- `apps/sigil/context-menu/snapshot-projection.js` - context-menu snapshot
  exposure of compact records.
- `packages/toolkit/workbench/html-workbench-expression.js` - workbench
  `semanticTarget()` producer that bypasses the semantic target normalizer and
  emits `target_id`, `aos_ref`, and `data_aos_ref`.
- `packages/toolkit/workbench/annotation-projection.js` - live consumer
  projection adapter and its six-key identity sniffing.
- `packages/toolkit/components/surface-inspector/index.js` - live consumer of
  semantic target projection and reveal payloads.

## Required Behavior

Create deterministic audit fixtures and tests that exercise these current
shapes without changing their runtime output:

1. Toolkit runtime semantic target record.
2. Toolkit panel form control record.
3. Sigil compact surface tab/control record.
4. HTML workbench source-line/document target record.
5. Annotation/Surface Inspector projection consumer record.

The conformance test may use a test-local mapper or fixture builder for the
review Section 8 candidate canonical shape. Do not introduce
`normalizeAgentUiTarget` or migrate production callers in this round.

The candidate producer fixture must represent one canonical structural record
with:

- a single top-level identity key: `ref`;
- snake_case top-level keys only;
- producer-side semantics and affordances only;
- no projection fields such as `current_render_status`,
  `display_space_rect`, `refreshed_at`, or `blocker_reason`;
- selectors only as provenance or reveal hints, never as identity.

The candidate projection fixtures must stay separate from the producer fixtures
and join by `ref`. They must model the existing consumer adapter results closely
enough to expose both:

- the current `subject_id`/`target_id` identity drift; and
- the load-bearing `(adapter_id, ref)` cardinality from review Sections 2 and
  2.5.

Include at least two projection adapter results for the same canonical `ref`,
for example an `aos-toolkit-semantic-target` projection and an
`aos-canvas-window` projection that refer to the same target/root. The test must
assert these are two separate projection records keyed by `(adapter_id, ref)`,
not one producer record with embedded or overwritten projection state.

Lossless mapping means every field currently asserted by focused tests is
either represented in the canonical fixture or explicitly accounted for in the
mapping table as provenance, extension, projection-only, or intentionally
excluded. Do not hide old identity spellings inside the canonical producer
record to satisfy losslessness.

## Required Outputs

Add a small fixture pack under:

```text
docs/design/fixtures/agent-ui-target-conformance-v0/
```

Include:

- JSON fixtures for the current source records and their candidate canonical
  mapped records.
- Committed JSON fixtures, not generated files that are silently overwritten
  during the test run.
- A concise mapping table in Markdown or JSON that shows, for each current
  shape, where `ref`, `role`, `name`, `surface`, `state`, `actions`,
  control/workbench extensions, provenance selectors, source lines, and
  projection fields land.
- A deterministic test, likely
  `tests/toolkit/agent-ui-target-conformance.test.mjs`, that validates the
  fixture pack against a test-local mapper, fails on drift, and enforces the
  review's Section 9 gates.

## Regression Gates

Enforce the review's Section 9 gates in the new conformance test:

- Single-identity gate: canonical producer records expose exactly one identity
  key, `ref`.
- Casing gate: every top-level canonical producer key matches
  `^[a-z][a-z0-9_]*$`.
- No-projection-in-producer gate: producer fixtures do not contain projection
  fields.
- Explicit-blocker gate: blocked or unprojectable consumer records preserve
  explicit `blocker_reasons` instead of inventing selector fallback identity.
- Cardinality gate: at least one canonical `ref` has two projection fixtures
  with different `adapter_id` values, proving projection identity is
  `(adapter_id, ref)`.
- Lossless mapping gate: all currently asserted producer fields are mapped or
  explicitly accounted for.
- Preserve proven cores: current tests still prove `normalizeSemanticTarget`
  requires an id and refuses an implicit action default.

## Scope

Tests, fixtures, and mapping/audit documentation only.

## Hard Boundaries / Non-Goals

- Do not change runtime code in this slice unless it is strictly necessary to
  expose a pure fixture builder that already exists implicitly. Prefer keeping
  all mapping logic test-local.
- Do not add `normalizeAgentUiTarget`.
- Do not migrate `normalizeSemanticTarget` to snake_case in this round.
- Do not rewrite `panel-form.test.mjs:272-273` in this round.
- Do not delete or re-derive workbench `semanticTarget()` in this round.
- Do not add compatibility aliases, transitional shims, or a second public
  identity spelling.
- Do not settle the open questions from review Section 11. If a decision is
  required to make the fixtures coherent, stop and report the exact decision
  point.

## Stop Conditions

Stop with a clear report instead of continuing if:

- the canonical candidate cannot represent a workbench source-line target and a
  control target without aliases or projection leakage;
- preserving losslessness would require keeping more than one identity spelling
  in the canonical producer record;
- the source artifacts are absent from the worktree;
- the work would require Slice 2 runtime migration.

## Verification

Run:

```bash
git diff --check
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/panel-form.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/context-menu-snapshot-projection.test.mjs tests/renderer/context-menu-hit-test.test.mjs tests/toolkit/html-workbench-expression.test.mjs tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
```

If the focused suite is too slow or has an unrelated pre-existing failure,
rerun the smallest failing command, capture the exact failure, and explain why
it is unrelated or why it blocks acceptance.

## Completion Report

Include:

- branch and head SHA;
- changed paths, limited to this conformance/fixture slice;
- what fixture records were added and what producer/consumer shapes they cover;
- mapping table summary, especially any field that failed to map cleanly;
- exact verification commands and pass/fail results;
- confirmation that no runtime behavior was changed, or the exact reason if a
  tiny runtime export was unavoidable;
- known unrelated dirty state in this worktree;
- recommended Slice 2 readiness: `ready`, `blocked`, or `needs human decision`,
  with the reason.
