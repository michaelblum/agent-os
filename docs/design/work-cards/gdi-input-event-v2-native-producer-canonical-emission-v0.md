# Input Event V2 Native Producer Canonical Emission V0

## Recipient

GDI implementation/validation round.

## Transfer Kind

GDI round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at or after `7af85dd9`, with PR
  #437 merged.
- local prerequisite commits:
  - `db21aa9f` (`docs(work-cards): route input event v2 native gate map`)
  - `622684e8` (`docs(input): map native live input event gates`)
- expected output branch:
  `gdi/input-event-v2-native-producer-canonical-emission-v0`

Work in the single local checkout at `/Users/Michael/Code/agent-os`. Do not
create linked git worktrees.

## Tracker

- GitHub issue #431:
  https://github.com/michaelblum/agent-os/issues/431
- Current gate map:
  `docs/design/input-event-v2-toolkit-cutover-v0.md`
- Prior gate-map work card:
  `docs/design/work-cards/gdi-input-event-v2-native-boundary-gate-map-v0.md`
- Native boundary ADR:
  `docs/adr/0015-aos-tcc-capability-broker-boundary.md`

## Native-Boundary Justification

This slice is allowed to touch native Swift because it concerns a privileged
input fact stream and daemon routed delivery substrate. Keep changes limited to
input payload construction, routed payload construction, deterministic harness
coverage, and adjacent docs/tests. Do not move product policy or presentation
behavior into Swift.

