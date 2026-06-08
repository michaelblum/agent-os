# AOS Work Recording Frame Contract V0

## Recipient

Implementer contract, fixture, and test round.

## Transfer Kind

Implementer round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at `f65a4c63` or later, with PR
  #434 merged.
- expected output branch: `implementer/aos-work-recording-frame-contract-v0`

Do not reset to an older `origin/main`. The #429 target descriptor contract,
#427 gesture frame proof, and #430 interaction grammar contract are published
prerequisites.

## Source Artifact

- GitHub issue #428:
  https://github.com/michaelblum/agent-os/issues/428
- Published prerequisite PR #434:
  https://github.com/michaelblum/agent-os/pull/434
- Prerequisite lanes:
  - #427 gesture-frame proof is published.
  - #429 target descriptor contract is published.
  - #430 interaction grammar contract is published and #430 is closed.
  - #431 input-event-v2 hard cutover remains separate debt.
  - #428 owns this Work Recording schema/design lane.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Define and prove the first Work Recording frame contract that stores #430
interaction records as baseline snapshots, delta frames, evidence, and replay
policy without making raw input replay, labels, or coordinates the durable
recording language.

## Read First

- `AGENTS.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/aos-interaction-grammar-v0.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `shared/schemas/aos-semantic-targets.md`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-work-record-v0.schema.json`
- `docs/design/fixtures/aos-interaction-grammar-v0/manifest.json`
- `docs/design/fixtures/aos-interaction-grammar-v0/toolkit-slider-sequence.json`
- `tests/toolkit/aos-interaction-grammar-contract.test.mjs`
- `tests/toolkit/work-record-capture.test.mjs`
- `tests/toolkit/work-record-adapter.test.mjs`
- `tests/toolkit/work-record-verifier.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 428 --json
./aos dev gh issue view 430 --json
rg -n "baseline snapshot|delta frame|keyframe|state_patch|recording_replay_plan|aos\\.gesture-frame|execution_map|replay_policy|target\\.target_id|owner_namespace|raw input replay|avatar\\.controls\\.scale" docs/design shared/schemas tests/toolkit packages/toolkit --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

Live AOS is intentionally paused for this workstream. Do not run `./aos ready`,
`./aos status`, `./aos clean`, service start/restart, or live smoke unless
Michael explicitly approves it in a new instruction. This slice is
deterministic-only.

## Existing Code And Docs To Inspect

- `docs/design/aos-work-records-and-self-healing-recipes.md` - current Work
  Record design seed and the lane that needs the baseline/delta-frame contract.
- `shared/schemas/aos-work-record-v0.md` and
  `shared/schemas/aos-work-record-v0.schema.json` - current schema-backed Work
  Record v0 sketch, capture-builder notes, report-only verifier boundary, and
  replay/repair gates.
- `docs/design/aos-interaction-grammar-v0.md` and
  `docs/design/fixtures/aos-interaction-grammar-v0/toolkit-slider-sequence.json`
  - the published interaction record family and slider fixture that the Work
  Recording frame contract should consume.
- `docs/design/aos-shared-gesture-spine-v0.md` - gesture frame lifecycle and
  passive Surface Inspector observation boundary.
- `shared/schemas/fixtures/aos-work-record-v0/valid/*.json` - existing
  schema-backed Work Record fixtures and style.
- `packages/toolkit/workbench/work-record-capture.js`,
  `packages/toolkit/workbench/work-record-verifier.js`, and
  `packages/toolkit/workbench/work-record-evidence-adapters.js` - current
  producer/verifier boundaries. Runtime changes are not required unless a tiny
  helper is needed for deterministic fixture validation.

## Required Behavior

### Contract Note

Add a current design note, likely
`docs/design/aos-work-recording-frame-contract-v0.md`, that defines the Work
Recording frame family over the #430 interaction grammar:

- `recording_baseline`: first snapshot of relevant surfaces, state ids, target
  descriptors, environment metadata, and Work Record/replay policy context.
- `recording_delta_frame`: compact frame after the baseline that can contain
  action intents, execution results, optional gesture frames, observed input
  evidence, state patches, annotation/inspector observations, and artifact
  refs.
- `recording_keyframe`: periodic full or partial snapshot for recovery, not a
  replacement for semantic deltas.
- `recording_evidence_ref`: immutable receipts linking frames to existing Work
  Record `evidence[]` entries and artifact routes.
- `recording_replay_policy`: semantic replay policy that re-perceives, resolves
  descriptors, reissues action intents, and verifies state patches under Work
  Record gates.

The note must state ownership boundaries:

- Work Recording owns baseline/delta/keyframe storage, replay policy, evidence
  refs, frame health, and repair patch records.
- #430 interaction grammar owns the shape of target descriptors, action
  intents, execution results, observed input, gesture frames, state patches,
  and replay plans.
- Toolkit gesture stream owns `aos.gesture-frame` production and passive
  observation, not the whole recording model.
- `aos do` owns execution result metadata and target resolution.
- Raw `input_event` / input-event-v2 payloads remain observed input evidence
  and #431 compatibility/cutover debt, not the primary Work Recording language.

### Fixture Pack

Add deterministic fixtures, likely under
`docs/design/fixtures/aos-work-recording-frame-v0/`, with at least:

- `manifest.json`;
- a toolkit single-thumb slider recording showing:
  `recording_baseline -> action_intent -> execution_result -> optional
  gesture.drag.* frames -> state_patch -> Surface Inspector/annotation
  observation -> recording_delta_frame -> replay_policy`;
- a compact keyframe example that proves recovery snapshots are periodic
  checkpoints and do not replace semantic action/state deltas;
- a blocked replay example for stale or ambiguous target resolution that
  preserves the original frame/evidence and records a repair-needed health
  state without rewriting historical frames.

The fixtures may reference or reuse the #430 slider fixture, but the Work
Recording frame fixture must show what belongs in the recording layer rather
than simply duplicating the interaction grammar fixture.

### Tests

Add a focused Node test, likely
`tests/toolkit/aos-work-recording-frame-contract.test.mjs`, that validates the
fixture pack and fails if:

- baseline/delta/keyframe records omit the target descriptor identity required
  by #429/#430 for target-addressed interactions;
- labels/accessibility names or coordinates become durable recording identity;
- delta frames collapse action intents, execution results, gesture frames, and
  state patches into one undifferentiated event payload;
- gesture frames are treated as the entire Work Recording model rather than
  optional evidence/playback frames linked by transaction id;
- raw input replay becomes the default replay policy for AOS-owned surfaces;
- replay/repair policy drops the existing Work Record gates or mutates
  historical evidence/frames instead of recording a repair-needed state.

Prefer fixture validation and small helpers in the test file over broad runtime
changes. If you update the JSON Schema, keep it additive and prove all existing
Work Record v0 fixtures still validate.

### Existing Docs And Schemas

Update adjacent current docs only as needed:

- `docs/design/aos-work-records-and-self-healing-recipes.md` should point to
  the new Work Recording frame contract and replace provisional examples such
  as `avatar.controls.scale` with descriptor-aware language or clearly mark
  them as historical shorthand.
- `shared/schemas/aos-work-record-v0.md` may get a narrow section describing
  how baseline/delta/keyframe frame packs relate to the existing
  `intent + execution_map + evidence + health` model.
- `shared/schemas/aos-work-record-v0.schema.json` should change only if the
  fixture contract needs an additive schema slot. Do not break existing valid
  fixtures unless the card identifies and updates every owned caller/test in
  the same slice.
- `docs/design/aos-interaction-grammar-v0.md` may get a narrow cross-reference
  back to the Work Recording frame contract if useful.

## Scope

Schema/design docs, deterministic fixtures, focused Node tests, and narrow
current-doc/schema cross-references.

Runtime recorder, replayer, repair automation, daemon/native producers, live
capture, and broad Work Record UI changes are out of scope.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, or live smoke.
- Do not implement a recorder, replayer, autonomous repair loop, or `aos do`
  runtime changes.
- Do not start #431 input-event-v2 hard cutover or normalize legacy input
  payloads in this slice.
- Do not change native/Swift or TCC broker code.
- Do not introduce Pi `@e` / `@w` syntax as canonical AOS syntax.
- Do not make raw coordinates or human-readable labels primary identity for
  AOS-owned targets or Work Recording frames.
- Do not close #428; Foreman will decide after review.
- Do not push, open PRs, or mutate GitHub issues.

## Stop Conditions

Stop with a clear report instead of continuing if:

- the existing Work Record v0 schema blocks a useful additive frame contract in
  a way that requires broad migration judgment;
- a useful fixture requires live AOS evidence, native producer changes, or a
  real recorder implementation;
- the design requires unresolved #431 input-event-v2 decisions;
- the round discovers existing Work Record producers would need breaking
  changes to remain coherent.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/toolkit/aos-target-descriptor-contract.test.mjs
node --test tests/toolkit/aos-interaction-grammar-contract.test.mjs
node --test tests/toolkit/work-record-capture.test.mjs tests/toolkit/work-record-adapter.test.mjs tests/toolkit/work-record-verifier.test.mjs
node --test tests/toolkit/aos-work-recording-frame-contract.test.mjs
rg -n "avatar\\.controls\\.scale|settings\\.opacity|accessible names over coordinates|human-readable.*identity|label.*identity|name.*identity|semantic_target\\.id|target\\.id|raw input replay|blind raw" docs/design shared/schemas docs/api packages/toolkit tests/toolkit --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

For remaining `rg` hits, classify them in the completion report as current
canonical guidance, historical/research and visibly marked, fixture-negative,
unrelated local object identity, or deferred #431 work.

## Completion Report

Return a path-scoped report with:

- branch and head SHA;
- base SHA;
- files changed;
- contract note path and summary of the recording frame family;
- fixture paths and what each proves;
- test path and exact assertions added;
- docs/schema cross-references updated;
- whether `shared/schemas/aos-work-record-v0.schema.json` changed and why;
- how baseline/delta/keyframe records preserve #430 interaction record
  boundaries;
- how replay/repair gates and immutable evidence/history are preserved;
- exact verification commands and pass/fail results;
- remaining drift-scan hits and classification;
- confirmation that live AOS was not restarted;
- local-only state, including dirty/untracked files and ignored artifacts;
- recommended next slice only if the round reveals one concrete follow-up.
