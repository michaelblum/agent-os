# AOS Input Event v2

**File:** `input-event-v2.schema.json`

Canonical schema for raw daemon `input_event` payloads and toolkit
`aos_routed_input` envelopes.

## Scope

This contract separates hardware observation from app behavior routing.

- Raw daemon `input_event` payloads carry observed input facts:
  coordinates, event kind, phase, button state, scroll deltas, key facts,
  modifiers, timestamps, sequence, and topology version.
- Toolkit `aos_routed_input` envelopes carry behavior-driving delivery roles:
  `observed`, `owned`, or `captured`.
- Apps should drive pointer behavior from routed events with `delivery_role`
  `owned` or `captured`, not directly from raw daemon observations.

## Versions

Raw events use `input_schema_version: 2`.

Routed toolkit envelopes use `routed_schema_version: 1`. This is intentionally
separate from the daemon event stream envelope version in
`daemon-event.schema.json`.

## Coordinate Frames

`native` is in global CG/display coordinates.

`desktop_world` is required at the routed envelope boundary. It may be supplied
by the daemon with `coordinate_authority: "daemon"` or derived by toolkit with
`coordinate_authority: "toolkit"`.

## Event Kinds

The schema defines four raw event kinds:

| Kind | Phase Rules | Notes |
| --- | --- | --- |
| `pointer` | `down`, `move`, `drag`, or `up` | Requires `button`, `buttons`, `native`, `display_id`, and `topology_version`. |
| `scroll` | `scroll` | Requires `scroll.dx`, `scroll.dy`, and `scroll.unit`. The only accepted PR 1 unit is `point`. |
| `key` | no `phase` | Requires `key.physical_key_code`, `key.logical`, `key.repeat`, and `key.is_printable`. |
| `cancel` | `cancel` | Requires `cancel_reason`; synthetic cancels should include `caused_by_sequence`. |

Routed envelopes require `gesture_id`, `desktop_world`,
`coordinate_authority`, and `source_event`. Routed pointer envelopes also carry
semantic `phase` values, including toolkit-synthesized `enter`, `hover`,
`leave`, and `hover_cancel` for region feedback. `region_id` is required for
`owned` and `captured` delivery. `capture_id` is required for `captured`
delivery.

## Fixtures

Fixtures live under `shared/schemas/fixtures/input-event-v2/`:

- `valid/` contains raw and routed examples that must validate.
- `invalid/` contains negative fixtures for required fields, phase scoping,
  scroll unit rejection, and routed capture requirements.
- `sequences/` contains mixed-source ordering fixtures for daemon events and
  toolkit synthetic events.

Run:

```sh
node --test tests/schemas/input-event-v2.test.mjs
```
