# Display-First Annotation Show Me Record Contract V0

## Tracker

- Show Me tracker: https://github.com/michaelblum/agent-os/issues/299
- Display-first annotation epic: https://github.com/michaelblum/agent-os/issues/295
- Foundation tracker: https://github.com/michaelblum/agent-os/issues/294
- Completed prerequisites:
  - #296 Display-first Annotation Mode foundation V0
  - #298 Annotation snapshots and live-session lifetime
- Design direction:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Current public contracts:
  - `docs/api/toolkit/workbench.md`
  - `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
  - `docs/design/generated-artifact-lifecycle-policy.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
issue state, annotation runtime state, snapshot artifacts, schema conventions,
or prior implementation state. Read and rediscover before editing. Work in
`/Users/Michael/Code/agent-os`, not in `.docks/`.

This is the first #299 slice after #296 and #298 completed. The goal is a
contract-first foundation for Show Me records, not a recorder UI.

## Branch / Base

- `branch_from: origin/main`
- `required_start_ref: origin/main`
- Expected output branch: `gdi/display-first-annotation-show-me-record-contract-v0`
- Stop and report instead of rebasing if the work card is not present on the
  start ref or if `origin/main` lacks the #296/#298 completion contracts.

## Goal

Define Show Me Record V0 as an ordered, portable record over the accepted
display-first annotation primitives.

A Show Me record should capture a sequence of focused moments: annotation
anchors, point-in-time annotation snapshots, optional observed user actions,
comments, and stale/blocker states. It should reuse `aos_annotation_session` and
`surface_inspector_annotation_snapshot` boundaries instead of creating a
separate annotation model.

Deliver the smallest durable contract that future UI/runtime work can build on:
a design/API note plus a focused schema, fixtures, and schema test if that stays
small. If a full schema would force premature product decisions, write the
precise contract note and a schema stub/sketch, then report why runtime schema
should wait.

## Read First

- `AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/api/toolkit/workbench.md`
- `docs/api/aos.md`
- `docs/design/generated-artifact-lifecycle-policy.md`
- `shared/schemas/CONTRACT-GOVERNANCE.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.md`
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json`
- `shared/schemas/fixtures/surface-inspector-annotation-snapshot-v0/valid/annotated.json`
- `tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `tests/toolkit/annotation-session.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
git worktree list
./aos ready
./aos dev recommend --json
./aos dev gh issue view 299 --json
./aos dev gh issue view 296 --json
./aos dev gh issue view 298 --json
rg -n "Show Me|rich leaf|aos_annotation_session|surface_inspector_annotation_snapshot|annotation snapshot|capture_bundle" docs shared packages tests
```

This slice should be deterministic. If `./aos ready` reports a repo-mode TCC or
input-tap blocker, record the exact blocker but continue docs/schema work. Do
not route live verification unless the implementation unexpectedly adds runtime
capture behavior.

## Existing Code And Contracts To Inspect

- `packages/toolkit/workbench/annotation-session.js` owns the shared in-memory
  `aos_annotation_session` model. Show Me must reference this boundary rather
  than inventing a second anchor/session shape.
- `packages/toolkit/workbench/surface-inspector-annotations.js` converts current
  Surface Inspector state into the shared session and snapshot artifact.
- `shared/schemas/surface-inspector-annotation-snapshot-v0.schema.json` and its
  valid fixture show the accepted point-in-time snapshot payload.
- `docs/api/toolkit/workbench.md` documents Annotation Session V0, overlay
  renderer V0, candidate helpers, and Surface Inspector annotation support.
- `docs/design/generated-artifact-lifecycle-policy.md` classifies records,
  evidence artifacts, generated projections, and disposable scratch. Show Me
  record storage/lifecycle must use this vocabulary.

## Required Behavior

### Contract Shape

Define the V0 Show Me record in neutral terms. It should include:

- stable schema/version identity, for example `aos_show_me_record` `0.1.0`;
- record id, created/updated timestamps, actor/source metadata, and producer
  metadata;
- subject root/context metadata when available;
- an ordered `steps` or `moments` array;
- per-step ids, order/index, timestamps, actor/source, and kind;
- references to `aos_annotation_session` state or
  `surface_inspector_annotation_snapshot` artifacts when a moment captures
  point-in-time annotation evidence;
- anchor/address references for focused frame/comment moments;
- optional observed user-action evidence when available, without requiring a
  separate recorder system in this slice;
- explicit stale, absent, unsupported, or blocker states when a subject changes
  during the recording;
