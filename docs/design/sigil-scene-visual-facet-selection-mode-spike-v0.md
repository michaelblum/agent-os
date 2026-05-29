# Sigil Scene Visual Facet Selection Mode Spike V0

## Answer

Yes, with boundaries. Selection Mode visuals should converge on a sibling
Three.js selection scene facet that is fed by the same current avatar
appearance/effect source as the normal avatar, but Selection Mode runtime must
keep ownership of input, candidates, acquisition, target scoring, hit testing,
semantic targets, and DesktopWorld state.

The next slice should not keep patching the current cursor-only model as an
isolated renderer, and it should not move all Selection Mode overlay work at
once. The smallest reversible proof is a render-model adapter only, with no
visible behavior change, that exposes the current avatar appearance/effect
source to both the existing avatar root and future scene facets.

## Inventory

| Surface | Current state owner | Current render surface | Appearance/effect source | Coordinate/projection source | Allocation/pooling/cleanup behavior visible from source | Accessibility or semantic target surface | Future scene visual facet alignment |
|---|---|---|---|---|---|---|---|
| Radial menu visuals | `liveJs.radialGestureMenu`, radial gesture runtime, and radial activation transition in `main.js` | Three scene object: `createSigilRadialGestureVisuals()` owns a persistent group added to `state.scene`; glyphs are `THREE.Group`, meshes, lines, loaded glTF scenes, and CanvasTexture-backed item parts | Radial item registry, geometry/item config, module effects, radial object-control transforms, and item motion config; not current avatar appearance | Item centers from radial menu snapshot projected by `projectAvatarToScene`; item radii projected by `projectRadius` | Persistent root group; glyph map keyed by item id; missing glyphs are removed and disposed; glTF placeholders are replaced; materials/geometries are disposed on removal/destroy | Separate radial target surface creates AX-visible item targets in a child canvas | Yes later, but as a radial facet with its own item appearance source, not avatar-derived by default |
| Radial menu target surface / semantic child canvas | `createRadialMenuTargetSurface()` plus DesktopWorld hit-region controller | DOM/child canvas surface loaded from `renderer/radial-menu-surface.html`; no primary visual painting in the parent scene | Semantic labels/actions from radial item snapshot | Item centers and hit/visual radii in DesktopWorld coordinates; child frame from `radialMenuWorldRect()` | Controller creates, syncs, disables, refreshes payload, and removes; offscreen frame when inactive | Yes: normalized `AXButton` targets with stable names/actions/aos refs | No move. Keep as semantic target ownership beside visual facets |
| Radial object/effect controls | `radial-object-control.js`, radial item geometry/effect config, and message handlers in `main.js` | Mixed: object registry/control contract for Three radial objects; controls mutate item config consumed by radial visuals | Radial item geometry/effect fields, wiki-brain effect config, and object-control patches | Contract transforms use scene units and degrees relative to radial item/model hosts | Registry generation is allocation-light; runtime visual glyphs do the actual create/dispose work | Canvas object registry messages, not a hit target surface | Yes for object registry vocabulary; keep control ownership separate from facet rendering |
| Fast travel visuals | `createFastTravelController()` owns `liveJs.travel`, gesture state, captures, and transition config | Mixed: Canvas2D overlay, optional WebGL shader overlay canvas, screenshot image patches, line/wormhole effects; not Three scene objects | `state.transitionFastTravelEffect`, `state.fastTravelLine*`, `state.wormhole*`, captures, and live travel state | `projectStagePoint`, DesktopWorld display/capture mapping, native-to-DesktopWorld conversions | Overlay canvases are created lazily and removed on destroy; captures are requested/cached per display/slot and discarded on completion; temporary patch canvases are cached on capture objects | None for the effect itself; radial target surface and input regions drive related interaction | Defer. It could become a later travel facet, but wormhole capture/shader behavior should stay separate until a clear scene benefit exists |
| Annotation reticle | `createSigilAnnotationReticleController()` plus annotation candidate evidence cache in `main.js` | Canvas2D overlay frames/anchors/hover drawn by `interaction-overlay.js`; runtime model is not Three | Annotation session/candidate state from toolkit workbench adapters, display fallback, semantic target/native AX evidence | Subject projection rects in DesktopWorld/display space, then projected by `buildProjectedAnnotationReticleOverlay()` | Controller snapshots are pure data; overlay redraws existing Canvas2D each frame; evidence caches are maps keyed by canvas/candidate | Consumes semantic target events and native AX/window evidence; no separate reticle hit surface | Defer. Reticle frames could share a generic overlay facet later, but acquisition evidence remains outside rendering |
| Selection Mode runtime | `createSigilSelectionModeRuntime()` owns active state, cursor, path candidates, context session, selected node, effects, and routing | Data/runtime only; it builds the projected overlay model | Selection style currently reads avatar colors/aura fields from renderer state; cursor glyph declares `avatar_render_state` and material/effects source strings | Candidate projection rects and cursor are projected by injected `projectPoint`; candidates come from annotation reticle cache | No render allocation; events/effects arrays are bounded; render-only pointer move schedules visual frames without input-region sync | Hit tests Canvas2D badge model; Selection Mode uses existing candidate/semantic evidence, not its own child target surface | Yes as state owner feeding a scene facet through a render-model adapter |
| Selection Mode visual model | `selection-mode-visual-model.js` owns overlay data shape and style normalization | Render-model data for Canvas2D overlay plus current `sigil_model` cursor glyph; no objects | Avatar-derived style reads `state.colors`, aura state, selection transition/trail fields; cursor declares live avatar material/effect source | Uses projected cursor/rects passed by runtime; badge layout from `selection-mode-badges.js` | Pure object creation per overlay build; no object pooling because it is model data | Badge hit model only; semantic ownership stays elsewhere | Yes, but split into `selectionRuntimeModel` and `selectionSceneRenderModel` to avoid visual state owning behavior |
| Selection Mode cursor renderer | `createSelectionModeCursorModelRenderer()` owns only the current cursor Three root/model/trail instances | Three scene object: persistent root group added to `state.scene`; primary and trail `THREE.Group`s with mesh and edge line | Clones/copies `state.coreMesh` or `state.skinMaterial` and `state.wireframeMesh`; carries `effectRoot` metadata but does not render inherited aura/phenomena | Cursor projected by `projectStageLocalToScene`; scale from projected radius; transform per frame | Persistent root; primary created once; trail instances grow to repeat count; materials/geometries disposed on identity change/destroy; no per-move structural sync | None | Replace with the first child of `selectionVisualRoot`, not a standalone cursor root named as a model renderer |
| Selection Mode Canvas2D overlay | `interaction-overlay.js` owns drawing and local cursor trail history | Canvas2D overlay on an absolutely positioned, pointer-events-none canvas | Styles from Selection Mode visual model; Canvas cursor path disabled for `sigil_model` | Already-projected stage-local rects, cursor points, badges, effects, radial snapshots | Canvas created lazily, resized for DPR, cleared every draw; cursor trail history bounded by age; destroy removes canvas | No semantic target ownership; badge hit testing uses model data in runtime | Keep initially for frames/connectors/badges/effects while pointer facet proof lands |
| Avatar rendering | `state`, `scene.js`, `geometry.js`, `aura.js`, `phenomena.js`, `skins.js`, `particles.js`, `omega.js`, and `main.js` animation loop | Three scene: `state.polyGroup` is avatar root; glow/core aura sprites are scene siblings that follow `polyGroup`; phenomena/omega/trails mostly live under avatar groups | `applyAppearance()` writes the structured appearance blob into `state`; geometry/material/effects read state fields | Avatar DesktopWorld position projects via `projectAvatarToScene`; `screenToScene()` maps pixels to scene; DesktopWorldSurface publishes snapshots | Geometry rebuild disposes old meshes/materials; aura wobble and phenomena use count-sync helpers; skin materials/ramp textures dispose on replacement | Avatar hit child canvas plus canvas object registry from `avatar-object-control.js` | Yes. This becomes the canonical appearance/effect source provider, not a child of Selection Mode |
| Avatar appearance, aura, phenomena, skins, and object controls | Appearance state gateway and object registry/control modules | Three materials, sprites, groups, shader skins, and object-control registry | `DEFAULT_APPEARANCE`, `applyAppearance()`, `snapshotAppearance()`, color maps, aura fields, phenomena counts/turbulence, skin shaders | Same avatar root/scene coordinates; object registry reports scene transforms in contract units | `applyAppearance()` triggers rebuild/update hooks; geometry, skins, aura wobble, and phenomena dispose or sync instance counts where implemented | Canvas object registry advertises controllable avatar and radial objects | Yes as the shared source and registry language for any visual facet |

