# AOS Work Recording Frame Contract V0

**Status:** legacy transition fixture note for #428; superseded as public
target/Gate authority by ADR 0040
**Depends on:** #429 target descriptors, #430 interaction grammar, and #427
gesture frames

## ADR 0040 Transition Boundary

This note freezes the current pre-ADR-0040 fixture shape so runtime migration
can replace it deliberately. Its mixed descriptor combines Observation Ref and
Locator material, and its Work Record Gate fields record legacy coupling. The
requirements below apply only to these transition fixtures; they are not the
public target-handle contract, and Gate is not AOS permission.

## Purpose

A Work Recording is an ordered frame pack over the interaction record family in
[`aos-interaction-grammar-v0.md`](aos-interaction-grammar-v0.md). It stores the
baseline context for a run, compact semantic deltas after the baseline,
periodic recovery snapshots, immutable evidence references, replay policy, and
frame health. It does not make raw pointer streams, labels, accessible names,
or coordinates the durable language of AOS-owned recordings.

In this legacy fixture, the mixed descriptor stores `target.target_id` scoped
by `target.owner_namespace` beside the state-scoped `ref` and `state_id` for an
immediate action attempt. Labels, accessible names, source names, and
coordinates remain hints rather than fixture identity. ADR 0040 instead defines
a distinct Observation Ref `(state_id, ref)` and action-time Locator.

## Frame Family

### `recording_baseline`

`recording_baseline` is the first snapshot for a recording segment. It captures
the relevant surfaces, state ids, target descriptors, environment metadata, and
Work Record context needed to interpret later deltas.

Required legacy-fixture content:

- `state_id` for the captured perception state.
- relevant `target_descriptors[]` with `target.target_id`,
  `target.owner_namespace`, `actions`, `state`, `provenance`, and
  `reacquisition`.
- `work_record_ref` or Work Record context that names the durable run.
- `replay_policy_ref` or inline policy context that records the current legacy
  Work Record Gate coupling.

The baseline is a snapshot for interpretation and recovery. It is not a command
to replay the screen exactly.

### `recording_delta_frame`

`recording_delta_frame` is the compact frame after a baseline. It can contain
references to or embedded copies of the #430 interaction records produced by a
transaction:

- `action_intents[]`
- `execution_results[]`
- optional `gesture_frames[]`
- optional `observed_input[]`
- `state_patches[]`
- annotation or Surface Inspector observations
- `evidence_refs[]`
- artifact refs

These pieces stay typed. A delta frame must not collapse an intent, execution
result, gesture frame, observed input, and state patch into one untyped event
payload.

### `recording_keyframe`

`recording_keyframe` is a periodic full or partial snapshot for recovery. It can
refresh surface state, relevant descriptors, state patch anchors, and artifact
routes. It does not replace semantic delta frames: the recording still stores
what action was requested, how it executed, what optional gesture evidence was
observed, and what state changed.

### `recording_evidence_ref`

`recording_evidence_ref` is an immutable receipt that links a frame to existing
Work Record `evidence[]` entries and artifact routes. It can point at before
and after perception, `aos do` results, gesture-frame traces, Surface Inspector
annotation snapshots, screenshots, verifier output, or exported artifacts.

Evidence references are append-only. Replay or repair must not rewrite
historical frames or evidence to make a later run look successful.

### `recording_replay_policy`

`recording_replay_policy` is semantic replay policy for AOS-owned surfaces:

1. re-perceive the relevant surface;
2. resolve target descriptors by `owner_namespace`, `target_id`, role,
   capabilities, structural path, range shape, and other machine facts;
3. use labels, accessible names, source names, and coordinates only as hints;
4. block on stale, missing, or ambiguous target resolution;
5. reissue #430 `action_intent` records when a unique target is resolved;
6. verify expected `state_patch` records or Work Record postconditions;
7. preserve the current legacy Work Record Gate fields for migration evidence.

Raw `input_event` / input-event-v2 payloads are observed input evidence and
#431 compatibility/cutover debt. Blind raw input replay is not the default for
AOS-owned surfaces.

## Ownership Boundaries

- Work Recording owns baseline, delta, and keyframe storage; replay policy;
  evidence refs; frame health; and repair patch records.
- The #430 interaction grammar owns target descriptors, action intents,
  execution results, observed input, gesture frames, state patches, and replay
  plans.
- The toolkit gesture stream owns `aos.gesture-frame` production and passive
  observation. Gesture frames are optional recording evidence or human-visible
  playback frames, not the whole recording model.
- `aos do` owns execution result metadata, target resolution, stale or
  ambiguous rejection, backend, strategy, fallback, state id, status, reason,
  and duration.
- Raw `input_event` / input-event-v2 payloads remain evidence and #431 debt, not
  the primary Work Recording language.

## Repair And Health

Replay failure records frame health instead of editing history. If target
resolution is stale or ambiguous, the legacy fixture appends a `repairable`
health record that references the original frame, evidence, and Gate field. A
future runtime migration may update the repairable execution map or Locator
knowledge, but it must preserve the original baseline, delta, keyframe, and
evidence refs without treating Gate as permission.

## Fixture Cases

The deterministic fixture pack in
[`docs/design/fixtures/aos-work-recording-frame-v0/`](fixtures/aos-work-recording-frame-v0/)
proves:

- a single-thumb toolkit slider recording:
  `recording_baseline -> action_intent -> execution_result -> gesture.drag.* ->
  state_patch -> Surface Inspector observation -> recording_delta_frame ->
  recording_replay_policy`;
- a compact keyframe that is a periodic recovery checkpoint while the semantic
  action and state delta remain in the delta frame;
- a blocked replay where stale or ambiguous target resolution preserves
  historical frames/evidence and appends repair-needed health.
