# Canvas Object Control

The canvas object control contract describes addressable, canvas-owned objects
that reusable AOS toolkit surfaces may inspect or request transform changes for.
It is intentionally narrower than a generic event bus. The JSON Schema source of
truth is
[`canvas-object-control.schema.json`](canvas-object-control.schema.json).

## Message Types

`canvas_object.registry` is a latest-state snapshot. A canvas that owns
addressable objects publishes the full set it wants controllers to see:

```json
{
  "type": "canvas_object.registry",
  "schema_version": "2026-05-03",
  "canvas_id": "avatar-main",
  "objects": [
    {
      "object_id": "radial.wiki-brain.tree",
      "name": "Wiki Brain Tree",
      "kind": "three.object3d",
      "capabilities": ["transform.read", "transform.patch"],
      "transform": {
        "position": { "x": 0.018, "y": -0.035, "z": 0.018 },
        "scale": { "x": 1.32, "y": 1.42, "z": 1.2 },
        "rotation_degrees": { "x": -11.5, "y": 0, "z": 0 }
      },
      "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees"
      }
    }
  ]
}
```

`canvas_object.transform.patch` is a command. A controller targets one object by
`canvas_id + object_id` and sends only the transform components it wants to
change:

```json
{
  "type": "canvas_object.transform.patch",
  "schema_version": "2026-05-03",
  "request_id": "req-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.tree"
  },
  "patch": {
    "scale": { "x": 1.4, "y": 1.5, "z": 1.25 }
  }
}
```

`canvas_object.transform.result` is the owner response. Owners report whether the
patch was applied, rejected, or stale:

```json
{
  "type": "canvas_object.transform.result",
  "schema_version": "2026-05-03",
  "request_id": "req-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.tree"
  },
  "status": "applied",
  "transform": {
    "position": { "x": 0.018, "y": -0.035, "z": 0.018 },
    "scale": { "x": 1.4, "y": 1.5, "z": 1.25 },
    "rotation_degrees": { "x": -11.5, "y": 0, "z": 0 }
  }
}
```

## Delivery Semantics

Registry snapshots are retained-state messages. Each
`canvas_object.registry` emit fully replaces the advertised object list for its
`canvas_id`. An empty `objects` array clears the owner's registry. Consumers must
evict registry entries when the owning canvas is removed and should treat stale
registries as unavailable if the owner stops publishing.

Transform patches are commands, not state. The owner canvas validates the target,
capability, and patch values before applying them. Controllers should correlate
responses by `request_id` and use the next registry snapshot as the eventual
state authority.

The initial routing should use existing AOS canvas plumbing:

- owner registry publish: toolkit `emit('canvas_object.registry', snapshot)` to
  daemon fan-out for subscribers
- controller registry subscribe: toolkit `subscribe(['canvas_object.registry'])`
- transform patch delivery: toolkit/daemon canvas message delivery to the
  owning `canvas_id`
- transform result delivery: direct response to the requesting canvas or a
  subscribed result stream, depending on the implementing surface

The contract is bus-shaped only at the boundary: typed messages, structured
addresses, explicit state-vs-command semantics, and correlation IDs for commands.
It is not a request to build a general AOS bus.

## Mismatch Handling

Implementations should log malformed registry, patch, and result payloads with
the message type, schema version, target address, request id when present, and
validation failure. Contract drift should be corrected at this schema boundary
instead of hidden in adopter-specific parsing.
