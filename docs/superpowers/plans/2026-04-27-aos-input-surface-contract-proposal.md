# AOS Input Surface Contract Proposal

## Purpose

This proposal asks a review panel to evaluate whether AOS should formalize a
single input contract for all AOS-owned canvases and overlays. The immediate
pressure comes from Sigil: fast travel, context menus, hit targets, cross-display
animation, and emergency recovery now all depend on input events behaving
consistently across displays and canvas layers.

Sigil is the motivating consumer, not the architecture template. AOS is a
platform for LLM agents to build agentic harness apps, and future apps may use
different interaction styles, devices, and product opinions. The goal is to
extract reusable primitive pressure from Sigil's current needs without making
Sigil's product model mandatory for other apps.

The implementation should build what Sigil needs now, but compose it in layers
so future apps can either reuse the same patterns or reasonably choose different
ones on top of the same primitives.

The core question is:

> Should daemon-observed input become the authoritative input stream for AOS
> surfaces, with toolkit primitives handling coordinate conversion, routing, and
> capture, while app code only declares regions and reacts to semantic events?

## Current State

AOS already has most of the necessary pieces, but they are not yet one contract.

- The daemon emits `input_event` for mouse and keyboard events.
- Toolkit exposes spatial helpers for native/display/DesktopWorld conversion.
- Toolkit has `createDesktopWorldInteractionRouter`, which handles region
  picking, pointer capture, duplicate-stream suppression, and outside-click
  callbacks.
- Sigil creates its own transparent hit canvas with
  `apps/sigil/renderer/live-modules/hit-target.js`.
- Sigil's hit page, `apps/sigil/renderer/hit-area.html`, still observes DOM
  pointer events and emits left-button events, even though the live Sigil path
  now ignores those left-button events for fast travel.
- Sigil's context menu uses the toolkit interaction router, but avatar press,
  drag, fast travel, and some keyboard behavior remain hand-routed in
  `apps/sigil/renderer/live-modules/main.js`.
- The current event builder in `src/perceive/events.swift` only formalizes a
  small payload shape: `type`, optional `x/y`, optional `key_code`, and optional
  `flags`.
- The daemon still contains Sigil-specific consumption logic in
  `src/daemon/unified.swift` through `shouldConsumeSigilInputEvent`. That path
  knows about Sigil modes, avatar rectangles, and menu-like states, which
  contradicts the desired daemon boundary.

This is close to the desired shape, but ownership is still ambiguous. A
transparent hit surface can absorb input, the daemon can emit input, the toolkit
can route input, and Sigil can also interpret input directly. That leaves room
for regressions where two paths both appear legitimate.

## Proposed Contract

For AOS-owned surfaces, app behavior should be driven by AOS input events only.
DOM events may absorb, focus, and support native editable controls, but DOM
pointer coordinates must not be authoritative for app behavior.

The proposed flow is:

```text
native hardware input
  -> daemon input_event
  -> toolkit input adapter normalizes to DesktopWorld
  -> toolkit interaction router captures/routes to declared regions
  -> app semantic handlers react
```

The complementary surface flow is:

```text
toolkit InteractionSurface
  -> creates transparent native absorber windows
  -> exposes enabled/disabled/placement/cursor configuration
  -> does not own pointer-coordinate meaning
```

This separates "pixels catch input" from "input means a drag/click/shortcut".

The target layering is:

```text
daemon primitives
  native input facts, canvas/window facts, emergency commands

toolkit primitives
  InteractionSurface, input adapter, interaction router

toolkit patterns
  optional composed helpers for common wiring configurations

apps
  product behavior and semantics
```

Only the lower layers should become platform contract. Toolkit patterns are
allowed to be opinionated where they wrap common wiring, but they should remain
optional conveniences, not required architecture for every future app.

Pattern discipline:

- A toolkit pattern should not be documented as the recommended shape until it
  has either a second-app fitness check or an explicit note that it was designed
  for Sigil's current needs.
- Pattern docs should name the lower primitives they compose so future apps can
  choose a different composition without forking the platform.
- If a second app needs the same job with a materially different interaction
  model, prefer documenting both patterns over stretching the first pattern into
  a one-size-fits-all abstraction.

## Responsibilities

### Daemon

The daemon should own hardware facts:

- native mouse coordinates
- mouse phase and button
- scroll deltas
- key down/up, repeat, key code, modifiers
- event timestamp
- display topology version, when available
- global emergency shortcuts that must work even when a canvas is broken

The daemon should not know app concepts such as Sigil fast travel, context-menu
sliders, wormhole entry points, or avatar drag cancellation.

The existing Sigil-specific daemon consumption path should be treated as a
current non-target implementation to converge away from, not as a pattern to
expand. The replacement should be generic canvas/input ownership policy:

- The daemon may reserve global emergency commands.
- The daemon may expose canvas lifecycle, z-level, interactivity, and focus
  facts.
- The daemon may decide whether an input event is consumed by an AOS-owned
  surface at a generic canvas/window level.
- The daemon should not branch on app names, Sigil modes, avatar rectangles, or
  menu states.

Concrete daemon consume policy:

- Consume a pointer event only when the event targets a known AOS-owned native
  window/canvas that is currently `interactive=true` and is the frontmost
  hittable AOS surface at that native point.
- The daemon consume decision is based on the native surface frame, not
  semantic region geometry. Shape-specific tests such as "inside the circular
  avatar" live in toolkit/app routing through `region.contains(point)`.
- Mode-aware ownership is expressed by toolkit/app surface and region state:
  Sigil may enable/disable an `InteractionSurface` and register the active
  region set for the current mode, but the daemon still sees only generic
  surface facts.
- The `InteractionSurface` `interactive` flag and router region set must update
  in one toolkit operation or transaction so there is no window where the daemon
  consumes for a surface with no corresponding routed region.
- Once a region wins pointer down, capture owns drag/up/cancel until release or
  cancel, even if the cursor leaves the surface frame.
- Consume a pointer event during an active daemon/toolkit capture only if the
  capture was started by an AOS-owned interactive surface and has not been
  cancelled.
- Never consume events for non-interactive, click-through, suspended, removed,
  or orphaned surfaces.
