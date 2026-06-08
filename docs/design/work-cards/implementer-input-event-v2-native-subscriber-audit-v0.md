# Input Event V2 Native Subscriber Audit V0

## Recipient

Implementer validation/correction round.

## Transfer Kind

Implementer round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at or after `4168fa60`, with PR
  #436 merged.
- expected output branch: `implementer/input-event-v2-native-subscriber-audit-v0`

Work in the single local checkout at `/Users/Michael/Code/agent-os`. Do not
create linked git worktrees.

## Tracker

- GitHub issue #431:
  https://github.com/michaelblum/agent-os/issues/431
- Published prerequisite PR #436:
  https://github.com/michaelblum/agent-os/pull/436
- Current audit note:
  `docs/design/input-event-v2-toolkit-cutover-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Decide and tighten the remaining deterministic #431 native-producer and active
subscriber compatibility surface after PR #436, while returning a
native-boundary finding instead of editing Swift or requiring live AOS.

## Read First

- `AGENTS.md`
- `src/AGENTS.md`
- `src/daemon/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/input-event-v2-toolkit-cutover-v0.md`
- `docs/design/work-cards/implementer-input-event-v2-toolkit-cutover-v0.md`
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
rg -n "input_event|input_region\\.event|routed_input|routed_schema_version|input_schema_version|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel|normalizeCanvasInputMessage|normalizeMessage\\(" src apps packages tests --glob "!**/node_modules/**"
```

Live AOS is intentionally paused. Do not run `./aos ready`, `./aos status`,
`./aos clean`, service start/restart, live smoke, or lower-level socket/PTY
control. Use passive classification only.

## Existing Code To Inspect

- `src/perceive/events.swift` - native input-event payload builder and v2 claim
  gate.
- `src/perceive/daemon.swift` - CGEvent to `inputEventData()` path.
- `src/daemon/unified.swift` - `input_event` subscription snapshots, broadcast,
  and `input_region.event` routing.
- `src/daemon/input-surface-ownership.swift` - routed input payload helper and
  routed-v1 claim gate.
- `packages/toolkit/runtime/input-events.js` - canonical toolkit normalizer and
  remaining unversioned bridges.
- `packages/toolkit/runtime/interaction-region.js` - JS local deterministic
  routing helper that still accepts raw event names.
- `packages/toolkit/panel/stage-affordance.js` and
  `packages/toolkit/panel/chrome.js` - routed/global input consumers.
- `packages/toolkit/components/surface-inspector/index.js` - active
  `input_event` subscriber using toolkit normalization.
- `packages/toolkit/components/spatial-telemetry/index.js` - active
  `input_event` subscriber using toolkit normalization.
- `apps/sigil/renderer/live-modules/input-message.js` and
  `apps/sigil/renderer/live-modules/main.js` - active Sigil normalization and
  fallback handling around daemon input envelopes.
- `tests/daemon-input-surface-ownership.sh` - deterministic Swift coverage for
  producer and routed payload claim gates.
- `tests/toolkit/runtime-input-events.test.mjs`,
  `tests/toolkit/runtime-gesture-stream.test.mjs`,
  `tests/toolkit/stage-affordance.test.mjs`,
  `tests/toolkit/panel-chrome.test.mjs`,
  `tests/toolkit/surface-inspector.test.mjs`, and
  `tests/toolkit/spatial-telemetry-model.test.mjs`.

## Required Behavior

### Audit Result

Update `docs/design/input-event-v2-toolkit-cutover-v0.md` or add a concise
adjacent note only if the current note is missing current facts. The result must
name the remaining owned active producer/subscriber bridges, not just generic
compatibility categories.

Classify each bridge as one of:

- removable in this deterministic JS/toolkit round;
- intentionally retained with a concrete external/native/live removal gate;
- native-boundary work that Foreman must route separately.

### JS/Toolkit Correction

If inspection shows an owned JS fallback is redundant after the #436 toolkit
normalizer, remove or narrow it with focused tests. Likely candidates include
duplicate fallback unwrapping in `apps/sigil/renderer/live-modules/input-message.js`
or tests that still teach owned components to rely on broad unversioned wrapper
payloads when a canonical fixture is available.

Do not remove compatibility that still has a named active producer or live
consumer. If the only honest cleanup requires Swift/native producer changes or
live runtime proof, stop with a native-boundary finding instead of editing
native files.

### Native Boundary

Inspect Swift producer code and deterministic Swift tests, but do not edit Swift
or run `./aos dev build` in this round. Foreman owns native rebuild and any TCC
handoff. A finding is sufficient when the remaining work is "native producer
must always emit canonical v2/routed-v1" or "needs live subscriber evidence."

## Scope

Deterministic audit, JS/toolkit/Sigil subscriber cleanup where safe, docs note
updates, and tests. Native Swift implementation, daemon rebuilds, TCC work,
live smoke, issue closure, PR publication, and GitHub mutation are out of scope.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, live smoke, raw daemon HTTP calls, `tmux`, or direct socket
  control.
- Do not edit Swift/native daemon producer files.
- Do not run `./aos dev build`.
- Do not close #431.
- Do not broaden the toolkit normalizer or add new compatibility aliases.
- Do not start Sigil remodel or migrate unrelated product interaction state.

## Stop Conditions

Stop and report `blocked_native_boundary` if:

- the remaining #431 work requires Swift/native producer edits;
- deterministic tests prove a live payload shape is still unknown;
- active consumer cleanup cannot be proven without live AOS;
- narrowing a fallback would break a named external or non-updatable producer.

If live AOS/TCC evidence becomes the next meaningful step, do not retry or
repair permissions. Run the manual TCC blocker report path, stop with
`manual_intervention`, and return the blocker to Foreman.

## Verification

Run the focused deterministic gate for any changes:

```bash
git diff --check
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/spatial-telemetry-model.test.mjs
tests/daemon-input-surface-ownership.sh
```

Also rerun a focused search and classify remaining hits:

```bash
rg -n "input_event|input_region\\.event|routed_input|routed_schema_version|input_schema_version|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel|normalizeCanvasInputMessage|normalizeMessage\\(" src apps packages tests --glob "!**/node_modules/**"
```

## Completion Report

Report:

- files changed;
- active producer/subscriber bridges classified;
- any JS/toolkit compatibility removed or narrowed;
- any native-boundary finding, with exact paths and line-level evidence;
- exact verification commands and pass/fail results;
- live AOS status classification and confirmation that no live readiness/control
  commands were run;
- whether #431 should remain open, close, or split into a smaller native
  follow-up after Foreman review.
