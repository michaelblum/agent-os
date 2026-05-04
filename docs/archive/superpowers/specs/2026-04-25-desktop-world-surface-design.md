# DesktopWorldSurface — Design

Status: Draft (design only; no implementation)
Date: 2026-04-25
Supersedes (in part): `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md`
Builds on: `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md`,
`shared/schemas/spatial-topology.md`

## Context

`DesktopWorld` already works as a logical cross-display coordinate space.
`display_geometry` re-anchoring landed; `aos see list` and the canvas inspector
both consume DesktopWorld-anchored fields. The canvas inspector's mouse-events
overlay successfully models drags that cross display boundaries by working in
DesktopWorld coords.

The current `--track union` canvas, however, is implemented as **one oversized
native window**: a single borderless `NSWindow` plus one `WKWebView` whose frame
is the union of all display rects, with `constrainFrameRect` overridden so
AppKit lets it span (`src/display/canvas.swift:114-141`,
`src/display/canvas.swift:259-310`,
`src/display/canvas.swift:607-700`,
`src/display/canvas.swift:1429-1439`).

That physical strategy is unreliable on certain multi-display layouts (display
sleep/wake, mirroring transitions, GPU surface migration). The coordinate model
is fine; the **rendering model** is wrong.

## Problem

We need a primitive whose contract is "draw across DesktopWorld" but whose
implementation is one physical canvas per display. Consumers should see one
logical canvas id, one coordinate system, one lifecycle, one input/message
stream. The platform handles the physical fan-out.

This abstraction applies only to surfaces whose contract is desktop-spanning
(`avatar-main`, future global overlays, cursor trails). Normal panels remain
normal native canvases and let macOS handle display placement.

## Invariants

- DesktopWorld is the logical coordinate space. The new primitive does not
  introduce a parallel coordinate system.
- `--track union` continues to work for existing callers. The implementation
  underneath it changes; the CLI does not break.
- The daemon stays renderer-agnostic. It never needs to know whether a surface
  is DOM, Canvas2D, or Three.js. No `--renderer`, `--state-strategy`, or
  similar flags on the CLI in this spec.
- Per-frame state replication across web views is **not** assumed to be the
  implementation strategy. It is one option among others, to be validated.
- Normal panels are out of scope. This primitive applies only to the
  desktop-spanning case.

## Non-Goals

- Renderer-specific replication transports.
- Compositor-level Metal layer rendering.
- Changes to non-spanning canvases (`--at`, `--track <window>`,
  `--anchor-window`, `--anchor-channel`).
- Cursor trail or global-overlay product features. Those are future consumers
  of this primitive, not part of its contract.

## Primitive: `DesktopWorldSurface`

A `DesktopWorldSurface` is **one logical canvas backed by N physical segment
canvases**, where N equals the number of active displays at any moment. The
surface has:

- A single `canvas_id` that does not change for the lifetime of the surface.
- A coordinate system: DesktopWorld.
- A topology: a deterministically ordered list of segments, one per active
  display, each carrying its `display_id`, DesktopWorld bounds, and native
  bounds, plus its `index` in the ordered list.

The daemon does not designate a primary segment and does not emit a `role`
field on segment events. The ordering rule is fixed and total:

1. ascending DesktopWorld y of the segment's origin
2. then ascending DesktopWorld x of the segment's origin
3. then ascending `display_id` as a stable tiebreaker

This always yields a unique first segment as long as at least one segment
exists, regardless of whether DesktopWorld coordinate `(0, 0)` falls inside a
display rect or in a hole. Adapters that need a "primary" elect it from this
ordering (typically: index 0). The election is an adapter concern, not a
daemon concern.

Segments are an implementation detail of the surface. They are visible to
inspectors and to toolkit adapters. They are not separate canvases from a
consumer point of view: there is one `canvas_id`, one lifecycle stream, one
input stream, one message stream.

### Layer Ownership

