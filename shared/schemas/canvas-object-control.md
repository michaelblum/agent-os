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
      "object_id": "radial.wiki-brain.group",
      "name": "Wiki Brain",
      "kind": "three.object3d",
      "capabilities": ["transform.read", "transform.patch", "visibility.read", "visibility.patch"],
      "visible": true,
      "transform": {
        "position": { "x": 0.018, "y": -0.035, "z": 0.018 },
        "scale": { "x": 1.32, "y": 1.42, "z": 1.2 },
        "rotation_degrees": { "x": -11.5, "y": 0, "z": 0 }
      },
      "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees"
      },
      "descriptors": {
        "geometry": "Complete wiki-graph menu item composition made from shell, fiber, and fractal-tree layers.",
        "animation_effects": "Whole composition scales and reveals against the radial menu item orbit path."
      }
    },
    {
      "object_id": "radial.wiki-brain.fractal-tree",
      "parent_object_id": "radial.wiki-brain.group",
      "name": "Fractal Tree",
      "kind": "three.object3d",
      "capabilities": ["transform.read", "transform.patch", "visibility.read", "visibility.patch"],
      "visible": true,
      "transform": {
        "position": { "x": 0.02, "y": -0.054, "z": -0.006 },
        "scale": { "x": 1.85, "y": 2.65, "z": 2.61 },
        "rotation_degrees": { "x": -8, "y": 86, "z": 8 }
      },
      "units": {
        "position": "scene",
        "scale": "multiplier",
        "rotation": "degrees"
      },
      "descriptors": {
        "geometry": "Recursive neural tree nested inside the glass brain shell.",
        "animation_effects": "Tree growth, glow, and branch-travel particles react to reveal pressure."
      }
    }
  ]
}
```

`parent_object_id` is optional. When present, consumers may render a nested
object tree under the referenced object in the same `canvas_id`. Descriptors are
optional natural-language annotations for human-agent editing surfaces.
`controls.animation_effects` is optional JSON data that lets a surface render
compact controls for owner-specific animations/effects. The JSON data is
editable state; the rendered form is a projection of that data, not a separate
agent-generated UI contract.

Objects that expose tunable effects advertise `effects.read` and
`effects.patch`, then include control definitions:

```json
{
  "object_id": "radial.wiki-brain.fiber-optics",
  "name": "Fiber Optics",
  "kind": "three.object3d",
  "capabilities": ["transform.read", "transform.patch", "visibility.read", "visibility.patch", "effects.read", "effects.patch"],
  "controls": {
    "animation_effects": [
      {
        "id": "fiberPulse.intensity",
        "label": "Fiber pulse",
        "type": "range",
        "value": 1,
        "min": 0,
        "max": 3,
        "step": 0.05,
        "tooltip": "Scale fiber line and spark brightness"
      }
    ]
  }
}
```

`canvas_object.transform.patch` is a command. A controller targets one object by
`canvas_id + object_id` and sends only the transform components or visibility
state it wants to change:

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
    "scale": { "x": 1.4, "y": 1.5, "z": 1.25 },
    "visible": true
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
  },
  "visible": true
}
```

`canvas_object.effects.patch` is a command for JSON-declared effect controls. A
controller sends changed control values by id:

```json
{
  "type": "canvas_object.effects.patch",
  "schema_version": "2026-05-03",
  "request_id": "req-effects-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.fiber-optics"
  },
  "patch": {
    "controls": {
      "fiberPulse.intensity": 1.35
    }
  }
}
```

`canvas_object.effects.result` reports the values the owner accepted:

```json
{
  "type": "canvas_object.effects.result",
  "schema_version": "2026-05-03",
  "request_id": "req-effects-42",
  "target": {
    "canvas_id": "avatar-main",
    "object_id": "radial.wiki-brain.fiber-optics"
  },
  "status": "applied",
  "controls": {
    "fiberPulse.intensity": 1.35
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

Effect patches follow the same command/result shape, but they carry only named
control values. The owner remains responsible for interpreting those values and
for publishing a later registry snapshot with updated JSON control state.

V0 runtime routing uses existing AOS canvas plumbing:

- owner registry publish: toolkit `emit('canvas_object.registry', snapshot)` to
  daemon fan-out for subscribers
- controller registry subscribe: toolkit `subscribe(['canvas_object.registry'])`
- transform patch delivery: toolkit/daemon canvas message delivery to the
  owning `canvas_id`
- transform result delivery: direct response to the requesting canvas or a
  subscribed result stream, depending on the implementing surface
- effects patch/result delivery: same route and correlation rules as transform
  patch/result

The contract is bus-shaped only at the boundary: typed messages, structured
addresses, explicit state-vs-command semantics, and correlation IDs for commands.
It is not a request to build a general AOS bus.

## Mismatch Handling

Implementations should log malformed registry, patch, and result payloads with
the message type, schema version, target address, request id when present, and
validation failure. Contract drift should be corrected at this schema boundary
instead of hidden in adopter-specific parsing.