- Never consume based on app state such as Sigil mode, avatar geometry, menu
  state, or fast-travel state.
- Always allow daemon-reserved emergency shortcuts to run, but keep them narrow
  and explicit.
- If ownership is ambiguous, do not consume. Prefer a missed AOS interaction
  over blocking normal desktop input.

This policy replaces `shouldConsumeSigilInputEvent`; it does not generalize that
function.

Rectangular native surface consumption is an accepted first-slice constraint.
On macOS, a consumed event cannot be handed back to the OS if toolkit
`region.contains(point)` later rejects it. `InteractionSurface` frames should be
placed as tightly as practical around visible affordances, and toolkit should
emit hover/leave events so apps can provide visual feedback that matches the
actual interactive footprint. If PR 3 proves the rectangular footprint
unacceptable for Sigil's circular avatar, the contingency is tighter/multiple
surface placement or a later shaped-surface primitive, not Sigil-specific daemon
mode logic.

## Convergence Principle

AOS should converge on one strongest contract instead of preserving parallel
contracts indefinitely. Existing components and apps are expected to be
refactored as the contract sharpens.

During staged rollout, adapters may accept current payload shapes only to keep
the system operable while producers and consumers move to `input_schema_version`
2. Those adapters are transition scaffolding, not alternate contracts. Each
adapter or switch must have an owner, removal gate, and deadline.

Avoiding contract drift is a design goal. If an existing Sigil, toolkit, or
daemon path does not match the v2 input contract, the expected outcome is
refactoring toward v2, not long-term support for that path.

Temporary convergence scaffolding inventory:

| Scaffolding | Owner | Removal gate | Deadline |
| --- | --- | --- | --- |
| Current-payload to v2 toolkit adapter | Toolkit | Daemon emits v2 and JS toolkit tests consume schema fixtures directly | PR immediately after Sigil router convergence verification |
| First-party raw `input_event` subscribers | Owning package/app | Consumer inventory confirms direct subscribers either consume v2 or are intentionally observation-only | Before deleting current-payload adapter |
| Sigil router convergence switch | Sigil | Extended-display avatar drag, fast-travel release, context-menu click/scroll/range controls, and editable text checks pass on the new router | PR immediately after PR 6b verification |
| Hit-canvas right/wheel DOM convergence path | Sigil | Right-click and wheel daemon routes pass context-menu tests | Delete in PR 6a |
| Hit-canvas left DOM convergence path | Sigil | v2 adapter, capture handshake, and extended-display drag tests pass | Delete in PR 6b |

## Consume, Broadcast, and Delivery Semantics

The word "consume" needs a narrow definition. In this proposal, consume means
prevent normal OS propagation for an event that hit an interactive AOS-owned
surface. It does not mean "drop the event".

Delivery rules:

- Pointer events consumed for an AOS surface are still broadcast as
  `input_event` to AOS subscribers and routed to the owning app path.
- Pointer events not consumed may still be broadcast to subscribers for
  observation, but toolkit must treat them as observational unless a registered
  AOS surface owns/captures them.
- Raw daemon `input_event` payloads do not include `delivery_role`. They are
  hardware observations, not app behavior events.
- Toolkit wraps adapted raw events in a routed event envelope, named here as
  `aos_routed_input`, with `delivery_role`: `observed`, `owned`, or
  `captured`. Apps must drive behavior from `aos_routed_input`, not raw
  `input_event`, and only from `owned` or `captured` events for a registered
  region. `observed` events are for diagnostics and passive state only.
- Daemon-reserved emergency shortcuts are handled by the daemon command path and
  are not routed as normal app shortcuts by default.
- Diagnostics shortcuts may emit a diagnostic event after the daemon action
  completes, but that diagnostic event must not trigger app behavior.
- Editable-control text events are not consumed by generic AOS routing unless a
  daemon-reserved shortcut wins precedence.
- If an event is consumed but cannot be delivered to a live AOS owner, the daemon
  must inject or request `cancel` for any active capture and log the delivery
  failure.

This keeps AOS interactions responsive without letting broad consumption block
normal desktop input silently.

## Input Event Schema

The proposal depends on a stronger input contract than the current
`inputEventData` helper provides. Before Sigil removes DOM left-button event
delivery, AOS should define a versioned `input_event` payload.

The preferred implementation path is to move producer and first-party consumers
to v2 in the same staged sequence wherever practical. A convergence adapter is
justified only to keep active Sigil work operable during the short window where
daemon, toolkit, and Sigil PRs cannot land atomically. If implementation shows
there are no active external or in-repo consumers pinned to the current shape,
PR 1 and PR 2 should collapse the producer/consumer move instead of preserving
an adapter for its own sake.

Proposed pointer event:

```json
{
  "input_schema_version": 2,
  "type": "left_mouse_down",
  "event_kind": "pointer",
  "phase": "down",
  "device": "mouse",
  "timestamp_monotonic_ms": 123456789.25,
  "sequence": { "source": "daemon", "value": 42 },
  "gesture_id": "g-42",
  "native": { "x": 529, "y": 373 },
  "desktop_world": { "x": 714, "y": 373 },
  "coordinate_authority": "daemon",
  "display_id": 1,
  "topology_version": 17,
  "button": "left",
  "buttons": {
    "left": true,
    "right": false,
    "middle": false,
    "other_pressed": []
  },
  "click_count": 1,
  "modifiers": {
    "shift": false,
    "ctrl": false,
    "cmd": false,
    "opt": false,
    "fn": false,
    "caps_lock": false
  }
}
```

Proposed scroll event:

```json
{
  "input_schema_version": 2,
  "type": "scroll_wheel",
  "event_kind": "scroll",
  "phase": "scroll",
  "device": "mouse",
  "timestamp_monotonic_ms": 123456790.10,
  "sequence": { "source": "daemon", "value": 43 },
  "native": { "x": 532, "y": 388 },
  "desktop_world": { "x": 717, "y": 388 },
  "coordinate_authority": "daemon",
  "display_id": 1,
  "topology_version": 17,
  "scroll": { "dx": 0, "dy": -11.5, "unit": "point" },
  "modifiers": {
    "shift": false,
    "ctrl": false,
    "cmd": false,
    "opt": false,
    "fn": false,
    "caps_lock": false
  }
}
```

