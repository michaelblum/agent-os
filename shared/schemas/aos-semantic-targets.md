# AOS Semantic Targets And Target Descriptors

Version: `0.3.0`

`semantic_targets` is the AOS-owned canvas target projection emitted by:

```bash
aos see capture --canvas <canvas-id> --xray
```

This is not a new UI language. It is a machine-readable projection of facts the
canvas already owns:

- role, name, state, and disabled/value semantics from standard AX/ARIA/native
  controls
- local geometry in `provenance` from the element's DOM frame in the capture
  image's local coordinate space
- AOS target metadata from `data-aos-ref`, `data-aos-actions`,
  `data-aos-primitive-actions`, app-local `data-aos-action`, `data-aos-surface`,
  `data-semantic-target-id`, and `data-aos-parent-canvas`

The projection is raw and fidelity-first. It does not classify sensitivity,
mask values, or choose what may reach a model or disk. Callers own any explicit
masking, redaction, persistence, or projection transform. Values withheld by an
upstream API remain absent as an upstream/platform fact.

The CLI gathers this data through a fixed internal probe. Agents should prefer
this field for AOS-owned canvases and reserve `show eval` for developer
diagnostics.

Each current emitted entry carries the `ref` component plus presentation,
address/provenance, state, and capability facts. The capture response carries
`state_id` at top level; consumers pair it with an entry's `ref` to form the
Observation Ref. The current projection does not emit a Locator object,
`target` namespace, structural path, or reacquisition fingerprint. The Locator
example below is the contract for the later runtime/schema migration, not a
claim about the current emitted entry shape. Human-facing names, labels,
accessible text, UI copy, DOM ids, and geometry are not durable target identity.

## Public Handle Types

An **Observation Ref** is exactly the pair returned by one perception state:

```json
{ "state_id": "see_abc123def456", "ref": "example-menu-item-wiki-graph" }
```

It is ephemeral. If that pair is not current, action rejects with a typed stale
result; an Observation Ref is never automatically reacquired.

A **Locator** is a declarative query made from machine facts, for example:

```json
{
  "target": {
    "target_id": "radial-item:wiki-graph",
    "owner_namespace": {
      "app_id": "example",
      "canvas_id": "example-menu",
      "surface_id": "example-menu",
      "component_family": "example.menu",
      "structural_owner": ["example-root", "menu"]
    }
  },
  "role": "button",
  "structural_path": ["menu", "item:wiki-graph"]
}
```

A Locator re-resolves on every operation. Exactly one action-compatible match is
required; zero matches return `missing` and multiple matches return `ambiguous`
with bounded candidate descriptors. Labels and source ids may be hints, but a
caller must not use them as unique identity by themselves.

These examples define semantic types, not a currently callable Locator wire
grammar. Public command/schema forms arrive with the later runtime migration;
current transport and emitted-shape discrepancies are inventoried below.

## Shape

```json
{
  "state_id": "see_abc123def456",
  "semantic_targets": [
    {
      "ref": "example-menu-item-wiki-graph",
      "surface": "example-menu",
      "role": "button",
      "name": "Wiki Graph",
      "kind": "semantic_target",
      "enabled": true,
      "state": { "current": "true" },
      "actions": ["click"],
      "extension": {
        "dom_id": "wiki-graph",
        "action_id": "open-wiki-graph",
        "source": { "path": null, "line_start": null, "line_end": null }
      },
      "provenance": {
        "canvas_id": "example-menu",
        "do_target": "canvas:example-menu/example-menu-item-wiki-graph",
        "parent_canvas_id": "example-root",
        "source_payload_id": "wiki-graph",
        "bounds": { "x": 40, "y": 24, "width": 56, "height": 56 },
        "frame": { "x": 40, "y": 24, "width": 56, "height": 56 },
        "center": { "x": 68, "y": 52 }
      }
    }
  ]
}
```

## Field Notes

`ref` is one component of the state-scoped Observation Ref from the current
perception state. It is not a complete handle without `state_id` and is not
durable identity.

`state_id` is top-level capture-response data for the perception state that
scoped every emitted `ref`; it is not currently repeated inside each semantic
target entry. An action that carries a stale `state_id`/`ref` pair must reject
with machine-readable stale status instead of silently acting on a different
target.

