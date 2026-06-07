# AOS Target Descriptor Contract V0

## Recipient

GDI implementation and fixture round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- expected output branch: `gdi/aos-target-descriptor-contract-v0`

Do not reset to `origin/main` for this round. Local `main` is intentionally ahead
of `origin/main` with Foreman coordination state.

## Source Artifact

- GitHub issue #429:
  https://github.com/michaelblum/agent-os/issues/429
- Related but downstream ledgers: #430, #432, #428, #427, #164.
- Current contract surfaces:
  - `shared/schemas/aos-semantic-targets.md`
  - `docs/api/aos.md`
  - `packages/toolkit/runtime/semantic-targets.js`
  - `tests/toolkit/runtime-semantic-targets.test.mjs`
  - `tests/toolkit/agent-ui-target-conformance.test.mjs`
  - `docs/design/aos-shared-gesture-spine-v0.md`
  - `docs/design/aos-work-records-and-self-healing-recipes.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Define and prove the first AOS target descriptor contract so agents can act
through state-scoped refs backed by collision-resistant machine descriptors,
without treating human names or labels as target identity.

## Read First

- `AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `shared/schemas/aos-semantic-targets.md`
- `docs/api/aos.md` sections for `aos see` semantic targets and `aos do`
  target-addressed actions.
