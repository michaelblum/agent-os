# Toolkit Runtime API

Consumer-facing reference for the generic in-canvas runtime bridge, canvas lifecycle helpers, DesktopWorld surface runtime, resource scopes, input regions, and subscriptions. Panel/window policy lives in [panel-window.md](./panel-window.md); content authoring and hosting lives in [content-host.md](./content-host.md).

## DesktopWorld Surface Runtime

`packages/toolkit/runtime/desktop-world-surface.js` provides
`DesktopWorldSurfaceAdapter`, the base adapter for canvases whose contract is
"draw across DesktopWorld." One adapter instance runs in each display segment
web view. The adapter consumes `canvas_topology_settled`, elects primary from
`segment.index === 0`, and exposes `runOnPrimary(fn)` so apps can gate
once-per-surface side effects.

`packages/toolkit/runtime/desktop-world-surface-2d.js` provides
`DesktopWorldSurface2D`, a DOM/Canvas2D helper that identifies its segment from
`window.__aosSegmentDisplayId` and applies the DesktopWorld origin translation
to a local root node.

`packages/toolkit/runtime/desktop-world-surface-three.js` provides
`DesktopWorldSurfaceThree` / `DesktopWorldSurface3D`, segment-carved
orthographic camera helpers, and a BroadcastChannel-backed state replication
hook for Three.js consumers.

`packages/toolkit/runtime/resource-scope.js` provides `createResourceScope`, a
small ownership helper for toolkit surface resources. A scope tracks its id,
owner canvas id, child canvas ids, stage layer ids, input region ids,
subscription events, cleanup status, and active state. Cleanup is deterministic
and idempotent. Owned input regions, stage layers, adopted child canvases, and
custom cleanup callbacks run during cleanup. Event subscriptions are treated as
shared canvas claims by default, so cleanup records them as retained instead of
unsubscribing; pass `exclusive: true` when adding a subscription only if the
scope exclusively owns that event claim. Bridge handlers installed through the
scope remain registered with the current bridge, but they stop invoking user
callbacks once the scope is inactive or cleaned up.

For subject-family cleanup, use one resource scope per root subject family and
register every owned runtime resource at the same boundary: cascade-owned child
canvases with `addChildCanvas`, stage layers with `addStageLayer` and a
`desktop_world_stage.layer.remove` callback, daemon input regions with
`addInputRegion`, and any exclusive event claims with
`addSubscription(..., { exclusive: true })`. Running `scope.cleanup()` is the
canonical toolkit operation. It is safe to call repeatedly and returns a report
under `cleanupStatus` with concrete `removed`, `preserved`, `orphaned`,
`couldNotClassify`, and `errors` details. Shared subscriptions are reported as
preserved. Child canvases registered with `owned: false` are preserved and
reported as orphaned from the scope rather than removed. A stage layer without a
cleanup callback is reported in `couldNotClassify` because the daemon does not
own toolkit stage-layer state.

The stock shared stage lives at
`aos://toolkit/components/desktop-world-stage/index.html`. It should be launched
as `--surface desktop-world` and stays non-interactive. Consumers update it with
`canvas.send` messages:

```json
{
  "type": "desktop_world_stage.layer.upsert",
  "payload": {
    "id": "panel-transfer-outline",
    "kind": "outline",
    "frame": [1920, 64, 720, 520],
    "label": "Move here"
  }
}
```

Accepted stage messages are `desktop_world_stage.layer.upsert`,
`desktop_world_stage.layer.remove`, `desktop_world_stage.layers.replace`, and
`desktop_world_stage.clear`.

The shared stage also publishes its current visible layer list as an
inspector-only `canvas_object.registry` snapshot after layer upsert, replace,
remove, clear, and initial render. The registry objects use
`kind: "desktop_world_stage.layer"`, expose no transform capabilities, and
carry metadata such as `inspector_surface_resource_type`,
`stage_layer_id`, `stage_layer_kind`, `frame`, `zIndex`,
`owner_canvas_id`, and `toolkit_affordance_id` when available. This makes stage
layers replayable to newly opened Surface Inspector canvases through the
existing retained registry route without adding a stage-specific daemon event.

## Input Regions And Events

Input regions are daemon-owned hit areas that toolkit surfaces can register when a visual does not need its own interactive WebView. The runtime helpers live in `packages/toolkit/runtime/input-region.js` and are re-exported from `packages/toolkit/runtime/index.js`.

- `registerInputRegion(region)` emits `input_region.register` and resolves when the daemon acknowledges the region.
- `updateInputRegion(region)` emits `input_region.update` for an existing region id.
- `removeInputRegion(id)` emits `input_region.remove`.
- `inputRegionContainsRect(rect)` is a deterministic local predicate for rectangle hit checks in tests and routing helpers.