`target.target_id`, `target.owner_namespace`, structural path, and
`reacquisition` in the Locator example are planned contract material, not
fields emitted by the current `semantic_targets` projection. Their later wire
schema must preserve an explicit collision domain and must not derive identity
from `name`, `label`, accessible text, DOM ids, display/window geometry, or
canvas coordinates.

`provenance.canvas_id` is the canvas requested by `--canvas`.

`provenance.do_target` is the target-with-ref string accepted by `aos do click`.
It is emitted only when both `provenance.canvas_id` and `ref` are present, and
agents may pass it directly to `aos do click` without reconstructing the target
string. `provenance.canvas_id` and `ref` remain present for structured querying
and filtering.

`role` is the explicit DOM role when present, otherwise the closest native
control role.

`name` is the accessible name, usually `aria-label`, not an implementation id.
It may be displayed to humans and may become a Locator hint after migration,
but it is not machine identity.

`actions` is the canonical primitive action list for the target. It names what
`aos do` can attempt, such as `click`, `drag`, `set-value`, `focus`, `select`,
`toggle`, or `open`. The current producer reads `data-aos-actions` and
`data-aos-primitive-actions`; when neither is present it derives defaults from
the control role. Singular `data-aos-action` does not populate this list.

`extension.action_id` preserves the app-local action identifier supplied by
singular `data-aos-action` for consumer-owned routing and inspection. It is not
a primitive `aos do` capability, action authority, or durable target identity.

`surface` and `provenance.parent_canvas_id` identify the AOS surface
relationship without polluting the accessible name.

`provenance.bounds`, `provenance.frame`, and `provenance.center` use the same
local image coordinate space as capture/xray output for that canvas.
Coordinates are observations and current action-routing aids; they are not
durable identity.

`geometry` is optional control-specific actionable geometry. Toolkit sliders
may include `control_bounds`, `track_bounds`, and `thumb_bounds` in the same
local image coordinate space so action code can resolve current points for
human playback without asking agents to choose pixels.

`state` is present only when the control exposes state such as `current`,
`pressed`, `selected`, `checked`, `expanded`, or `value`. Disabled state is
reported as top-level `enabled: false`. Sliders
may additionally expose `values`, `min`, `max`, `step`, `orientation`, and
`thumb_count`. Multi-thumb sliders should advertise `drag` but not single-value
`set-value` unless a thumb-specific target exists.

`metadata` is optional JSON metadata copied from `data-aos-metadata` for
debugging and higher-level routing. It is not required for target resolution.

Future Locator resolution must use machine facts first: `owner_namespace`,
`target_id`, `role`, structural path, capabilities, source payload ids, range
shape, and nearby groups. Label/accessibility text belongs only in hint fields.
If a Locator matches more than one current target, the result must stay explicit
with an `ambiguous` status and bounded candidate list; callers must not pick the
first same-label target.

## Resolution Status

Observation Ref resolution returns:

- `resolved`: the supplied `(state_id, ref)` pair is current and names one
  enabled, action-compatible observed target.
- `stale_ref`: the state is no longer current, the ref is absent from that
  state, or the pair does not match.
- `unsupported`: the observed target cannot perform the requested action.

Locator resolution returns:

- `resolved`: the query found exactly one enabled, action-compatible current
  target.
- `missing`: the query found no current target.
- `ambiguous`: the query found more than one current target.
- `unsupported`: the uniquely located target cannot perform the action.

Stale, missing, ambiguous, and unsupported outcomes block action and return a
machine-readable `status`, `reason`, supplied/current state ids when relevant,
and bounded candidate descriptors for ambiguity.

## Current Implementation Gap

Current routes do not consistently require `state_id` with `ref`; saved
workspace wrappers can accept bare saved handles and report `reacquired` after
automatic current-target validation. Those are implementation facts awaiting
the runtime migration, not a third public target type or an exception to the
Observation Ref/Locator split. The current `semantic_targets` entries also do
not emit the planned Locator query object or fingerprint fields. The internal
probe reads singular `data-aos-action` into the admitted app-local
`extension.action_id` field, but the current public decoder does not preserve
that field; it neither reaches the emitted entry nor contributes to primitive
`actions`.