- `packages/toolkit/runtime/semantic-targets.js`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `tests/toolkit/agent-ui-target-conformance.test.mjs`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 429 --json
rg -n "semantic_targets|normalizeAgentUiTarget|normalizeSemanticTarget|refForTarget|pickName|target_id|state_id|stateId|reacqui|settings\\.opacity|avatar\\.controls\\.scale" shared docs packages tests
```

Live AOS is intentionally paused for this workstream. Do not run `./aos ready`,
`./aos status`, `./aos clean`, service start/restart, or live smoke unless
Michael explicitly approves it in a new instruction. This slice is
deterministic-only.

## Existing Code To Inspect

- `shared/schemas/aos-semantic-targets.md` - current semantic-target contract;
  it still needs the state-scoped ref / durable descriptor split.
- `docs/api/aos.md` - public `aos see` and `aos do` semantics that must align
  with descriptor-backed target resolution.
- `packages/toolkit/runtime/semantic-targets.js` - current toolkit normalizers;
  watch for any path where `name`, `label`, or accessible text can feed machine
  identity.
- `tests/toolkit/runtime-semantic-targets.test.mjs` - focused runtime contract
  tests.
- `tests/toolkit/agent-ui-target-conformance.test.mjs` and
  `docs/design/fixtures/agent-ui-target-conformance-v0/` - adjacent fixture
  pack proving older target-shape drift.
- `packages/toolkit/runtime/gesture-stream.js` and
  `docs/design/aos-shared-gesture-spine-v0.md` - gesture frame vocabulary that
  should point at descriptors instead of nice-name examples.
- `shared/schemas/aos-work-record-v0.schema.json`,
  `tests/toolkit/work-record-*.test.mjs`, and
  `docs/design/aos-work-records-and-self-healing-recipes.md` - recording
  vocabulary that will later consume the descriptor contract.

## Required Behavior

### Contract Shape

Add or update the schema/design contract so a target descriptor separates these
concepts:

- `ref`: a state-scoped, model-facing action handle from the current perception
  state. It is convenient for immediate `aos do` calls and may become stale.
- `state_id`: the perception state that scoped the ref, when available.
- `target_id` or equivalent durable machine identity, scoped by an explicit
  owner namespace. This identity must not be derived from display/window/app
  geometry or human-facing labels.
- `owner_namespace`: the app, canvas, surface, component/schema family, and
  structural owner facts needed to avoid cross-surface collisions.
- `capabilities` / `actions`: primitive operations such as `click`, `drag`,
  `set-value`, `focus`, `select`, `toggle`, and `open`.
- `state`: current value, selected/expanded/checked/pressed/current state,
  enabled/disabled state, range metadata, and similar action-relevant facts.
- `provenance` / current address: canvas id, parent canvas id, do target,
  frame/bounds/center, display/window capture facts, source payload id, and
  current routing data. These fields are observations, not durable identity.
- `reacquisition` / fingerprint: role, structural path, capabilities, nearby
  group, range shape, source hints, and label/accessibility text as hints only.

Use `/Users/Michael/Code/pi-computer-use` only as pattern inspiration:
state-scoped refs, stale state ids, richer descriptors behind refs, and
reacquisition by role/label/capability/position. Do not copy Pi's `@e` / `@w`
syntax or make it the AOS canonical grammar.

### Identity Rules

- Human-facing labels, accessible names, UI copy, and "nice" examples such as
  `settings.opacity` or `avatar.controls.scale` are not durable identity.
- Labels may remain presentation/accessibility fields and reacquisition hints.
- Same-label controls in different owner namespaces or surfaces must not
  collide.
- Geometry and display/window/canvas coordinates must not be part of durable
  identity; keep them in provenance/current address fields.
- Owned repo callers should move toward one canonical vocabulary. Do not add
  broad aliases or compatibility shims unless the card names an external
  non-updatable consumer and a removal gate.

### Stale Ref And Reacquisition Shape

Define the deterministic stale-ref behavior at the contract level:

- an action carrying a stale `state_id` / ref pair must reject or mark the ref
  stale with machine-readable status;
- a descriptor may include a reacquisition plan/fingerprint that says how a
  current target can be searched for again;
- reacquisition must use machine facts first and labels only as hints;
- ambiguous reacquisition must stay explicit instead of silently picking the
  first same-label target.

This round does not need live `aos do` stale-ref execution. It must define the
shape and prove it with deterministic fixtures/tests.

## Required Outputs

Produce a tight contract slice. Prefer the narrowest code/doc/test set that
makes #429's acceptance shape true.

Expected outputs:

- Update `shared/schemas/aos-semantic-targets.md` or add a clearly-linked
  schema/design draft that defines the descriptor vocabulary above.
- Update the relevant `docs/api/aos.md` target sections enough that `aos see`
  output, `aos do` target input, gesture frames, and Work Recording can point at
  the same descriptor vocabulary.
- Add deterministic fixtures, likely under
  `docs/design/fixtures/aos-target-descriptor-v0/`, for:
  - two same-label controls in different namespaces/surfaces;
  - a stale state-scoped ref;
  - descriptor-based reacquisition with role/capability/position/label hints;
  - an ambiguous same-label reacquisition case that stays rejected/ambiguous.
- Add a focused Node test, likely
  `tests/toolkit/aos-target-descriptor-contract.test.mjs`, that validates the
  fixture pack and fails if labels/names become identity.
- Update `packages/toolkit/runtime/semantic-targets.js` and existing runtime
  tests only as needed to stop helper behavior from deriving identity from
  labels/names when the descriptor contract requires stricter input.

## Scope

Schema/design contract, deterministic fixtures, focused Node tests, and the
smallest toolkit runtime helper changes needed for those tests.

## Hard Boundaries / Non-Goals

- Do not do the broad #432 drift cleanup sweep in this round. Touch only docs
  required to define and prove #429.
- Do not implement #430's full interaction record family yet; only leave the
  target vocabulary usable by #430.
- Do not start #431's input-event-v2 hard cutover.
- Do not restart live AOS or require live canvas/input evidence.
- Do not introduce Pi's `@e` / `@w` syntax as AOS canonical syntax.
- Do not make human-readable target names prettier at the expense of machine
  robustness.
- Do not add compatibility aliases for owned in-repo callers without an
  explicit external consumer and removal gate.

## Stop Conditions

Stop with a clear report instead of continuing if:

- a single descriptor contract cannot represent `aos see`, `aos do`, gesture
  frames, and Work Recording references without conflating labels with identity;
- making the fixture pass requires a broad producer/consumer migration better
  owned by #432 or #430;
- an external consumer requires a compatibility window;
- live AOS evidence becomes necessary to proceed.

## Suggested Implementation Areas

- `shared/schemas/aos-semantic-targets.md`
- `docs/api/aos.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- new `docs/design/fixtures/aos-target-descriptor-v0/`
- new `tests/toolkit/aos-target-descriptor-contract.test.mjs`

## Verification

Run deterministic checks only:

```bash
git diff --check
node --test tests/toolkit/runtime-semantic-targets.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/aos-target-descriptor-contract.test.mjs
rg -n "human-readable name exposed to AOS perception|name as id|target id from label|label.*identity|name.*identity|settings\\.opacity|avatar\\.controls\\.scale" shared/schemas docs/api docs/design packages/toolkit/runtime tests/toolkit
```

The final `rg` may return historical or explicitly rejected examples, but the
completion report must classify every remaining hit as current contract,
historical/superseded, fixture-negative, or a #432 cleanup follow-up.

## Completion Report

Include:

- branch and head SHA;
- changed paths;
- exact descriptor fields added or changed;
- how the contract separates state-scoped refs, durable target identity,
  labels, provenance/current address, capabilities, state, and reacquisition;
- how same-label collision resistance is proved;
- how stale-ref/state-id and ambiguous reacquisition are represented;
- which current helpers stopped deriving identity from labels/names, if any;
- exact verification commands and pass/fail results;
- remaining #432 cleanup targets, if the round intentionally leaves stale prose
  outside #429's narrow contract.
