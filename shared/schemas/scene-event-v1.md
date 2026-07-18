# AOS DesktopWorld Scene Event v1

**File:** `scene-event-v1.schema.json`

`aos.scene.event.v1` is the bounded product-neutral gesture envelope emitted by
the DesktopWorld scene engine. It is delivered as `service: "scene"`,
`event: "gesture"` data only to a client that subscribed on the same
owner/resource `scene-follow` lease.

## Identity And Ordering

Every event carries the stage, owner, resource, affordance, interaction,
pointer-session, gesture, and monotonically increasing lease sequence. The
stage is `desktop-world/main`. Owner/resource identity is validated before the
daemon acquires the lease and cannot be changed by later operations.

## Gesture Lifecycle

The supported kinds are `tap`, `drag`, `long_press`, and `radial`. Phases are
`start`, `update`, `end`, and `cancel`. Movement updates may be coalesced to the
render cadence; start, end, and cancel are never dropped. Cancellation reasons
are bounded to engine lifecycle facts such as Escape, pointer loss, ownership
loss, resource mutation/removal/suspension, topology change, or stage disposal.

Coordinates preserve origin, previous/current points, deltas, DesktopWorld and
native projections, plus a bounded display-topology snapshot. Declarative
responses are `translate`, `aim_commit`, `drop`, or `signal_graph`. Drag itself
does not imply translation.

## Data Boundary

The schema rejects additional fields. Events never carry scene documents,
scripts, product state names, prompts, text, audio, captures, or arbitrary
executor return values. Applied results are limited to revision, boolean
application state, and bounded signal counts.

Run:

```sh
node --test tests/schemas/scene-event-v1.test.mjs tests/schemas/daemon-event.test.mjs
```
