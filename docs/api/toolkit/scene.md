# Toolkit Scene API

`@agent-os/toolkit/scene` is the narrow package boundary for external scene
authors. It exposes product-neutral DesktopWorld, Three renderer lifecycle,
canvas projection, and visual-object editing primitives without exposing the
broader toolkit implementation tree.

The package does not depend on or bundle Three.js. Consumers own their Three.js
version and pass renderer-, scene-, camera-, and resource-like objects into the
dependency-injected helpers.

## Package Import

```js
import {
  DesktopWorldSurfaceThree,
  canonicalizeSceneDocument,
  createSceneLease,
  createThreeRenderLifecycle,
  createVisualObjectDescriptor,
  bindVisualObjectForm,
  validateSceneTransaction,
} from '@agent-os/toolkit/scene'
```

The package export includes `scene/index.d.ts` for TypeScript consumers. Direct
imports into `runtime/` or `workbench/` are not part of this external package
contract.

## Declarative Scene Contracts

`aos.scene.document.v1` describes a bounded object/resource graph without
consumer JavaScript. `canonicalizeSceneDocument()` validates exact fields,
hierarchy, resource references, finite JSON parameters, per-resource asset
limits, and a 256 MiB aggregate asset limit before returning key-sorted data.
`sceneDocumentRequiredImplementations()` reports the registered geometry,
material, effect, and component implementations needed to render it.

`aos.scene.transaction.v1` carries owner/resource-scoped, revision-checked
operations. `validateSceneTransaction()` validates the envelope and bounded
operations; the future stage host remains responsible for lease ownership,
revision matching, resource availability, and atomic application.

`createSceneLease()` produces an `aos.scene.lease.v1` identity containing the
stage, owner, resource, and ResourceScope IDs. The contract does not create a
daemon lease or shared renderer by itself.

This initial contract slice is not evidence that the shared DesktopWorld 3D
host is operational. Existing Three consumers still use the standalone adapter
until the daemon and toolkit host slices are delivered.

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

This API owns reusable renderer and binding mechanics only. External products
own persona, representation selection, scene schema, materials, effects,
animation mapping, editor layout, persistence, authority, and approval policy.
Importing this package grants no AOS command execution, daemon socket access,
native input, TCC permission, or product identity.
