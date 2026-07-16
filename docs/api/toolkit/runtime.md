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
canvases with `addChildCanvas`, stage layers with `addStageLayer`, declarative
3D resources with `addStageObject`, and a
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
    "id": "surface-diagnostic-outline",
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

Daemon input region events arrive as the exact bridge envelope
`{type:"input_region.event", routed_input}`. The bridge name is not a payload
schema version. `routed_input` is the canonical routed-v1 payload matching
`shared/schemas/input-event-v2`:
`routed_schema_version`, `delivery_role`, `region_id`, `owner_canvas_id`,
stable `capture_id` for captured drags, `source_origin`,
bounded string `source_event`, canonical `sequence`, `desktop_world`, and
`coordinate_authority`. A `routed_schema_version: 1` claim must include the
required routed fields for its `event_kind` and `delivery_role`; incomplete
claims are errors.

Consumers should call `normalizeCanvasInputMessage(msg)` from
`packages/toolkit/runtime/input-events.js` instead of parsing
`input_region.event` directly. The normalizer delegates versioned payloads to
the browser-safe standalone validator compiled from
`shared/schemas/input-event-v2.schema.json` with Ajv; no schema interpreter or
compiler runs in the canvas. Generation checks reject stale artifacts. It accepts canonical raw input-event-v2
payloads, direct routed-v1 envelopes, exact `input_region.event.routed_input`
envelopes, and canvas-origin messages that can be resolved into routed v1.
Canvas-origin `other_mouse_*` messages require a producer-supplied button id
and normalize it to `other:<id>`; messages without that identity are rejected.
Unversioned event names, `input_event` wrappers, nested bridge payloads, and
top-level-only input-region events return `null`; malformed payloads that claim
a supported schema version fail validation. The `input_event` name remains the
daemon subscription topic, not a wrapper schema. Normalized output adds
camelCase fields such as
`gestureId`, `captureId`, `deliveryRole`, `regionId`, `ownerCanvasId`,
`sourceCanvasId`, `sourceOrigin`, `sourceSequence`, and `sourceEvent`. Every
normalized input also carries one toolkit-owned `inputIdentity` projection with
`sourceOrigin`, `sourceCanvasId`, `ownerCanvasId`, `regionId`, `deliveryRole`,
and `envelopeType`; app policy should consume that projection instead of
re-normalizing transport fields.

Child hit WebViews that forward DOM input through `canvas_message` should use
the same source identity contract instead of app-local booleans. The runtime
exports `createCanvasOriginInputEvent(message, facts)` and
`normalizeCanvasOriginInputMessage(message, facts)` for this bridge. The child
payload supplies `source_origin: "canvas"`, `source_canvas_id`,
`owner_canvas_id`, `source_event`, child-local offsets, pointer id, and optional
scroll deltas. The parent supplies authoritative DesktopWorld coordinates in
`facts.desktopWorld` after resolving the current child frame and display
geometry. `createCanvasOriginInputEvent()` emits canonical routed-v1 fields for
pointer, scroll, and cancel events. `normalizeCanvasOriginInputMessage()` then
adds router aliases such as `x`/`y`, camelCase identity fields, and child-local
offsets for existing toolkit code.

Use the [surface interaction decision tree](../../guides/aos-surface-interaction-decision-tree.md)
(`docs/guides/aos-surface-interaction-decision-tree.md`) before adding a
region: passive DesktopWorld visuals with small hit areas usually belong behind
`createStageAffordance`, while ordinary DOM controls should stay inside the
existing interactive canvas.

## Canvas Host Target Semantics

Toolkit surfaces participate in the same AOS target ladder as the public CLI.
`aos show --id <canvas-id>` owns canvas resource lifecycle, `aos see capture
--canvas <canvas-id>` scopes perception to the current canvas host, and
`canvas:<canvas-id>/<ref>` is the direct current Target-with-Ref for a semantic
element inside that host. Saved workspace refs remain the model-facing durable
handle: agents should prefer `ref:<snapshot-id>:<ref-id>` after `aos see capture
--save`, and use direct canvas targets for current-host actions or diagnostic
paths where the canvas is live.

