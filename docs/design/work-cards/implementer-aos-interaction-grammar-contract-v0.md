# AOS Interaction Grammar Contract V0

## Recipient

Implementer contract, fixture, and test round.

## Transfer Kind

Implementer round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at `143382ac` or later, with PR
  #433 merged.
- expected output branch: `implementer/aos-interaction-grammar-contract-v0`

Do not reset to an older `origin/main`. The target descriptor contract and
semantic-target drift cleanup are published prerequisites.

## Source Artifact

- GitHub issue #430:
  https://github.com/michaelblum/agent-os/issues/430
- Published prerequisite PR #433:
  https://github.com/michaelblum/agent-os/pull/433
- Prerequisite lanes:
  - #429 target descriptor contract is published.
  - #432 semantic-target drift cleanup is closed.
  - #427 gesture-frame proof is published.
  - #428 Work Recording remains downstream schema/design work.
  - #431 input-event-v2 hard cutover remains separate debt.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Define and prove the first AOS interaction grammar contract so action intents,
execution results, optional gesture frames, state patches/evidence, and Work
Recording replay plans all reference the #429 target descriptor vocabulary
without treating labels or coordinates as durable identity.

## Read First

- `AGENTS.md`
- `shared/schemas/aos-semantic-targets.md`
- `docs/api/aos.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/see-do-grammar-trace-connections.md`
- `docs/design/fixtures/aos-target-descriptor-v0/manifest.json`
- `tests/toolkit/aos-target-descriptor-contract.test.mjs`
- `packages/toolkit/runtime/gesture-stream.js`
- `tests/toolkit/runtime-gesture-stream.test.mjs`
- `shared/schemas/aos-work-record-v0.md`
- `shared/schemas/aos-work-record-v0.schema.json`
- `docs/design/fixtures/aos-work-records/canvas-toolkit-control-step.json`
- `tests/toolkit/work-record-capture.test.mjs`
- `tests/toolkit/work-record-adapter.test.mjs`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 430 --json
rg -n "action intent|execution result|gesture frame|state patch|do_step|execution_map|aos\\.gesture-frame|semantic_action|semantic_target|target\\.target_id|state_id|replay" docs/design shared/schemas packages/toolkit tests/toolkit --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

Live AOS is intentionally paused for this workstream. Do not run `./aos ready`,
`./aos status`, `./aos clean`, service start/restart, or live smoke unless
Michael explicitly approves it in a new instruction. This slice is
deterministic-only.

## Existing Code And Docs To Inspect

- `shared/schemas/aos-semantic-targets.md` - canonical target descriptor
  vocabulary that every interaction frame must use.
- `docs/design/aos-shared-gesture-spine-v0.md` and
  `packages/toolkit/runtime/gesture-stream.js` - existing `aos.gesture-frame`
  proof and gesture frame fields.
- `docs/design/aos-work-records-and-self-healing-recipes.md`,
  `shared/schemas/aos-work-record-v0.md`, and
  `shared/schemas/aos-work-record-v0.schema.json` - current work-record
  vocabulary and replay/repair boundaries.
- `docs/design/see-do-grammar-trace-connections.md` - older research note that
  should be reconciled or marked as pre-#429 where it conflicts.
- `docs/design/fixtures/aos-work-records/canvas-toolkit-control-step.json` -
  current toolkit control step fixture that can inform the slider example.
- `tests/toolkit/work-record-*.test.mjs` - existing fixture/test style for
  Work Record guardrails.

## Required Behavior

### Contract Note

Add a current design note, likely `docs/design/aos-interaction-grammar-v0.md`,
that defines the V0 interaction record family:

- `target_descriptor`: what target exists and what can be done to it, using the
  #429 descriptor vocabulary.
- `action_intent`: what an agent, recipe, or replay requested. It must carry
  action type, target ref/descriptor, optional input value or vector, source
  state id, constraints, and caller/provenance metadata.
- `execution_result`: how AOS performed the intent and whether it fell back,
  preserving current `aos do` response fields such as backend, strategy,
  fallback flag, state id, target details, resolved target, post-action state,
  status, reason, and duration.
- `observed_input`: raw hardware/canvas facts only when needed for evidence or
  visible playback; not the primary semantic record for AOS-owned surfaces.
- `gesture_frame`: optional normalized lifecycle frames from
  `aos.gesture-frame`, linked to the action intent/execution transaction when
  playback is human/visible or observation captured a drag.
- `state_patch` / `evidence`: what changed and how it was verified.
- `recording_replay_plan`: how a Work Recording should re-perceive, resolve the
  descriptor, reissue the semantic action, and verify state without blind raw
  event replay.

The note must name ownership boundaries:

- `aos do` owns action intent validation and execution result fields.
- toolkit gesture stream owns gesture mechanics and frame lifecycle.
- Work Recording owns durable intent, execution-map/evidence storage, replay
  plan, health, and repair patches.
- raw `input_event` / input-event-v2 is source evidence and compatibility debt,
  not the new canonical recording grammar.