- lifecycle/provenance fields that say whether the record is a runtime record,
  evidence artifact, archived bundle member, or checked-in fixture.

The contract should make clear that Show Me is an ordered record over the shared
annotation model. It is not a persistent live annotation database, not a replay
engine, and not a replacement for snapshot artifacts.

### Rich Leaf Boundary

Name future rich leaf extension points without implementing them. At minimum,
reserve or document how later slices can add:

- agent prompt/query leaves;
- yes/no, true/false, and option-button leaves;
- free-form response leaves;
- "something else" escape-hatch responses;
- freehand/drawing records scoped to a frame;
- multiple human comments on the same frame;
- agent-authored suggestions with actor/source/status distinction.

Do not build the UI widgets or runtime authoring flows for these leaves in this
slice. The V0 record should leave a clear extension path without making leaf
semantics more specific than current product direction supports.

### Documentation Placement

Add or update the smallest durable docs needed so the next implementation slice
does not need to infer the contract from issue text alone. Likely outputs:

- a focused design note under `docs/design/`, or a concise section in the
  display-first annotation note if that is cleaner;
- `docs/api/toolkit/workbench.md` pointer text for Show Me Record V0;
- `shared/schemas/aos-show-me-record-v0.md` and
  `shared/schemas/aos-show-me-record-v0.schema.json` if schema work stays
  bounded;
- valid/invalid fixtures and `tests/schemas/aos-show-me-record-v0.test.mjs` if
  the schema is added.

Use existing schema/test naming conventions. Avoid broad docs churn.

## Scope

Likely ownership:

- design/API contract docs;
- shared schema and fixtures, if bounded;
- schema test only;
- no runtime behavior unless a tiny export/helper is unavoidable to keep the
  contract truthful.

## Hard Boundaries / Non-Goals

- No recorder UI.
- No Show Me playback/replay engine.
- No workflow engine.
- No persistent annotation database.
- No broad Surface Inspector authoring redesign.
- No Sigil radial UI changes.
- No freehand drawing implementation.
- No rich-leaf widgets or prompt/answer UI.
- No arbitrary browser DOM/CDP adapter expansion.
- No Employer Brand-specific fields in the neutral contract.
- No screenshot-pixel oracle for structured target truth.
- No runtime cleanup/migration commands.

## Suggested Implementation Areas

Treat these as starting points, not mandates:

- `docs/design/show-me-record-contract-v0.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/aos-show-me-record-v0.md`
- `shared/schemas/aos-show-me-record-v0.schema.json`
- `shared/schemas/fixtures/aos-show-me-record-v0/valid/basic-record.json`
- `shared/schemas/fixtures/aos-show-me-record-v0/invalid/missing-ordered-moments.json`
- `tests/schemas/aos-show-me-record-v0.test.mjs`

If you add a schema, prefer explicit references or copied minimal definitions
over depending on runtime-only JavaScript helpers. Keep fixture data synthetic.

## Verification

Start with the router:

```bash
./aos dev recommend --json --files \
  docs/design/show-me-record-contract-v0.md \
  docs/api/toolkit/workbench.md \
  shared/schemas/aos-show-me-record-v0.md \
  shared/schemas/aos-show-me-record-v0.schema.json \
  tests/schemas/aos-show-me-record-v0.test.mjs
```

Run deterministic checks based on actual changes. Expected candidates:

```bash
node --test tests/schemas/aos-show-me-record-v0.test.mjs
node --test tests/schemas/surface-inspector-annotation-snapshot-v0.test.mjs
node --test tests/toolkit/annotation-session.test.mjs tests/toolkit/surface-inspector-annotations.test.mjs
bash tests/help-contract.sh
git diff --check
```

If the slice remains docs-only, run at least:

```bash
bash tests/help-contract.sh
git diff --check
```

Report `./aos ready` state, but do not require live AOS smoke for this contract
slice.

## Completion Report

Report:

- changed files;
- whether a schema/fixtures/test were added or why schema stayed deferred;
- the final Show Me record identity and lifecycle class;
- how the record references `aos_annotation_session` and
  `surface_inspector_annotation_snapshot`;
- which rich leaf extension points were reserved and which stayed out of scope;
- deterministic tests and exact results;
- `./aos ready` result or exact readiness blocker;
- final `git status --short --branch`;
- recommended next #299 slice, if one is obvious after the contract lands.

If this GDI CLI session already had a completed active goal, remind the human
to run `/goal clear` before retiring it or starting unrelated work.
