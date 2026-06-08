# Perceive Semantic Target Canonical Cutover Correction V0

## Recipient

Implementer correction round.

## Branch / Base

- required_start_ref:
  `origin/implementer/perceive-semantic-target-canonical-cutover-v0` at
  `92eb489b373d3c7f4f27b6937b3a340bcbaf47ab`
- expected output branch:
  `implementer/perceive-semantic-target-canonical-cutover-v0`
- base for review: `origin/main` at
  `9665dd324a9663354f87caab575eab90155c8027`

Continue the existing perceive cutover branch. Do not start a new feature
branch unless the current branch cannot be updated.

## Source Artifact

- Original card:
  `docs/design/work-cards/implementer-perceive-semantic-target-canonical-cutover-v0.md`
- Issue #399 "Track removal of transitional semantic target identity sniffers"
- Foreman review of head `92eb489b373d3c7f4f27b6937b3a340bcbaf47ab`

The first cutover made the native producer canonical and removed the primary JS
fallbacks, but review found downstream surfaces that still read or assert the
old flat `semantic_targets[]` shape.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the perceive semantic-target cutover internally consistent by updating
remaining tests, docs, and toolkit consumers to read the canonical
`agent_ui_target` shape emitted by `aos see`.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/implementer-perceive-semantic-target-canonical-cutover-v0.md`
- `src/perceive/semantic-targets.swift`
- `src/perceive/models.swift`
- `src/act/canvas-ref-targeting.swift`
- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/workbench/annotation-perception-verification.js`
- `tests/toolkit/spatial-subject-tree.test.mjs`
- `tests/aos-canvas-ref-click.sh`
- `tests/aos-semantic-targets-xray.sh`
- `tests/aos-semantic-targets-xray-retry.sh`
- `docs/api/toolkit/components.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/main origin/implementer/perceive-semantic-target-canonical-cutover-v0
gh issue view 399 --json number,title,state,url,body
rg -n "semantic_targets\\[\\]\\.do_target|target\\.do_target|\\.do_target|target\\.canvas_id|target\\.bounds|target\\.action" \
  packages/toolkit/workbench tests docs/api src apps packages/gateway shared/schemas
```

## Review Findings To Correct

### F1: live smoke scripts still assert the old flat output

These tests still expect top-level `canvas_id`, `id`, `do_target`, `action`,
`parent_canvas`, `bounds`, and `center`:

- `tests/aos-canvas-ref-click.sh`
- `tests/aos-semantic-targets-xray.sh`
- `tests/aos-semantic-targets-xray-retry.sh`

Update them to assert the canonical shape:

- top-level: `ref`, `surface`, `role`, `name`, `kind`, `enabled`, `state`,
  `actions[]`, `extension`, `provenance`;
- DOM slug: `extension.dom_id`;
- route: `provenance.do_target`;
- canvas and parent canvas: `provenance.canvas_id`,
  `provenance.parent_canvas_id`;
- geometry: `provenance.bounds`, `provenance.frame`,
  `provenance.center`;
- no top-level `id`, `canvas_id`, `do_target`, `action`, `parent_canvas`,
  `bounds`, `center`, `target_id`, `aos_ref`, or `data_aos_ref`.

### F2: spatial subject tree still consumes old top-level fields

`packages/toolkit/workbench/spatial-subject-tree.js` still builds semantic
target nodes from `target.canvas_id`, `target.bounds`, `target.do_target`, and
`target.action`.

Update it for canonical inputs:

- surface/canvas come from `target.surface` and `target.provenance.canvas_id`;
- target id should prefer `target.ref` and only use a local DOM slug as a
  label/detail, not identity;
- bounds come from `target.provenance.bounds` or `target.provenance.frame`;
- action capability comes from `target.actions.length > 0` or
  `target.provenance.do_target`;
- adapter subject/routing metadata should use `target.ref` and
  `target.provenance.do_target`.

Then update `tests/toolkit/spatial-subject-tree.test.mjs` so its semantic target
fixture is canonical and would fail on the old flat field reads.