```
┌─────────────────────────────────────────────────────────┐
│ App (e.g. Sigil renderer)                               │
│   • domain state (avatar position/appearance/behavior)  │
│   • composes a toolkit renderer adapter                 │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Toolkit                                                 │
│   • renderer adapters (per renderer family)             │
│   • how to render the same logical scene into each      │
│     segment using its viewport/camera                   │
│   • shared logical state model (state-shape, not        │
│     transport)                                          │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│ Daemon                                                  │
│   • logical surface id                                  │
│   • physical segment canvases (one per display)         │
│   • segment bounds (DesktopWorld + native)              │
│   • topology change handling                            │
│   • lifecycle aggregation                               │
│   • message fanout (post / eval)                        │
│   • (input continues via the existing global daemon-    │
│     routed input event stream in DesktopWorld coords;   │
│     the surface does not synthesize its own input)      │
└─────────────────────────────────────────────────────────┘
```

The daemon owns segment lifecycle and coordinate metadata. It does **not** own
renderer state. The toolkit owns the rendering pattern. The app owns domain
state.

## CLI & Schema

### CLI

`--track union` is reinterpreted internally to mean "create a
`DesktopWorldSurface`." No new mandatory flag. The existing call sites continue
to work:

```sh
aos show create --id avatar --url aos://sigil/renderer/index.html --track union
```

A canonical alias is added for new code and clarity in the inspector / docs:

```sh
aos show create --id avatar --url aos://sigil/renderer/index.html --surface desktop-world
```

`--surface desktop-world` and `--track union` are exact equivalents.

Current CLI mutex behavior (`src/display/client.swift:238-239`) is that
`--track` and `--at` cannot both be specified; the existing client does not
explicitly reject `--track` together with `--anchor-window` or
`--anchor-channel`. The new `--surface desktop-world` flag inherits that same
minimum: it is mutually exclusive with `--at`, matching what `--track union`
already enforces.

A stricter desired rule — `--surface desktop-world` mutually exclusive with
all of `--at`, `--track`, `--anchor-window`, and `--anchor-channel` — makes
sense because anchoring a desktop-spanning surface is incoherent. That rule
is recommended for the new flag and should be added during implementation;
calling it out here keeps the spec honest about the gap between current and
desired behavior. Existing `--track union` callers without anchors are
unaffected either way.

No `--renderer` or `--state-strategy` flag in this spec. Renderer adapter
choice happens inside the loaded web app.

### Daemon request schema

`shared/schemas/daemon-request.schema.json` (`ShowCreateData`) gains an
optional `surface: "desktop-world"` field as a peer of `track`. When either
`track == "union"` or `surface == "desktop-world"` is present, the daemon
constructs a `DesktopWorldSurface` instead of a single-window canvas. Existing
`track == "union"` callers are unaffected.

### Lifecycle channel

`canvas_lifecycle` keeps emitting one event per logical surface, keyed on the
single `canvas_id`. A new sub-event family is added under the same channel
for desktop-world surfaces:

```
canvas_segment_added    { canvas_id, display_id, index, dw_bounds, native_bounds }
canvas_segment_removed  { canvas_id, display_id }
canvas_segment_changed  { canvas_id, display_id, index, dw_bounds, native_bounds }
canvas_topology_settled { canvas_id, segments: [ { display_id, index, dw_bounds, native_bounds } ] }
```

`index` is the segment's position in the ordering rule above. After any
batch of add/remove/change events caused by a single topology update, the
daemon emits one `canvas_topology_settled` carrying the full new ordered
segment set. Subscribers can either follow individual deltas or wait for the
settled snapshot. Indexes are stable only within a snapshot, not across
snapshots — a hot-plug can shift index assignments.

