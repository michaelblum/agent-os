# AOS DesktopWorld Scene Event v1

**File:** `scene-event-v1.schema.json`

`aos.scene.event.v1` is the bounded product-neutral gesture envelope emitted by
the DesktopWorld scene engine. It is delivered as `service: "scene"`,
`event: "gesture"` data only to a client that subscribed on the same
owner/resource `scene-follow` lease.

## ADR 0040 Transition Boundary

Runtime migration must expose without omission the raw gesture facts already
admitted to this bounded public envelope, or require an explicit caller-owned
transform. This does not widen the envelope to adjacent scene documents,
scripts, product state, prompts, text, audio, captures, or arbitrary executor
values; those categories remain outside the product-neutral gesture contract.

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
responses are `translate`, `aim_commit`, `drop`, `radial_menu`, or
`signal_graph`. Drag itself does not imply translation.

Current `radial_menu` responses contain bounded visual data and canonical item
IDs. Item labels support native accessibility and semantic inspection but
remain outside this product-neutral gesture envelope. A
tap-open menu keeps a transient AOS-owned hit-region lease after the
trigger gesture. Pointer movement emits focus and blur updates, while item
selection and menu cancellation retain complete gesture lifecycles.

An `aim_commit` response keeps the projected object at its origin through
`start` and `update`. It carries the bounded parent-local destination in
`position`; `pointer` remains the global DesktopWorld destination used for the
route visual. Only an accepted `end` commits the parent-local destination and
starts the selected line or wormhole route. Cancellation leaves the document
unchanged.

## Data Boundary

The schema rejects additional fields. Scene documents, scripts, product state
names, prompts, text, audio, captures, and arbitrary executor return values are
outside this bounded product-neutral gesture envelope; their exclusion is not
an ADR 0040 raw-output gap. Current applied results expose revision, boolean
application state, and bounded signal counts, and those admitted result facts
must not be silently omitted or redacted.

Run:

```sh
node --test tests/schemas/scene-event-v1.test.mjs tests/schemas/daemon-event.test.mjs
```
