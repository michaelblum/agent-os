# AOS Semantic Targets And Target Descriptors

Version: `0.2.0`

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
- AOS ownership metadata from `data-aos-ref`, `data-aos-action`,
  `data-aos-actions`, `data-aos-surface`, `data-semantic-target-id`, and
  `data-aos-parent-canvas`

The CLI gathers this data through a fixed internal probe. Agents should prefer
this field for AOS-owned canvases and reserve `show eval` for developer
diagnostics.

Each entry is also a V0 target descriptor. The descriptor separates the
state-scoped model-facing action handle from durable machine identity,
presentation labels, current address/provenance, state, capabilities, and
reacquisition hints. Human-facing names, labels, accessible text, UI copy, DOM
ids, and geometry are not durable target identity.

## Shape

```json
{
  "semantic_targets": [
    {
      "ref": "example-menu-item-wiki-graph",
      "state_id": "see_abc123def456",
      "surface": "example-menu",
      "role": "button",
      "name": "Wiki Graph",
      "kind": "semantic_target",
      "enabled": true,
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
      "state": { "current": "true" },
      "actions": ["wiki-graph"],
      "extension": {
        "dom_id": "wiki-graph",
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
      },
      "reacquisition": {
        "strategy": "owner-structural-fingerprint",
        "machine_fingerprint": {
          "role": "button",
          "structural_path": ["menu", "item:wiki-graph"],
          "capabilities": ["click", "open"],
          "nearby_group": "Example menu"
        },
        "hint_fingerprint": {
          "label_hints": ["Wiki Graph"],
          "source_hints": { "dom_id": "wiki-graph" }
        }
      }
    }
  ]
}
```

## Field Notes

`ref` is the state-scoped model-facing action handle from the current
perception state. It is convenient for immediate `aos do` calls and may become
stale after the surface changes. It is not durable identity.

`state_id` is the perception state that scoped the `ref`, when available. An
action that carries a stale `state_id`/`ref` pair must reject or report
machine-readable stale status instead of silently acting on a different target.

`target.target_id` is a durable machine identity within
`target.owner_namespace`. The durable identity key is the pair
`owner_namespace` + `target_id`; callers must not derive it from `name`,
`label`, accessible text, DOM ids, display/window geometry, or canvas
coordinates.

`target.owner_namespace` is the explicit collision domain for the target. It
contains app, canvas, surface, component/schema family, and structural owner
facts needed to distinguish same-label or same-local-id controls on different
surfaces. Geometry and current address facts do not belong here.

`provenance.canvas_id` is the canvas requested by `--canvas`.

`provenance.do_target` is the target-with-ref string accepted by `aos do click`.
It is emitted only when both `provenance.canvas_id` and `ref` are present, and
agents may pass it directly to `aos do click` without reconstructing the target
string. `provenance.canvas_id` and `ref` remain present for structured querying
and filtering.

`role` is the explicit DOM role when present, otherwise the closest native
control role.

`name` is the accessible name, usually `aria-label`, not an implementation id.
It may be displayed to humans and may appear in reacquisition hints, but it is
not machine identity.

`actions` is the canonical primitive action list for the target. It names what
`aos do` can attempt, such as `click`, `drag`, `set-value`, `focus`, `select`,
`toggle`, or `open`. The producer converts `data-aos-action` to a one-item list
when no primitive action list is present.

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

`reacquisition` is a bounded fingerprint for searching for a current target
after a stale ref. Reacquisition must use machine facts first:
`owner_namespace`, `target_id`, `role`, structural path, capabilities, source
payload ids, range shape, and nearby groups. Label/accessibility text belongs
only in hint fields. If the fingerprint matches more than one current target,
the result must stay explicit with an `ambiguous` status and candidate list;
callers must not pick the first same-label target.

## Stale Ref And Reacquisition Status

Target-addressed actions that carry both `ref` and `state_id` compare the
supplied state with the current perception state when that check is available.
The deterministic statuses are:

- `resolved`: the supplied `state_id`/`ref` pair is current and resolves to one
  enabled target.
- `stale_ref`: the supplied `state_id` is no longer current or the old `ref`
  is absent from the current state.
- `reacquired`: a stale descriptor fingerprint resolved to exactly one current
  target through machine facts, with labels used only as hints.
- `ambiguous`: reacquisition found more than one plausible current target.
- `missing`: neither the ref nor the descriptor fingerprint found a candidate.
- `unsupported`: the target or surface cannot perform the requested action.

Stale and ambiguous outcomes are action blockers. They should return
machine-readable `status`, `reason`, supplied/current state ids when known,
and candidate descriptors when ambiguity must be shown to the agent or a human.