## Recommended Boundary

The durable pattern should be named `SigilSceneVisualFacet`, with a concrete
`selectionSceneFacet` instance. The pattern is a renderer boundary, not a
behavior owner.

```text
state.scene
  avatarRoot / state.polyGroup
    alpha primary shape
    omega
    avatar-local phenomena

  avatar-following effect objects
    aura sprites that already follow avatarRoot

  selectionVisualRoot
    pointerMesh
    framePool
    connectorPool
    effectPool
```

`selectionVisualRoot` must be a sibling of `avatarRoot`, not a child. It may read
the same appearance/effect source, but it must use its own transform driver:
DesktopWorld/canvas rect projection for frames and a cursor-driven world
transform for the pointer. It must not inherit avatar position, idle rotation,
quick-spin, app scale, or normal avatar transform state unless an explicit
render-model adapter maps those values through a Selection Mode override mask.

The facet contract should be:

```text
SigilSceneVisualFacet
  mount(scene, camera, renderer)
  update(renderModel, frameContext)
  snapshot()
  reset()
  destroy()
```

The render model should separate:

- `appearance/effect source`: current avatar materials, colors, skins, aura,
  phenomena/effect descriptors, and version identity.
- `transform driver`: cursor-driven world transform, rect projection, and
  screen-plane scale.