### Fixture Pack

Add deterministic fixtures, likely under
`docs/design/fixtures/aos-interaction-grammar-v0/`, with at least:

- `manifest.json`;
- a toolkit single-thumb slider sequence showing:
  `see -> action_intent(set-value) -> execution_result -> optional
  gesture.drag.* frames for human playback -> state_patch -> work_record /
  replay_plan`;
- a stale-ref sequence where `state_id`/`ref` rejects before execution and the
  replay plan attempts machine-first reacquisition;
- an ambiguous same-label reacquisition sequence that stays blocked.

The slider fixture must use the #429 descriptor vocabulary:

- `ref` and `state_id` for the immediate action;
- `target.target_id` scoped by `target.owner_namespace`;
- primitive `actions`;
- current `state`;
- `provenance`;
- `reacquisition` machine facts first, labels only as hints.

Do not use examples such as `avatar.controls.scale` or `settings.opacity` as
durable ids unless they are explicitly presented as labels/hints and paired
with descriptor identity.

### Tests

Add a focused Node test, likely
`tests/toolkit/aos-interaction-grammar-contract.test.mjs`, that validates the
fixture pack and fails if:

- labels/accessibility names appear in durable target identity;
- `action_intent`, `execution_result`, gesture frames, state patches, or replay
  plans point at a target without descriptor identity or state-scoped ref
  context;
- an execution result loses current `aos do` fields such as backend, strategy,
  fallback flag, state id, target details, post-action state, status/reason, or
  duration when those fields are present;
- raw coordinates become the primary target identity for the AOS-owned slider
  case;
- ambiguous same-label reacquisition silently selects a target.

Prefer fixture validation and small helpers in the test file over broad runtime
changes unless inspection shows a tiny shared helper belongs in toolkit.

### Existing Docs

Update adjacent current docs only as needed:

- `docs/design/aos-work-records-and-self-healing-recipes.md` should point to
  the new interaction grammar note for the intent/execution/gesture/patch
  split.
- `docs/design/aos-shared-gesture-spine-v0.md` should make clear that gesture
  frames are optional interaction evidence/playback frames, not the whole
  action intent or Work Recording model.
- `docs/design/see-do-grammar-trace-connections.md` may remain a research note,
  but if it still recommends accessible names over descriptor identity for
  replay, add a dated status note pointing to #429/#430 and the new grammar
  note.
- `docs/api/aos.md` may be updated only if the contract note needs a narrow
  public cross-reference. Do not overpromise current producer/runtime coverage.

## Scope

Schema/design docs, deterministic fixtures, focused Node tests, and narrow
current-doc cross-references.

Runtime code changes are optional and should happen only if a tiny helper is
needed to keep fixture validation honest. Native Swift producer, daemon, live
runtime, and input-event-v2 hard-cutover work are out of scope.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, or live smoke.
- Do not implement a recorder, replayer, autonomous repair loop, or `aos do`
  runtime changes.
- Do not start #431 input-event-v2 hard cutover.
- Do not change native/Swift or TCC broker code.
- Do not introduce Pi `@e` / `@w` syntax as canonical AOS syntax.
- Do not make raw coordinates or human-readable labels primary identity for
  AOS-owned targets.
- Do not close #430; Foreman will decide after review.
- Do not push, open PRs, or mutate GitHub issues.

## Stop Conditions

Stop with a clear report instead of continuing if:

- the interaction family cannot represent current `aos do` result metadata
  without losing fields;
- a useful end-to-end fixture requires live AOS evidence or native producer
  migration;
- the design requires unresolved #431 input-event-v2 decisions;
- existing Work Record schemas conflict with the proposed fixture in a way that
  needs Foreman product/architecture judgment.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/toolkit/aos-target-descriptor-contract.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs
node --test tests/toolkit/work-record-capture.test.mjs tests/toolkit/work-record-adapter.test.mjs
node --test tests/toolkit/aos-interaction-grammar-contract.test.mjs
rg -n "avatar\\.controls\\.scale|settings\\.opacity|accessible names over coordinates|human-readable.*identity|label.*identity|name.*identity|semantic_target\\.id|target\\.id" docs/design shared/schemas docs/api packages/toolkit tests/toolkit --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

For remaining `rg` hits, classify them in the completion report as current
canonical guidance, historical/research and visibly marked, fixture-negative,
unrelated local object identity, or deferred #431/#428 work.

## Completion Report

Return a path-scoped report with:

- branch and head SHA;
- base SHA;
- files changed;
- contract note path and summary of the interaction record family;
- fixture paths and what each proves;
- test path and exact assertions added;
- existing docs updated or marked historical;
- how current `aos do` result metadata is preserved in `execution_result`;
- how gesture frames link to action intent/execution without becoming the
  whole Work Recording model;
- exact verification commands and pass/fail results;
- remaining drift-scan hits and classification;
- confirmation that live AOS was not restarted;
- local-only state, including dirty/untracked files and ignored artifacts;
- recommended next slice only if the round reveals one concrete follow-up.
