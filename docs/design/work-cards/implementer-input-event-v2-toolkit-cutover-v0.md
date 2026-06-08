# Input Event V2 Toolkit Cutover V0

## Recipient

Implementer contract, fixture, toolkit-runtime, and docs round.

## Transfer Kind

Implementer round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at `b72a7b27` or later, with PR
  #435 merged.
- expected output branch: `implementer/input-event-v2-toolkit-cutover-v0`

Do not reset to an older `origin/main`. The #429 target descriptor contract,
#430 interaction grammar contract, and #428 Work Recording frame contract are
published prerequisites.

## Source Artifact

- GitHub issue #431:
  https://github.com/michaelblum/agent-os/issues/431
- Published prerequisite PR #435:
  https://github.com/michaelblum/agent-os/pull/435
- Current published contracts:
  - `shared/schemas/input-event-v2.schema.json`
  - `shared/schemas/input-event-v2.md`
  - `docs/design/aos-interaction-grammar-v0.md`
  - `docs/design/aos-work-recording-frame-contract-v0.md`
- Related lanes:
  - #427 gesture stream is published and currently consumes normalized input.
  - #430 and #428 consume observed input as evidence, not canonical replay.
  - #431 owns the input-event-v2 hard cutover.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Cut toolkit-owned input consumers and docs toward canonical input-event-v2 /
routed-v1 payloads, while leaving any remaining compatibility behind explicit
external or native-producer gates instead of broad permanent aliases.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `shared/schemas/daemon-event.md`
- `docs/api/toolkit/runtime.md`
- `packages/toolkit/runtime/input-events.js`
- `packages/toolkit/runtime/gesture-stream.js`
- `packages/toolkit/runtime/interaction-region.js`
- `tests/schemas/input-event-v2.test.mjs`
- `tests/toolkit/runtime-input-events.test.mjs`
- `tests/toolkit/runtime-gesture-stream.test.mjs`
- `docs/design/work-cards/input-event-v2-version-truth-correction-v0.md`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 431 --json
rg -n "input_schema_version|routed_schema_version|input_region\\.event|aos_routed_input|input_event|legacy|compat|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel|normalizeCanvasInputMessage|createCanvasOriginInputEvent" shared/schemas docs/api docs/design packages/toolkit tests --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

Live AOS is intentionally paused for this workstream. Do not run `./aos ready`,
`./aos status`, `./aos clean`, service start/restart, or live smoke unless
Michael explicitly approves it in a new instruction. This slice is
deterministic-only.

## Existing Code And Docs To Inspect

- `shared/schemas/input-event-v2.schema.json` and
  `shared/schemas/input-event-v2.md` - canonical raw daemon payload and routed
  toolkit envelope contracts.
- `packages/toolkit/runtime/input-events.js` - current compatibility normalizer
  for raw event names, `input_event` envelopes, routed input, and
  canvas-origin synthetic messages.
- `packages/toolkit/runtime/gesture-stream.js` - #427 gesture stream consumer
  that should consume canonical normalized routed/raw input first.
- `packages/toolkit/runtime/interaction-region.js` - routed region events and
  capture delivery surface.
- `docs/api/toolkit/runtime.md` and `shared/schemas/daemon-event.md` - docs
  that must distinguish daemon stream channel names from versioned payload
  schemas.
- `shared/schemas/fixtures/input-event-v2/` - existing valid, invalid, and
  sequence fixtures.
- `tests/schemas/input-event-v2.test.mjs`,
  `tests/toolkit/runtime-input-events.test.mjs`, and
  `tests/toolkit/runtime-gesture-stream.test.mjs` - deterministic guardrails.

## Required Behavior

### Audit And Plan

Add or update a concise current note, likely
`docs/design/input-event-v2-toolkit-cutover-v0.md`, that records:

- `input_event` is the daemon/event-stream channel name; `input-event-v2` is
  the payload schema.
- `aos_routed_input` / `input_region.event` is a routed delivery envelope with
  its own `routed_schema_version: 1`.
- every toolkit-owned consumer that still accepts raw legacy event names,
  wrapper envelopes, or canvas-origin compatibility messages;
- which compatibility remains because of a native producer or external
  non-updatable source, with a removal gate;
