# Native Effect Program Recipe

Use this complete interaction document as the minimum copyable pattern. The
cartridge manifest must declare `aos.scene.effect.program` with kind `effect`,
and its reviewed extension must grant `aos.scene.desktop_frame_texture` and
`aos.scene.native_sheet_effect`.

```json
{
  "contract": "aos.scene.cartridge.interactions.v1",
  "schemaVersion": 1,
  "nativeEffectPrograms": [{
    "contract": "aos.scene.native-effect-program.v2",
    "schemaVersion": 2,
    "id": "example.pointer-wave",
    "revision": 1,
    "durationMs": 900,
    "parameters": [
      { "id": "amplitude", "default": 18, "min": 0, "max": 96 },
      { "id": "frequency", "default": 0.045, "min": 0.001, "max": 0.25 },
      { "id": "radius", "default": 1200, "min": 32, "max": 5000 },
      { "id": "speed", "default": 850, "min": 10, "max": 4000 }
    ],
    "nodes": [
      { "id": "delta", "op": "subtract", "inputs": ["world.position", "event.current"] },
      { "id": "distance", "op": "length", "inputs": ["node.delta"] },
      { "id": "direction", "op": "normalize", "inputs": ["node.delta"] },
      { "id": "travel", "op": "multiply", "inputs": ["clock.elapsed", "parameter.speed"] },
      { "id": "front", "op": "subtract", "inputs": ["node.distance", "node.travel"] },
      { "id": "phase", "op": "multiply", "inputs": ["node.front", "parameter.frequency"] },
      { "id": "wave", "op": "cosine", "inputs": ["node.phase"] },
      { "id": "amount", "op": "multiply", "inputs": ["node.wave", "parameter.amplitude"] },
      { "id": "displacement", "op": "multiply", "inputs": ["node.direction", "node.amount"] },
      { "id": "zero", "op": "constant", "value": 0 },
      { "id": "position", "op": "compose3", "inputs": ["node.zero", "node.zero", "node.amount"] },
      { "id": "edge", "op": "smoothstep", "inputs": ["node.zero", "parameter.radius", "node.distance"] },
      { "id": "opacity", "op": "one_minus", "inputs": ["node.edge"] }
    ],
    "outputs": {
      "positionOffset": "node.position",
      "textureDisplacement": "node.displacement",
      "opacity": "node.opacity"
    },
    "material": {
      "lighting": "lambert",
      "ambient": 0.65,
      "diffuse": 0.45,
      "lightDirection": [-0.35, -0.45, 0.82],
      "normalSampleDistance": 2,
      "perspectiveDistance": 2400
    }
  }],
  "interactions": [{
    "id": "body-pointer-wave",
    "affordanceId": "body",
    "recognizer": { "implementation": "aos.scene.gesture.tap", "parameters": {} },
    "response": { "implementation": "aos.scene.response.drop", "parameters": {} },
    "nativeEffects": [{
      "implementation": "aos.scene.effect.program",
      "programId": "example.pointer-wave",
      "trigger": { "input": "pointer_down", "button": "left" },
      "parameters": { "amplitude": 24 }
    }]
  }]
}
```

One interaction may carry up to five `nativeEffects`. Each binding must have a
unique trigger for its affordance. Use this to pair immediate pointer feedback
with a separate `start` or `end` gesture effect without introducing another
recognizer. The singular `nativeEffect` field remains decode-compatible, but it
cannot be combined with `nativeEffects`.

For a continuous drag deformation, declare the start binding as gesture-owned:

```json
{
  "implementation": "aos.scene.effect.program",
  "programId": "example.drag-surface",
  "trigger": { "phase": "start" },
  "lifecycle": { "kind": "gesture" },
  "parameters": { "amplitude": 24 }
}
```

AOS updates `event.current`, `event.delta`, and `event.total_delta` in the
installed program without recapturing pixels or rebuilding geometry. Gesture
end may select a separate timed binding; cancellation disposes the active
effect. Do not simulate this by inflating `durationMs`.

Validate the complete cartridge before mounting it:

```bash
aos scene cartridge validate ./scene-work/companion --json
```

`event.origin`, `event.current`, `event.delta`, and `event.total_delta` use the
global DesktopWorld coordinate plane. `clock.elapsed` is measured in seconds
and starts at zero for the effect instance. In V2, `world.position`,
`surface.position`, `surface.size`,
and `surface.uv` use the logical global sheet. AOS converts the result into each
native display segment and samples that segment's captured texture internally.

The graph is forward-only. Parameters are bounded scalars. V2 outputs one
`vec3` sheet-position offset, one `vec2` texture displacement in DesktopWorld
points, and one scalar opacity. Use only the operators and limits exported by
`@agent-os/toolkit/scene/authoring`; AOS clamps every output even after a valid
graph executes. A trusted Three.js preview can compile this same artifact with
`compileSceneNativeEffectProgramGLSL()`; do not hand-maintain a second effect.