Toolkit code should treat a canvas id as a resource id, not as durable object
identity for a semantic control. Semantic targets exposed through
`data-aos-ref`, `data-semantic-target-id`, owner metadata, and
`provenance.do_target` provide the action vocabulary. DesktopWorld surfaces,
segmented canvases, passthrough visuals, child hit WebViews, and interactive
affordances should use the same split: daemon primitives own lifecycle,
geometry, input routing, and current canvas host state; toolkit policy owns
panel/window behavior, stage affordances, semantic target descriptors, and
reusable interaction bindings; app code owns product behavior.

Surfaces that inspect ownership rather than handle pointer input can subscribe
to `input_region` with `{ snapshot: true }`. The daemon replays
`input_region.snapshot` and then sends live `input_region` actions
`registered`, `updated`, and `removed`, with region metadata preserved for
toolkit ownership correlation.

## Gesture Stream

`packages/toolkit/runtime/gesture-stream.js` provides the V0 shared
pointer/gesture lifecycle spine for drag-like behavior. It normalizes DOM
pointer events and existing normalized canvas input messages into
`aos.gesture-frame` frames such as `gesture.drag.start`,
`gesture.drag.move`, `gesture.drag.end`, and `gesture.drag.cancel`.

Use `createPointerGestureStream(options)` when a surface already owns the
active input source but wants shared gesture frames, passive subscribers, and
consistent cleanup. Use `bindDomPointerGesture(element, options)` for DOM
controls that need pointer capture plus document-level move/end/cancel
listeners. The stream owns mechanics only; semantic adapters still own value
mapping, movement, resize, range, or product behavior.

Gesture frames include source identity, pointer identity and capture id,
available coordinate spaces, origin/current/previous/delta points, semantic
target/action metadata, and timing/frame metadata. Passive observers subscribe
with `stream.subscribe(listener)` and receive the same frames as the active
adapter without adding duplicate raw pointer listeners.

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

`packages/toolkit/runtime/semantic-child-target-surface.js` provides
`createSemanticChildTargetSurface`, a higher-level child WebView helper for
semantic hit surfaces rendered over parent-owned visuals. It wraps
`createDesktopWorldHitRegionController` and adds generic target projection,
offscreen disable payloads, payload refresh, and message-type injection.
Apps supply the target resolver, bounds resolver, payload shape, labels,
actions, and command routing.

`packages/toolkit/runtime/canvas-host-runtime.js` provides
`createCanvasHostRuntime`, the browser-side host bridge used by app renderers
that talk to the daemon through `window.webkit.messageHandlers.headsup`. It
owns bridge installation, inbound message fanout, request/response
correlation, timeouts, subscribe/unsubscribe, status menu publication, canvas
lifecycle helpers, input-region calls, position storage, capture requests, and
generic AOS action dispatch. App wrappers should only supply globals, request
id prefixes, and logger labels.

`packages/toolkit/runtime/utility-surface-manager.js` provides
`createUtilitySurfaceManager` for reusable utility canvas lifecycle mechanics:
ensure-visible, toggle, warm precreate, resume, suspend, duplicate-create
recovery, concurrent open-promise dedupe, state-map updates, lifecycle
snapshot reconciliation, and change hooks. The toolkit manager does not know
about app-specific terminal parking, status menus, workbenches, telemetry
panels, or product labels.

`packages/toolkit/runtime/managed-input-region-set.js` provides
`createManagedInputRegionSet` for descriptor-owned daemon input regions. Each
descriptor supplies an id, owner canvas resolver, enabled predicate, frame
resolver, and optional payload factory. The helper owns register/update/remove,
redundant update suppression, `NOT_FOUND` update recovery via register retry,
remove-all cleanup, and snapshots.

`packages/toolkit/runtime/render-performance-sampler.js` provides
`createRenderPerformanceSampler` for throttled render telemetry. Consumers
inject a telemetry state accessor, source label, target canvas id, visibility
predicate, renderer stats, render-loop work classifier, and post function.