Daemon input region events arrive as `input_region.event` bridge messages. V0
deliveries keep legacy top-level fields for existing consumers and include a
canonical `routed_input` payload matching `shared/schemas/input-event-v2`:
`routed_schema_version`, `delivery_role`, `region_id`, `owner_canvas_id`,
stable `capture_id` for captured drags, `source_origin`,
`source_event`/`source_sequence`, `desktop_world`, and
`coordinate_authority`. Consumers should call `normalizeCanvasInputMessage(msg)`
from `packages/toolkit/runtime/input-events.js` instead of parsing
`input_region.event` directly; it normalizes raw legacy daemon events, v2 raw
events, `input_event` envelopes, routed envelopes, and input-region delivery
wrappers into one object with camelCase aliases such as `gestureId`,
`captureId`, `deliveryRole`, `regionId`, `ownerCanvasId`,
`sourceCanvasId`, `sourceOrigin`, `sourceSequence`, and `sourceEvent`.

Child hit WebViews that forward DOM input through `canvas_message` should use
the same source identity contract instead of app-local booleans. The runtime
exports `createCanvasOriginInputEvent(message, facts)` and
`normalizeCanvasOriginInputMessage(message, facts)` for this bridge. The child
payload supplies `source_origin: "canvas"`, `source_canvas_id`,
`owner_canvas_id`, `source_event`, child-local offsets, pointer id, and optional
scroll deltas. The parent supplies authoritative DesktopWorld coordinates in
`facts.desktopWorld` after resolving the current child frame and display
geometry. The normalized result carries `coordinate_authority: "toolkit"`, a
toolkit `source_sequence`, stable `gesture_id` / `capture_id` for a pointer
sequence, `desktop_world` plus `x`/`y`, and camelCase aliases for router code.

Use the [surface interaction decision tree](../../recipes/aos-surface-interaction-decision-tree.md)
(`docs/recipes/aos-surface-interaction-decision-tree.md`) before adding a
region: passive DesktopWorld visuals with small hit areas usually belong behind
`createStageAffordance`, while ordinary DOM controls should stay inside the
existing interactive canvas.

Surfaces that inspect ownership rather than handle pointer input can subscribe
to `input_region` with `{ snapshot: true }`. The daemon replays
`input_region.snapshot` and then sends live `input_region` actions
`registered`, `updated`, and `removed`, with region metadata preserved for
toolkit ownership correlation.

`packages/toolkit/runtime/desktop-world-hit-region.js` provides
`createDesktopWorldHitRegionController` for the transitional case where a
DesktopWorld visual still needs a small interactive child WebView for semantic
targets or DOM transport. The controller owns generic mechanics: owner canvas
id selection from `__aosCanvasId`, `__aosSurfaceCanvasId`, or an explicit
fallback; offscreen creation; native frame conversion from DesktopWorld rects;
deduplicated placement/interactivity updates; deduplicated child
`canvas.send` payloads; disable; remove; and `snapshot()`. Product mapping such
as labels, actions, active item state, and child URL selection remains in the
app or higher toolkit layer.

## Runtime API

Convenience re-export:

```js
import {
  wireBridge,
  emit,
  esc,
  subscribe,
  unsubscribe,
  spawnChild,
  mutateSelf,
  removeSelf,
  warmCanvas,
  canvasInfo,
  waitForCanvasStatusReady,
  setInteractive,
  evalCanvas,
  move,
  declareManifest,
  emitReady,
  emitLifecycleComplete,
  onReady,
  MENU_ACTIVATION_PHASES,
  createMenuActivationRequest,
  advanceMenuActivation,
} from 'aos://toolkit/runtime/index.js'
```

### Menu Activation Model

`packages/toolkit/runtime/menu-activation.js` defines the provider-neutral
activation envelope for menu-like surfaces. It is intentionally independent of
radial geometry, 3D rendering, and Sigil-specific actions.

Canonical phases are:

```js
[
  'requested',
  'item_transition',
  'menu_transition',
  'surface_transition',
  'completed',
  'cancelled',
  'failed',
]
```

Use `createMenuActivationRequest({ menuId, item, input, source, targetSurface,
transition })` when a menu item commits. The request keeps legacy
`input` / `source` string fields, but also includes `input_source` for richer
click, gesture, keyboard, or accessibility metadata. `surface` and
`target_surface` are aliases for the requested destination surface descriptor.

Use `advanceMenuActivation(request, phase, extra?)` to move through the
lifecycle. Unknown phases throw, so provider or app mismatches fail loudly
instead of creating ad-hoc status names.

`packages/toolkit/runtime/radial-item-transition.js` defines the companion
transition contract for 3D radial menu items. The vanilla preset,
`radial-3d-vanilla`, describes item focus/zoom/hold, menu fade/dissolve, incoming
surface fade, and cancel restore slots. Consumers can put an
`activationTransition` object on a radial item to override those slots without
mixing transition state into static geometry tuning data. Use
`resolveRadialItemActivationTransition(item)` before attaching the result to a
menu activation request.

### `wireBridge(handler)`

Installs an inbound message handler for daemon-to-canvas messages.

```js
wireBridge((msg) => {
  if (msg.type === 'hello') console.log(msg.payload)
})
```

Notes:

- safe to call more than once
- each handler is retained and invoked for every inbound message
- inbound messages arrive through `window.headsup.receive(base64Json)`

