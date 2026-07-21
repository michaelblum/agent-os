# Scene Runtime

Use `@agent-os/toolkit/scene/runtime` for the high-level DesktopWorld session,
dependency-injected hosts, numeric signals and animation, renderer lifecycle,
and the segment-aware Three adapter.

## DesktopWorld Session

`createDesktopWorldSceneSession()` wraps the public `scene-follow` protocol.
The caller injects a `SceneFollowTransportFactory`; the toolkit never discovers
a runtime path, opens the private socket, or starts a daemon.

The session exposes `open`, `mount`, `transact`, `signal`, `play`, `suspend`,
`resume`, `inspect`, `subscribe`, `remove`, `close`, and `snapshot`.

```js
import {
  createDesktopWorldSceneSession,
} from '@agent-os/toolkit/scene/runtime'

const session = createDesktopWorldSceneSession({
  stageId: 'desktop-world/main',
  ownerId: 'example.consumer',
  resourceId: 'companion/main',
  connect: sceneFollowTransportFactory,
})

await session.open()
await session.mount({ document, interactions })
const stopGestures = await session.subscribe('gesture', handleGesture)
await session.transact(transaction)
await session.signal('audio.rms', 0.45, 500)
await session.play('idle-spin')
await session.inspect()
await stopGestures()
await session.close()
```

`sceneFollowTransportFactory` is supplied by the product adapter and returns
the public transport handle described by `SceneFollowTransportFactory`. A
complete fake-transport implementation is runnable with:

```bash
node packages/toolkit/scene/examples/session-lifecycle.mjs \
  --cartridge ./scene-work/companion
```

## Serialization And Recovery

One operation runs at a time. Canonical document state advances only after the
authoritative all-display result succeeds. Responses and events from prior
connection generations are ignored.

On one recoverable transport or stage loss, the session reconnects once and
remounts the last committed document, subscriptions, and suspended state. It
never replays transient signals, animation plays, or the uncertain in-flight
operation. A second recovery failure terminally faults the session. `close()`
is idempotent and releases the connection-scoped lease.

The error-code authority is exported with the implementation:

```js
import {
  DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES,
  DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES,
} from '@agent-os/toolkit/scene/runtime'
```

Documentation and agents consume those arrays; they do not maintain a second
handwritten error list. Malformed NDJSON, invalid or out-of-order envelopes,
line/rate/stderr overflow, and consumer failures are terminal protocol faults.

## One Global Coordinate Plane

Scene positions and scales use the global DesktopWorld coordinate plane. AOS
segments that plane across physical displays and derives one clipped
orthographic camera per segment. A resource can straddle displays or animate
between them without the author reconciling display-local coordinates.

Every segment applies the same operation and reports an origin-attributed
internal result. The daemon accepts only the current canvas and topology
generation and emits one authoritative public result after the all-segment
barrier settles. Advanced status anchors or native-input operations may expose
explicit display and native geometry; ordinary scene authoring does not.

## Hosts, Signals, And Animation

`createLocalSceneViewportHost()` and `createDesktopWorldSceneHost()` share
document, lease, registry, transaction, inspection, suspension,
context-recovery, and disposal policy. Consumers inject a trusted
`prepareProjection()` function. Candidate preparation never mutates the active
projection, and failed preparation leaves the committed revision unchanged.

`aos.scene.signal.bind` maps one finite numeric signal through bounded input,
output, clamp, and smoothing rules. It accepts no text, audio buffers, prompts,
functions, or arbitrary property paths.

`aos.scene.animation.bind` maps an explicit elapsed clock through bounded
delay, duration, easing, and once/loop/ping-pong playback. The controller owns
no scheduler and allocates no event object per binding per tick. A completed
one-shot remains complete until an explicit restart.

## Renderer Lifecycle

`createThreeRenderLifecycle()` owns resize observation, DPR and backing-pixel
limits, visibility and context-loss suspension, the caller-supplied render
callback, and idempotent disposal. Default DPR is capped at 2, backing
dimensions at 4096, and backing pixels at 4,194,304. DesktopWorld lowers its
per-display-segment pixel ceiling to 2,097,152.

`DesktopWorldSurfaceThree` (alias `DesktopWorldSurface3D`) adds segment-aware
camera and viewport refresh. `deriveOrthoCamera()` is the pure segment-to-frustum
projection. Use `manageViewport: false` when `createThreeRenderLifecycle()` is
the sole resize owner.

`DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS` and
`evaluateDesktopWorldPerformanceAcceptance()` provide the content-free engine
acceptance contract. Historical product renderers are appearance references,
not performance baselines.

## Inspection And Cleanup

`host.inspect()` returns `aos.scene.inspection.v1`: identities, implementation
health, binding IDs, lifecycle metrics, and metadata keys without parameter or
metadata content. Projection callback failures become redacted counters.

Only resources reachable from an owned scene and explicitly supplied
disposables are released. Do not hand a lifecycle shared textures, materials,
controls, or render targets it does not own. Always close the scene session in
`finally` when the consumer no longer owns the resource.
