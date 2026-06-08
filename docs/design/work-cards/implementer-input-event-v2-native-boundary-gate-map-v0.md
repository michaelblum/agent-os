# Input Event V2 Native Boundary Gate Map V0

## Recipient

Implementer validation/correction round.

## Transfer Kind

Implementer round.

## Branch / Base

- branch_from: local `main` containing this work card.
- required_start_ref: local `main` containing this work card.
- published prerequisite base: `origin/main` at or after `7af85dd9`, with PR
  #437 merged.
- expected output branch: `implementer/input-event-v2-native-boundary-gate-map-v0`

Work in the single local checkout at `/Users/Michael/Code/agent-os`. Do not
create linked git worktrees.

## Tracker

- GitHub issue #431:
  https://github.com/michaelblum/agent-os/issues/431
- Published prerequisite PR #436:
  https://github.com/michaelblum/agent-os/pull/436
- Published prerequisite PR #437:
  https://github.com/michaelblum/agent-os/pull/437
- Current audit note:
  `docs/design/input-event-v2-toolkit-cutover-v0.md`
- Prior deterministic subscriber-audit card:
  `docs/design/work-cards/implementer-input-event-v2-native-subscriber-audit-v0.md`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Turn the remaining #431 native/live hard-cutover gates into an exact
deterministic gate map: name what is already satisfied by PRs #436/#437, what
still requires native producer changes, and what still requires a supervised
live AOS proof after Michael explicitly approves restart.

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
- `docs/design/work-cards/implementer-input-event-v2-native-subscriber-audit-v0.md`
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
rg -n "input_event|input_region\\.event|routed_input|routed_schema_version|input_schema_version|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel|normalizeCanvasInputMessage|normalizeMessage\\(" src/perceive src/daemon packages/toolkit/runtime packages/toolkit/panel packages/toolkit/components apps/sigil/renderer tests --glob "!**/node_modules/**"
```

Live AOS is intentionally paused. Do not run `./aos ready`, `./aos status`,
`./aos clean`, service start/restart, live smoke, raw daemon HTTP calls, `tmux`,
direct socket control, or lower-level runtime control. Use passive service
classification only.

## Existing Code To Inspect

- `src/perceive/events.swift` - raw `input_event` payload construction and
  `input_schema_version: 2` claim gate.
- `src/perceive/daemon.swift` - CGEvent-to-payload path and missing-fact cases.
- `src/daemon/unified.swift` - active input-event subscriber accounting,
  broadcast snapshots, and `input_region.event` routed delivery.
- `src/daemon/input-surface-ownership.swift` - routed input construction and
  `routed_schema_version: 1` claim gate.
- `packages/toolkit/runtime/input-events.js` - canonical normalizer and
  remaining compatibility categories.
- `packages/toolkit/runtime/interaction-region.js` - deterministic JS router
  that still accepts raw event names.
- `packages/toolkit/panel/chrome.js` - global drag subscriber and routed
  minimized-chip input consumer.
- `packages/toolkit/panel/stage-affordance.js` - passive routed input consumer.
- `packages/toolkit/components/surface-inspector/index.js` - active
  `input_event` subscriber.
- `packages/toolkit/components/spatial-telemetry/index.js` - active
  `input_event` subscriber.
- `apps/sigil/renderer/live-modules/input-message.js` and
  `apps/sigil/renderer/live-modules/main.js` - Sigil input normalization and
  child canvas-origin fallback handling.
- `tests/daemon-input-surface-ownership.sh` - deterministic Swift harness for
  native raw/routed claim gates.
- `tests/renderer/input-message.test.mjs`,
  `tests/toolkit/runtime-input-events.test.mjs`,
  `tests/toolkit/runtime-gesture-stream.test.mjs`,
  `tests/toolkit/stage-affordance.test.mjs`,
  `tests/toolkit/panel-chrome.test.mjs`,
  `tests/toolkit/surface-inspector.test.mjs`, and
  `tests/toolkit/spatial-telemetry-model.test.mjs`.

## Validation Questions

Answer these from deterministic source inspection and tests:

1. Which #431 acceptance bullets are now satisfied by PRs #436/#437?
2. Which remaining compatibility paths are native producer gates rather than
   JS/toolkit subscriber gates?
3. Which remaining compatibility paths are live evidence gates because the
   daemon must be running to prove active subscriber payload shape?
4. Which gates are blocked on child WebView/canvas-origin coordinate ownership
   rather than raw daemon input?
5. What is the smallest later Operator/live proof needed once Michael approves
   restarting live AOS?

## Required Behavior

Update `docs/design/input-event-v2-toolkit-cutover-v0.md` with a concise
Native/Live Gate Map section, or replace stale wording in its existing native
audit section with equivalent concise content.

The gate map must classify every remaining owned bridge into one of these
states:

- `satisfied_by_pr_436_or_437`
- `deterministic_js_followup_possible`
- `native_producer_followup_required`
- `live_aos_evidence_required`
- `child_canvas_coordinate_followup_required`
- `external_or_non_updatable_compatibility`

For each remaining unsatisfied gate, include:

- exact source paths;
- what fact is missing;
- whether the next owner is Foreman, Implementer, or Operator;
- whether live AOS restart is required;
- the smallest verification command or live observation that would satisfy it.

If source inspection shows a current doc or test assertion is false, correct it
with the smallest docs/test edit. Do not remove runtime compatibility or change
product behavior in this round unless the existing code is demonstrably dead and
the focused tests prove the removal without live evidence.

## Scope

Deterministic validation, gate-map documentation, and focused docs/test
corrections only. This round may inspect native Swift code and deterministic
Swift tests, but it must not implement native changes.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, live smoke, raw daemon HTTP calls, `tmux`, or direct socket
  control.
- Do not edit Swift/native daemon producer files.
- Do not run `./aos dev build`.
- Do not push, open a PR, close #431, or mutate GitHub.
- Do not broaden the toolkit normalizer or add new compatibility aliases.
- Do not remove compatibility merely because the name looks old; tie removal to
  a satisfied gate and deterministic evidence.
- Do not route the next workstream. Recommend the next slice, but Foreman owns
  acceptance and routing.

## Stop Conditions

Stop and report `blocked_native_boundary` if:

- answering the gate map requires Swift/native producer edits;
- the missing fact can only come from live AOS payload observation;
- active subscriber cleanup cannot be proven without live AOS;
- a compatibility path is tied to an external or non-updatable producer.

If live AOS/TCC evidence becomes the next meaningful step, do not retry or
repair permissions. Run the manual TCC blocker report path, stop with
`manual_intervention`, and return the blocker to Foreman.

## Verification

Run the deterministic documentation and focused gate checks:

```bash
git diff --check
rg -n "Native/Live Gate Map|native_producer_followup_required|live_aos_evidence_required|child_canvas_coordinate_followup_required" docs/design/input-event-v2-toolkit-cutover-v0.md
tests/daemon-input-surface-ownership.sh
node --test tests/renderer/input-message.test.mjs
node --test tests/schemas/input-event-v2.test.mjs
node --test tests/toolkit/runtime-input-events.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/spatial-telemetry-model.test.mjs
```

Also rerun and summarize the focused search:

```bash
rg -n "input_event|input_region\\.event|routed_input|routed_schema_version|input_schema_version|mouse_moved|left_mouse_down|scroll_wheel|pointer_cancel|mouse_cancel|normalizeCanvasInputMessage|normalizeMessage\\(" src/perceive src/daemon packages/toolkit/runtime packages/toolkit/panel packages/toolkit/components apps/sigil/renderer tests --glob "!**/node_modules/**"
```

## Completion Report

Report:

- files changed;
- gate-map classifications and remaining unsatisfied gates;
- any docs/test corrections made;
- exact verification commands and pass/fail results;
- passive AOS service status and confirmation that no live readiness/control
  commands were run;
- whether #431 should remain open, and the single smallest next follow-up after
  Foreman review;
- local-only state, including dirty files, untracked artifacts, or runtime
  blockers.