### `emit(type, payload?)`

Sends a message from the canvas back to the daemon / host bridge.

```js
emit('log/append', { text: 'hello', level: 'info' })
```

### `esc(value)`

HTML-escape helper for rendering untrusted text into `innerHTML`.

### `subscribe(events, options?)` / `unsubscribe(events)`

Manage daemon event subscriptions.

```js
subscribe(['canvas_lifecycle', 'display_geometry'], { snapshot: true })
unsubscribe('display_geometry')
```

Options:

- `snapshot: true` asks the daemon to replay the current state for supported
  streams immediately after subscribing. Today that includes
  `display_geometry`, `canvas_lifecycle`, `canvas_object.registry`,
  `input_region`, and `input_event` (replayed as the current cursor position).
- `canvas_lifecycle` snapshots and live updates now share one rich payload
  shape: top-level compatibility fields (`canvas_id`, `action`, `at`) plus
  metadata such as `parent`, `track`, `interactive`, `scope`, and a nested
  `canvas` object mirroring `aos show list`. Lifecycle payloads include
  `lifecycle_state` so inspectors can distinguish ordinary active canvases
  from explicit warm suspended canvases.

### `spawnChild(opts)`

Creates a child canvas and returns a promise that resolves after the daemon ack.

```js
await spawnChild({
  id: 'child',
  url: 'aos://toolkit/components/log-console/index.html',
  at: [100, 100, 320, 240],
  interactive: true,
})
```

### `warmCanvas(opts)`

Creates a bounded warm canvas using the daemon's existing suspended-create
primitive, waits for the renderer to reach `document.readyState ===
"interactive"` or `"complete"`, and leaves the canvas hidden until the caller
explicitly resumes it.

```js
const warmed = await warmCanvas({
  id: 'surface-inspector-warm',
  url: 'aos://toolkit/components/canvas-inspector/index.html',
  frame: [120, 120, 720, 520],
  parent: window.__aosCanvasId,
  timeoutMs: 5000,
})
```

Options:

- `id`, `url`, and `frame` are required.
- `parent` records the owner canvas for cascade and cleanup.
- `interactive` defaults to `true`, but suspended canvases are hidden and do
  not participate in input routing until `resumeCanvas(id)`.
- `cascade` defaults to `true`.
- `timeoutMs`, `intervalMs`, and `evalTimeoutMs` bound readiness polling.
- `requireManifest: true` waits for `window.headsup.manifest` as well as
  document readiness.
- `cleanupOnFailure` defaults to `true` and removes the canvas if warm setup
  fails or times out.

The returned object carries `{ id, lifecycle_state: "warm_suspended",
suspended: true, ready }`. V0 has no automatic pool: each warm canvas is
explicitly created by its owner and should be resumed, suspended, or removed by
that owner.

### `waitForCanvasReady(id, opts?)`

Polls another canvas with `canvas.eval` until it is ready enough for warm
resume. Use this only when a caller already created a suspended canvas and
needs the same bounded readiness check used by `warmCanvas`.

### `canvasInfo(id, opts?)`

Requests daemon-backed canvas status through `canvas.info`. This is a
non-mutating status path and does not grant cross-canvas JavaScript execution.
It returns the canvas list metadata plus daemon-cached renderer readiness data
from `ready` / `lifecycle.ready`, including the declared manifest when the
renderer has emitted one.

### `waitForCanvasStatusReady(id, opts?)`

Polls `canvas.info` until the canvas exists, is in an allowed lifecycle state,
and, when requested, has a matching ready manifest. Shared toolkit surfaces such
as the singleton DesktopWorld stage should use this instead of cross-owner
`canvas.eval` readiness checks.

### `mutateSelf(opts)`

Fire-and-forget update for the current canvas.

```js
mutateSelf({ interactive: true })
```

### `removeSelf(opts?)`

Removes the current canvas and resolves after daemon ack.

### `setInteractive(boolean)`

Convenience wrapper over `mutateSelf({ interactive })`.

### `evalCanvas(id, js, options?)`

Evaluates JavaScript inside another canvas and resolves with the daemon's eval result string.

```js
await evalCanvas('avatar-main', 'document.title')
```

Options:

- `timeoutMs`: override the default 5000ms request timeout

### `move(dx, dy)`

Relative move helper for the current canvas.

Used by the stock draggable header; intended for live drag behavior rather than absolute positioning.

### `declareManifest(manifest)`

Declares the canvas manifest on `window.headsup.manifest`.

### `emitReady()`

Signals that the canvas is loaded and ready for host-side post-load actions.

### `emitLifecycleComplete(action, payload?)`

Acknowledges that a renderer-managed lifecycle transition actually finished.

```js
emitLifecycleComplete('resume')
emitLifecycleComplete('exit', { reason: 'animation_done' })
```

Use this for transition acks such as `resume`, `enter`, or `exit` when the
daemon should wait on real renderer completion instead of a guessed delay.

### `onReady(handler)`

Convenience hook for inbound `ready` events.