`packages/toolkit/runtime/three-render-lifecycle.js` provides the generic,
dependency-injected Three renderer lifecycle: bounded DPR/backing metrics,
resize observation, hidden/context-loss suspension, frame scheduling, and
owned-resource disposal. External package consumers use the narrow
[`@agent-os/toolkit/scene` contract](./scene.md) instead of importing this file
directly.

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
  writeClipboardText,
  declareManifest,
  emitReady,
  emitLifecycleComplete,
  onReady,
  submitGateContinuation,
  createCanvasHostRuntime,
  createManagedInputRegionSet,
  createRenderPerformanceSampler,
  createThreeRenderLifecycle,
  resolveThreeRenderMetrics,
  createSemanticChildTargetSurface,
  createUtilitySurfaceManager,
  MENU_ACTIVATION_PHASES,
  createMenuActivationRequest,
  advanceMenuActivation,
} from 'aos://toolkit/runtime/index.js'
```

### UX Tree Runtime

`packages/toolkit/runtime/ux-tree.js` provides the dependency-light runtime
helper for the `aos_ux_tree` contract. A UX tree is the future canonical shape
for inspectable and editable affordances: nodes, mode-scoped gesture bindings,
allowlisted command references, and plain JSON settings. V0 is read-only and
shadow-resolved; it does not execute commands or replace app routers.

```js
import {
  createUxTree,
  mergeUxTreeDefinitions,
  resolveUxTree,
  uxTreeBindingsForGesture,
  uxTreeCommandById,
} from 'aos://toolkit/runtime/index.js'
```

The helper follows the radial-menu merge precedent: objects deep-merge, arrays
replace by default, and `nodes`, `commands`, `bindings`, and `modes` merge by
stable `id`. `resolveUxTree(input, { strict })` normalizes the tree and returns
`validation.errors` for invalid node, command, or mode references. Strict mode
throws after collecting the same validation metadata.

Radial menu config remains the source of truth for radial menu geometry/items.
When represented in a UX tree it belongs under `settings.radial`, alongside
future override patches, rather than becoming a competing menu model.

### Deferred Gate Submission

`packages/toolkit/runtime/gate.js` provides `submitGateContinuation()` for
AOS-hosted canvases that need to submit a durable deferred gate continuation
through the daemon bridge:

```js
await submitGateContinuation({
  continuationId: 'gate-cont-...',
  response: { decision: 'approve' },
  submittedBy: { role: 'human', user: 'local-user' },
  storeResponse: false,
})
```

The helper emits `gate.submit` with a generated `request_id`, resolves when the
daemon returns a `canvas.response` success ack, and rejects on daemon error or
timeout. The WebView does not run shell commands; the daemon owns the trusted
submit path and uses the active runtime mode and state root.

### Clipboard Read

AOS-hosted canvases may request current plain-text clipboard contents from the
daemon with a `clipboard.read` message and a `request_id`. The daemon responds
to the same canvas with `canvas.response`:

```js
window.webkit?.messageHandlers?.headsup?.postMessage({
  type: 'clipboard.read',
  payload: { request_id: 'clipboard-1' },
})

// inbound:
// { type: 'canvas.response', request_id: 'clipboard-1', status: 'ok', text: '...' }
```

Use this only for user-initiated paste flows in AOS WebViews where browser
clipboard APIs may be unavailable. Treat an empty `text` string or timeout as a
quiet paste miss.

### Clipboard Write

AOS-hosted canvases may write plain text to the system clipboard through the
daemon with a `clipboard.write` message and a `request_id`. The daemon responds
to the same canvas with `canvas.response`:

```js
window.webkit?.messageHandlers?.headsup?.postMessage({
  type: 'clipboard.write',
  payload: {
    request_id: 'clipboard-write-1',
    text: 'text to copy',
  },
})