- which owned consumers are migrated or guarded in this slice.

The note should not describe mixed legacy/current shapes as the desired steady
state.

### Fixtures And Tests

Ensure canonical v2/routed fixture coverage includes at least:

- raw pointer;
- raw scroll;
- raw key;
- raw cancel;
- routed owned pointer;
- routed captured drag;
- routed scroll;
- routed cancel.

Add invalid fixtures or test cases where useful so future changes fail if an
owned payload claims `input_schema_version: 2` or `routed_schema_version: 1`
without required fields.

### Toolkit Runtime Cutover

Tighten `packages/toolkit/runtime/input-events.js` and adjacent tests so:

- canonical raw v2 payloads and routed v1 envelopes are the preferred internal
  path;
- invalid version-claiming payloads fail loudly enough for tests to catch them
  instead of being silently normalized as if valid;
- broad compatibility paths are narrowed to named sources, such as
  canvas-origin synthetic messages or explicit external/native-producer gates;
- `createCanvasOriginInputEvent()` emits canonical routed v1 fields for
  supported pointer, scroll, and cancel cases when it claims
  `routed_schema_version: 1`;
- any remaining unversioned raw event-name support is clearly documented as a
  compatibility bridge, not a target state.

Update `gesture-stream.js` only if inspection shows it depends on broad legacy
aliases rather than the canonical normalized fields. Keep any change narrow and
covered by `runtime-gesture-stream` tests.

### Docs

Update `shared/schemas/input-event-v2.md`, `docs/api/toolkit/runtime.md`,
`shared/schemas/daemon-event.md`, and adjacent design notes only as needed to
make the standing contract clear:

- channel names are not schema versions;
- versioned payloads must validate against their schema for the declared event
  kind;
- routed delivery has separate required fields by delivery role;
- raw input remains evidence for #430/#428, not the primary replay language for
  AOS-owned Work Recordings.

## Scope

Toolkit runtime input normalization, schema fixtures/tests, and current docs.

Native Swift producer changes, daemon rebuilds, TCC permission work, live smoke,
and broad app migrations are out of scope for this Implementer round.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, or live smoke.
- Do not edit Swift/native daemon producer code in this round. If the cutover
  requires a native producer change, stop with a clear native-boundary finding
  and return it to Foreman.
- Do not run `./aos dev build`; Foreman owns native rebuilds and TCC regrant
  handoff.
- Do not start Work Recording runtime recorder/replayer work.
- Do not change #429/#430/#428 descriptor, interaction, or recording contracts
  except for narrow cross-references needed by this cutover.
- Do not push, open PRs, or mutate GitHub issues.

## Stop Conditions

Stop with a clear report instead of continuing if:

- the only honest cutover path requires Swift/native daemon producer changes;
- owned toolkit consumers cannot be migrated without live AOS evidence;
- existing schemas conflict with required canonical routed payloads in a way
  that needs Foreman architecture judgment;
- compatibility cannot be narrowed without breaking an identified external
  consumer.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs
node --test tests/toolkit/aos-interaction-grammar-contract.test.mjs tests/toolkit/aos-work-recording-frame-contract.test.mjs
rg -n "legacy|compat|current shape|mixed shape|input_schema_version: 2|routed_schema_version: 1|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel" shared/schemas docs/api docs/design packages/toolkit tests --glob "*.md" --glob "*.json" --glob "*.js" --glob "*.mjs"
```

For remaining `rg` hits, classify them in the completion report as current
canonical guidance, fixture/test coverage, explicitly gated compatibility,
historical/work-card text, native-boundary debt, or unrelated local examples.

## Completion Report

Return a path-scoped report with:

- branch and head SHA;
- base SHA;
- files changed;
- audit/design note path and migration/removal-gate summary;
- fixture/test changes and what event kinds they cover;
- toolkit runtime changes and which compatibility paths remain;
- whether `gesture-stream.js` changed and why;
- docs updated;
- exact verification commands and pass/fail results;
- remaining drift-scan hits and classification;
- confirmation that live AOS was not restarted and native build was not run;
- any native-boundary finding that Foreman must route separately;
- local-only state, including dirty/untracked files and ignored artifacts;
- recommended next slice only if the round reveals one concrete follow-up.