**Subscription bootstrap ordering** (a normative contract, not an
implementation hint): when a subscriber attaches to `canvas_lifecycle`, the
daemon delivers, before any other event for a given desktop-world surface,
exactly one synthetic `canvas_topology_settled` carrying that surface's
current ordered segment set. After the bootstrap settled events, live
deltas (`canvas_segment_added`/`removed`/`changed`) and subsequent settled
events stream in normally. A subscriber therefore never has to ask "what is
the topology right now?" — it sees a settled event first, then deltas.

Sub-events are scoped to surfaces created with `surface == "desktop-world"`
(or the equivalent `track == "union"`). Normal canvases never emit them.

The `canvas_id`'s lifetime is independent of its segment set. A display
hot-plug does not destroy and recreate the surface.

### Snapshot in `CanvasInfo` and `aos show list`

Lifecycle deltas are not enough on their own. A late subscriber, an
`aos show list` invocation, or the canvas inspector at boot needs to see
the current segment set without waiting for the next topology event.

`CanvasInfo` (the response shape used by `aos show list` and other
introspection paths) gains a `segments` field for desktop-world surfaces:

```
CanvasInfo {
  id, kind, ...,
  segments?: [
    { display_id, index, dw_bounds, native_bounds }
  ]
}
```

`segments` is present on desktop-world surfaces and absent (or null) on
normal canvases. The values match what the most recent
`canvas_topology_settled` event carried for that surface.

`CanvasInfo.segments`, the bootstrap `canvas_topology_settled` events, and
post-bootstrap delta events must all be driven from a single source of
truth in the daemon's surface registry. This rules out a class of races
where a one-shot `aos show list` and a live subscriber disagree about
topology because they read from divergent caches.

## Input

For `DesktopWorldSurface` consumers whose contract is passthrough/visual
(notably `avatar-main` and any future global overlay), input continues to
come from the existing global daemon-routed input event stream — which today
emits coordinates in native screen space, not DesktopWorld. Consumers
(Sigil, canvas inspector, spatial telemetry) re-anchor those events into
DesktopWorld on the JS side using `nativeToDesktopWorldPoint` from
`packages/toolkit/runtime/spatial.js:*` and the latest `display_geometry`
snapshot. This is the current behavior described in
`docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md`.

The toolkit adapter base class normalizes input to DesktopWorld at the
**adapter boundary** before invoking `onInput(event)` on the app. The app
sees DesktopWorld coordinates; it does not deal with native coords or
re-anchoring. If and when the in-flight DesktopWorld input re-anchor plan
moves the normalization into the daemon, the adapter contract does not
change — adapters become a thin pass-through instead of a normalization
step, but apps continue to see DesktopWorld events.

The surface itself does **not** synthesize a per-segment input stream. The
daemon does not promise that an event delivered into a segment NSWindow
under the surface will be routed across to a sibling segment when a drag
crosses displays — segment NSWindows for a `DesktopWorldSurface` are
expected to be non-interactive (passthrough) at the macOS level. Consumers
that need interactivity inside a desktop-spanning surface use a normal
child canvas (e.g. the existing `avatar-hit` pattern), not the surface
itself.

This is a deliberate scope-limit. We are not redesigning interactive
desktop-spanning surfaces in this spec.

## Marks

Marks remain DesktopWorld-coordinate annotations. The daemon does not
translate marks into per-segment local coordinates. Translation, if needed,
is a renderer adapter concern. This keeps marks usable as world-space debug /
state telemetry without coupling them to physical segmentation.

## Inspector & Introspection

`aos show list` and the canvas inspector treat a `DesktopWorldSurface` as one
row, expandable to show its segment set (sourced from `CanvasInfo.segments`):

```
[surface ] avatar             desktop-world   3 segments
            └─ [0] display D1  dw(0,0,1920,1080)
            └─ [1] display D2  dw(1920,0,1920,1080)
            └─ [2] display D3  dw(0,1080,1920,1080)
```

The bracketed integers are the segment indexes from the ordering rule. The
inspector's existing cross-display drag visualization is unchanged: it
already operates in DesktopWorld coordinates and is surface-agnostic.

