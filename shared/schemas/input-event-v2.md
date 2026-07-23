# AOS Input Event v2

**File:** `input-event-v2.schema.json`

Canonical schema for raw daemon `input_event` payloads and toolkit
`aos_routed_input` envelopes.

## Scope

This contract separates hardware observation from app behavior routing.

- Raw daemon `input_event` payloads carry observed input facts:
  coordinates, event kind, phase, button state, scroll deltas, key facts,
  modifiers, timestamps, sequence, source origin, and topology version.
- Toolkit `aos_routed_input` envelopes carry behavior-driving delivery roles:
  `observed`, `owned`, or `captured`.
- Apps should drive pointer behavior from routed events with `delivery_role`
  `owned` or `captured`, not directly from raw daemon observations.

## Versions

Raw daemon payloads may use `input_schema_version: 2` only when the payload
contains every required field for its `event_kind`. Event helpers that know an
event name but cannot yet provide the required v2 facts must leave the payload
in an explicit legacy shape without `input_schema_version`.

Routed toolkit envelopes may use `routed_schema_version: 1` only when the
payload contains every required routed field for its `event_kind` and
`delivery_role`. This is intentionally separate from the daemon event stream
envelope version in `daemon-event.schema.json`.

## Identity Fields

Raw daemon events are identified by `sequence: {source:"daemon", value}` plus
`timestamp_monotonic_ms`. Pointer and scroll events also carry `gesture_id`
when they belong to a pointer sequence. Raw events may include
`source_origin`; daemon-observed hardware input uses `source_origin:"daemon"`,
while compatibility adapters can use `source_origin:"canvas"` with
`source_canvas_id` for canvas-origin synthetic input.

Routed envelopes preserve the observed event identity in `source_event` and,
when available, `source_sequence`. Owned and captured deliveries must include
`region_id` and `owner_canvas_id`; captured deliveries must also include
`capture_id`, which stays stable from captured drag through release/cancel.
`source_canvas_id` is reserved for routed canvas-origin echoes. This lets
toolkit and app consumers suppress duplicates by identity rather than private
booleans such as `fromHitTarget`.

## Coordinate Frames

`native` is in global CG/display coordinates.

`desktop_world` is required at the routed envelope boundary. It may be supplied
by the daemon with `coordinate_authority: "daemon"` or derived by toolkit with
`coordinate_authority: "toolkit"`.

Routed envelopes may also carry an explicit `native` point. Daemon input-region
pointer and scroll delivery includes it; canvas-origin delivery includes it only
when the producer supplied an authoritative native point. Consumers must never
infer native coordinates from normalized `x`/`y`, which follow `desktop_world`
when available.

## Event Kinds

The schema defines four raw event kinds:

| Kind | Phase Rules | Notes |
| --- | --- | --- |
| `pointer` | `down`, `move`, `drag`, or `up` | Requires `button`, `buttons`, `native`, `display_id`, and `topology_version`. |
| `scroll` | `scroll` | Requires `scroll.dx`, `scroll.dy`, and `scroll.unit`. The only accepted PR 1 unit is `point`. |
| `key` | no `phase` | Requires `key.physical_key_code`, `key.logical`, `key.repeat`, and `key.is_printable`. |
| `cancel` | `cancel` | Requires `cancel_reason`; synthetic cancels should include `caused_by_sequence`. |

The native daemon tap currently emits v2 scroll events from `.scrollWheel`
because it can populate `scroll.dx`, `scroll.dy`, and `scroll.unit: "point"`.
Synthetic or helper-only cancel events may claim v2 only when they include
`cancel_reason`; otherwise they remain legacy-shaped compatibility payloads.
When Escape cancels an active daemon-owned input-region capture, the daemon
emits one routed cancel with `cancel_reason: "escape"`, the existing capture and
gesture identity, and the last authoritative coordinates. Repeated Escape after
that atomic cancellation is not delivered to the former owner.

Routed envelopes require `gesture_id`, `desktop_world`,
`coordinate_authority`, `source_origin`, and `source_event`. Routed pointer
envelopes also carry semantic `phase` values, including toolkit-synthesized
`enter`, `hover`, `leave`, and `hover_cancel` for region feedback. `region_id`
and `owner_canvas_id` are required for `owned` and `captured` delivery.
`capture_id` is required for `captured` delivery.

## Fixtures

Fixtures live under `shared/schemas/fixtures/input-event-v2/`:

- `valid/` contains raw and routed examples that must validate.
- `invalid/` contains negative fixtures for required fields, phase scoping,
  scroll unit rejection, and routed capture requirements.
- `sequences/` contains mixed-source ordering fixtures for daemon events and
  toolkit synthetic events.

The valid set covers raw pointer, scroll, key, and cancel payloads plus routed
owned pointer, captured drag, scroll, and captured cancel deliveries. The
invalid set includes version-claiming raw and routed payloads that omit required
fields such as `scroll`, `cancel_reason`, `region_id`, or `capture_id`.

Run:

```sh
node --test tests/schemas/input-event-v2.test.mjs
```
