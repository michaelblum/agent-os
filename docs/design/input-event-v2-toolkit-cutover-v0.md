# Input Event v2 Toolkit Cutover V0

## Contract Split

`input_event` is the daemon event-stream channel name. `input-event-v2` is the
payload schema for raw observed input on that channel. A payload may claim
`input_schema_version: 2` only when it includes the required fields for its
`event_kind`.

`aos_routed_input` is the toolkit routed delivery payload. Daemon
`input_region.event` bridge messages carry it under `routed_input` with
`routed_schema_version: 1`. Routed delivery has its own required fields by
`event_kind` and `delivery_role`; owned and captured deliveries require
`region_id` and `owner_canvas_id`, and captured deliveries require
`capture_id`.

## Toolkit Consumers

`packages/toolkit/runtime/input-events.js` remains the owned normalization
boundary. Its canonical path is raw v2 payloads and routed v1 envelopes. It now
throws when a payload claims `input_schema_version: 2` or
`routed_schema_version: 1` without the required fields that the runtime depends
on.

The remaining unversioned compatibility paths are:

- raw event-name fanout such as `mouse_moved`, `left_mouse_down`,
  `scroll_wheel`, `pointer_cancel`, and `mouse_cancel`; removal gate: the native
  canvas fanout publishes only canonical raw v2 payloads to toolkit-owned
  consumers;
- unversioned `{type:"input_event", payload}` wrappers; removal gate: external
  and test producers stop using wrapper envelopes without schema claims;
- top-level-only `input_region.event` messages; removal gate: the daemon routed
  producer always includes canonical `routed_input`;
- `canvas_message` child WebView input forwarded through
  `createCanvasOriginInputEvent()`; removal gate: child hit WebViews can emit
  canonical routed v1 directly with parent-supplied DesktopWorld coordinates.

`packages/toolkit/runtime/gesture-stream.js` consumes
`normalizeCanvasInputMessage()` and is covered with canonical routed pointer
fixtures. It does not need a separate legacy alias path.

`packages/toolkit/runtime/interaction-region.js` still accepts raw event names
for local deterministic routing helpers. That is a native producer bridge until
the input-region router receives only canonical routed v1 payloads.

## Migrated Or Guarded In This Slice

- Runtime v2/v1 normalizing now validates version-claiming payloads before
  adding camelCase router aliases.
- Canvas-origin synthetic messages emit canonical routed v1 payloads for
  pointer, scroll, and cancel cases.
- Top-level-only `input_region.event` compatibility no longer fabricates a
  `routed_schema_version: 1` payload.
- Schema fixtures now include a valid routed captured cancel example alongside
  existing raw pointer, raw scroll, raw key, raw cancel, routed owned pointer,
  routed captured drag, routed scroll, and invalid version-claiming examples.

## Replay Boundary

Raw input remains evidence for interaction grammar and Work Recording frame
contracts. AOS-owned replay should use the interaction and recording languages,
not unversioned input aliases or mixed raw/routed payload shapes.