## Stateful Height Field

Use V3 when an effect needs persistent height and velocity history instead of
an analytic value at the current clock time. This complete program emits a
positive leading pressure lobe and a negative trailing trough while an event
travels from its origin to its current point:

```json
{
  "contract": "aos.scene.native-effect-program.v3",
  "schemaVersion": 3,
  "id": "example.fluid-trail",
  "revision": 1,
  "durationMs": 1800,
  "parameters": [
    { "id": "displacement", "default": 72, "min": 8, "max": 256 },
    { "id": "damping", "default": 1.35, "min": 0.2, "max": 4 },
    { "id": "transit", "default": 0.22, "min": 0.1, "max": 1 },
    { "id": "lead", "default": 1, "min": 0.2, "max": 2 },
    { "id": "pressure", "default": 1.15, "min": 0.2, "max": 3 },
    { "id": "propagation", "default": 0.18, "min": 0.05, "max": 0.35 },
    { "id": "radius", "default": 44, "min": 12, "max": 160 },
    { "id": "tension", "default": 0.012, "min": 0, "max": 0.04 }
  ],
  "nodes": [
    { "id": "height", "op": "multiply", "inputs": ["state.height", "parameter.displacement"] },
    { "id": "zero", "op": "constant", "value": 0 },
    { "id": "position", "op": "compose3", "inputs": ["node.zero", "node.zero", "node.height"] },
    { "id": "texture", "op": "multiply", "inputs": ["state.gradient", "parameter.displacement"] },
    { "id": "one", "op": "constant", "value": 1 }
  ],
  "outputs": {
    "positionOffset": "node.position",
    "textureDisplacement": "node.texture",
    "opacity": "node.one"
  },
  "geometry": {
    "kind": "event_segment",
    "cellSize": 6,
    "width": 640,
    "padding": 192
  },
  "material": {
    "lighting": "standard",
    "ambient": 0.65,
    "diffuse": 0.45,
    "fresnel": 0.24,
    "lightDirection": [-0.35, -0.45, 0.82],
    "normalSampleDistance": 2,
    "perspectiveDistance": 2400,
    "refraction": 12,
    "roughness": 0.55,
    "specular": 0.72
  },
  "state": {
    "kind": "damped_height_field",
    "maxDimension": 192,
    "minDimension": 64,
    "fixedStepHz": 60,
    "maxSubsteps": 3,
    "edgeAbsorptionCells": 8,
    "dampingParameter": "damping",
    "propagationParameter": "propagation",
    "surfaceTensionParameter": "tension",
    "emitter": {
      "kind": "swept_brush",
      "durationParameter": "transit",
      "pressureParameter": "pressure",
      "radiusParameter": "radius",
      "leadParameter": "lead",
      "spacingRadiusScale": 0.38,
      "speedReference": 1400,
      "speedScaleMin": 0.3,
      "speedScaleMax": 1.65,
      "lobes": [
        { "offsetRadiusScale": 1, "radiusScale": 1, "strengthScale": 1 },
        { "offsetRadiusScale": -0.42, "radiusScale": 0.82, "strengthScale": -0.72 }
      ]
    }
  }
}
```

AOS allocates one logical field for the complete global DesktopWorld plane.
Every display samples the same immutable field generation; a bezel is not an
absorbing boundary, and GPU completion gates buffered texture reuse.
`state.gradient` is a derivative in global DesktopWorld units rather than raw
texture-cell units, so field resolution does not retune the graph.
The emitter transit may be shorter than `durationMs`, allowing the surface to
settle after fast movement. Field dimensions, substeps, lobe count, brush work,
and referenced parameter ranges are engine-bounded. V3 still accepts no source,
loops, kernels, allocation commands, pixels, or native handles.

## Semantic Effect Trigger

Exercise one exact consumer-authored native effect without posting a global
macOS pointer or keyboard event:

```bash
aos scene effect trigger \
  --owner example.consumer \
  --resource companion/main \
  --affordance companion-body \
  --interaction companion-fast-travel \
  --phase pointer_down \
  --origin 400,300 \
  --current 400,300 \
  --pointer-session proof-1 \
  --sequence 1 \
  --expected-revision 2 \
  --expected-program example.effect.ripple \
  --expected-program-revision 1 \
  --expected-program-digest aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --dry-run \
  --json
```

Read the exact resource revision and reviewed program identity from the
consumer artifact and current inspection evidence. Remove `--dry-run` only
after they agree. Use the same pointer-session identity with `start`, `update`,
`end`, or `cancel` for gesture-lifecycle effects.

This command resolves the current scene input generation and invokes only the
native-effect lifecycle. It does not move the pointer, press Escape, reposition
the scene object, or prove the operating system's physical-input path. Do not
use `aos do click`, `aos do drag`, or `aos do key` as an unattended substitute
for this semantic proof.
