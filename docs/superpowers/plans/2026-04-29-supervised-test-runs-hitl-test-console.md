# Supervised Runs and HITL Test Console

Tracking epic: GitHub issue #149.

Child issues:

- #150 - Contracts and event schemas
- #151 - Shell harness kernel
- #152 - Test console toolkit component
- #153 - File-backed console bridge
- #154 - Run puck HITL pilot
- #155 - Shared run artifact library

## Core Shape

Build a supervised-run substrate for AOS: agents perform work in an explicit
operating path, run control keeps the work bounded, human feedback is captured
as structured evidence, and the whole run produces a canonical timeline plus an
artifact pack.

HITL testing is the first concrete projection of that substrate. In that
projection, agents run automated checks, and steps that require visual or
real-input judgment are routed through a sibling test console canvas. The
console presents one step at a time, captures human confirmation, failure,
blocked state, retry, skip, and notes as structured events, and feeds those
events back into a canonical test timeline.

This is steerable collection applied to verification. Human intent sensing
captured run control, human marks, canonical timeline, and evidence/source-pack
output. HITL testing needs the same substrate with testing vocabulary: run
control, human confirmations/errors/notes, canonical test timeline, and
evidence/artifact output.

Do not build this as a separate philosophy. Build it as a sibling projection
over the same primitives.

## Roadmap

The roadmap has one shared substrate and several domain projections:

```text
shared substrate
  -> run control
  -> operating paths
  -> single-writer timeline
  -> artifact/evidence pack
  -> human feedback sidecar
  -> deterministic fixtures

projections
  -> supervised testing
  -> steerable collection
  -> workflow playback
  -> agent/user collaboration
  -> intent feedback loops
```

The first implementation vertical is supervised testing because it gives the
project an immediate operational payoff: visual/runtime checks stop living only
in chat and become durable evidence.

The second vertical is shared artifact mechanics. Once supervised testing and
steerable collection both produce run evidence, factor the common timeline and
artifact-pack code into `src/sessions/run-artifacts/`.

The third vertical is operating-path data. Once the testing pilot proves the
shape, define reusable path records for headless, headed, real-input,
HITL-sidecar, visual diagnostics, and input-routing diagnostics. Keep the tree
shallow so it remains an execution contract rather than another skills system.

## Operating Path

Primary V0 operating path:

```text
agent/dev/testing/headed/real-input/hitl-sidecar
```

The initial entry path is not permanent. Agents may backtrack to a narrower or
deeper operating path when evidence requires it, but they should state the path
change when it changes authority, sensors, or verification obligations.

Example transition:

```text
Operating path change: agent/dev/testing/headed/real-input/hitl-sidecar.
Reason: this verification depends on visual placement, so I am routing the
step through the test console.
```

## V0 Boundaries

- Shell-first harness, because current integration tests are shell-first.
- File/event-log bridge first; defer daemon-backed test channels.
- Use `./aos show` for the console as a sibling daemon canvas, not an app-local
  modal.
- Keep `aos test run ...` out of V0 until the pilot proves the contract.
- Do not duplicate steerable-collection source-pack logic. Factor shared
  artifact mechanics only after both domains need them.
- Real-input verification is only required where the behavior depends on real
  host routing. Deterministic logic can stay synthetic/headless.

## SOP

Use this operating procedure for supervised run and HITL verification work:

1. Start from the narrowest operating path that fits the task.
2. Use headless deterministic checks for schema, state-machine, pure toolkit,
   and artifact-writer behavior.
3. Escalate to headed checks when canvas lifecycle, display, or browser UI state
   is part of the claim.
4. Escalate to real-input checks when the behavior depends on macOS input taps,
   event ownership, pointer routing, keyboard routing, or user gesture timing.
5. Escalate to HITL-sidecar when the expected result depends on human visual
   judgment or user-facing acceptance.
6. State the operating-path change when it changes authority, sensors, or
   verification obligations.
7. Emit every step, automated assertion, human request, human response, and
   artifact reference as an append-only event.
8. Keep the console as human I/O only. Test logic belongs in the harness and
   domain adapters.
9. Write summaries and artifacts under the run directory so issue and PR updates
   can cite durable evidence instead of chat memory.
10. De-escalate once the elevated sensor or authority is no longer needed.

## Substrate Model

```text
test plan
  -> ordered steps
  -> agent executes automated parts
  -> test console asks the human for visual/input confirmation where needed
  -> human response becomes structured event
  -> canonical JSONL timeline
  -> artifacts/screenshots/logs
  -> test report/evidence pack
```

The shared concepts are:

- single-writer timeline
- source-pack-like artifact directory
- run-control state machine
- sibling daemon canvas
- human events as first-class evidence
- deterministic demo fixture

## Phase 1: Contracts

Issue: #150.

Add shared schemas:

```text
shared/schemas/test-run.schema.json
shared/schemas/test-plan.schema.json
shared/schemas/test-step.schema.json
shared/schemas/test-human-response.schema.json
shared/schemas/test-artifact.schema.json
```

Core event types:

```text
test.run.started
test.step.started
test.step.instruction
test.step.expectation
test.step.automated_check
test.step.human_requested
test.human.confirmed
test.human.failed
test.human.blocked
test.human.note
test.step.completed
test.run.completed
```

Every run and step includes `operating_path`. Human responses include
`step_id`, `response`, optional `note`, optional artifact references, and a
timestamp.

Exit criteria:

- Schemas validate checked-in fixtures with focused Node tests.
- Contract docs identify V0 boundaries and extension points.
- Fixture output is deterministic.

## Phase 2: Harness Kernel

Issue: #151.

Create shell primitives:

```text
tests/lib/harness.sh
tests/lib/harness-events.sh
tests/lib/harness-plan.sh
tests/lib/harness-assert.sh
```

Capabilities:

- create isolated run directory
- append JSONL events
- start isolated daemon using `tests/lib/isolated-daemon.sh`
- launch a test console canvas
- emit current step
- wait for human response
- write summary

Example authoring API:

```bash
aos_harness_start \
  --name run-puck-visual \
  --operating-path agent/dev/testing/headed/real-input/hitl-sidecar

aos_step \
  --id step_001 \
  --title "Launch run puck" \
  --do "./aos show create --id run-puck-test --url aos://toolkit/run-puck/index.html --track union" \
  --expect "The run puck appears bottom-center."

aos_step_human \
  --id step_002 \
  --title "Confirm paused state" \
  --instruction "Look at the puck." \
  --expect "It says Paused and the primary button says Resume."
```

Exit criteria:

- A non-visual dry run can execute a tiny plan.
- The harness writes timeline and summary artifacts.
- The harness composes existing `tests/lib/` primitives instead of replacing
  them.

## Phase 3: Test Console Component

Issue: #152.

Create:

```text
packages/toolkit/components/test-console/
  index.html
  index.js
  styles.css
```

The console displays one step at a time:

- current operating path
- step title
- instruction
- expected result
- artifacts/evidence links
- Confirm, Fail, Blocked, Add note, Retry, and Open evidence controls

It emits structured response events:

```json
{"type":"test.human.confirmed","step_id":"step_002","note":"Looks correct."}
{"type":"test.human.failed","step_id":"step_002","note":"Button says Step, not Resume."}
```

Exit criteria:

- The component renders supplied step payloads.
- Human button actions produce schema-shaped response events.
- The UI is usable as a daemon sibling canvas via `./aos show`.

## Phase 4: Console Bridge

Issue: #153.

Simplest V0 bridge:

- Harness writes events under `AOS_STATE_ROOT`.
- Test console polls current step state or receives it through
  `aos show eval` / `aos show post`.
- Human button clicks write response events to response JSONL or a
  bridge-accessible queue.
- Harness reads the response and advances the plan.

Later bridge:

- daemon-backed test event channel
- `aos test run ...`
- durable event bus

Exit criteria:

- A supervised run can pause on a human step.
- A button response resumes the harness without chat copy/paste.
- The event log remains inspectable if the console closes.

## Phase 5: Pilot

Issue: #154.

Add:

```text
tests/run-puck-hitl-plan.sh
```

Flow:

1. Start isolated daemon.
2. Register toolkit content root if needed.
3. Launch test console.
4. Launch run puck.
5. Automated check: `show wait` confirms canvas exists.
6. Human check: confirm visual placement and paused state.
7. Synthetic hotkey or real input step.
8. Human confirms expected state.
9. Write summary.

Exit criteria:

- The run produces a canonical timeline.
- Human responses are persisted as evidence.
- Summary output is concise enough for issue/PR updates.

## Phase 6: Shared Artifact Library

Issue: #155.

Factor shared mechanics only when both supervised tests and steerable collection
need the same code:

```text
src/sessions/run-artifacts/
  timeline.js
  artifact-pack.js
```

Common concepts:

- `run_id`
- `timeline.jsonl`
- `artifacts/`
- `human-events.jsonl`
- `summary.json`
- `narrative.md`

Different domain schemas:

- collection uses `human.mark` and `evidence-item`
- testing uses `test.step`, `test.human.confirmed`, and `test.assertion`

Exit criteria:

- Shared mechanics do not collapse the domain contracts.
- Existing steerable-collection sample output remains deterministic.
- Test-run evidence output uses the same artifact discipline.

## First Milestone

The first useful checkpoint is intentionally small:

- `docs/recipes/supervised-test-runs.md`
- `shared/schemas/test-run.schema.json`
- `tests/lib/harness-events.sh`
- `tests/lib/harness-plan.sh`
- `packages/toolkit/components/test-console/`
- `tests/run-puck-hitl-plan.sh`
- checked-in sample artifact pack from a deterministic dry run

## Verification Plan

Focused checks:

```bash
node --test tests/schemas/supervised-test-runs.test.mjs
tests/supervised-test-run-dry-run.sh
tests/run-puck-hitl-plan.sh
```

The first two checks should be deterministic and suitable for CI. The HITL run
is an operator test: it should produce durable evidence, not require CI.

No Swift rebuild is required until the plan changes daemon or CLI Swift sources.