## Message Streams: Logical vs. Per-Segment Delivery

There is **one logical message stream per surface** at the caller-facing API
level. `aos show post --id avatar <payload>` and `aos show eval --id avatar
<script>` are single logical operations against a single `canvas_id`. Callers
do not address segments and do not need to know how many displays are
attached.

Internally, the daemon **delivers** the message into every segment's web view
because each web view runs its own JS context. This is implementation, not
contract: the caller-facing semantics is "one post." Adapters and apps are
responsible for deciding what each segment does on receipt.

The default safe pattern, recommended for any scene-mutating logic:

- App boot inside a segment runs the toolkit adapter's `onInit`, which
  exposes the segment's `index` and ordered topology.
- Side-effecting code — domain state mutation, subscriptions, mark
  heartbeats, hit-target creation, network calls, anything that should run
  *once per surface* rather than *once per segment* — runs only when the
  segment is the elected primary (typically `index === 0`).
- Pure-render code — applying shared logical state to the local
  viewport/camera and drawing — runs in every segment unconditionally.

This is the same pattern as leader election in any replicated system. The
spec does not mandate `index === 0` as the election rule, but it does
mandate that *some* deterministic election happens and that scene-mutating
logic does not accidentally fan out to N segments.

`eval` carries a special hazard: an `eval`-injected script that mutates
shared state (e.g. `aos show eval --id avatar 'mySurface.setAvatarPosition(...)'`)
will, by default, run in every segment. The toolkit adapter base class
should expose a helper such as `surface.runOnPrimary(fn)` so eval payloads
can express "do this once per surface" without each consumer reinventing
the gate.

**`eval` return-value semantics.** `aos show eval --id <surface>` is a
single logical operation and returns a single result to the caller, even
though the script ran in N segment web views. The contract:

- The daemon executes the script in every segment.
- The daemon waits for all segment results (or a per-segment timeout) and
  returns the **elected primary segment's result** to the caller. Other
  segment results are discarded.
- If the elected primary's segment errors or times out, the eval returns
  that error/timeout — the daemon does not silently fall back to a
  follower's result. This keeps the caller's mental model identical to a
  single-canvas eval.
- Scripts wrapped in `runOnPrimary(fn)` resolve to `fn`'s return value on
  the primary and to `undefined` on followers; the caller still sees the
  primary's value because of the rule above.
- A debugging-oriented per-segment results variant is out of scope for
  this spec; if needed later, it should be a distinct subcommand or flag
  rather than a different default.

`post` carries the same hazard at a lower amplitude (most consumers route
posts into a state diff that is idempotent). `post` is fire-and-forget —
no return value semantics to define — but adapter authors should still
prefer the `runOnPrimary` pattern for any post handler that mutates state
rather than just reads it.

## Multi-WebView Boot Contract

Loading the same app URL into N segment web views means N copies of
boot-time code run. Today, Sigil's renderer at boot does:

- subscribes to `display_geometry` and other channels
  (`apps/sigil/renderer/live-modules/main.js:485-507`)
- registers mark heartbeats
- creates hit-target child canvases
- initializes Three.js scene + animation loop

If all of that runs N times, the surface ends up with N parallel
subscriptions, N redundant heartbeats, N hit-target canvases on top of
each other, and N animation loops fighting over shared state.

The spec mandates a contract, leaving implementation detail to the toolkit
adapter and to the app:

1. **Topology-aware boot.** The toolkit adapter exposes the segment's
   ordered position and the full topology to the app at `onInit`. The app
   *must* gate its boot-time side effects on segment role.
2. **Once-per-surface side effects run on the elected primary only.** This
   includes: subscriptions whose handlers mutate shared state; mark
   heartbeats; hit-target child canvas creation; outbound `tell`/`post`
   that represents the surface as a whole.
