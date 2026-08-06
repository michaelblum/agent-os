# AOS Semantic Targets And Target Descriptors

Version: `1.0.0`

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

Each canvas entry carries a required V1 Locator `handle` plus presentation,
provenance, state, and capability facts. Browser xray elements carry a required
Observation Ref `handle` containing the response's `state_id`, browser session,
and Playwright ref. Human-facing names, labels, accessible text, UI copy, DOM
ids, and geometry are not durable target identity.

## Public Handle Types

An **Observation Ref** is exactly the pair returned by one perception state:

```json
{
  "kind": "observation_ref",
  "backend": "browser",
  "state_id": "see_abc123def456",
  "scope": { "session": "todo" },
  "ref": "e21"
}
```

It is ephemeral. If that pair is not current, action rejects with a typed stale
result; an Observation Ref is never automatically reacquired.

A **Locator** is a declarative query made from machine facts, for example:

```json
{
  "kind": "locator",
  "backend": "aos_canvas",
  "query": { "canvas_id": "settings", "ref": "save" }
}
```

A Locator re-resolves on every operation. Exactly one action-compatible match is
required; zero matches return `missing` and multiple matches return `ambiguous`
with bounded candidate descriptors. Labels and source ids may be hints, but a
caller must not use them as unique identity by themselves.

The closed union is defined by `aos-target-handle-v1.schema.json`. V1 does not
expose a general Locator grammar, a browser Locator, or a native Observation
Ref. Native AX capture emits a Locator handle only when the platform supplies
a non-empty role and omits empty optional title, label, or identifier fields;
the raw observation facts remain otherwise unchanged.

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

For canvas semantic targets, `ref` is one machine component of the emitted
Locator query. The complete canvas handle also carries `canvas_id`; the ref is
not snapshot identity or a browser Observation Ref.

The capture response carries `state_id` at top level. Browser element handles
repeat that value because their original `(state_id, ref)` pair is the
Observation Ref; canvas Locator handles do not carry or accept state.

`provenance.canvas_id` is the canvas requested by `--canvas`.

`provenance.do_target` is the target-with-ref string accepted by `aos do click`.
It is emitted only when both `provenance.canvas_id` and `ref` are present, and
agents may pass it directly to `aos do click` without reconstructing the target
string. `provenance.canvas_id` and `ref` remain present for structured querying
and filtering.

`role` is the explicit DOM role when present, otherwise the closest native
control role.

`name` is the accessible name, usually `aria-label`, not an implementation id.
It may be displayed to humans but is not machine identity.

`actions` is the canonical primitive action list for the target. It names what
`aos do` can attempt, such as `click`, `drag`, `set-value`, `focus`, `select`,
`toggle`, or `open`. The current producer reads `data-aos-actions` and
`data-aos-primitive-actions`; when neither is present it derives defaults from
the control role. Singular `data-aos-action` does not populate this list.

`extension.action_id` is produced by the fixed probe from singular
`data-aos-action`, but the current public decoder does not preserve that field.
If retained in a later decoder change, it remains consumer-owned routing and
inspection data, not a primitive `aos do` capability, action authority, or
durable target identity.

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

Current Locator resolution uses the closed backend-specific machine query from
the handle. It re-resolves at action time and requires exactly one current,
action-compatible match. Label/accessibility text outside a native AX Locator
query is a presentation hint only. If a Locator matches more than one target,
the result remains `TARGET_AMBIGUOUS` with bounded candidate facts; callers must
not pick the first same-label target. Native traversal depth is capped at 128
and resolution timeout at 30000 milliseconds.

## Resolution Status

Observation Ref resolution returns:

- `resolved`: the supplied `(state_id, ref)` pair is current and names one
  enabled, action-compatible observed target.
- `TARGET_STATE_STALE`: the state is no longer current, the ref is absent from
  that state, or the pair does not match.
- `TARGET_ACTION_UNSUPPORTED`: the observed target cannot perform the requested
  action.

Locator resolution returns:

- `resolved`: the query found exactly one enabled, action-compatible current
  target.
- `TARGET_NOT_FOUND`: the query found no current target.
- `TARGET_AMBIGUOUS`: the query found more than one current target.
- `TARGET_ACTION_UNSUPPORTED`: the uniquely located target cannot perform the
  action.

Stale, missing, ambiguous, and unsupported outcomes block action and return a
machine-readable `status`, `reason`, supplied/current state ids when relevant,
and bounded candidate descriptors for ambiguity.

Browser Observation Ref results use `TARGET_STATE_REQUIRED`,
`TARGET_STATE_STALE`, `TARGET_HANDLE_INVALID`, `TARGET_DISABLED`, or
`TARGET_ACTION_UNSUPPORTED`. Locator resolution uses `TARGET_NOT_FOUND`,
`TARGET_AMBIGUOUS`, `TARGET_DISABLED`, `TARGET_ACTION_UNSUPPORTED`, or
`TARGET_RESOLUTION_TIMEOUT`. Candidate facts are bounded and fidelity-first.
