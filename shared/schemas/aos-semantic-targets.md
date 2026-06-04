# AOS Semantic Targets

Version: `0.1.0`

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
  `data-aos-surface`, `data-semantic-target-id`, and `data-aos-parent-canvas`

The CLI gathers this data through a fixed internal probe. Agents should prefer
this field for AOS-owned canvases and reserve `show eval` for developer
diagnostics.

## Shape

```json
{
  "semantic_targets": [
    {
      "ref": "sigil-radial-item-wiki-graph",
      "surface": "sigil-radial-menu",
      "role": "button",
      "name": "Wiki Graph",
      "kind": "semantic_target",
      "enabled": true,
      "state": { "current": "true" },
      "actions": ["wiki-graph"],
      "extension": {
        "dom_id": "wiki-graph",
        "source": { "path": null, "line_start": null, "line_end": null }
      },
      "provenance": {
        "canvas_id": "sigil-radial-menu",
        "do_target": "canvas:sigil-radial-menu/sigil-radial-item-wiki-graph",
        "parent_canvas_id": "avatar-main",
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

`ref` is the canonical AOS object reference from `data-aos-ref`.

`provenance.canvas_id` is the canvas requested by `--canvas`.

`provenance.do_target` is the target-with-ref string accepted by `aos do click`.
It is emitted only when both `provenance.canvas_id` and `ref` are present, and
agents may pass it directly to `aos do click` without reconstructing the target
string. `provenance.canvas_id` and `ref` remain present for structured querying
and filtering.

`role` is the explicit DOM role when present, otherwise the closest native
control role.

`name` is the accessible name, usually `aria-label`, not an implementation id.

`actions` is the list of AOS action ids. The producer converts
`data-aos-action` to a one-item list when present.

`surface` and `provenance.parent_canvas_id` identify the AOS surface
relationship without polluting the accessible name.

`provenance.bounds`, `provenance.frame`, and `provenance.center` use the same
local image coordinate space as capture/xray output for that canvas.

`state` is present only when the control exposes state such as `current`,
`pressed`, `selected`, `checked`, `expanded`, or `value`. Disabled state is
reported as top-level `enabled: false`.