3. **Per-segment side effects run in every segment.** This includes:
   creating the local renderer, sizing the local canvas/camera to the
   segment's bounds, attaching local input listeners (if any).
4. **Re-election on topology change.** When `canvas_topology_settled`
   reassigns the primary (because a display was removed and the previous
   primary's segment is gone), the new primary's web view must take over
   primary-only side effects. The toolkit adapter is responsible for
   driving a `becamePrimary` / `lostPrimary` callback into the app so it
   can start subscriptions / cancel them, recreate child canvases, etc.

This contract is conceptual in this spec and concrete in the toolkit
adapter that follows. The Sigil migration must satisfy it explicitly:
identify each side effect in the current renderer boot, classify it
(once-per-surface vs. per-segment), and place it on the right side of the
gate.

## Toolkit-Side Renderer Adapters (Contract Only)

The toolkit ships a base contract that adapters implement. The daemon never
sees this; it is purely a JS-side abstraction over the segment set the daemon
exposes through subscriptions inside the web view.

Sketch of the contract:

```
class DesktopWorldSurfaceAdapter {
  // Called once per segment web-view at boot, with the segment's identity
  // and the full ordered topology. The adapter exposes both to the app so
  // it can gate primary-only side effects per the multi-webview boot
  // contract.
  onInit({ segment, topology, surface }): void

  // Called when topology changes (segment added/removed/resized).
  // Adapter rebuilds its local viewport/camera as needed. If primary
  // election changes, the adapter also fires becamePrimary / lostPrimary
  // into the app.
  onTopologyChange(topology): void

  // Called when shared logical state updates. Shape is adapter-defined.
  onStateUpdate(state): void

  // Called with input events in DesktopWorld coordinates.
  onInput(event): void

  // Helper: run fn only when this segment is the elected primary.
  // Used by app boot code and by eval handlers that must not fan out.
  runOnPrimary(fn): void
}
```

Two adapters are anticipated. The 2D adapter renders the same scene with a
per-segment translation. The Three.js adapter renders the same scene with a
per-segment camera/viewport.

**Replication transport is intentionally not specified here.** The user's
explicit guidance: prefer a model where every segment runs the same renderer
against shared logical state and renders its own viewport, rather than a
primary-streams-frame-diffs model. Whether shared state propagates over the
existing `post` channel, a dedicated low-latency replication channel, or
shared `BroadcastChannel`/`SharedWorker` is a validation question, not a
decided implementation detail.

The Three.js adapter is treated as a **validation spike** in this spec, not a
deliverable. See "Validation Spikes" below.

## Migration Shape

| Surface | Today | After |
|---------|-------|-------|
| `--track union` flag | one oversized NSWindow | reinterpreted as `DesktopWorldSurface`; same id, same callers, segmented internals |
| `--surface desktop-world` flag | n/a | new canonical alias; equivalent to `--track union` |
| `avatar-main` (Sigil) | Three.js in one webview spanning displays; manual stale-bounds clamp in the `display_geometry` handler | Sigil renderer composes the toolkit Three.js adapter; clamp removed once the spike lands and validates the chosen rendering strategy |
| Canvas inspector (the canvas) | normal canvas, DOM, not union | unchanged |
| Inspector list view | flat list of canvases | one row per logical surface, expandable to segments |
| `tests/capture-union-canvas-surface.sh` | captures one window | captures the logical surface; verification updated to compose per-segment images |
| `tests/runtime-display-union.sh` | exercises union geometry math | unchanged |
| `tests/sigil-avatar-interactions.sh` | drives avatar lifecycle | reviewed alongside the Sigil migration |
| Normal panels (`--at`, `--track <window>`, anchors) | unchanged | unchanged |

The blast radius is concentrated in:
1. The daemon: introduce `DesktopWorldSurface` as a peer of single-window
   `Canvas` in `src/display/canvas.swift`, with segment management and
   sub-event emission.
2. Sigil's renderer refactor onto the toolkit adapter.
3. The capture-union test's verification.
4. Inspector list-view rendering.

Everything else either continues to work or absorbs a docs/inspector polish
pass.

## Validation Spikes

These are required before implementation can proceed past the daemon-side
primitive. Each is a small, throwaway prototype that answers one question.

1. **Three.js shared-state rendering across N web views.** Build a minimum
   scene where each segment web view runs the same scene against shared logical
   state (e.g. avatar position, rotation) and renders its own camera/viewport.
   Measure: visual coherence (do the slices line up across the seam?), input
   latency (drag avatar, time-to-update on followers), CPU/GPU cost per
   segment. Compare two transports for shared state: daemon `post` fanout vs.
   `BroadcastChannel` between web views in the same daemon-managed origin. If
   neither is good enough, scope a third option.
2. **Display hot-plug under animation.** Add and remove a display while the
   surface is animating. Confirm the segment add/remove events fire in order,
   that surviving segments do not flicker or lose state, and that the new
   segment is at parity within one frame after `canvas_segment_added`.
3. **Capture composition.** Decide whether `aos see` of a `DesktopWorldSurface`
   captures per-segment and composites in DesktopWorld coords, or captures the
   union region of the screen directly. The existing capture-union test fixes
   the expected output shape.

The Three.js spike is the gating risk. If shared-state rendering is not
visually coherent or not performant enough for Sigil's avatar, the design
needs to come back to brainstorming before Sigil migrates. The daemon-side
primitive can still ship in advance of that decision; it is renderer-agnostic.

## Open Questions

1. **Capture semantics.** Per-segment compositing vs. union-region capture.
   To resolve during the capture spike.
2. **Shared logical state shape.** Whether the toolkit ships a base `Surface`
   object that holds shared state, or whether each adapter defines its own.
   To resolve when the first two adapters are written.
3. **Stricter CLI mutex.** Whether `--surface desktop-world` should also be
   mutex with `--anchor-window` and `--anchor-channel`. Recommended yes;
   pin during implementation.
4. **Inspector segment-row UX.** Inline expansion vs. a detail panel.
   Cosmetic; resolve during inspector polish.

## Out of Scope (Explicitly)

- Interactive desktop-spanning surfaces. Use child canvases (e.g.
  `avatar-hit`) for interactivity inside the surface.
- Cursor trails, global highlight overlays, multi-screen wallpaper effects.
  Future consumers of the primitive, designed separately.
- Compositor-level rendering paths (Metal layer composition).
- Mirroring or extended-display detection logic beyond what
  `display_geometry` already provides.

## References

- `docs/superpowers/specs/2026-04-14-union-canvas-foundation-design.md` —
  prior union canvas foundation; this spec supersedes its physical-rendering
  decisions while keeping its coordinate-foundation work intact.
- `docs/superpowers/plans/2026-04-19-desktopworld-daemon-reanchor.md` —
  in-flight DesktopWorld re-anchor plan; this spec assumes its outputs.
- `shared/schemas/spatial-topology.md` and
  `shared/schemas/spatial-topology.schema.json`.
- `src/display/canvas.swift` (current single-window union implementation).
- `src/display/client.swift:184-189` (`--track` parsing).
- `src/display/display-geometry.swift:19-144` (DesktopWorld geometry producer).
- `src/shared/types.swift:31-93` (Swift coord conversion helpers).
- `packages/toolkit/runtime/spatial.js` (JS DesktopWorld helpers).
- `packages/toolkit/components/canvas-inspector/index.js`,
  `packages/toolkit/components/canvas-inspector/mouse-effects.js`.
- `apps/sigil/renderer/live-modules/main.js:485-507` (current Sigil
  DesktopWorld input path).
- `apps/sigil/renderer/live-modules/main.js` (legacy stale-bounds clamp lived
  in the `display_geometry` handler before the Sigil migration).
