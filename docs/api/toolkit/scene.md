# Toolkit Scene API

`@agent-os/toolkit/scene` is the narrow package boundary for external scene
authors. It exposes product-neutral DesktopWorld, Three renderer lifecycle,
canvas projection, and visual-object editing primitives without exposing the
broader toolkit implementation tree.

The public streaming transport is:

```bash
aos scene --stage desktop-world/main --owner <consumer-id> --resource <resource-id> --follow
```

It reads strict NDJSON operations from stdin: `mount`, `transact`, `signal`,
`play`, `suspend`, `resume`, `inspect`, `subscribe`, `unsubscribe`, `remove`,
and `close`. Leases are scoped to the client connection and removed on
disconnect. Documents contain only registered declarative implementation IDs;
implementation code never crosses the transport.

Subscribe to typed gesture events without opening another socket or process:

```jsonl
{"op":"subscribe","events":["gesture"]}
{"op":"inspect"}
{"op":"unsubscribe","events":["gesture"]}
{"op":"close"}
```

`subscribe` requires one or more supported event names. `unsubscribe` removes
the named events; an empty event list removes every subscription for that
lease. Unsolicited events use `aos.scene.event.v1`, preserve owner/resource and
pointer-session identity, and never carry product text, audio, prompts, or
scene document content.

Data-only cartridges can be validated without starting the daemon:

```bash
aos scene cartridge validate ./my-cartridge --json
```

The daemon-backed outlet interprets scene object positions and scales in the
global DesktopWorld coordinate plane. It uses one orthographic camera per
physical display segment, so a resource appears at its declared desktop point
without being independently centered on every display. All segments apply the
same bounded operation; the primary segment emits the single authoritative
result event. The outlet uses the same animation and signal controllers as the
public host API, preserving once/loop/ping-pong playback, easing, clamping, and
time-based signal smoothing.

The package does not depend on or bundle Three.js. Consumers own their Three.js
version and pass renderer-, scene-, camera-, and resource-like objects into the
dependency-injected helpers.

## Package Import

```js
import {
  DesktopWorldSurfaceThree,
  applySceneTransaction,
  canonicalizeSceneDocument,
  createDesktopWorldSceneHost,
  createSceneAnimationController,
  createSceneInteractionController,
  createSceneInteractionVisualController,
  createLocalSceneViewportHost,
  createSceneImplementationRegistry,
  createSceneLease,
  createSceneSignalController,
  createThreeRenderLifecycle,
  createVisualObjectDescriptor,
  bindVisualObjectForm,
  validateSceneTransaction,
  validateSceneInteractionDocument,
} from '@agent-os/toolkit/scene'
```

The package export includes `scene/index.d.ts` for TypeScript consumers. Direct
imports into `runtime/` or `workbench/` are not part of this external package
contract.

## Declarative Scene Contracts

### Scene Cartridges

`aos.scene.cartridge.v1` packages a scene as a familiar, declarative runtime
unit:

```text
cartridge.json
scene.json
animations.json
interactions.json
assets/
```

`cartridge.json` binds the other three JSON files and every local asset by
SHA-256. It also declares the exact trusted implementation IDs and resource
budgets. Paths are canonical and relative to the cartridge root. Raster images
and binary glTF are the only V1 asset media types. Runtime URLs, executable
source fields, functions, links, special files, traversal, undeclared files,
unknown implementations, and values above engine limits fail validation.

`validateSceneCartridgeManifest()` validates the manifest alone.
`validateSceneCartridge()` validates the complete in-memory package against a
trusted scene implementation registry. `resolveSceneCartridge()` returns the
canonical existing `aos.scene.document.v1` plus its animation and interaction
descriptors; it does not create a second renderer or transport.

The repository includes neutral cartridges under
`packages/toolkit/scene/examples/` for a spinning object, conventional drag,
aim-and-commit, and a radial menu. Interaction descriptors are data contracts;
only AOS-owned registered recognizers and responses may execute them.

`aos.scene.document.v1` describes a bounded object/resource graph without
consumer JavaScript. `canonicalizeSceneDocument()` validates exact fields,
hierarchy, resource references, finite JSON parameters, per-resource asset
limits, and a 256 MiB aggregate asset limit before returning key-sorted data.
`sceneDocumentRequiredImplementations()` reports the registered geometry,
material, effect, and component implementations needed to render it.

`aos.scene.transaction.v1` carries owner/resource-scoped, revision-checked
operations. `validateSceneTransaction()` validates the envelope and bounded
operations. `applySceneTransaction()` additionally verifies the active lease,
matches the current revision, applies the operations to an isolated candidate,
validates its complete graph, and returns revision `n + 1`. A rejected
transaction never mutates the supplied document.

`createSceneLease()` produces an `aos.scene.lease.v1` identity containing the
stage, owner, resource, and ResourceScope IDs. The contract does not create a
daemon lease or shared renderer by itself.

### Affordances And Gestures

