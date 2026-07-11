# AOS Shared Gesture Spine V0

## Purpose

This proof starts the shared pointer/gesture interaction spine for drag-like
behavior. It standardizes mechanics, not meaning:

> Do not add private pointer drag logic. New drag-like behavior must either use
> the shared gesture spine or document why it cannot.

> Shared drag does not mean shared behavior. Shared spine owns mechanics;
> adapters own meaning.

The V0 proof lives in toolkit runtime because it is generic in-canvas policy
over DOM pointer events and already-normalized AOS input messages. It does not
change daemon/native delivery, coalescing, backpressure, or Swift policy.

## Gesture Frame Contract

The V0 frame schema is `aos.gesture-frame` with `schema_version: 0`. Frame
types use normalized names:

- `gesture.drag.start`
- `gesture.drag.move`
- `gesture.drag.end`
- `gesture.drag.cancel`

Each frame carries:

- `gesture_id`: stable id for one pointer gesture sequence.
- `transaction_id`: stable transaction id for recording/causality; V0 defaults
  to `gesture_id` when no separate transaction exists.
- `source`: origin identity with `origin`, `source_canvas_id`,
  `owner_canvas_id`, `raw_event_source`, and DOM `element_ref` when available.
- `pointer`: `pointer_id`, `button`, `buttons`, and `capture_id`.
- `phase`: `start`, `move`, `end`, or `cancel`.
- `coordinates`: available coordinate spaces, currently `dom_client`,
  `native`, and `desktop_world`.
- `origin`, `previous`, `current`, `delta`, and `total_delta` points.
- `constraints`, `bounds`, and `axis` metadata when the adapter knows them.
- `semantic_target` and `semantic_action` for the AOS target descriptor and
  primitive action, such as a slider `set-value` drag. The descriptor carries
  state-scoped `ref`/`state_id`, durable `target.target_id` scoped by
  `target.owner_namespace`, current `state`, provenance/current address, and
  reacquisition hints. Human-facing labels and coordinates may be recorded as
  hints or observations, but not as target identity.
- `timing`: timestamp `t` and `frame_index`.
- `raw_event_type`: the source event type used to create the frame.

Gesture frames are optional interaction evidence and human-visible playback
frames in the broader
[`aos-interaction-grammar-v0.md`](aos-interaction-grammar-v0.md) family. They
link to an action intent/execution transaction through `transaction_id`, but
they are not the whole action intent, execution result, state patch, or Work
Recording replay model.

DOM controls should use toolkit gesture lifecycle helpers for pointer capture,
document-level move/end listeners, end/cancel cleanup, and frame publication.
Canvas or daemon input consumers should normalize existing `input_event` /
`input_region.event` messages into gesture frames before active adapters or
passive observers consume them.

Owned in-repo callers that can consume `aos.gesture-frame` must migrate to this
frame contract. Current daemon/canvas input messages may be source-normalized
only for named in-repo consumers that still receive those messages today; the
normalization does not create broad aliases or product-specific adapter
vocabulary.

## Passive Subscribers

The runtime stream exposes passive `subscribe(listener)` observers. Subscribers
receive the same gesture frames as active adapters and must not mutate gesture
lifecycle state. Surface Inspector uses this path for the minimap drag overlay:
current daemon-delivered `input_event` messages are source-normalized and then
published as `gesture.drag.*` frames through the shared stream.

Passive subscribers may render, record, annotate, or trace frames. They should
not add duplicate raw pointer listeners for a migrated behavior.

## Cleanup And Cancel

The shared lifecycle owner must:

- capture the starting pointer when DOM capture is available;
- filter later DOM pointer frames by pointer id;
- remove document listeners on `end`, `cancel`, cleanup, or destroy;
- release DOM pointer capture on terminal frames when available;
- publish `gesture.drag.cancel` on explicit cancellation or destruction while
  a gesture is active.

Adapters retain semantic cleanup. For example, a slider decides whether an end
frame commits a value and whether a cancel frame reports a cancelled commit.

## Runtime Primitive

`packages/toolkit/runtime/gesture-stream.js` exports:

