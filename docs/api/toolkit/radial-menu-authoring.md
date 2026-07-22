# Radial Menu Authoring

Use `@agent-os/toolkit/scene/radial-menu` as the focused public entry point for
logical radial menus, AOS DesktopWorld interaction projection, 3D item
expression, hover behavior, activation transitions, and validation.

## One Definition, Four Projections

`aos.radial_menu_3d` is the renderer-neutral authoring definition. Resolve and
compile it once:

```js
import {
  compileSceneRadialMenuDefinition,
} from '@agent-os/toolkit/scene/radial-menu'

const compiled = compileSceneRadialMenuDefinition(menuDefinition)
```

The result separates three responsibilities:

| Projection | Consumer | Contains |
|---|---|---|
| `parameters` | AOS scene interaction | IDs, native semantic labels, disabled state, colors, layout, and stock style |
| `gestureProjection` | radial gesture model | fixed or trigger-vector geometry, handoff, and re-entry values |
| `logicalItems` | product action dispatcher | actions, roles, shortcuts, state, children, target descriptors, and action payloads |
| `visualDefinition` | stock renderer or reviewed extension | geometry, materials, hover transforms, transitions, and effects |

`runtimeProjection` is the normalized label-free interaction view. Labels are
used only while AOS creates native semantic hit regions. Scene and gesture
events expose stable item IDs, not labels, actions, product payloads, geometry,
or effects.

The compiler validates the strict AOS projection before returning anything.
Unknown scene fields, invalid IDs, duplicate IDs, unsafe labels, invalid colors,
unbounded geometry, cyclic data, and definitions above the public byte, depth,
node, or item limits fail closed.

## Stage Projection

The optional top-level `scene` block uses the strict
`SceneRadialMenuParameters` vocabulary except that `menuId` and `items` derive
from the definition:

```json
{
  "scene": {
    "radius": 108,
    "spreadDegrees": 120,
    "startAngle": -90,
    "closeOnSelect": true,
    "style": {
      "activeColor": "#ffffff",
      "fillColor": "#201b2f",
      "itemRadius": 22,
      "opacity": 0.94
    }
  }
}
```

Renderer-neutral `geometry.menuRadius` is not silently converted into
DesktopWorld pixels. If no explicit scene radius exists, the compiler uses the
stock 108-unit radius. Existing `geometry.spreadDegrees` and `startAngle` are
safe angular fallbacks because they are unitless.

## Choose The Gesture

Use the compiled `parameters` for a tap-open transient DesktopWorld menu. Use
`gestureProjection` with the toolkit radial gesture model for a press-drag
chooser or trigger-vector placement. With `orientation: "trigger-vector"`, the
first outward crossing reserves the pointer vector as an egress lane and locks
the item fan until the pointer returns inside the re-entry zone.

These interaction styles share logical items and 3D visuals but are not
interchangeable at runtime. Do not make a tap-open scene menu infer
trigger-vector behavior from renderer geometry.

## Interaction Ownership

AOS owns the complete transient menu lease:

- edge-aware layout in the global DesktopWorld coordinate plane;
- one atomic native-region generation for all items;
- pointer capture and focus, blur, press, select, and cancel lifecycles;
- a non-consuming outside-dismiss backdrop;
- Escape, pointer-loss, topology, suspension, and owner-loss cleanup;
- ID-only events and bounded deterministic replay.

Consumers must not register parallel hit regions or infer actions from labels,
selection indices, colors, or geometry. Dispatch only a known item ID from an
applied terminal selection.

## 3D Rendering

The stock radial visual supports bounded circles and colors. Use a reviewed
trusted extension when items need custom Three.js geometry, shaders, effects,
or per-frame behavior.

The extension's synchronous `applyInteraction(event)` receives the exact
engine-resolved `radialLayout`. Render those centers directly. Retain object,
geometry, material, and effect resources; update values in place during
`tick()`. Do not allocate scene resources per frame or create another renderer,
camera, input stream, or animation loop.

Supported authoring patterns include:

- stock glyph or primitive items;
- procedural retained Three object trees;
- digest-bound cartridge glTF assets;
- layered compositions with independently animated retained parts;
- per-item hover scale, rotation, spin, halo, and reveal behavior;
- cancellable activation transitions resolved through
  `resolveRadialItemActivationTransition()`.

Extension-local asset loading is not part of V1. Models must enter through the
validated cartridge asset contract. Product-specific art and state vocabulary
remain in the consumer; they do not become AOS stock effects.

## Workbench Editing

`createRadialMenuWorkbenchSubject()` projects a selected item into reusable
visual-object controls. Transform, visibility, and effect patches route back to
the consumer's canonical definition. Editors and renderers must share that
definition rather than maintaining dual state.

## Runnable Route

Run the neutral compiler example:

```bash
node packages/toolkit/scene/examples/radial-menu-authoring.mjs --json
```

Scaffold and validate the stock interaction cartridge:

```bash
mkdir -p ./scene-work
aos scene cartridge scaffold ./scene-work/radial \
  --id example/radial --template radial-menu --json
aos scene cartridge validate ./scene-work/radial --json
```

For custom visuals, scaffold and independently review a trusted extension:

```bash
aos scene extension scaffold ./scene-work/radial-renderer \
  --owner example.consumer --id radial-renderer \
  --template basic-three --json
aos scene extension validate ./scene-work/radial-renderer --json
```

Validation and scaffolding are static. They do not install, mount, start the
daemon, or request TCC permission.

## Acceptance

Test logical projection, native labels, renderer layout, item hover, action
mapping, disabled and hidden state, outside dismissal, Escape, selection,
topology changes, context loss, reduced motion, resource bounds, and disposal
as separate assertions. Use fixed clocks for visual output and deterministic
scene replay for interaction behavior. Native input remains a separate manual
acceptance lane.