`aos.scene.cartridge.interactions.v1` declares object-relative rectangular
`SceneAffordanceDescriptor` regions. AOS registers those regions against the
passive DesktopWorld canvas and owns pointer capture, DesktopWorld/native
coordinates, display topology, arbitration, Escape cancellation, update
coalescing, and cleanup. Only the primary display segment mutates daemon region
state or emits events; every segment applies the same response so one logical
scene remains visually continuous across displays.

Affordance rectangles resolve through the object's complete parent transform
chain into an axis-aligned DesktopWorld hit frame. Conventional translation
converts DesktopWorld pointer deltas back into the object's parent space and
refreshes the native hit region after commit.

`createSceneGestureArena()` arbitrates tap, drag, long-press, and radial
recognizers by bounded explicit priority and stable ID order. Drag phases are
always `start`, `update`, `end`, or `cancel`; the recognizer does not imply that
an object moves. `translate`, `aim_commit`, `drop`, and `signal_graph` are
separate declarative responses. Aim-and-commit keeps its object fixed and emits
the route vector for an engine renderer to consume.

`createSceneInteractionController()` binds the generic arena to one
owner/resource lease and emits schema-validated `SceneEventEnvelope` values.
Movement updates are coalesced to render cadence, while start, end, and cancel
are never dropped. Long-press uses a timer only while an undecided pointer
session exists; an idle scene creates no timer or additional frame loop.

`createSceneInteractionVisualController()` is the pure, deterministic visual
state machine for aim-and-commit routes and stock radial menus. It owns no
scheduler or renderer. A host supplies its existing clock through `tick()` and
projects the returned bounded models. `start` and `update` expose a full-stage
arrow while the target object remains fixed; `end` starts a line or wormhole
route; `cancel` removes the preview without changing the scene document.
The route uses global `origin`/`pointer` coordinates, while the committed
`position` remains parent-local so nested objects project and persist correctly.

Aim responses may declare bounded arrow and wormhole styles, duration, and one
of `linear`, `smoothstep`, `ease_in_out_cubic`, or `ease_out_quart` easing.
Radial recognizers may declare up to 32 ID/color/disabled item descriptors and
a bounded stock style. Item zero is centered at the top, placement clamps to
the containing display, and `selection_index` / `selection_active` expose only
numeric selection state through a declarative signal graph. Product labels,
commands, and action semantics stay in the cartridge owner.

The daemon DesktopWorld outlet adapts this controller to a preallocated Three
pool: arrow and trail geometry, a 64-sample route path, two wormhole rings, one
flash, and 32 radial item meshes. It shares the outlet's existing render loop,
coalesces pointer updates at that cadence, and disposes every pooled GPU
resource with the mounted scene. The same global route appears continuously
across display segments because each segment projects the same DesktopWorld
coordinates through its own clipped orthographic camera.

## Implementations, Animation, Signals, And Hosts

`createSceneImplementationRegistry()` is the trusted-code boundary. Scene
documents carry implementation IDs only; a host resolves those IDs to locally
registered geometry, material, texture, shader, effect, and component
factories. Missing or kind-mismatched implementations fail before projection
work begins.

The built-in `aos.scene.signal.bind` component maps one finite numeric signal
to one relative projection target. Bindings support bounded input/output
ranges, clamping, and time-based smoothing. `compileSceneSignalBindings()`
validates them, while `createSceneSignalController()` applies values through a
caller callback. The signal contract accepts no text, audio buffers, prompts,
functions, or arbitrary property paths.

The built-in `aos.scene.animation.bind` component maps an explicit elapsed
clock to one finite numeric projection target. It supports bounded delay and
duration, linear or ease-in-out interpolation, and once, loop, or ping-pong
playback. `createSceneAnimationController()` performs no scheduling and
allocates no event object per binding per tick; the host or consumer owns the
clock. This is a numeric binding primitive, not a general timeline or
consumer-code evaluator.

`createLocalSceneViewportHost()` and `createDesktopWorldSceneHost()` own the
same document, lease, registry, transaction, animation, signal, inspection,
suspension, context-recovery, and disposal policy. Consumers provide a trusted
`prepareProjection()` function that returns their Three scene, renderer,
camera, bounded lifecycle, and deterministic disposal. Candidate projections
activate before the previous projection is disposed; failed preparation leaves
the active revision and projection unchanged.

```js
const registry = createSceneImplementationRegistry({
  entries: [boxGeometry, physicalMaterial],
})
const lease = createSceneLease({
  stageId: 'desktop-world/main',
  ownerId: 'io.example.product',
  resourceId: 'companion/main',
  scopeId: 'connection/42',
})
const host = createLocalSceneViewportHost({
  document,
  lease,
  registry,
  prepareProjection: ({ document, registry, reportContextLost }) => (
    buildProductProjection({ document, registry, reportContextLost })
  ),
})
await host.mount()
await host.transact(transaction)
host.publishSignal('audio.rms', 0.45)
host.tick(500)
host.suspend()
host.resume()
await host.dispose()
```