Proposed key event:

```json
{
  "input_schema_version": 2,
  "type": "key_down",
  "event_kind": "key",
  "timestamp_monotonic_ms": 123456791.00,
  "sequence": { "source": "daemon", "value": 44 },
  "key": {
    "physical_key_code": 53,
    "logical": "Escape",
    "repeat": false,
    "is_printable": false
  },
  "modifiers": {
    "shift": false,
    "ctrl": false,
    "cmd": false,
    "opt": false,
    "fn": false,
    "caps_lock": false
  }
}
```

Proposed cancel event:

```json
{
  "input_schema_version": 2,
  "type": "pointer_cancel",
  "event_kind": "cancel",
  "phase": "cancel",
  "timestamp_monotonic_ms": 123456792.00,
  "sequence": { "source": "toolkit", "value": 45, "synthetic": true },
  "caused_by_sequence": { "source": "daemon", "value": 44 },
  "gesture_id": "g-42",
  "cancel_reason": "surface_removed"
}
```

Rules:

- `native` is always in global CG/display coordinates.
- `desktop_world` is optional on raw daemon events, but required on toolkit
  routed events. If the daemon omits it, the toolkit input adapter derives it
  from `native` and `topology_version`.
- `coordinate_authority` identifies who produced `desktop_world`: `daemon` when
  emitted by the daemon, `toolkit` when derived by toolkit, and omitted when no
  DesktopWorld coordinate is present yet.
- `timestamp_monotonic_ms` is monotonic process time, not wall-clock time.
- `sequence` is a typed per-source ordering object, not a global total order.
  Daemon events use
  `{ "source": "daemon", "value": N }` with monotonically increasing numeric
  values. Synthetic events use their producer as `source`, set
  `synthetic: true`, and include `caused_by_sequence` when produced in response
  to another event.
- Toolkit must order a synthetic cancel immediately after `caused_by_sequence`
  and before later events for the same `gesture_id`. Synthetic cancels should not
  share or replace the daemon event sequence.
- `gesture_id` groups down/drag/up/cancel for the physical pointer sequence when
  the daemon can assign it. `gesture_id` is optional on raw daemon pointer
  events during convergence. Toolkit must synthesize a stable `gesture_id`
  before routing an owned pointer event or sending `capture.start`, and routed
  pointer/cancel events must include it.
- `topology_version` follows the topology rules below.
- `phase` is scoped by `event_kind`: pointer events use `down`, `move`, `drag`,
  or `up`; scroll events use `scroll`; cancel events use `cancel`; key events do
  not use `phase`.
- Scroll events always include `scroll.dx`, `scroll.dy`, and `scroll.unit`.
  PR 1 should fix macOS daemon scroll fixtures to `unit: "point"`; other units
  are rejected until a producer explicitly supports them.
- Keyboard events include `key.physical_key_code`, `key.logical`, `key.repeat`,
  `key.is_printable`, and modifier state. `physical_key_code` is the primary
  field for daemon emergency chord matching; `logical` is for display,
  diagnostics, and layout audit.
- Existing payloads without `input_schema_version` remain accepted during
  convergence and are adapted by toolkit into the v2 internal shape.

Event-kind field requirements:

| Event kind | Required fields | Optional fields | Notes |
| --- | --- | --- | --- |
| `pointer` | `input_schema_version`, `event_kind`, `type`, `phase`, `device`, `timestamp_monotonic_ms`, `sequence`, `native`, `display_id`, `topology_version`, `button`, `buttons`, `modifiers` | `desktop_world`, `coordinate_authority`, `gesture_id`, `click_count` | Used for left/right/middle/other down, drag, move, and up. `desktop_world` is required after toolkit adaptation. |
| `scroll` | `input_schema_version`, `event_kind`, `type`, `phase`, `device`, `timestamp_monotonic_ms`, `sequence`, `native`, `display_id`, `topology_version`, `scroll`, `modifiers` | `desktop_world`, `coordinate_authority`, `gesture_id` | `phase` is `scroll`. `scroll.unit` must be present. |
| `key` | `input_schema_version`, `event_kind`, `type`, `timestamp_monotonic_ms`, `sequence`, `key`, `modifiers` | `native`, `display_id`, `topology_version`, `desktop_world` | `key.physical_key_code`, `key.logical`, `key.repeat`, and `key.is_printable` are required inside `key`. Coordinates are optional and only describe current pointer/focus context. |
| `cancel` | `input_schema_version`, `event_kind`, `type`, `phase`, `timestamp_monotonic_ms`, `sequence`, `cancel_reason` | `caused_by_sequence`, `native`, `display_id`, `topology_version`, `desktop_world`, `coordinate_authority`, `gesture_id`, `button`, `buttons`, `modifiers` | Used when the OS cancels, display topology changes mid-gesture, owner surface disappears, or toolkit injects cancel. |

Toolkit routed envelope requirements:

| Envelope | Required fields | Conditional fields | Notes |
| --- | --- | --- | --- |
| `aos_routed_input` | `routed_schema_version`, `event_kind`, `type`, `delivery_role`, `sequence`, `gesture_id`, `desktop_world`, `coordinate_authority`, `source_event` | `region_id` required for `owned` and `captured`; `capture_id` required for `captured`; `cancel_reason` required for cancel; `button`/`buttons` required for pointer | This is the only event shape app behavior should consume. `source_event` may be an embedded v2 raw event or a stable reference to one. |

Right/middle/other pointer types must not be collapsed into left-button phases.
The schema should support at least `left`, `right`, `middle`, and `other:N` for
`button`. `buttons` should include fixed `left`, `right`, and `middle` booleans
plus `other_pressed`, an array of numeric or string other-button identifiers.

## Topology Version Lifecycle

The daemon should maintain a monotonically increasing `topology_version` for
display geometry.

Rules:

- Increment `topology_version` whenever the daemon's display geometry snapshot
  changes.
- Include `topology_version` on every pointer/scroll event and every
  `display_geometry` snapshot.