- `override mask`: geometry, cursor-driven transform, fixed orientation, one
  screen-plane rotation axis, visibility, and scale.
- `pools`: frames, connectors, badges, effects, and pointer/trail instances.

## Selection Mode Keep / Move / Defer

Keep:

- Selection Mode runtime state, acquisition, selected target, context session,
  path candidates, input routing, badge hit testing, and render-only pointer
  scheduling in Selection Mode runtime.
- Badge text in Canvas2D/DOM for now. Text is the hard part; moving it to
  Three sprites/textures is not justified until clarity, DPR behavior, and
  allocation costs are proven.
- Existing semantic target ownership in annotation evidence, radial target
  surface, input regions, and DesktopWorld state.

Move:

- Pointer into `selectionVisualRoot.pointer` as an avatar-derived render
  instance after the render-model adapter exists.
- Selection frames into pooled Three line/plane objects after pointer proof,
  because frames are geometry-only and can update buffers only when the
  candidate/path changes.
- Connectors into pooled Three line objects with geometry buffer updates only
  when badge/frame layout changes.
- Enter/exit effects into pooled Three overlay-like effects only after pointer
  and frames prove projection, render order, and cleanup semantics.

Defer:

- Trails beyond the pointer's current bounded trail instances until the primary
  pointer facet is stable.
- Badges as Three objects, especially text labels.
- Radial, reticle, and fast-travel remodels.

## Appearance And Effects Source

The appearance/effect source should live at the avatar renderer boundary, not
inside Selection Mode. Today `currentAvatarRenderSourceForSelectionPointer()`
is the useful seam, but it is cursor-specific and only clones/copies current
primary/edge materials. It should become a small render-model adapter that can
emit an avatar-derived render instance source:

```text
currentAvatarRenderSource()
  version
  geometryType
  skin
  primaryMaterialTemplate
  edgeMaterialTemplate
  colorRamp / colors
  auraDescriptor
  phenomenaDescriptor
  trailDescriptor
  effectRootDescriptor
```

Selection visuals consume descriptors and material templates through derived
variants. Pointer-specific opacity, depth, scale, or render-order changes must
not mutate the real avatar materials or effect objects.

## Cursor Override Mask

The cursor-only override mask is valid and should remain explicit:

- geometry: elongated triangular-pyramid pointer with hotspot at local origin;
- cursor-driven world transform: apex projects exactly to the current cursor;
- fixed orientation: no inherited avatar idle rotation or quick-spin axes;
- one screen-plane rotation axis: visual spin only around scene/screen Z;
- visibility: controlled by Selection Mode active/visible state;
- scale: projected from cursor-space pixel length and Selection Mode trail
  scale, not avatar app scale.

## Overlay Three Constraints

For overlay-like scene visuals, use derived material variants with intentional
depth behavior:

- consider `depthTest: false` and `depthWrite: false` for screen-overlay
  frames/connectors/effects;
- use stable `renderOrder`;
- project DesktopWorld/canvas rects to scene coordinates from the same
  `DesktopWorldSurface3D` camera state;
- keep DPR/display scaling crisp by deriving scale from projected pixel radii
  or rect corners;
- decide occlusion explicitly. Pointer and frames likely sit above avatar
  geometry; avatar-derived internal glow may use a separate low-opacity
  variant rather than true avatar depth occlusion.

## Performance And Cleanup

The recommendation preserves the current performance contract:

- pointer movement remains visual-only;
- no structural sync on mouse move/drag;
- no DesktopWorld publish on pointer-only frames;
- no input-region or hit-surface sync on pointer-only frames;
- no projection rebuild from debug snapshots;
- persistent `selectionVisualRoot`;
- bounded object, material, and geometry allocation after warmup;
- object pools for frames, connectors, badges, and effects if they move to
  Three;
- shared material templates or derived variants that cannot mutate the real
  avatar;
- geometry buffer updates only when candidate/path changes;
- per-frame pointer transform only.

## Non-Goals

Do not move or redesign these in the scene facet:

- input ownership;
- hit testing;
- semantic target ownership;
- acquisition;
- target scoring;
- DesktopWorld state ownership;
- radial behavior;
- reticle behavior;
- fast-travel behavior;
- Canvas2D/DOM badge text or semantic surfaces.

## Smallest Next Slice

Build a render-model adapter only, with no visible behavior change.

Why this is the smallest reversible proof:

- It answers the V10/V11 ownership problem before adding more visual code.
- It lets the existing cursor renderer consume the same adapter first, then
  makes `selectionSceneFacet.pointer` a mechanical move.
- It can be tested without live AOS or screenshot evidence: avatar appearance
  changes should update adapter output version/descriptors, and cursor-specific
  override fields should remain outside the source.
- It keeps Canvas2D frames, connectors, effects, badges, and all semantic
  surfaces stable while the shared source boundary hardens.