`host.inspect()` returns `aos.scene.inspection.v1`: object/resource identities,
implementation health, signal binding identities, lifecycle metrics, and
metadata keys without parameter values or metadata content. Default host
budgets cap documents at 1,024 objects, 256 resources, 1,024 numeric signal
bindings, and 1,024 numeric animation bindings. Projection callback failures
are contained and exposed only as redacted counters. The underlying Three
lifecycle retains its stricter canvas limits.

The DesktopWorld host wraps `DesktopWorldSurfaceThree` and mounts the same
prepared projection used by a local viewport. The public `scene-follow`
transport mounts generic registered implementations into the daemon-backed
singleton outlet. Product-specific projection implementations remain local to
the consumer unless they are accepted into this product-neutral registry.

## Three Renderer Lifecycle

`createThreeRenderLifecycle(options)` owns generic renderer mechanics:

- element resize observation plus window-resize fallback;
- effective device-pixel ratio capped at `2` by default;
- backing dimensions capped at `4096` and total backing pixels capped at
  `4,194,304` by default;
- invalid or zero measurements skipped without mutating the renderer;
- requestAnimationFrame suspension while hidden, explicitly suspended, or
  WebGL context-lost;
- context-loss prevention and restoration callbacks;
- idempotent listener, observer, frame, scene-resource, renderer, and context
  disposal.

Use `resolveThreeRenderMetrics()` when a consumer needs the same pure sizing
policy without lifecycle ownership. Product code may lower the limits but
should not raise them without its own memory and canvas acceptance evidence.

```js
const lifecycle = createThreeRenderLifecycle({
  renderer,
  scene,
  camera,
  container,
  onFrame: ({ deltaMs }) => {
    animateScene(deltaMs)
    renderer.render(scene, camera)
  },
  onContextLost: () => showFallback(),
  onContextRestored: () => hideFallback(),
})

lifecycle.start()
// lifecycle.suspend() while a product-owned stage is inactive
// lifecycle.resume() when it becomes visible again
lifecycle.dispose()
```

Only resources reachable from the supplied `scene` and entries explicitly
listed in `additionalDisposables` are disposed. Do not pass shared textures,
materials, controls, or render targets unless this lifecycle owns them.

## DesktopWorld Three Adapter

`DesktopWorldSurfaceThree` (alias `DesktopWorldSurface3D`) extends the generic
DesktopWorld surface adapter with segment-aware orthographic and perspective
camera refresh, viewport refresh, primary-surface state publication, and
secondary-surface state latency measurements. `deriveOrthoCamera()` is the pure
segment-to-frustum projection.

The adapter and renderer lifecycle compose without sharing product policy:

```js
const surface = new DesktopWorldSurfaceThree({ canvasId })
await surface.start({ onState: applySharedState })
surface.mountScene({ scene, camera, renderer, manageViewport: false })

const lifecycle = createThreeRenderLifecycle({
  renderer,
  scene,
  camera,
  container,
  updateCamera: () => surface.refreshCamera(),
  onFrame: () => renderer.render(scene, camera),
})
lifecycle.start()
```

`manageViewport: false` makes the bounded lifecycle the sole resize owner. The
adapter's default remains `true` for existing standalone DesktopWorld consumers.

Use the adapter only when the surface runs on an AOS DesktopWorld canvas.
Product-owned editors can use the renderer lifecycle directly.

## Canvas Lifecycle Projection

The scene package exports the complete neutral projection helpers from
`runtime/canvas-lifecycle.js`:

- `canvasLifecycleCanvasID()` and `mergeCanvasLifecycleCanvas()`;
- `canvasGeometryCanvasID()`, `normalizeCanvasGeometry()`, and
  `mergeCanvasGeometryCanvas()`.

These helpers normalize daemon lifecycle and geometry events. They do not
create, mutate, suspend, or remove canvases.

## Visual Objects And Forms

Scene editors use `createVisualObjectDescriptor()` and the validation helpers
to describe canonical editable state. `applyVisualObjectControllerUpdate()`
performs the state mutation and dispatches injected route and renderer-sync
handlers. `bindVisualObjectForm()` maps a compatible form's field-change events
to those descriptors.

Projection-only descriptors cannot mutate canonical state. Routed editable
descriptors require a state path, route, coercion policy, renderer-sync labels,
group key, and object identities. State remains plain JSON; Three resources are
never stored in descriptors or serialized scene state.

The resource-lifecycle evidence helpers describe rebuilds, retained resources,
disposal balance, renderer synchronization, and JSON serializability. They are
proof contracts, not a resource manager.

## Ownership Boundary

This API owns the generic declarative scene schema, host policy, renderer
lifecycle, numeric signal mapping, transactions, inspection, and binding
mechanics. External products own persona, representation selection, definition
schema, materials and effect recipes, semantic state mapping, editor layout,
persistence, authority, and approval policy.
Importing this package grants no AOS command execution, daemon socket access,
native input, TCC permission, or product identity.
