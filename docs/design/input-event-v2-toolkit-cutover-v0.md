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
Deterministic coverage in `tests/daemon-input-surface-ownership.sh` proves
every current daemon-produced CGEvent pointer name, scroll, key, and
subscription snapshot move payload can claim `input_schema_version: 2`.
Incomplete scroll or cancel builder calls without required facts intentionally
remain unversioned only as helper/non-delivery guards; the current CGEvent
producer does not emit `pointer_cancel` or `mouse_cancel` into raw
`input_event`.

Current routed input is built by
`src/daemon/input-surface-ownership.swift` and delivered by
`src/daemon/unified.swift` as `input_region.event` with both
`routed_input` and top-level compatibility fields. Deterministic coverage
proves complete routed pointer and scroll deliveries can claim
`routed_schema_version: 1` with `source_event` preserving the canonical raw v2
payload. Complete routed cancel helpers can also claim routed v1 when supplied
with `cancel_reason`, while helper-only scroll or cancel payloads without
`scroll` or `cancel_reason` intentionally remain unversioned. Current live
input-region routing is driven by pointer/scroll CGEvent names; key events do
not route through `AOSInputRegionRegistry`, and cancel routing remains a
helper/native-follow-up boundary until a producer supplies an explicit cancel
reason. The top-level-only `input_region.event` bridge is retained until live
subscriber proof shows no consumer depends on the top-level fallback fields.

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

## Native/Live Gate Map

### satisfied_by_pr_436_or_437

- `packages/toolkit/runtime/input-events.js` validates canonical raw
  `input_schema_version: 2` payloads and routed `routed_schema_version: 1`
  payloads before adding router aliases. Version-claiming payloads with missing
  required fields now fail deterministically in
  `tests/toolkit/runtime-input-events.test.mjs`.
- `packages/toolkit/runtime/gesture-stream.js` consumes
  `normalizeCanvasInputMessage()` and has canonical routed pointer coverage in
  `tests/toolkit/runtime-gesture-stream.test.mjs`; no separate gesture-stream
  compatibility bridge remains.
- `apps/sigil/renderer/live-modules/input-message.js` delegates
  `input_event` unwrapping to toolkit normalization. The duplicate app-local
  unwrap path was removed and guarded by
  `tests/renderer/input-message.test.mjs`.
- `tests/daemon-input-surface-ownership.sh` proves the current native builders
  claim raw v2 or routed v1 only for complete deterministic pointer, scroll,
  key, snapshot, and cancel payloads, and keep helper-only incomplete
  scroll/cancel payloads unversioned.

### deterministic_js_followup_possible

No remaining owned bridge is safely removable by deterministic JS inspection
alone. The remaining JS compatibility paths are tied to either native producer
shape, live active-subscriber proof, child WebView coordinate ownership, or
external/test producers.

### native_producer_followup_required

- Raw `input_event` fanout: none for current deterministic CGEvent pointer,
  scroll, key, and snapshot move producers. `src/perceive/daemon.swift`
  supplies the facts needed by `src/perceive/events.swift`, and
  `tests/daemon-input-surface-ownership.sh` validates the resulting raw v2
  payloads against `shared/schemas/input-event-v2.schema.json`. Remaining
  unversioned scroll/cancel builder calls are helper/non-delivery guards, not
  current owned-subscriber raw daemon deliveries. Next owner: Foreman only if a
  future native producer starts emitting cancel. Live AOS restart: no for this
  deterministic fact; yes only for active-subscriber observation.
- Routed `input_region.event` producer: no remaining deterministic
  pointer/scroll routed producer change is required after
  `src/daemon/input-surface-ownership.swift` preserves canonical raw v2
  `source_event` objects for complete routed deliveries. Missing fact:
  top-level compatibility fields beside `routed_input` may still be live
  subscriber dependencies, and no current deterministic source path proves a
  live cancel delivery with `cancel_reason`. Next owner: Operator for live
  subscriber proof after Foreman review; Foreman routes a smaller native slice
  only if live or future source inspection finds a real cancel producer without
  `cancel_reason`. Live AOS restart: yes for subscriber proof, no for the
  deterministic pointer/scroll producer gate now covered by
  `tests/daemon-input-surface-ownership.sh`.