### F3: annotation perception verification still has a top-level do_target arm

`packages/toolkit/workbench/annotation-perception-verification.js` still uses
`target.do_target` as a fallback for `source_ids.adapter_subject_id`.

Snap it to canonical provenance (`target.provenance?.do_target`) or remove the
fallback if it is no longer needed. Do not add a compatibility alias for the old
flat native producer.

### F4: docs still name the old contract

`docs/api/toolkit/components.md` still says `semantic_targets[].do_target` for
`aos do click`. Update it to `semantic_targets[].provenance.do_target` and
align the nearby wording with the canonical envelope.

## Required Behavior

- The native producer remains canonical; do not reintroduce top-level aliases.
- `do_target` stays, but only as the canvas action-routing field under
  `provenance`.
- JS/toolkit consumers that ingest `aos see` semantic targets read the canonical
  envelope directly.
- Live smoke tests and deterministic spatial-subject-tree tests enforce the
  canonical field locations.
- Issue #399 remains ready to close only after this correction lands and the
  final drift search is clean.

## Scope

Correction only for the already-routed perceive cutover branch:

- tests for live semantic-target output;
- toolkit spatial/annotation consumers that still read old flat fields;
- narrow docs/API wording that still documents old flat fields.

## Hard Boundaries / Non-Goals

- Do not modify the producer back toward flat aliases.
- Do not fold `provenance.do_target` into `ref`.
- Do not touch the employer-brand reference-art quarantine branch.
- Do not start the held conformance primitive reuse cleanup; this correction is
  about cutover consistency, not abstraction cleanup.
- Do not preserve old flat native-producer fields unless a separate external
  contract forces it. If such a contract is discovered, stop and report it.

## Suggested Implementation Areas

- `packages/toolkit/workbench/spatial-subject-tree.js`
- `packages/toolkit/workbench/annotation-perception-verification.js`
- `tests/toolkit/spatial-subject-tree.test.mjs`
- `tests/aos-canvas-ref-click.sh`
- `tests/aos-semantic-targets-xray.sh`
- `tests/aos-semantic-targets-xray-retry.sh`
- `docs/api/toolkit/components.md`

## Verification

Deterministic:

```bash
git diff --check
node --test tests/toolkit/spatial-subject-tree.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/html-workbench-expression.test.mjs
./aos dev recommend --json --files src/perceive/semantic-targets.swift src/act/canvas-ref-targeting.swift packages/toolkit/workbench/spatial-subject-tree.js
```

Drift search:

```bash
rg -n "semantic_targets\\[\\]\\.do_target|target\\.do_target|\\.do_target|target\\.canvas_id|target\\.bounds|target\\.action|target_id|semantic_target_id|data_aos_ref|aos_ref|Removal gate" \
  packages/toolkit/workbench packages/toolkit/components tests docs/api src/perceive src/act apps/sigil packages/gateway shared/schemas
```

Remaining `do_target` matches must be `provenance.do_target` routing or
historical work-card text only. Remaining old-spelling matches must be unrelated
contracts such as work-record evidence fixtures, not semantic-target producer or
consumer drift.

Live, if `./aos ready` passes:

```bash
tests/aos-semantic-targets-xray.sh
tests/aos-semantic-targets-xray-retry.sh
tests/aos-canvas-ref-click.sh
```

If repo-mode TCC/input permissions block live checks, run
the manual TCC blocker report path, stop with `manual_intervention`, and after
the human says `finished` resume with `./aos ready --post-permission`.

## Completion Report

Include:

- branch and head SHA;
- changed files;
- exact remaining `do_target` and old-spelling drift-search results, with why
  any remaining matches are intentional;
- confirmation the live shell tests now assert `provenance.do_target` and nested
  geometry/canvas fields;
- confirmation `spatial-subject-tree` canonical input is tested;
- deterministic test results and live test results or readiness blocker;
- whether issue #399 is ready to close after Foreman acceptance.