- Toolkit keeps display snapshots by `topology_version` with a minimum LRU depth
  of four, and must retain any snapshot referenced by a buffered event or active
  capture until that event is routed/dropped or that capture releases/cancels.
- If an input event includes `desktop_world`, toolkit may use it directly only
  if `coordinate_authority` is `daemon` and its `topology_version` matches a
  known snapshot. Daemon authority does not bypass topology consistency.
- If an input event omits `desktop_world`, toolkit derives it from `native`
  using the matching cached topology.
- If no matching topology snapshot exists, toolkit requests or waits for a fresh
  `display_geometry` snapshot before routing the event.
- Toolkit may buffer events while waiting for matching topology for at most
  `topology_stale_buffer_ms`. The initial placeholder is 50 ms, but PR 3 must
  measure real multi-display `displayDidReconfigure` settle times and set the
  default from that evidence before this ships as product behavior.
- Buffered daemon events remain sorted by daemon `sequence.value`; toolkit must
  not route daemon event `N+1` before daemon event `N` for the same
  pointer/gesture. Synthetic toolkit events are ordered by causal insertion:
  immediately after `caused_by_sequence` and before later daemon events for the
  same `gesture_id`. There is no global comparator across unrelated sources.
- If the matching topology does not arrive within the configured buffer,
  toolkit cancels the active capture if one exists and drops otherwise-routable
  pointer/scroll events for that stale topology.
- Dropped stale events are recorded in router diagnostics with `sequence`,
  `topology_version`, and reason.
- Consumers do not receive stale dropped events as behavior-driving input.
  Diagnostics subscribers may opt in to a non-behavioral drop event with
  redacted metadata for debugging missed-click reports.
- Toolkit records telemetry counters for stale-topology buffering, timeout
  drops, injected cancels, and continued captures after topology transitions.
- If topology changes during an active pointer capture and the next event cannot
  be mapped confidently, toolkit injects `cancel` for the captured region.
- If topology changes but both old and new snapshots map the native point to the
  same DesktopWorld point within a small tolerance, toolkit may continue the
  capture and record the topology transition for diagnostics.

This makes daemon-emitted `desktop_world` permanently optional at the raw event
boundary, but not optional at the app-routing boundary. Apps receive
DesktopWorld coordinates after toolkit adaptation.

Open schema decisions:

- Whether future non-macOS or non-wheel producers need additional scroll units
  beyond the PR 1 macOS `point` unit.

### Toolkit

The toolkit should own input normalization and arbitration:

- native-to-DesktopWorld conversion
- region registration and priority
- pointer capture from down through up/cancel
- duplicate-stream suppression
- outside-click policy hooks
- scroll routing
- shortcut routing
- editable-control exceptions for text input
- transparent interaction surface creation and placement

The existing `createDesktopWorldInteractionRouter` is the seed of this model,
but it should become the standard input path rather than a menu-local helper.

Toolkit may also provide optional composed patterns above primitives. For
example, a future `InteractiveAnchor` or `HitRegionSurface` could combine an
`InteractionSurface`, a router region, pointer capture, shape-aware
`contains(point)`, cursor affordance, cleanup, and debug snapshots into one
common helper.

That helper would be appropriate for Sigil's avatar and for other apps with
floating handles, inspectors, palettes, draggable affordances, or radial menus.
It should not move product semantics into toolkit: "drag release means fast
travel" remains Sigil behavior, while "press/drag/release/cancel on a shaped
region" can be reusable toolkit behavior.

Required router API changes:

- Accept v2/adapted events with nested `native`, `desktop_world`, `button`,
  `buttons`, `gesture_id`, `capture_id`, `delivery_role`, and `cancel_reason`
  fields.
- Route `left`, `right`, `middle`, and `other:N` pointer buttons without
  conflating them.
- Emit hover, enter, leave, and hover-cancel events for registered regions so
  apps can visually cue the effective interactive footprint even when the native
  surface frame is rectangular.
- Assign a toolkit `capture_id` when a region wins pointer down.
- Preserve daemon `gesture_id` when present and include both ids in routed
  events.
- `capture_id` is required in `aos_routed_input` events with
  `delivery_role: "captured"` and omitted for raw daemon `input_event`.

- Inject `cancel` to the captured region when the owner surface is removed,
  suspended, disabled, or loses a valid topology mapping.
- Expose a `releaseCapture(capture_id, reason)` API for lifecycle and emergency
  paths.
- Expose route snapshots for debugging: active region id, `capture_id`,
  `gesture_id`, source event version, and last topology version.
- Keep outside-click behavior as policy layered on top of routing.

## Daemon/Toolkit Capture Handshake

Toolkit-owned capture state must be visible to the daemon at a generic surface
level so the daemon can make conservative consume decisions without knowing app
semantics.

Handshake:

1. `capture.start`: toolkit tells the daemon a region won pointer down.
   Payload: `capture_id`, owner canvas id, owner surface/window id when
   available, `gesture_id`, starting daemon `sequence`, native down point, and
   timeout. The `capture.start` delivery must be ordered before later
   drag/up events for the same daemon `gesture_id` can be consumed under the
   capture. If ordering cannot be guaranteed, the daemon must fall back to "do
   not consume" and toolkit must inject cancel or recover the gesture.
   The initial pointer-down is consumed based on surface ownership before
   capture exists. Drag/up consumption then moves to capture ownership after
   `capture.start` is acknowledged/ordered.

2. `capture.update`: fixed-cadence heartbeat from toolkit while drag continues.
   Payload: `capture_id`, latest daemon `sequence`, latest native point, and
   owner still alive flag. The heartbeat proves the renderer/toolkit owner is
   alive; it is not required for every drag event because the daemon already
   observes those independently.
3. `capture.release`: toolkit tells the daemon the capture ended normally on
   up. Payload: `capture_id`, ending daemon `sequence`, and reason `up`.
4. `capture.cancel`: toolkit or daemon cancels capture because the owner surface
   was removed, suspended, disabled, lost topology mapping, timed out, or an
   emergency command ran. Payload: `capture_id`, `cancel_reason`, and
   `caused_by_sequence` when applicable.