- Local deterministic router bridge:
  `packages/toolkit/runtime/interaction-region.js`. Missing fact: this helper
  still routes raw event names such as `left_mouse_down`, `mouse_moved`,
  `scroll_wheel`, `pointer_cancel`, and `mouse_cancel`. Next owner: GDI only
  after Foreman accepts a canonical routed-v1 producer/input contract for this
  helper. Live AOS restart: no. Smallest verification:
  `node --test tests/toolkit/runtime-interaction-region.test.mjs` with canonical
  routed-v1 fixtures, after the native routed producer gate is resolved.

### live_aos_evidence_required

- Active `input_event` subscribers:
  `packages/toolkit/components/surface-inspector/index.js`,
  `packages/toolkit/components/spatial-telemetry/index.js`,
  `apps/sigil/renderer/live-modules/main.js`, and
  `packages/toolkit/panel/chrome.js`. Missing fact: deterministic tests prove
  these consumers normalize canonical and compatibility shapes, but cannot
  prove the live daemon only delivers canonical raw v2 payloads to active
  subscribers. Next owner: Operator after Michael explicitly approves live AOS
  restart. Live AOS restart: yes. Smallest observation: launch the repo daemon,
  open each active subscriber surface, trigger pointer, scroll, key, cancel or
  drag where applicable, and observe through surface debug state or a focused
  probe that received `input_event` messages carry `input_schema_version: 2`
  with required fields and no consumer depends on unversioned raw names.
- Active `input_region.event` consumers:
  `packages/toolkit/panel/stage-affordance.js`,
  `packages/toolkit/panel/chrome.js`, and
  `apps/sigil/renderer/live-modules/main.js`. Missing fact: deterministic tests
  cover canonical `routed_input` and top-level compatibility, but cannot prove
  live daemon routed delivery always includes canonical `routed_input` for
  owned/captured regions. Next owner: Operator after the native producer gate
  lands and Michael approves live AOS restart. Live AOS restart: yes. Smallest
  observation: create a stage affordance/minimized chip or Sigil input region,
  trigger down/drag/up/cancel, and observe `input_region.event.routed_input`
  with `routed_schema_version: 1`, required region ownership, capture identity
  for captured deliveries, and DesktopWorld coordinates.

### child_canvas_coordinate_followup_required

- Child WebView `canvas_message` input:
  `packages/toolkit/runtime/input-events.js`,
  `apps/sigil/renderer/live-modules/input-message.js`, and
  `apps/sigil/renderer/live-modules/main.js`. Missing fact: identity-only
  child messages from Sigil hit/radial surfaces lack parent-resolved
  DesktopWorld coordinates, so toolkit intentionally leaves them unresolved
  until the parent supplies `desktop_world`. Next owner: GDI for the
  parent-coordinate adapter once Foreman routes that slice. Live AOS restart:
  no for deterministic adapter tests; yes only for final real-input proof.
  Smallest verification:
  `node --test tests/renderer/input-message.test.mjs` and
  `node --test tests/toolkit/runtime-input-events.test.mjs` proving
  identity-only child messages remain unresolved while parent-resolved child
  messages normalize to canonical routed v1 with `source_origin: "canvas"`.

### external_or_non_updatable_compatibility

- Unversioned `{type:"input_event", payload}` wrappers in
  `packages/toolkit/runtime/input-events.js` and focused tests remain bounded
  compatibility for test fixtures, ad hoc `show post` probes such as
  `tests/spatial-telemetry-smoke.sh`, and any external canvas producer that
  cannot be updated in the same repo slice. Missing fact: there is no live
  inventory proving every non-repo producer has stopped sending unversioned
  wrapper envelopes. Next owner: Foreman for disposition; Operator only if
  Foreman asks for a live producer inventory. Live AOS restart: not required
  unless Foreman requests live inventory. Smallest verification: keep wrapper
  handling bounded to `input_event` envelopes in
  `normalizeCanvasInputMessage()` and rerun
  `node --test tests/toolkit/runtime-input-events.test.mjs`.

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
