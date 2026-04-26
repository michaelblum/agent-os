# Sigil Boot Side-Effect Classification

This note classifies the current Sigil renderer boot sequence for migration to
`DesktopWorldSurfaceThree`. Source reference:
`apps/sigil/renderer/live-modules/main.js`.

## Once Per Surface

These side effects must be gated behind `surface.runOnPrimary(...)` because they
mutate daemon-visible state or subscribe to global streams.

| Line | Side effect | Reason |
| --- | --- | --- |
| 591 | `host.install()` | Installs the host bridge used by global daemon messages. The bridge must exist before primary subscriptions and request/response traffic, but should not imply multiple owners. |
| 592 | `host.onMessage(handleHostMessage)` | Registers global message handling for display, input, canvas messages, lifecycle, and position state. Running this in every segment duplicates the state machine. |
| 596 | `host.subscribe(['display_geometry', 'input_event', 'canvas_message'], { snapshot: true })` | Subscribes to global streams. If every segment subscribes, every input event and canvas message is processed multiple times. |
| 597 | `startMarkHeartbeat()` | Publishes `canvas_object.marks`; multiple segments would duplicate mark heartbeats. |
| 598 | `hitTarget.ensureCreated()` | Creates an interactive child canvas. It must happen once for the logical avatar, not once per segment. |
| 626 | `postLastPositionToDaemon()` callback during fast travel | Writes daemon position state. Followers should render replicated state only. |
| 690 | `hitTarget.sync(...)` | Moves the single child hit target. Followers should not race the primary. |
| 718 | `host.post('lifecycle.complete', ...)` | Acknowledges one logical lifecycle transition. Followers must not produce duplicate lifecycle completions. |

## Per Segment

These side effects are local to a physical web view and should run in every
segment.

| Line | Side effect | Reason |
| --- | --- | --- |
| 593 | `overlay.mount()` | Creates local DOM/canvas overlay for drawing segment-local interaction affordances. |
| 594 | `visibilityTransition.mount()` | Creates local DOM/canvas state needed by each renderer. |
| 595 | `fastTravel.mount()` | Creates local drawing resources; primary owns state mutation, but each segment renders. |
| 604 | `initScene()` | Creates a local Three.js renderer and cameras for the segment web view. |
| 605-613 | Scene object creation and color/geometry setup | Builds local Three.js objects; every web view needs its own GPU resources. |
| 615 | `scheduleRenderFrame()` | Each segment has its own render loop. Primary mutates shared state; followers render replicated state. |

## Legacy Clamp

The stale-bounds clamp previously lived in
`apps/sigil/renderer/live-modules/main.js` near the `display_geometry` handler.
It was removed after the renderer started using segment-aware DesktopWorld
coordinates.