5. `capture.timeout`: daemon expires a capture if no update/release/cancel
   arrives before the declared timeout. The timeout default must be
   config-backed and set from PR 3 timing data. A reasonable starting model is
   `timeout = heartbeat_cadence * 3 + handshake_rtt_budget`.

Rules:

- The daemon may consume drag/up events for an active capture only when
  `capture_id` is known, the owner surface still exists and is interactive, and
  the capture has not timed out.
- Toolkit remains the owner of region-level capture semantics. The daemon only
  tracks enough generic ownership to avoid over-consuming or missing a drag.
- If daemon and toolkit disagree on capture state, the daemon stops consuming
  and emits or requests cancel. Ambiguous means do not consume.
- If the daemon times out a capture, it sends an explicit daemon-to-toolkit
  `capture.cancel`/timeout event before later drag/up events can be routed for
  that capture.
- Renderer or toolkit IPC disconnect is an immediate capture-cancel signal and
  should not wait for heartbeat timeout.
- Capture handshake state is observable in diagnostics but does not include app
  region names unless toolkit explicitly marks them safe for debugging.

### Apps

Apps should declare regions and react to semantic pointer/key phases:

- avatar region: press, drag, release, cancel
- menu region: click, slider drag, scroll, back, close
- debug/proof regions: dismiss, dim, clear

Apps should not cast DOM `screenX`, `clientX`, or stale child-canvas frames into
authoritative app coordinates.

## Keyboard Boundary

Keyboard input should follow the same model for commands, with one important
exception: default app-surface routing is not the same thing as raw platform
capability.

AOS should preserve powerful input primitives for future agent harnesses, but
the default toolkit keyboard path should stay conservative. The Sigil
convergence slice should route daemon-reserved chords and app commands, while
leaving normal text composition to DOM/WebView. A future raw keyboard/input
observation capability can be added as an explicit opt-in primitive, profile, or
specialized toolkit module with its own permission, policy, privacy, and testing
requirements. It should not be the default `InteractionSurface` router contract.

This keeps the platform open for unusual agent harnesses without making every
AOS app surface responsible for raw-keyboard complexity.

Keyboard handling should be split into three tiers.

### Tier 1: Daemon-Reserved Shortcuts

These must work even if a canvas has covered the screen or app JavaScript is
wedged:

- `Ctrl+Option+Command+.`: emergency dim all AOS display surfaces to opacity
  `0.2`.
- `Ctrl+Option+Command+Shift+.`: clear debug/proof overlays and restore normal
  opacity/window levels.
- `Ctrl+Option+Command+Escape`: hard cancel active AOS pointer capture.
- `Ctrl+Option+Command+/`: optional diagnostics capture/input dump.

These commands need a daemon-owned command path. Toolkit routing alone is not
enough. Chords are matched primarily by physical key code plus modifiers so they
survive non-US keyboard layouts; diagnostics should also record the logical key
name for audit/debugging.

The chords should be config-backed from day one, even if the defaults above ship
initially. Installed mode may disable or remap them through config, but repo mode
should keep them enabled by default for recovery. Before landing defaults, audit
macOS system shortcuts, common accessibility tools, and non-US keyboard layouts.
The audit must include VoiceOver chords, common accessibility utilities, and at
least US, UK, AZERTY, and Dvorak layouts, with both physical and logical key
reports captured.

Diagnostics capture/input dump is sensitive. It should be opt-in or repo-mode
only by default, redact typed text and printable key sequences, include only
recent structural input metadata unless explicitly expanded, and write artifacts
under the runtime-mode state directory with clear retention/cleanup behavior.

### Tier 2: Toolkit/App Shortcuts

Toolkit and app code should own normal command routing:

- Escape/cancel
- menu navigation shortcuts
- global app shortcuts
- modifier state
- debug/proof escape hatches

The toolkit router should decide whether a key event becomes a semantic app
action such as `cancel`, `menu.back`, `confirm`, or `shortcut.toggle`.

### Tier 3: DOM Editable-Control Passthrough

DOM should own text composition inside focused editable controls:

- text fields
- textareas
- contenteditable
- IME composition
- dead keys
- selection and clipboard editing
- accessibility text editing

For the Sigil convergence slice, AOS should use chord-only keyboard routing:
daemon/toolkit route daemon-reserved chords and explicit app shortcuts, but do
not globally route bare printable keys. DOM/WebView keeps normal text
composition by default.

The editable-control exception must include focus loss, clipboard shortcuts,
selection movement, IME composition start/update/end, dead keys, and
accessibility text editing. Those should not be reimplemented in toolkit unless
AOS introduces a dedicated text-input primitive.

Non-goal for this proposal: define the full raw keyboard/input stream API for
agent harnesses. This proposal should leave room for that capability, but Sigil
does not need it and this staged plan should not block on it.

The daemon may still expose printable key observations to an explicitly
permissioned future raw-input subscriber with `delivery_role: "observed"` and
privacy controls. That observation path must not make printable keys
behavior-driving input for default app surfaces.

## Agent Activity Visual Annotation

AOS should preserve a clear distinction between agent embodiment and visual
annotation. When an agent acts through `aos do` or an equivalent action
primitive, the real macOS cursor/keyboard path should be used at the lowest
software level macOS allows. Renderer-only test injection is useful for state
machine tests, but it is not proof that the agent inhabited the user's mouse or
keyboard.

Apps such as Sigil may want to decorate agent-driven activity without replacing
the OS cursor, text caret, app border, display edge, or focused target. The
target shape is:

```text
daemon action/input state
  -> toolkit activity/annotation helpers
  -> app-specific renderer style
```

The daemon should own factual activity state, such as:

- actor/source: user, agent, script, or mixed
- action phase: planned, moving, dragging, clicking, typing, complete, cancelled
- pointer position in native and DesktopWorld coordinates when available
- target display/window/app/element facts when available
- caret rectangle/focus facts when available and privacy-safe
- correlation with the originating action request or input event sequence

Toolkit may later provide reusable annotation helpers for coordinate mapping,
target-frame normalization, smoothing, TTL/fade, and multi-display projection.
Those helpers should not prescribe a product visual language.