// inbound:
// { type: 'canvas.response', request_id: 'clipboard-write-1', status: 'ok' }
```

Use `writeClipboardText(text, { timeoutMs })` from
`packages/toolkit/runtime/canvas.js` for user-initiated copy buttons, menus, or
keyboard actions. The helper requires a string, posts `clipboard.write`, waits
for the matching `canvas.response`, and falls back to
`navigator.clipboard.writeText()` unless `{ browserFallback: false }` is set.
The primitive writes only `text/plain` / `NSPasteboard.PasteboardType.string`;
rich formats, files, images, and clipboard history are out of scope.

### Menu Activation Model

`packages/toolkit/runtime/menu-activation.js` defines the provider-neutral
activation envelope for menu-like surfaces. It is intentionally independent of
radial geometry, 3D rendering, and consumer-specific actions.

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
transition })` when a menu item commits. The request keeps the existing
`input` / `source` string fields, but also includes `input_source` for richer
click, gesture, keyboard, or accessibility metadata. These retained fields are
owned by the menu activation contract and are not gesture-ingress aliases.
`surface` and
`target_surface` are aliases for the requested destination surface descriptor.

Use `advanceMenuActivation(request, phase, extra?)` to move through the
lifecycle. Unknown phases throw, so provider or app mismatches fail loudly
instead of creating ad-hoc status names.

`packages/toolkit/contracts/mounted-surface-menu-projection.js` owns the
neutral mounted-surface menu projection query name, legacy query name, schema
version, envelope, and surface filter. Experience manifests declare menu items
with a target `surface`; activation validates mounted-surface menu targets
generically and projects manifest-owned menu items for the mounted surface into
the URL via `aos_mounted_surface_menu` only when that surface has matching menu
entries. Non-menu status surfaces keep their templated URLs unchanged.

`packages/toolkit/runtime/operator-annotation-menu.js` provides the reusable
surface-side bridge for app-owned status item entries that start operator
selection/annotation mode. Runtime decode validates the generic mounted-surface
projection schema, experience id, mounted surface id, current surface match
when available, and menu array before filtering to the `operator_annotation`
entries it understands. Operator annotation entries whose declared target
differs from the projected mounted surface fail closed and are not routed from
URL data. The native status item still emits the generic
`status_item.menu_action` event; the toolkit helper maps that action id to a
`canvas.send` message for the projected operator surface.

Public operators should invoke this path through the AOS-owned experience
status-item menu command sequence: `aos experience status <id> --json`,
`aos experience menu invoke <id> --item <item-id> --dry-run --json`, then the
same invoke command without `--dry-run`. This posts the generic
`status_item.menu_action` event to the mounted status surface; it does not scrape
or dispatch arbitrary third-party macOS menu extras.

Use `operatorAnnotationStatusMenuItems(menu)` to project manifest menu entries
to native menu descriptors, `operatorAnnotationMenuFromLocation(location)` to
read the activation-projected `aos_mounted_surface_menu` data inside the
mounted surface, and
`routeOperatorAnnotationMenuAction(message, menu, host)` to route an incoming
menu event. The default routed message type is `aos.operator_annotation.start`;
it includes the menu item id, action id, source, selection mode, creation
intent, origin point, and modifiers. The helper does not create pending
annotations by itself; the receiving operator surface owns capture/comment/
commit behavior and should write pending annotations through
`aos see annotation`. Runtime also accepts the legacy `aos_manifest_menu`
parameter for older mounted surfaces, but activation emits the generic
`aos_mounted_surface_menu` contract.

`packages/toolkit/runtime/operator-annotation-surface.js` provides the minimal
state model for that receiving surface. `createOperatorAnnotationSurface()`
handles `aos.operator_annotation.start`, accepts comment updates, supports
commit/cancel, and emits generic operator-selection evidence through an
injected `createAnnotation` adapter.
Selection may start without a target, but commit fails closed with
`OPERATOR_ANNOTATION_TARGET_REQUIRED` unless the surface has selected-target,
saved-ref, capture, or explicit fallback evidence. The runtime helper does not
construct pending annotation records; pending-annotation-owned adapters convert
the generic selection payload to `aos see annotation` create input. Successful
commits report the adapter result id/path; missing or failing adapters move to
`failed` instead of creating in-memory-only intent.

