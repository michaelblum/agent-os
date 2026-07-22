---
name: aos-radial-menu-authoring
description: Author logical, semantic, 2D, and 3D AOS radial menus and radial items with bounded gestures, dismissal, hover visuals, transitions, effects, actions, inspection, and tests. Trigger for radial menus, 3D menu items, hover animation, radial item art, or radial-menu workbenches.
---

# AOS Radial Menu Authoring

Author one renderer-neutral definition, then compile its separate projections:

```text
definition -> logical items + AOS interaction parameters + consumer visuals
```

AOS owns layout, hit regions, pointer capture, focus/blur, press/select,
outside dismissal, Escape cancellation, topology cleanup, and ID-only events.
The consumer owns item art and maps selected IDs to product actions.

## Run The Neutral Example

```bash
node packages/toolkit/scene/examples/radial-menu-authoring.mjs --json
```

The summary proves that logical actions and 3D visual data do not enter the
runtime interaction payload.

## Compile One Definition

```js
import {
  compileSceneRadialMenuDefinition,
} from '@agent-os/toolkit/scene/radial-menu'

const compiled = compileSceneRadialMenuDefinition(menuDefinition)
const interactionParameters = compiled.parameters
const gestureParameters = compiled.gestureProjection
const logicalItems = compiled.logicalItems
const visualDefinition = compiled.visualDefinition
```

Put `compiled.parameters` under the cartridge's
`aos.scene.response.radial-menu` response. Keep `logicalItems` in the consumer
action dispatcher and `visualDefinition` in the consumer renderer or reviewed
extension. Never dispatch an action from a label or visual index.

Use `gestureProjection` with the toolkit radial gesture model for press-drag or
trigger-vector selection. A tap-open transient menu and a press-drag chooser
share one definition but remain distinct interaction lifecycles.

## Scaffold The Runtime

```bash
mkdir -p ./scene-work
aos scene cartridge scaffold ./scene-work/radial \
  --id example/radial --template radial-menu --json
aos scene cartridge validate ./scene-work/radial --json
```

Use the stock renderer for simple color-and-circle menus. For custom 3D item
geometry or effects, scaffold a reviewed extension:

```bash
aos scene extension scaffold ./scene-work/radial-renderer \
  --owner example.consumer --id radial-renderer \
  --template basic-three --json
aos scene extension validate ./scene-work/radial-renderer --json
```

Implement `applyInteraction(event)` and consume the exact engine-provided
`event.radialLayout`. Do not recompute edge placement, register hit regions,
open another input stream, or create another frame loop.

## Author Items

- **Glyph:** use stock visual data when simple geometry is sufficient.
- **Procedural 3D:** declare the implementation and bounded parameters; render
  it in the reviewed extension.
- **Model-backed:** keep glTF bytes in the digest-bound cartridge. Extension-
  local asset loading is not supported in V1.
- **Layered item:** compose retained Three objects once, then change opacity,
  scale, rotation, material values, and visibility in place.
- **Hover:** configure enter/leave rates, scale, rotation, spin, and halo per
  item. Reuse resources and allocate nothing per frame.
- **Activation:** resolve `activationTransition` through the exported radial
  transition helpers. Cancellation restores the pre-activation state.

Labels must be printable and at most 256 UTF-8 bytes. Labels identify native
semantic hit regions but are absent from scene events. Keep stable canonical
IDs across logical, visual, native, test, and action projections.

## Dismiss And Dispatch

- Set `close_on_select` in the logical definition and `closeOnSelect` in its
  scene projection intentionally.
- The AOS outside backdrop dismisses without consuming unrelated desktop input.
- Escape, pointer loss, topology change, suspension, and owner loss cancel.
- Act only on a terminal `select` event whose response reports `applied: true`.
- Treat unknown, hidden, disabled, stale, or unapplied IDs as no-ops.

## Add Editing

Use `createRadialMenuWorkbenchSubject()` and visual-object descriptors for
transform, visibility, hover, and effect controls. The editor mutates the same
consumer definition that compilation reads; it must not invent a renderer-only
shadow model.

## Inspect And Verify

```bash
aos scene inspect --resource example/radial --json
aos scene perf --resource example/radial --json
aos scene monitor --resource example/radial --follow --json
aos scene replay \
  --events packages/toolkit/scene/fixtures/radial-menu.ndjson --json
```

Test open, focus, blur, press, select, outside dismissal, Escape, disabled and
hidden items, edge placement, topology loss, context loss, disposal, and
product action mapping independently. Use fixed clocks and bounded pixel checks
for visual acceptance.

## Cleanup

Close the owning scene session, dispose retained Three resources, and remove
the local scaffold with the caller's normal workspace cleanup. Do not use a
second consumer retry loop around the session's one bounded recovery attempt.

## References

- `docs/api/toolkit/radial-menu-authoring.md`
- `docs/api/toolkit/scene-authoring.md`
- `docs/api/toolkit/scene-extensions.md`
- `docs/api/toolkit/workbench.md`
- `shared/schemas/radial-menu-3d.schema.json`
- `packages/toolkit/runtime/radial-menu/default-3d.json`