Apps own presentation. Sigil can render aura, cursor-adjacent chrome, caret
flair, border glows, display-edge treatments, trails, or other visual language
from the same primitive facts. Another app may render a quieter or entirely
different annotation convention.

This proposal does not define the final `agent_activity` or `action_activity`
schema. That schema should be added under `shared/schemas/` when implementation
starts. The design constraint recorded here is that activity annotation must not
replace OS input primitives, must not depend on app JavaScript for emergency
recovery, and must respect privacy boundaries around text input, secure fields,
and caret/focus inspection.

## InteractionSurface Lifecycle

`InteractionSurface` should start as a minimal lifecycle primitive, not a
semantic routing primitive.

Responsibilities:

- create/update/remove a transparent AOS-owned native surface
- configure frame in native coordinates
- configure interactivity/click-through
- configure window level
- configure cursor affordance where supported
- expose parent/owner canvas id
- support suspend/resume and owner cascade cleanup
- recover or report duplicate/orphaned surfaces
- support multi-display placement through explicit frames

Non-goals:

- no gesture interpretation
- no app semantic routing
- no DOM-coordinate authority
- no fast-travel/menu/slider concepts

Required lifecycle rules:

- If the owner canvas is removed, the surface is removed.
- If the owner canvas is suspended, the surface becomes non-interactive or moves
  offscreen.
- If the surface is removed during pointer capture, toolkit receives a cancel
  event for the captured region.
- If the daemon restarts and discovers orphan surfaces, they are either removed
  or reconciled with their owner.
- A surface must not steal keyboard focus unless explicitly configured to do so.
- Z-level and click-through behavior must be tested on both main and extended
  displays.

## Sigil Convergence Delta

The near-term Sigil convergence would be:

1. Define and adapt the v2 `input_event` shape while bridging current pre-v2
   input events.
2. Remove or replace daemon `shouldConsumeSigilInputEvent` with generic
   canvas/input ownership policy.
3. Move `createHitTargetController` into toolkit as an `InteractionSurface`
   primitive.
4. Strip `hit-area.html` so it no longer emits left-button drag streams as a
   competing coordinate source.
5. Register the avatar as a toolkit interaction region.
6. Register the context menu as a region in the same router, not a separate
   downstream special case.
7. Route fast travel exclusively from toolkit `down/drag/up/cancel` events in
   DesktopWorld coordinates.
8. Add a toolkit keyboard router for Escape, menu back, and app-level shortcuts.
9. Add daemon-reserved emergency opacity dim/clear behavior outside app JS.
10. Keep DOM text input behavior for real editable controls.

This is not just a small wiring change. `apps/sigil/renderer/live-modules/main.js`
currently owns a hand-rolled press/drag/goto/fast-travel state machine with more
than one pointer source. The Sigil migration should therefore be split so the
context-menu right-click/scroll work lands separately from avatar drag and
fast-travel convergence.

## Convergence Matrix

| Event / behavior | Current source | Target source | Convergence rule |
| --- | --- | --- | --- |
| Left down | Daemon plus hit-canvas DOM emission; Sigil now ignores hit left events | Daemon `input_event` routed by toolkit | Use a temporary convergence adapter for current pre-v2 payloads only until v2 schema is live |
| Left drag | Daemon plus hit-canvas DOM emission; hit events ignored for fast travel | Daemon `input_event` routed to captured region | Remove DOM left drag after extended-display tests pass |
| Left up | Daemon plus hit-canvas DOM emission; hit events ignored for fast travel | Daemon `input_event` routed to captured region | Cancel capture if owner surface disappears before up |
| Right click | Daemon and hit-canvas DOM convergence paths | Daemon `input_event` routed by toolkit | Remove hit convergence path when context-menu route is proven |
| Wheel | Daemon when available plus hit-canvas DOM convergence path | Daemon `input_event` with scroll delta routed by toolkit | Remove DOM wheel path when scroll delta schema/tests exist |
| Middle/other buttons | Not designed as a first-class app route | Daemon `input_event` with `button`/`buttons`, routed by toolkit | No semantic app behavior until explicit region handlers opt in |
| Pointer cancel | Not a complete platform contract today | Daemon/toolkit cancel event | Required for canvas remove/suspend/crash mid-drag |
| Escape | Raw `key_down` in Sigil | Toolkit/app shortcut action, with daemon emergency tier separate | Use a temporary convergence adapter until toolkit shortcut routing is active |
| Emergency dim | Not implemented; issue #132 tracks need | Daemon-reserved command path | Must not depend on app JS |
| Text input | DOM/WebView behavior | DOM/WebView behavior with toolkit passthrough policy | Do not route printable text away from editable controls |
| Focus changes | Mostly WebView/OS behavior | Explicit toolkit focus/editable state where needed | Must not steal focus for transparent surfaces |

## Evaluation Options

### Option A: Patch Current Sigil-Local Model

Patch Sigil's current hand wiring without converging it onto the platform
contract.

Benefits:

- Lowest immediate implementation cost.
- Minimal churn during wormhole/context-menu work.
- Avoids changing toolkit contracts before they are fully proven.

Costs:

- Input ownership remains ambiguous.
- Future apps will likely copy Sigil-specific hit-canvas patterns.
- Cross-display and mixed-DPI regressions remain easier to reintroduce.
- Emergency shortcuts and debug overlays remain app-specific.

### Option B: Toolkit-First Contract

Promote interaction surfaces and input routing into toolkit, then migrate Sigil
onto the contract.

Benefits:

- Aligns with primitives-first architecture.
- Keeps daemon generic and apps semantic.
- Gives every AOS app one coordinate and routing model.
- Directly addresses duplicate pointer stream and stale DOM-coordinate bugs.
- Creates a natural place for keyboard shortcut and emergency-dim behavior.

Costs:

- Requires a careful migration plan.
- Toolkit APIs need sharper names and tests.
- Sigil must be changed while active wormhole/menu work is still in motion.
- Bounded convergence adapters may be needed while producers and consumers move
  to the v2 contract.

### Option C: Daemon-Registered Regions

Move region registration and hit testing into the daemon.

Benefits:

- Strongest single-source model.
- Could eliminate child hit canvases for many use cases.
- Lets the daemon emit already-routed semantic region events.