`packages/toolkit/runtime/radial-item-transition.js` defines the companion
transition contract for 3D radial menu items. The vanilla preset,
`radial-3d-vanilla`, describes item focus/zoom/hold, menu fade/dissolve, incoming
surface fade, and cancel restore slots. Consumers can put an
`activationTransition` object on a radial item to override those slots without
mixing transition state into static geometry tuning data. Use
`resolveRadialItemActivationTransition(item)` before attaching the result to a
menu activation request.

### 3D Radial Menu Config

`packages/toolkit/runtime/radial-menu/default-3d.json` is the V0 data contract
for a renderer-neutral 3D radial menu expression. The JSON keeps ordinary menu
fundamentals (`id`, labels, actions, disabled/hidden/current/checked state,
typeahead text, shortcut labels, children or submenu refs, semantic roles, and
target-surface/action payload descriptors) separate from the optional 3D
expression layer (`geometry`, model refs, item hover transforms, activation
transitions, materials, and effect/module refs).

`packages/toolkit/runtime/radial-menu-config.js` provides the data-only
resolver. It can clone and merge plain JSON, resolve an `extends` definition
from an allowlisted map, merge items by stable `id`, validate required V0
fields, and produce both `items` for renderers and `logical_items` for DOM/AX,
keyboard, test, or future menu-stack projections. Arrays replace by default;
menu items are the V0 keyed-merge exception. The resolver intentionally imports
no Three.js, DOM, app actions, Zag, or dynamic module code.

The `logical_items` output is the stable lower menu projection. DOM, AX,
semantic child canvases, tests, and ordinary stack-menu projections should
consume that projection instead of walking 3D geometry or consumer item modules.
The 3D expression remains layered data on each resolved item for a renderer or
app-owned adapter to consume.

Radial geometry supports fixed and trigger-vector placement. With
`geometry.orientation: "trigger-vector"`, the menu locks its item angles from
the pointer vector that first crosses into the radial gesture. It does not track
later cursor movement; returning inside the dead zone re-arms the vector so the
next outward crossing can choose a new placement. Trigger-vector placement
reserves that crossing vector as an egress lane: item array order fans out on
the left and right flanks with no item centered directly on the drag vector.
For odd item counts, the leading flank receives the extra item. Put higher
priority or easy-switch items near the middle of the array when they should sit
adjacent to the lane.

Hover defaults cascade from toolkit menu defaults to app/menu overrides and
then item overrides under `three.item.hover`. The default hover transform uses
exponential progress with `factor: 0.22`, scale `1 -> 1.08`, and y-axis spin.
Apps can override those values in their own JSON manifests; a consumer can set item hover scale
to `1 -> 2` for every item and changes the cog and annotation reticle to
z-axis wheel spin. Flat glyphs that must keep their face toward the viewer can
set `three.item.facing: "camera"` so the renderer suppresses radial-angle yaw
while preserving screen-plane Z spin.

Zag is intentionally outside the 3D radial render path. It remains appropriate
for ordinary DOM/AX/2D menu projections of the resolved logical menu model, but
it does not own radial pointer geometry, drag-to-handoff state, or per-frame
3D animation.

### `wireBridge(handler)`

Installs an inbound message handler for daemon-to-canvas messages and returns
an unsubscribe function for removing that handler.

```js
const unsubscribe = wireBridge((msg) => {
  if (msg.type === 'hello') console.log(msg.payload)
})
unsubscribe()
```

Notes:

- safe to call more than once
- each handler is retained and invoked for every inbound message
- call the returned unsubscribe before tearing down or restarting a reusable
  adapter
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
- `canvas_geometry` is the frame invalidation stream for origin/size/frame
  changes. It carries `change`, `cause`, `phase`, `transaction_id`, `frame`,
  optional `previous_frame`, `canvas_id`, and a nested `canvas` identity object.
  It does not snapshot; pair it with `canvas_lifecycle` snapshots for initial
  state. Pointer-frequency drag/resize updates use `phase: "update"` and should
  be handled with cheap frame/minimap updates instead of structural rerenders.

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
  url: 'aos://toolkit/components/surface-inspector/index.html',
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
await evalCanvas('example-surface', 'document.title')
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