- `createPointerGestureStream(options)`;
- `createGestureFrameHub()`;
- `bindDomPointerGesture(element, options)`;
- schema constants.

The module reuses `input-events.js` normalization for existing canvas input
messages. It does not replace `interaction-region.js`; routed DesktopWorld hit
ownership remains there. The gesture stream starts after a routed or DOM source
has identified the active pointer path.

The primitive is exported from `packages/toolkit/runtime/index.js` because the
proof is a public toolkit runtime contract for ordinary web-surface controls.
Promotion beyond V0 requires at least one second active adapter and a clear
range/vector/frame adapter split.

## Migrated Proof

The active behavior migrated in this slice is
`packages/toolkit/adapters/zag/slider.js`.

Why this candidate:

- it had private DOM pointer lifecycle code with capture and document move/end
  listeners;
- it is generic toolkit control behavior, not product policy;
- it already exposes semantic slider metadata;
- its preview/change and commit behavior is deterministic and covered by tests.

The slider still owns value mapping, nearest-thumb selection, multi-thumb value
state, and callback semantics. The shared gesture stream now owns DOM pointer
lifecycle mechanics and emits semantic `set-value` drag frames.

## Surface Inspector Path

Surface Inspector minimap mouse effects now consume `gesture.drag.*` frames
through a passive subscriber path. The only temporary raw-input ingress bridge
owned by this proof is the Surface Inspector minimap path for current
daemon-delivered `input_event` drag messages. Its removal gate is the daemon or
toolkit delivery of `aos.gesture-frame` frames to Surface Inspector; at that
point the minimap path drops direct drag normalization from `input_event`.
Non-drag effects such as right-click pulse and Escape cancellation remain in
`mouse-effects.js` until a broader pointer action vocabulary exists; they are
not compatibility names for the drag spine.

## Work Recording Dependency

#428 should stay in schema/design mode until this gesture vocabulary stabilizes.
The intended first Work Recording proof shape is:

1. baseline snapshot;
2. `gesture.drag.*` frames for the migrated interaction;
3. resulting state patch;
4. Surface Inspector overlay observation of the same frames;
5. periodic keyframe later for recovery.

No Work Recording schema or implementation changed in this proof.

## Survey Classifications

- `packages/toolkit/adapters/zag/slider.js`: migrate onto the spine now. This
  is the V0 active migration.
- `packages/toolkit/runtime/range-drag.js`: defer with follow-up
  `gesture-range-value-adapter-v0`; it should consume gesture frames after the
  range adapter boundary is named.
- `packages/toolkit/panel/drag-drop.js`: defer with follow-up
  `panel-drag-drop-gesture-frames-v0`; it already has higher-level panel
  movement policy and should migrate after the V0 frame contract settles.
- `packages/toolkit/panel/chrome.js`: keep domain-private but consume
  normalized gesture frames later for panel drag and resize wiring.
- `packages/toolkit/panel/layouts/split-pane.js`: defer with follow-up
  `split-pane-gesture-ratio-adapter-v0`; it needs a split-ratio semantic
  adapter, not raw shared drag meaning.
- `packages/toolkit/adapters/zag/splitter.js`: defer with the split-pane
  adapter follow-up, preserving Zag splitter semantics.
- `packages/toolkit/panel/minimized-chip.html`: defer with follow-up
  `minimized-chip-gesture-consumer-v0`; it should align with panel drag/drop
  migration and transfer-outline retirement.
- Surface Inspector minimap mouse-event overlay: migrate onto the spine now as
  a passive subscriber. It temporarily owns raw `input_event` drag
  source-normalization until Surface Inspector receives `aos.gesture-frame`
  delivery directly.
- Product-specific gesture adoption remains domain-private and belongs in the
  consuming repository after a generic semantic adapter exists.
- toolkit graph/radial-graph canvas drag paths: keep separate with a clear
  reason for now; object/camera canvas interaction needs a graph-specific
  semantic adapter before migration.
- Remaining raw `pointerdown`, `pointermove`, and `setPointerCapture` surface
  logic: defer with follow-up `raw-pointer-path-sweep-after-gesture-v0`; each
  path should either move onto the spine or record a local exception.
