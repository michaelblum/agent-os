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
- bounds and center from the element's DOM frame in the capture image's local
  coordinate space
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
      "canvas_id": "sigil-radial-menu",
      "id": "wiki-graph",
      "ref": "sigil-radial-item-wiki-graph",
      "role": "button",
      "name": "Wiki Graph",
      "action": "wiki-graph",
      "surface": "sigil-radial-menu",
      "parent_canvas": "avatar-main",
      "enabled": true,
      "bounds": { "x": 40, "y": 24, "width": 56, "height": 56 },
      "center": { "x": 68, "y": 52 },
      "state": { "current": "true" }
    }
  ]
}
```

## Field Notes

`canvas_id` is the canvas requested by `--canvas`.

`id` is the stable local target id, normally `data-semantic-target-id` or the DOM
id.

`ref` is the canonical AOS object reference from `data-aos-ref`.

`role` is the explicit DOM role when present, otherwise the closest native
control role.

`name` is the accessible name, usually `aria-label`, not an implementation id.

`action` is the AOS action id from `data-aos-action`.

`surface` and `parent_canvas` identify the AOS surface relationship without
polluting the accessible name.

`bounds` and `center` use the same local image coordinate space as capture/xray
output for that canvas.

`state` is present only when the control exposes state such as `current`,
`pressed`, `selected`, `checked`, `expanded`, `disabled`, or `value`.
