# AOS Interaction Grammar V0

**Status:** contract note for #430 deterministic fixtures
**Depends on:** #429 target descriptor vocabulary and #427 gesture frames

## Purpose

AOS interaction records are a small family, not one flat event stream. The
family connects what a target is, what an agent or replay requested, how AOS
executed it, what input evidence was observed, and what state changed.

Every target-addressed interaction in this contract uses the descriptor
vocabulary from
[`shared/schemas/aos-semantic-targets.md`](../../shared/schemas/aos-semantic-targets.md):

- immediate action handles are `ref` scoped by `state_id`;
- durable identity is `target.target_id` scoped by `target.owner_namespace`;
- primitive actions are listed in `actions`;
- current state lives in `state`;
- current address and geometry live in `provenance`;
- repair search facts live in `reacquisition.machine_fingerprint`;
- labels, accessible names, source names, and coordinates are hints or
  observations, not durable identity.

## Record Family

### `target_descriptor`

`target_descriptor` says what target exists and what can be done to it. It is
the same shape emitted in `semantic_targets[]` for AOS-owned canvases.

Required target-addressing fields:

- `ref`
- `state_id`
- `target.target_id`
- `target.owner_namespace`
- `actions`
- `state`
- `provenance`
- `reacquisition`

### `action_intent`

`action_intent` records what an agent, recipe, or replay requested before AOS
mutates anything.

Required fields:

- `id` and `transaction_id`
- `action_type`, such as `click`, `drag`, `set-value`, `focus`, or `toggle`
- `target_ref.ref` and `target_ref.state_id` for the current action attempt
- `target_ref.target_descriptor` when the action is target-addressed
- optional `input.value` or `input.vector`
- `source_state_id`
- `constraints`
- `caller` and provenance metadata

An intent that carries a stale `state_id`/`ref` pair must reject before
execution or report stale status. It must not silently select a same-label
target.

### `execution_result`

`execution_result` records how `aos do` handled an intent. It is the canonical
place to preserve the current `aos do` response fields and additive target
details.

Required fields when present in the `aos do` response:

- `status`
- `reason`
- `duration_ms`
- `execution.backend`
- `execution.strategy`
- `execution.fallback_used`
- `execution.state_id`
- `target`
- `resolved_target`
- `post_action_state`

Rejected stale or ambiguous actions still produce an `execution_result`, but
`executed` is false and `status`/`reason` explain why no actuator backend ran.

### `observed_input`

`observed_input` stores raw hardware, DOM, canvas, or daemon facts only when
they are needed for evidence, diagnosis, or visible playback. It is source
evidence, not the primary semantic recording grammar for AOS-owned surfaces.

For AOS-owned sliders and controls, raw coordinates may describe where playback
occurred. They must not become the target identity.

### `gesture_frame`

`gesture_frame` is the optional normalized lifecycle stream from
`aos.gesture-frame`. It is linked to the action transaction through
`transaction_id` and carries the same target descriptor under
`semantic_target`.

Gesture frames are required only when human-visible playback or observation
captured a drag. They are not the whole action intent, execution result, or
Work Recording model.

### `state_patch` / `evidence`

`state_patch` records what changed. `evidence` records how that change was
verified. Both point back to the target descriptor and transaction instead of
repeating label or coordinate identity.

Recommended fields:

- `id`
- `transaction_id`
- `target_ref`
- `before_state`
- `after_state`
- `changes`
- `verified_by`
- `evidence_refs`

### `recording_replay_plan`

`recording_replay_plan` describes how a Work Recording should attempt the same
work later:

1. re-perceive the relevant surface;
2. resolve the descriptor by `owner_namespace`, `target_id`, role,
   structural path, capabilities, range shape, and other machine facts;
3. use label/accessibility text only as hints;
4. block on ambiguous or missing matches;
5. reissue the semantic `action_intent`;
6. verify the expected `state_patch` or postcondition.

Blind raw event replay is not the default for AOS-owned surfaces. Raw
`input_event` / input-event-v2 payloads remain evidence and compatibility debt
until the input-event-v2 cutover is designed.

## Ownership Boundaries

- `aos do` owns action intent validation, target resolution, stale/ambiguous
  rejection, execution result fields, backend/strategy/fallback metadata,
  target details, post-action state, status, reason, and duration.
- Toolkit gesture stream owns pointer/gesture mechanics, capture lifecycle,
  frame lifecycle, passive subscribers, and `aos.gesture-frame` publication.
- Work Recording owns durable intent storage, execution-map storage, evidence,
  replay plans, health, and repair patches. It records and verifies work; it
  does not make raw input replay canonical.
- Raw `input_event` / input-event-v2 is source evidence and compatibility debt.
  It is not the canonical recording grammar for AOS-owned controls.

## Fixture Cases

The deterministic fixture pack in
[`docs/design/fixtures/aos-interaction-grammar-v0/`](fixtures/aos-interaction-grammar-v0/)
proves:

- a single-thumb toolkit slider sequence:
  `see -> action_intent(set-value) -> execution_result -> gesture.drag.* ->
  state_patch -> work_record -> replay_plan`;
- stale `state_id`/`ref` rejection before execution, followed by a
  machine-first reacquisition replay plan;
- ambiguous same-label reacquisition that remains blocked.

