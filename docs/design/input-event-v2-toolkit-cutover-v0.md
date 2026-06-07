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

## Native Producer And Active Subscriber Audit

Current native raw input is built in `src/perceive/events.swift` and delivered
from `src/perceive/daemon.swift` into `src/daemon/unified.swift`.
Deterministic inspection shows complete CGEvent pointer, scroll, key, and
snapshot move payloads can claim `input_schema_version: 2`, while helper-only
scroll or cancel payloads without required facts intentionally remain
unversioned in `tests/daemon-input-surface-ownership.sh`. Removing the raw
event-name bridge from toolkit is therefore native-boundary work: Foreman must
route a separate native/live round to prove the daemon no longer emits
unversioned raw input to active subscribers.

Current routed input is built by
`src/daemon/input-surface-ownership.swift` and delivered by
`src/daemon/unified.swift` as `input_region.event` with both
`routed_input` and top-level compatibility fields. Complete routed pointer,
scroll, and cancel payloads can claim `routed_schema_version: 1`; routed scroll
or cancel helpers without `scroll` or `cancel_reason` intentionally remain
unversioned in deterministic Swift coverage. The top-level-only
`input_region.event` bridge is intentionally retained until a native/live round
proves every active daemon routed producer includes canonical `routed_input`
and no live subscriber depends on the top-level fallback.

Active owned subscribers currently route through the toolkit normalizer:

- `packages/toolkit/components/surface-inspector/index.js` subscribes to
  `input_event` for cursor tracking, mouse effects, and annotation hover.
  Retain compatibility until live subscriber evidence proves only canonical raw
  v2 reaches it.
- `packages/toolkit/components/spatial-telemetry/index.js` subscribes to
  `input_event` and summarizes cursor telemetry through
  `normalizeCanvasInputMessage()`. Retain compatibility until native fanout is
  live-proven canonical.
- `apps/sigil/renderer/live-modules/main.js` subscribes to `input_event` and
  delegates input normalization through
  `apps/sigil/renderer/live-modules/input-message.js`. Sigil's duplicate
  app-local `input_event` unwrap was removed; unresolved child
  `canvas_message` input remains intentionally retained until parent
  DesktopWorld coordinates are supplied and toolkit can emit canonical
  canvas-origin routed v1.
- `packages/toolkit/panel/chrome.js` temporarily subscribes to global
  `input_event` during panel drags and handles minimized-chip
  `input_region.event` messages. Retain raw and top-level routed
  compatibility until daemon routed delivery and live panel drag subscribers
  are proven canonical.
- `packages/toolkit/panel/stage-affordance.js` filters
  `input_region.event` by region id for passive DesktopWorld hit regions. It is
  intentionally retained as routed producer compatibility until canonical
  `routed_input` delivery is native/live-proven.

No Swift/native files were changed in this audit. The remaining hard-cutover
work is a native-boundary/live-evidence follow-up, not a deterministic
JS/toolkit cleanup, once Foreman is ready to route native producer changes and
TCC-safe live subscriber proof.

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
- Sigil input normalization no longer keeps a duplicate app-local
  `input_event` unwrap after toolkit normalization; that owned compatibility is
  removable in this deterministic JS round and now covered by
  `tests/renderer/input-message.test.mjs`.

## Replay Boundary

Raw input remains evidence for interaction grammar and Work Recording frame
contracts. AOS-owned replay should use the interaction and recording languages,
not unversioned input aliases or mixed raw/routed payload shapes.