Foreman owns any native rebuild and manual TCC handoff. GDI must not run
`./aos dev build`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Make the deterministic native producer gates from #431 as canonical and
machine-checkable as possible without live AOS: raw daemon `input_event`
payloads and routed `input_region.event.routed_input` payloads should claim
input-event-v2 / routed-v1 whenever the daemon-owned delivery has enough facts,
and any remaining unversioned producer case must be explicitly classified with
the smallest live or native follow-up.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `docs/design/work-cards/gdi-input-event-v2-native-boundary-gate-map-v0.md`
- `shared/schemas/input-event-v2.schema.json`
- `shared/schemas/input-event-v2.md`
- `docs/api/toolkit/runtime.md`
- GitHub issue #431.

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 431 --json
./aos dev gh pr list --state open --limit 20 --json
rg -n "inputEventData|inputEventPayload|input_schema_version|routed_schema_version|inputRegionRoutedInputPayload|aosInputRegionRoutedInputPayload|routeInputRegionEvent|forwardInputEventToCanvases|input_region\\.event|routed_input" src/perceive src/daemon tests/daemon-input-surface-ownership.sh packages/toolkit/runtime/input-events.js tests/toolkit --glob "!**/node_modules/**"
```

Live AOS is intentionally paused. Do not run `./aos ready`, `./aos status`,
`./aos clean`, service start/restart, live smoke, raw daemon HTTP calls, `tmux`,
direct socket control, or lower-level runtime control. Use passive service
classification only.

## Existing Code To Inspect

- `src/perceive/events.swift` - raw input payload builder and version claim
  gate.
- `src/perceive/daemon.swift` - CGEvent name/payload path for pointer, scroll,
  and key input.
- `src/daemon/input-surface-ownership.swift` - routed input payload builder and
  routed-v1 claim gate.
- `src/daemon/unified.swift` - input snapshots, input fanout, routed region
  delivery, and top-level compatibility fields.
- `tests/daemon-input-surface-ownership.sh` - deterministic Swift harness.
- `packages/toolkit/runtime/input-events.js` - runtime validation contract for
  raw v2 and routed v1.
- `tests/toolkit/runtime-input-events.test.mjs`,
  `tests/toolkit/stage-affordance.test.mjs`,
  `tests/toolkit/panel-chrome.test.mjs`, and
  `tests/renderer/input-message.test.mjs`.

## Required Behavior

### Raw `input_event`

Classify the actual daemon producer path separately from helper-only builder
calls:

- If `src/perceive/daemon.swift` already provides enough facts for every
  daemon-produced pointer, scroll, key, and snapshot event to claim
  `input_schema_version: 2`, add deterministic coverage that proves that fact
  or document the exact coverage boundary in the gate map.
- If an actual daemon-produced raw event can still reach owned subscribers
  without `input_schema_version: 2`, change the native builder/path so it emits
  a canonical v2 payload, then prove it deterministically.
- Keep helper-only incomplete scroll/cancel cases unversioned only if they are
  not daemon-produced deliveries to owned subscribers; label that as a test
  helper or non-delivery guard, not a standing target.

### Routed `input_region.event`

Make routed delivery canonical where deterministic source state allows:

- `input_region.event` messages should keep `routed_input` as the canonical
  payload for owned/captured deliveries.
- If top-level compatibility fields remain on `input_region.event`, the gate
  map must state that they are retained only until live subscriber proof allows
  removal.
- If routed pointer, scroll, key, or cancel deliveries can reach live consumers
  without `routed_schema_version: 1` because required facts are missing, either
  fill the missing deterministic facts at the native producer boundary or
  return a precise native-boundary finding explaining why the fact requires live
  state that this round cannot prove.

### Docs And Tests

Update `docs/design/input-event-v2-toolkit-cutover-v0.md` so the gate map
reflects the new deterministic truth after any implementation or classification
change. Prefer narrowing stale wording over adding a second overlapping gate
map.

Add or update deterministic tests in `tests/daemon-input-surface-ownership.sh`
for any native producer change. If you only classify a path as already
canonical, add the smallest guard that prevents future drift if feasible.

## Scope

Native input payload construction, native routed input payload construction,
deterministic Swift harness coverage, focused toolkit contract tests, and the
gate-map doc. JavaScript runtime compatibility removal, live AOS proof, TCC
work, daemon rebuilds, publication, and issue closure are out of scope.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, live smoke, raw daemon HTTP calls, `tmux`, or direct socket
  control.
- Do not run `./aos dev build`.
- Do not edit unrelated Swift/native capability, daemon policy, UI/product
  behavior, Sigil product behavior, or toolkit presentation code.
- Do not broaden the toolkit normalizer or add new compatibility aliases.
- Do not remove runtime compatibility unless deterministic native tests prove
  the corresponding producer gate is satisfied and all focused JS tests pass.
- Do not push, open a PR, close #431, or mutate GitHub.
- Do not route the next workstream. Recommend the next slice, but Foreman owns
  acceptance and routing.

## Stop Conditions

Stop and report `blocked_native_boundary` if:

- proving canonical emission requires live AOS payload observation;
- the missing fact is a TCC/input-tap runtime fact rather than source logic;
- the only honest change requires a daemon rebuild before deterministic tests
  can be meaningful;
- the slice would need broader native architecture or product behavior changes.

If live AOS/TCC evidence becomes the next meaningful step, do not retry or
repair permissions. Run `.docks/gdi/scripts/human-needed-tcc-reset`, stop with
`human_needed`, and return the blocker to Foreman.

## Verification

Run the deterministic gate:

```bash
git diff --check
tests/daemon-input-surface-ownership.sh
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/renderer/input-message.test.mjs
rg -n "Native/Live Gate Map|native_producer_followup_required|live_aos_evidence_required|child_canvas_coordinate_followup_required" docs/design/input-event-v2-toolkit-cutover-v0.md
```

If you changed raw schema fixtures or runtime validator assumptions, also run:

```bash
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs
```

Rerun and summarize this focused source search:

```bash
rg -n "inputEventData|inputEventPayload|input_schema_version|routed_schema_version|inputRegionRoutedInputPayload|aosInputRegionRoutedInputPayload|routeInputRegionEvent|forwardInputEventToCanvases|input_region\\.event|routed_input" src/perceive src/daemon tests/daemon-input-surface-ownership.sh packages/toolkit/runtime/input-events.js tests/toolkit --glob "!**/node_modules/**"
```

## Completion Report

Report:

- files changed;
- raw `input_event` producer classification: already canonical, changed, or
  still blocked, with source paths;
- routed `input_region.event` producer classification: already canonical,
  changed, or still blocked, with source paths;
- any native Swift changes and why they stay inside the TCC/native boundary;
- any docs/test corrections made;
- exact verification commands and pass/fail results;
- passive AOS service status and confirmation that no live readiness/control,
  rebuild, TCC, push, PR, issue closure, or GitHub mutation was run;
- whether #431 should remain open and the single smallest next follow-up after
  Foreman review;
- local-only state, including dirty files, untracked artifacts, or runtime
  blockers.