Costs:

- Highest complexity.
- Pushes app/toolkit concerns into the primitive layer too early.
- Harder to iterate on menu, slider, and app-specific policy.
- Risks overfitting daemon behavior to Sigil's current needs.

## Recommendation

Adopt Option B now: a toolkit-first input contract.

Do not move region semantics into the daemon yet. The daemon should publish
hardware facts. Toolkit should normalize, route, and arbitrate. Sigil should be
the first consumer migrated onto the contract.

This gives us one clean lower-level model without prematurely freezing
daemon-level region semantics or making Sigil's product opinions mandatory for
future apps.

Implementation should prioritize the pieces Sigil needs today: pointer routing,
hit-surface ownership, cross-display coordinate continuity, and menu/fast-travel
predictability. Broader keyboard, diagnostics, and non-primary device work should
land only when required by the staged gates or by another concrete consumer.

## Acceptance Criteria

A review panel should consider the proposal successful if the resulting design
can satisfy these criteria:

- `input_event` has a versioned schema covering coordinates, timestamp, button,
  scroll, key repeat, modifiers, cancel semantics, and topology versioning.
- `input_event` required/optional fields are specified per event kind.
- Raw daemon `input_event` and toolkit `aos_routed_input` envelopes are
  separately named so apps cannot accidentally bypass routed delivery roles.
- Routed coordinate provenance is explicit through `coordinate_authority`.
- Current pre-v2 input payloads have explicit convergence adapters with owners,
  test gates, and removal deadlines.
- Sigil-specific daemon input consumption is removed or isolated behind a
  generic canvas/input ownership policy.
- Generic daemon consume policy is based on canvas/window identity,
  interactivity, z-level, and active capture, not app state.
- Consumed AOS pointer events are still delivered to AOS subscribers/routed app
  handlers, while daemon-reserved emergency chords are not routed as normal app
  shortcuts.
- AOS-owned app behavior has one authoritative pointer stream.
- Left-button drag behavior cannot be driven by DOM hit-canvas coordinates.
- Toolkit routed events include hover/enter/leave so rectangular
  `InteractionSurface` footprints can be reflected in app visual feedback.
- Pointer capture has exactly one logical owner from down through up/cancel.
- Pointer capture cancels cleanly when a canvas/surface is removed, suspended, or
  crashes mid-drag.
- Synthetic cancel events have deterministic sequence ordering through
  typed `sequence` and `caused_by_sequence`.
- Routed captured events include `capture_id`, while raw daemon events do not.
- Cross-display drags preserve DesktopWorld continuity.
- Topology/event races have config-backed stale-snapshot buffering, ordered
  delivery by typed `sequence`, drop/cancel behavior, diagnostics, and
  telemetry.
- Context-menu sliders, menu scrolling, avatar drag, and fast travel all use the
  same routed event model.
- Emergency dim works through a daemon-owned path even when a canvas overlay or
  app JavaScript is visually broken.
- Emergency key chords are config-backed and collision-audited before becoming
  defaults.
- Diagnostics dumps redact sensitive input by default and are opt-in or
  repo-mode-only unless explicitly configured otherwise.
- Escape routes through toolkit/app shortcut handling unless it is reserved by a
  daemon emergency mode.
- Text input still supports native DOM editing behavior.
- Raw printable-key observation for future agent harnesses is explicitly outside
  the default toolkit app-surface router and requires a separate opt-in
  capability design before use.
- Agent-driven visual annotation is treated as decoration of real daemon/action
  facts, not as a replacement for OS cursor/keyboard primitives.
- Toolkit tests cover region priority, capture, outside-click, scroll, duplicate
  stream suppression, and keyboard shortcut arbitration.
- Sigil tests cover avatar drag, fast travel release, menu controls, scroll, and
  extended-display interaction.
- Daemon/toolkit tests cover click-through surfaces, non-interactive surfaces,
  overlapping AOS surfaces at different window levels, and ambiguous hit
  ownership falling back to "do not consume".
- Canonical v2 schemas and fixtures live under `shared/schemas/`, covering
  pointer, scroll, key, cancel, current-shape adaptation, and stale-topology
  cases.

## Panel Review Questions

1. Is the daemon/toolkit/app responsibility split correct?
2. Should the transparent hit surface be a toolkit primitive, or should it stay
   app-owned until another app needs it?
3. Is Option B sufficient, or do we need daemon-registered regions sooner?
4. What global shortcuts should be reserved by AOS from day one?
5. Does the keyboard boundary correctly separate conservative default app
   routing from future opt-in raw input capability?
6. Should daemon emit DesktopWorld coordinates directly, or should it emit native
   coordinates plus topology version and let toolkit derive DesktopWorld?
7. What replaces current Sigil-specific daemon input consumption?
8. Which temporary convergence adapters are acceptable while Sigil converges?
9. What tests are required before removing Sigil's DOM left-button hit events?
10. What is the rollback path if unified routing regresses active Sigil work?
11. Are the proposed daemon-reserved key chords acceptable on macOS?
12. What is the convergence deadline for removing payloads without
    `input_schema_version`?
13. Should installed mode allow emergency chords to be disabled, or only
    remapped?
14. What stale-topology buffer duration should installed mode use by default?
15. Should capture heartbeat be required for every drag event or only at a fixed
    cadence?
16. Is raw keyboard/input observation correctly scoped out of the Sigil
    convergence slice while preserving a future extension point?

## Open Risks

- WebView focus behavior may complicate keyboard routing.
- Existing canvases may rely on DOM pointer behavior in subtle ways.
- The renderer IPC path for screenshot capture has shown fragility and should
  not be conflated with input routing, even though wormhole needs both.
- Emergency opacity/dim behavior needs a daemon-level path so it works when app
  JavaScript is wedged.
- Hit-surface z-level and click-through behavior must be tested on extended
  displays, not only the main display.
- Removing DOM left-button events before daemon input has a complete production
  event shape could break drag/menu behavior on extended displays or mixed-DPI
  setups.
- Global input capture can accidentally consume normal user/system input if
  capture ownership and cancel semantics are not strict.
- Right, middle, and other buttons are currently under-modeled in the router and
  must be added before they become first-class app routes.
- Topology/event races can route input into the wrong DesktopWorld point unless
  stale snapshot handling is explicit.
- Frontmost hittable AOS surface detection may be hard with transparent windows,
  click-through state, mixed window levels, and extended displays.
- Diagnostics/input dumps can expose sensitive input unless redaction and
  opt-in rules are enforced.
- Capture state split between daemon and toolkit can cause either missed drags
  or over-consumption if the handshake is incomplete or stale.
- Agent activity annotation can leak sensitive context if caret/focus metadata,
  typed text, secure fields, or target application details are published without
  explicit privacy rules.

## Staged Implementation

This work should land as separate PRs with test gates. The minimum first PR
should prove the architecture without changing live Sigil behavior.

### PR 1: Schema and Fixtures Only

- Add `shared/schemas/input-event-v2.schema.json`.
- Add fixtures for pointer, scroll, key, cancel, current-shape adaptation, and
  stale topology.
- Add mixed-source ordering fixtures covering daemon down/drag/up, toolkit
  synthetic cancel with `caused_by_sequence`, and later daemon events for the
  same `gesture_id`.
- Add negative fixtures for missing required fields per `event_kind`, invalid
  phase for an event kind, unsupported scroll unit, and missing `capture_id` on
  captured routed events.
- Add schema validation tests consumed by both Swift daemon tests and JS toolkit
  adapter tests so producer and consumer interpretations cannot drift.
- Do not change daemon emission or Sigil behavior.

### PR 2: Toolkit Adapter and Router Tests

- Add a toolkit convergence adapter from current payloads to v2 internal shape.
- Record adapter owner, test gate, and removal deadline in the PR.
- Add typed `sequence` handling.
- Add tests for right-click, middle/other button passthrough, cancel injection,
  stale-topology cancel, capture-id debug snapshots, and printable-key redaction
  in diagnostics.
- Do not change live Sigil behavior.

### PR 3: Frontmost Hittable Surface Spike

This is the load-bearing implementation spike for the consume model and should
run in parallel with PR 1 if possible, so empirical answers are available before
PR 4 commits to the daemon consume policy.

- Prove native-window hit ownership with overlapping AOS surfaces,
  non-interactive surfaces, click-through surfaces, different window levels, and
  extended displays.
- Determine whether the daemon can identify the frontmost hittable AOS surface
  at a native point without querying renderer app state.
- Measure real multi-display `displayDidReconfigure` settle time to set
  `topology_stale_buffer_ms` and capture timeout defaults.
- Verify whether rectangular surface-frame consumption produces acceptable
  behavior for Sigil's circular avatar semantic region.
- Acceptance: ambiguous ownership falls back to "do not consume".
- Do not migrate Sigil until this passes.
- Contingency if frontmost-hittable detection requires renderer app-state
  round-trips: do not ship generic consume policy in PR 4; either reduce the
  consume model to native AOS surface ownership only or design a separate
  daemon/toolkit hit-test handshake before Sigil migration.
- Contingency if display reconfiguration settle time is too large for responsive
  buffering: make topology-transition routing best-effort with explicit cancel
  and diagnostics instead of extending input buffering until interaction feels
  stuck.
- Contingency if rectangular footprint is unacceptable for the avatar: PR 6b
  must use tighter/multiple `InteractionSurface` placement or defer to a shaped
  surface primitive before removing the current path.

### PR 4: Generic Consume Policy and Capture Handshake

- Replace or isolate `shouldConsumeSigilInputEvent`.
- Add daemon/toolkit `capture.start`, `capture.update`, `capture.release`,
  `capture.cancel`, and timeout behavior.
- Add diagnostics for active `capture_id`, owner surface, latest sequence, and
  timeout state.
- Do not route Sigil through the new path in this PR.

### PR 5: InteractionSurface Primitive

- Add toolkit `InteractionSurface` around today's hit-target canvas lifecycle.
- Test owner cascade cleanup, suspend/resume, orphan recovery, focus behavior,
  click-through, and z-level.
- Leave Sigil behavior unchanged in this PR; DOM left event removal happens in
  PR 6b after the gate passes.

### PR 6a: Sigil Context-Menu Router Convergence

- Register the Sigil context menu in the toolkit router path behind a temporary
  convergence switch with a removal deadline.
- Remove right-click and wheel convergence paths once their daemon event schema
  and routing tests are proven.
- Verify context-menu click, scroll, range controls, submenu back, and extended
  display behavior.

### PR 6b: Sigil Avatar Drag and Fast-Travel Convergence

PR 6b must land against a stable wormhole/fast-travel rendering branch. If
wormhole rendering is still changing, pause this PR or establish an explicit
merge order with that workstream before changing `main.js` state-machine
wiring.

- Register the Sigil avatar region in the same router model.
- Remove left-button event delivery from `hit-area.html` only after v2 adapter
  and extended-display drag tests pass.
- Route press/drag/release/cancel and fast-travel release from one toolkit event
  stream in DesktopWorld coordinates.
- Leave wormhole rendering and capture behavior untouched except for consuming
  the cleaned fast-travel input stream.

## Convergence Guardrails

The migration may keep a short-lived convergence switch so active Sigil work is
not blocked while the new contract lands. The switch is not a supported second
contract. It must be local to Sigil, temporary, and tracked with an owner,
specific removal gate, and deadline:

- default to the new toolkit router only after the v2 adapter tests,
  interaction-router tests, and Sigil extended-display tests pass;
- temporarily route through the current path if any blocking regression appears
  in avatar drag, fast-travel release, context-menu click/scroll/range controls,
  or editable text input;
- log which path is active, active `capture_id`, `gesture_id`, and topology
  version in `__sigilDebug.snapshot()`;
- delete the context-menu convergence switch in the PR immediately after PR 6a
  verification passes;
- delete the avatar/fast-travel convergence switch in the PR immediately after
  PR 6b verification passes.

Convergence deadline: support for payloads without `input_schema_version`
should be removed in the PR immediately after PR 6b lands and one
extended-display Sigil verification pass succeeds. Do not use calendar time as
the cleanup trigger.
