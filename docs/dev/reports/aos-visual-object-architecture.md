# AOS Visual Object Architecture: Avatar as Reference Implementation

**Date**: 2026-05-31  
**Status**: Accepted architecture. Phase 5 consolidation and Phase 6 closure
now provide reusable descriptor/update contracts, resource-lifecycle evidence,
representative deterministic and live proofs, a profiler-backed primary
stellation leak/resource window, and a primary stellation positive-factor
morph-target subset. Remaining work is split into separate future tracks below
rather than kept as active Phase 6 scope.
**Branch**: `gdi/selection-mode-cursor-ancestor-ladder-v0`

## Current Routing Update: Detached Avatar Panel

As of the accepted `21dc331d` checkpoint on
`gdi/radial-compact-snapshot-extraction-integration-v0`, Sigil's avatar
controls can open as a separate toolkit panel through the AOS action bus. That
panel is product-useful but still uses a temporary private
`sigil.avatar_panel.*` message protocol between the panel and `avatar-main`.

Route order for the active Foreman workstream:

1. Accepted: AOS-first visible-surface/orphan audit through
   `docs/design/work-cards/gdi-aos-visible-surface-orphan-audit-v0.md`.
2. Accepted: cross-process visible AOS native-window audit through
   `docs/design/work-cards/gdi-aos-visible-surface-cross-process-audit-v0.md`.
3. Accepted: runtime service/input-tap ownership observability through
   `docs/design/work-cards/gdi-aos-runtime-service-input-tap-observability-v0.md`.
4. Next: define or refresh toolkit panel placement so requested frames, actual
   native frames, final settled frames, and opt-in viewport overflow behavior
   are explicit toolkit policy rather than daemon layout policy.
5. Add Sigil-owned avatar avoidance only if final settled panel frame evidence
   shows the avatar can overlap or win input over its controls panel.
6. Return to live toolkit/Sigil panel dragging through
   `docs/design/work-cards/gdi-toolkit-panel-live-drag-correction-v0.md`.
7. Migrate the detached avatar controls panel to the existing
   `visual_object_descriptors` / `canvas_object.*` resource contract through
   `docs/design/work-cards/gdi-sigil-avatar-panel-resource-contract-migration-v0.md`.
8. Refresh Wiki graph browser, shared 3D editor subject, and semantic target
   cleanup work against that accepted resource migration head.

Do not preserve repo-owned private protocols, duplicate target vocabulary, or
transitional aliases for this workstream. Migrate owned callers in the same
slice and delete stale paths unless a named external consumer, release boundary,
or explicit migration window requires compatibility.

## Implementation Status

The original target architecture has now been implemented and accepted on
`gdi/selection-mode-cursor-ancestor-ladder-v0`. This report is both the
architecture record and the current status record. Future-looking sections
below are separate tracks, not an instruction to keep expanding Phase 6.
Sections labeled as historical describe the pre-descriptor problem statement or
the original migration plan. Current implementation guidance comes from the
status summary, validation matrix, Phase 6 closure notes, and
`docs/design/visual-object-descriptor-contract-v0.md`.

Implemented capabilities:

- `apps/sigil/renderer/state.js` owns canonical, JSON-serializable
  `state.avatar.*` data for active shape, appearance, effects, and transform
  configuration.
- Active avatar renderer/model/editor paths read and write canonical
  `state.avatar.*` paths while preserving current renderer behavior.
- `apps/sigil/avatar-editor/model.js` projects Sigil avatar editor controls into
  `visual_object_descriptors` with the shared
  `aos.visual_object.descriptor.v0` contract.
- `packages/toolkit/workbench/visual-object-contract.js` contains descriptor
  creation, validation, coercion, descriptor-addressed state mutation, and the
  DOM slider proof helper.
- `packages/toolkit/workbench/visual-object-controller.js` provides
  `applyVisualObjectControllerUpdate()` for descriptor edit events, route
  dispatch, state mutation, and ordered `renderer_sync` handlers.
- `packages/toolkit/workbench/visual-object-form-binding.js` provides
  `bindVisualObjectForm()` and field-change descriptor lookup for real form
  surfaces.
- `apps/sigil/avatar-editor/compact-surface.js` can opt canonical avatar forms
  into `bindVisualObjectForm()` with caller-owned state, route handlers, and
  renderer sync handlers.
- `packages/toolkit/workbench/radial-menu-subject.js` projects non-avatar
  radial menu state into descriptor metadata for transform, visibility, effects,
  selected item config, preview resources, and export actions.
- `apps/sigil/radial-item-editor/model.js` and
  `apps/sigil/radial-item-workbench/index.js` route real radial item workbench
  descriptor edits through `applyVisualObjectControllerUpdate()` and the
  existing `applyEditorObjectPatch()` / `applyEditorEffectsPatch()` mutation
  authorities.
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js` provides the
  reusable renderer-agnostic resource/update lifecycle evidence contract for
  descriptor-driven update proofs, including optional profiler-backed window
  metadata for representative leak/resource observations.

Implemented representative proofs and retained limits:

- Stellation and tesseron paths have focused no-rebuild, bounded resource, and
  serialization coverage. Primary stellation descriptor edits now keep the
  existing depth/core/wire mesh, material, and geometry identities. Positive
  non-tesseron stellation edits use a renderer-local Three.js morph-target
  path after one topology-stable setup, while factor-zero transitions remain on
  the retained CPU buffer route because the current generator uses a different
  vertex topology at zero. The deterministic 1,000-edit proof-window record
  retains 2 unique geometries, creates/disposes 4 temporary morph setup
  geometries, performs 0 replacement-geometry swaps, updates
  `morphTargetInfluences`, serializes `state.avatar` successfully, and now
  carries a profiler-backed window record over the same representative path.
  The live stellation smoke hook now supports a bounded minimum-duration proof
  window, emits `aos.visual_object.resource_lifecycle.v0` evidence, and
  reports the same lifecycle counts plus profiler window metadata.
  Primary tesseron proportion edits update child and link geometry buffers in
  place through `updatePrimaryTesseronProportion()` instead of routing the
  descriptor to a full primary hierarchy rebuild. The 100-edit deterministic
  and bounded live canvas proofs retained 7 unique geometries, created and
  disposed 500 temporary geometries, and serialized `state.avatar`
  successfully. Uniform-only stellation remains blocked for the current
  generated geometry because factor zero and positive stellation do not share
  the same vertex layout, face semantics, or edge segment layout.
- The descriptor/controller/form loop has deterministic 3D, 2D, and DOM proof
  coverage. Existing avatar/Three.js, radial/non-avatar 3D, toolkit DOM slider,
  and DesktopWorld/canvas-style tests now express their update evidence through
  the shared lifecycle vocabulary; broad migration of every visual surface is
  future work.
- Live AOS proof exists for bounded avatar tesseron, radial workbench,
  toolkit DOM slider, and DesktopWorld stage descriptor updates. These are
  representative live paths, not a claim of live proof for every visual
  surface.
- Phase 6 boundary proof now keeps visual-object lifecycle evidence separate
  from observe-mode snapshot/session evidence. Descriptor records prove routed
  mutation, renderer sync, retained identity/resources, serialization, and
  cleanup. Annotation/context sessions continue to own root/scope/anchor,
  comment, projection status, keyframe asset refs, and `snapshot_count`.

Future tracks:

- **Profiler-backed leak proof**: convert the current deterministic and bounded
  runtime-duration lifecycle evidence into profiler-backed memory/resource
  evidence where product risk warrants it. The primary stellation path now has
  a representative profiler-backed window; broader leak safety remains a
  separate follow-on concern.
- **Observe-mode snapshot product integration**: integrate descriptor-adjacent
  state into the existing observe/session/snapshot product flow without
  replacing the session contract or absorbing `snapshot_count` into
  visual-object lifecycle records.
- **Topology-stable stellation model**: if smooth zero-to-positive stellation
  becomes a product requirement, make topology-stable stellated meshes the
  canonical zero-factor representation, then revisit uniform-only stellation.
- **Omega tesseron hot path**: extend the primary tesseron in-place update
  pattern to omega tesseron only if profiling or product usage shows that edit
  path is hot.
- **Broad toolkit stabilization**: handle radial gesture and spatial governance
  suite failures in their own runtime/toolkit stabilization track.

## Vision

Establish a **unified data-driven architecture for all AOS visual objects**—whether 3D WebGL, 2D Canvas, or DOM-based—where interactive elements expose addressable state, respond to mutations without full rebuilds, and integrate seamlessly with toolkit, agents, and temporal capture systems.

Sigil's avatar serves as the **reference implementation**, proving this pattern works for the most complex case: real-time editable 3D graphics with GPU optimization, effects, and transitions. Once validated, the pattern generalizes to all AOS visuals: toolkit controls, radial menus, workbench panels, spatial UI, and beyond.

## The Core Pattern

All AOS visual objects—regardless of rendering technology—should follow this architecture:

```
Canonical State Graph
  ↓ (descriptors provide metadata)
Renderer Projection (pure function: state → visual output)
  ↓ (user/agent interaction)
State Mutation (via routing layer)
  ↓ (diff detection)
Minimal Update (not full rebuild)
```

### Pattern Components

1. **Canonical State**: Pure data in addressable graph (`state.avatar.effects.aura.throw`, `state.controls.slider.value`)
2. **Descriptors**: Metadata about parameters (type, range, label, route, coercion rules)
3. **Renderer**: Pure projection from state to visual output (WebGL, Canvas2D, or DOM)
4. **Routing**: User/agent events write to state via consistent addressing (`canvas_object.effects.patch`)
5. **Updates**: Diff-driven minimal re-render (GPU uniforms, DOM property updates, not full recreation)

### Why This Matters

This pattern should work identically whether rendering:
- A 3D icosahedron with stellation parameter in WebGL
- A radial menu slice with arc angle in Canvas2D  
- A workbench slider with numeric value in DOM
- A spatial UI panel with transform matrix in Three.js

The **rendering technology changes, but the architecture stays constant**.

## Historical Problem Statement: Imperative, Rebuild-Heavy Rendering

This section preserves the pre-descriptor problem statement that motivated the
architecture. It is not current guidance for implemented avatar stellation or
tesseron descriptor edits.

### Avatar Example (3D WebGL)

User drags stellation slider:
```javascript
state.stellationFactor = 1.5;
// Triggers FULL geometry rebuild:
// - Dispose 8+ meshes, materials, edge geometries
// - Create new baseGeometry
// - Recompute vertex normals 3x
// - Rebuild entire composition
// Result: Frame stutter, GC pressure, impossible to maintain 60fps
```

### The Same Problem Exists Elsewhere

- **Toolkit controls**: Changing slider value recreates DOM elements instead of updating properties
- **Radial menu**: Redrawing entire canvas instead of dirty regions
- **Workbench panels**: Full re-render on any state change instead of targeted updates

### Root Cause

State is **hidden in closures, renderer internals, or scattered across modules**. There's no canonical source of truth, so any change requires full reconstruction to ensure consistency.

## Current Target Architecture: Data-Driven, Minimal Updates

This section describes the accepted direction. Current proof scope and retained
limits are the ones listed in the implementation status, validation matrix, and
success criteria.

### Avatar Example (Reference Implementation)

User drags stellation slider:
```javascript
state.avatar.shape.stellationFactor = 1.5;
// Updates GPU uniform or morph target weight:
material.uniforms.stellationFactor.value = 1.5;
// OR
mesh.morphTargetInfluences[0] = calculateWeight(1.5);
// Result: GPU interpolates geometry, 60fps smooth, zero GC
```

### Generalizes to All Visuals

Workbench slider:
```javascript
state.controls.slider.value = 0.75;
// Updates DOM property:
sliderThumb.style.left = `${value * 100}%`;
// No element recreation
```

Radial menu slice:
```javascript
state.menu.slices[2].arcAngle = Math.PI / 6;
// Redraws dirty region only:
ctx.clearRect(slice.bounds);
ctx.arc(/* new angle */);
// Not full canvas redraw
```

## Goals

### Unified Architecture

- **Single pattern** for all AOS visual objects regardless of rendering technology
- **Consistent addressing**: Same path-based state access for 3D, 2D, DOM
- **Descriptor-driven**: All visual parameters expose metadata for toolkit/agent consumption
- **Routing abstraction**: Same event → state mutation flow across all object types

### Performance & Responsiveness

- **60fps interaction**: Parameter changes apply immediately via minimal updates (uniforms, properties, dirty regions)
- **Zero rebuild churn**: Geometry/DOM/canvas recreation only when structure changes, not parameter updates
- **Optimal resource usage**: Caching, pooling, complete disposal prevent leaks across all renderer types

### Toolkit Integration

- **Subject/adapter pattern**: Every visual object exposes state via consistent interface
- **Workbench-compatible**: Drill-down editing works identically for 3D objects, controls, menus
- **Live binding**: UI controls two-way sync with visual object state in real-time

### Agent-First Ergonomics

- **Path-based mutations**: LLMs mutate `state.avatar.effects.aura.throw` or `state.menu.slices[0].label` without understanding renderer internals
- **Semantic addressing**: Parameters have meaningful names agents can reason about
- **Transition-compatible**: Smooth animations between any two states via declarative transitions

### Foundation for Temporal Systems

- **Introspectable state**: Snapshots capture complete visual configuration at any moment
- **Serializable**: Full state exports/imports as JSON for persistence, sharing, undo/redo
- **Playback-ready**: Temporal sequence of snapshots enables scrubbing, annotation, LLM analysis

## Sigil Avatar as Reference Implementation

### Why Avatar First?

Avatar is the **most demanding test case** for this architecture:
- Real-time 3D rendering (WebGL)
- Complex geometry with multiple parameters (stellation, tesseron, shape type)
- Effects with performance requirements (aura, magnetism, lightning, particles)
- Agent-driven customization needs
- Integration with observe mode for temporal capture

If the pattern works for avatar, it will work for simpler cases (2D controls, menus, panels).

### Avatar-Specific Work (Stays in Sigil)

**Location**: `apps/sigil/renderer/`

- Polyhedron composition algorithms (tesseron, stellation)
- Avatar-specific effects (magnetism, aura, lightning, particles)
- Sigil visual aesthetics and brand identity
- Observe mode UI integration (cursor trails, ancestry ladder)

### Pattern Extraction (Moves to AOS)

**Location**: `packages/toolkit/` or `packages/aos-3d/`

- **Visual object base contracts**: State graph structure, descriptor format, routing patterns
- **GPU optimization patterns**: Uniform updates, morph targets, geometry caching
- **Effect parameter contracts**: How effects expose state, respond to changes
- **Subject/adapter for 3D**: `canvas_object` implementation for Three.js integration
- **Descriptor-driven controls**: Metadata format workbench uses to generate UI

### Potential New Package: `packages/aos-visuals/`

If the pattern proves robust, extract to platform-level package:
- Base classes for data-driven visual objects
- Renderer abstraction (WebGL, Canvas2D, DOM, SVG)
- State mutation routing layer
- Diff detection and minimal update strategies
- Transition system integration
- Snapshot/annotation integration

## Technical Approach

### State Graph Structure

```javascript
state.avatar = {
  // Core geometry
  shape: {
    type: 12, // icosahedron
    size: 100,
    stellationFactor: 0.0,
    tesseron: {
      enabled: true,
      proportion: 0.6,
      matchMother: true
    }
  },
  
  // Visual appearance
  appearance: {
    opacity: 0.25,
    edgeOpacity: 1.0,
    faceColors: ['#8CF8FF', '#FF6B9D'],
    edgeColors: ['#FFFFFF', '#8CF8FF'],
    skin: 'chrome',
    isInterior: false,
    isSpecular: true
  },
  
  // Effects (each is data-driven)
  effects: {
    magnetism: { enabled: true, strength: 0.8, radius: 200 },
    aura: { enabled: true, throw: 0.5, color: '#8CF8FF' },
    lightning: { enabled: false, intensity: 1.0, frequency: 200 },
    particles: { enabled: true, count: 50, speed: 0.5 }
  },
  
  // Transform
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 1.0
  }
};
```

### Descriptor Example

```javascript
// Stellation parameter descriptor
{
  id: 'sigil-avatar-stellation',
  panel: 'shape',
  label: 'Stellation',
  type: 'range',
  path: 'shape.stellationFactor',
  min: -1,
  max: 2,
  step: 0.05,
  default: 0,
  coerce: NUMBER,
  route: 'canvas_object.transform.patch',
  rendererSync: 'updateGeometry', // triggers minimal GPU update
  description: 'Push/pull face extrusion factor'
}
```

### Renderer Integration

```javascript
// Effect reads from state (imperative implementation for performance)
export function updateMagnetism(avatarGroup, state, inputs) {
  if (!state.effects.magnetism.enabled) return;
  
  const { strength, radius } = state.effects.magnetism;
  const distance = Vector.distance(inputs.pointer, avatarGroup.position);
  
  if (distance < radius) {
    const force = calculateForce(distance, strength, radius);
    avatarGroup.position.add(force); // Direct Three.js mutation
  }
}

// Render loop orchestrates effects
export function render(state, inputs, scene) {
  updateMagnetism(scene.avatarGroup, state, inputs);
  updateAura(scene.auraGroup, state);
  updateLightning(scene.lightningGroup, state);
  updateParticles(scene.particleSystem, state);
}
```

### GPU Optimization for Geometry Parameters

```javascript
// Instead of rebuilding geometry on stellation change:

// Option A: Vertex shader uniform
material.uniforms.stellationFactor = { value: 0.5 };
// Shader interpolates between base and stellated positions

// Option B: Morph targets
geometry.morphAttributes.position = [
  baseMesh.getAttribute('position'),
  stellatedMesh.getAttribute('position')
];
mesh.morphTargetInfluences[0] = stellationFactor;
// Three.js interpolates on GPU
```

Primary stellation now implements the morph-target option for the safe positive
non-tesseron subset. The blocker is the zero-factor topology split: at zero the
current generator keeps the source triangle topology, while positive
stellation expands each source triangle into three peak triangles. A uniform-
only path still requires a renderer model where zero and positive stellation
share vertex and edge topology.

## Validation Matrix

The durable cross-surface pattern is:

```text
state graph -> descriptor -> route/controller -> renderer sync/minimal update
```

| Surface | State graph | Descriptor/route | Sync or minimal update evidence | Focused verification |
| --- | --- | --- | --- | --- |
| Sigil avatar / Three.js | `state.avatar.*` shape, appearance, effects, and transform data | Avatar editor model exposes `visual_object_descriptors`; compact surface can opt into `bindVisualObjectForm()` | Caller-owned route/sync handlers mutate canonical avatar JSON and preserve compact form/root identity; stellation/tesseron focused tests express 100-edit no-rebuild, retained resource bounds, temporary create/dispose balance, finite geometry, serialization, and profiler-backed primary stellation window metadata through `aos.visual_object.resource_lifecycle.v0` | `node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs tests/renderer/sigil-avatar-editor-model.test.mjs tests/renderer/sigil-avatar-editor-surface-view-model.test.mjs`; `node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs` |
| Sigil radial item workbench / non-avatar 3D | `radial_menu.<menu>.items.<item>.*` selected item JSON and editor state | `createRadialMenuWorkbenchSubject()` descriptors route through `canvas_object.transform.patch`, `canvas_object.visibility.patch`, and `canvas_object.effects.patch`; workbench posts `visual_object.descriptor.update` | `applyVisualObjectControllerUpdate()` dispatches to existing `applyEditorObjectPatch()` / `applyEditorEffectsPatch()` and syncs registry/preview/exported subject state; radial transform proof now records route, renderer sync labels, retained selected-item identity, and serializable exported state with the lifecycle helper | `node --test tests/renderer/radial-item-editor.test.mjs tests/renderer/radial-object-control.test.mjs`; `node --test tests/toolkit/radial-menu-subject.test.mjs tests/toolkit/object-transform-panel-model.test.mjs` |
| Toolkit DOM slider proof | `toolkit.controls.opacity.value` JSON fixture state | `createToolkitSliderVisualObjectDescriptor()` uses `dom-toolkit` and `dom_toolkit.control.value.patch`; the live smoke surface is `aos://toolkit/components/visual-object-live-proof/index.html` | Controller/form binding calls the existing slider `setValue()` path, preserves root element identity, validates serializable state with the lifecycle helper, and live `window.__visualObjectLiveProof.runDomControlProof()` returns `live_dom_control_edit_loop` evidence | `node --test tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/panel-form.test.mjs`; live `./aos show eval --id visual-object-live-proof-dom --js 'JSON.stringify(window.__visualObjectLiveProof.runDomControlProof())'` |
| 2D/DesktopWorld or canvas-style proof | DesktopWorld/canvas-style transform fixture state and DesktopWorld stage layer frame state | `canvas-2d` descriptor routes through `canvas_object.transform.patch` or `canvas_object.effects.patch`; the live DesktopWorld stage exposes `window.__desktopWorldStageVisualObjectProof.run()` | Controller update applies state in place and reruns the existing transform/sync path on the same target node/object; live DesktopWorld stage proof mutates the retained stage layer target, preserves root/layer identity, serializes state, and removes the proof layer after recording cleanup evidence | `node --test tests/toolkit/desktop-world-surface-2d.test.mjs tests/toolkit/runtime-canvas.test.mjs tests/toolkit/controls-slider-color.test.mjs`; live `./aos show eval --id visual-object-live-proof-stage --js 'JSON.stringify(window.__desktopWorldStageVisualObjectProof.run())'` |
| Observe/snapshot session boundary | Annotation session/context session roots, scopes, anchors, comments, projection status, keyframes, asset refs, and `snapshot_count` | Not a visual-object descriptor route; Surface Inspector and Sigil camera paths use `canvas_inspector.capture_bundle` / `sigil_radial_camera` triggers through the existing session/snapshot contract | Focused boundary proof asserts lifecycle evidence does not absorb `snapshot_count`, session summaries, or asset refs, while context-session snapshots do not claim descriptor ids, renderer sync labels, or minimal-update semantics | `node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs`; live proof uses one bounded Sigil/radial surface plus cleanup when `./aos ready --json` passes |

### Phase 6 Pooling Boundary Decision

Material and geometry pooling stays renderer-local for this slice. The current
reuse behavior that matters for leaks and churn is inside Sigil's Three.js
renderer: topology-specific geometry buffers, mesh/material object identity,
temporary source geometry disposal, and shader/material template ownership.
Extracting a toolkit pool now would either import Three.js concepts into the
renderer-agnostic workbench layer or create a generic cache that none of the
DOM, DesktopWorld/canvas-style, or radial descriptor paths can honestly share.

The shared boundary is therefore evidence, not pooled objects:
`aos.visual_object.resource_lifecycle.v0` records retained, replacement,
temporary, disposed, identity, serialization, and optional
`pooling_boundary` metadata. Sigil can continue to optimize renderer-owned
Three.js resources locally, while toolkit surfaces prove stable target identity
and serializable state through the same vocabulary without claiming GPU
resource pooling.

### Phase 6 Observe/Snapshot Boundary Decision

Observe-mode integration stays on the existing annotation/session contract for
this slice. Visual-object descriptors describe editable object state and the
route/sync path for mutating that state; they intentionally do not encode live
annotation scope, comments, projection freshness, bundle assets, or
`snapshot_count`. Conversely, annotation and context sessions can capture a
point-in-time surface and may include descriptor-adjacent evidence, but they do
not become descriptor mutation records or resource lifecycle proof.

The current compatibility proof is bounded: the lifecycle helper and
annotation/context session helpers can coexist in the same workbench package
without either contract importing the other's fields. Full observe-mode
snapshot product integration remains tracked separately because it has broader
surface, bundle, and capture-success semantics than descriptor/update evidence.

The broad toolkit suite is not the validation gate for this workstream. On this
branch, broad `node --test tests/toolkit/*.test.mjs` is known to include
unrelated failures in `tests/toolkit/runtime-radial-gesture.test.mjs` and
`tests/toolkit/spatial-governance.test.mjs`; use the focused matrix above for
this architecture contract unless those files are touched. For broader harness
selection, use `tests/README.md` and
`docs/guides/test-harness-ladder-and-prep.md`.

## Success Criteria

The criteria below distinguish completed Phase 5 contract work from remaining
performance or platform-wide adoption work.

### Performance

1. **60fps parameter updates**: Accepted for the implemented primary
   positive-factor stellation morph-target subset; broader smooth
   zero-to-positive or all-shape stellation remains a separate topology-stable
   model track.
2. **Memory stability**: Implemented for the focused lifecycle evidence matrix.
  Focused no-rebuild tests and
  longer deterministic edit loops now prove retained/replacement/temporary
  resource counts across the validation matrix, and the primary stellation
  smoke path now records profiler-backed window metadata; complete GPU-level
  material/geometry pooling and broader leak safety remain separate future
  tracks.
3. **Instant agent changes**: Implemented for descriptor-addressed state writes
   and deterministic sync handlers; broader live agent mutation proof remains
   future work.

### Architecture

4. **State introspection**: Implemented for active avatar shape, appearance,
   effects, and transform paths under `state.avatar.*`.
5. **Serialization**: Implemented for deterministic avatar and descriptor tests;
   live proof depends on AOS readiness for the selected surface.
6. **Descriptor coverage**: Implemented for active editor/workbench controls
   covered by the avatar compact and radial workbench surfaces; not yet claimed
   for every future visual parameter.

### Integration

7. **Workbench binding**: Implemented for the generic form binding helper,
   optional Sigil avatar compact-surface binding, and radial item workbench
   descriptor/controller adoption.
8. **Agent addressing**: Implemented at the descriptor/controller path level for
   covered parameters; full natural-language or all-parameter addressing is not
   claimed here.
9. **Snapshot capture**: Boundary accepted. JSON-serializable descriptor state
   and exported subject state coexist with observe/session snapshots, but
   complete observe-mode snapshot product integration remains a separate
   surface contract.
10. **Transition support**: Future work. The current contract exposes
   `renderer_sync` labels and routes, but does not implement declarative
   transition playback for all avatar parameters.

### Pattern Extraction

11. **Reusable primitives**: Implemented in toolkit descriptor, controller, form
   binding, radial subject, and DOM slider helper modules.
12. **Documentation**: Implemented in
   `docs/design/visual-object-descriptor-contract-v0.md` and this report, with
   3D, 2D/canvas-style, and DOM/toolkit examples.
13. **Validation**: Implemented through the matrix above for avatar 3D, radial
   non-avatar 3D, toolkit DOM slider, and 2D/DesktopWorld-style proofs.

## Historical Migration Strategy

The phase plan below records how the accepted architecture was reached. Treat
implemented phase details as historical delivery notes unless the phase status
explicitly identifies a future track.

### Phase 1: Avatar State Unification (Foundation)

**Status**: Implemented for active Sigil avatar paths.

**Goal**: Move all avatar parameters from scattered locations into canonical `state.avatar` graph

- Extract effect parameters into `state.avatar.effects.*`
- Consolidate geometry params into `state.avatar.shape.*`
- Move appearance settings into `state.avatar.appearance.*`
- Move transform and other runtime-editable avatar configuration into an
  appropriate `state.avatar.*` child while keeping renderer-only Three.js/DOM
  objects outside the serializable graph
- Migrate active controls, context-menu descriptors, subject/adapter projections,
  and renderer reads/writes that currently consume those parameters
- Ensure all state is serializable (no closures, no circular refs)
- **Deliverable**: Single source of truth for avatar configuration, with current
  rendering behavior preserved
- **Out of scope for Phase 1**: eliminating all geometry rebuilds, adding morph
  targets, proving 60fps slider edits, extracting platform packages, and
  completing all descriptor/workbench coverage

### Phase 2: GPU-Optimized Parameter Updates (Performance)

**Status**: Accepted for the current architecture scope. The primary
positive-factor non-tesseron stellation subset uses a renderer-local
morph-target path; zero-factor topology-stable stellation and broader
GPU/resource optimization are separate future tracks.

**Goal**: Eliminate geometry rebuilds for parameter changes

- Implement stellation via GPU uniforms or morph targets. **Implemented for the
  safe positive-factor morph-target subset; uniform-only and zero-factor
  topology-stable support are future work.**
- Add geometry caching layer where repeated structures warrant it. **Future
  profiler-backed work.**
- Add material pooling for matching properties where profiling shows churn.
  **Future profiler-backed work.**
- Fix disposal lifecycle for intermediate geometries. **Partially covered by
  focused no-rebuild tests; profiler-backed leak proof is a future track.**
- **Deliverable**: Minimal-update stellation proof for the implemented subset.
  **Accepted for the architecture closure; broader smooth editing remains a
  product/performance track.**

### Phase 3: Descriptor-Driven Controls (Toolkit Integration)

**Status**: Implemented for covered avatar compact and workbench descriptor
paths; not a claim that every possible avatar parameter has shipped live UI.

**Goal**: Make avatar fully editable via workbench

- Define descriptors for all avatar parameters
- Wire workbench panels to avatar state via subject/adapter
- Implement live two-way binding (UI ↔ state ↔ renderer)
- Add validation and coercion at descriptor layer
- **Deliverable**: Complete drill-down editing in workbench

### Phase 4: Pattern Extraction (Platform Generalization)

**Status**: Implemented as toolkit workbench contract, controller, and form
binding helpers.

**Goal**: Extract reusable patterns to AOS packages

- Document state graph contracts
- Extract descriptor format specification
- Generalize routing layer through descriptor `route` and caller-owned handlers
  rather than a `canvas_object`-only implementation
- Keep base classes out of scope until more real surfaces need them; the current
  reusable unit is the descriptor/controller/form helper set
- **Deliverable**: Documented pattern ready for other AOS visuals. **Implemented.**

### Phase 5: Validation & Iteration (Proof of Generality)

**Status**: Implemented for deterministic proofs across avatar 3D, non-avatar
radial 3D, toolkit DOM slider, and 2D/DesktopWorld-style update paths.

**Goal**: Prove pattern works beyond avatar

- Apply pattern to a non-avatar 3D radial editor/workbench surface. **Implemented
  through the Sigil radial item workbench.**
- Apply pattern to 2D/DesktopWorld or canvas-style state update. **Implemented
  through focused toolkit tests.**
- Apply pattern to toolkit control. **Implemented through the DOM slider
  descriptor and form-binding proof.**
- Identify friction points, refine contracts. **Implemented: strict boolean
  coercion, projection-only rejection, route/sync handler boundaries, and
  field-change descriptor lookup are documented and tested.**
- **Deliverable**: Pattern proven across rendering technologies. **Implemented
  for the focused validation matrix above.**

### Phase 6: Architecture Closure

**Status**: Closed for this workstream. Resource lifecycle contract extracted.
Primary stellation now has
1,000-edit deterministic proof-window evidence plus a live bounded-duration
smoke hook, primary tesseron proportion edits have longer bounded in-place
geometry update proof, representative radial, DOM, and
DesktopWorld/canvas-style update fixtures map to the same lifecycle vocabulary,
and the pooling boundary is documented as renderer-local for material/geometry
resources. Future GPU/resource/product work is tracked as separate next tracks.

**Goal**: Close the proven descriptor/update architecture as reusable and
reviewable, with representative live evidence and explicit boundaries.

- Accepted core: descriptor, controller, form binding, radial subject, and
  resource-lifecycle contracts are reusable toolkit/workbench primitives.
- Accepted representative proofs: avatar/Three.js, radial/non-avatar 3D,
  toolkit DOM slider, DesktopWorld/canvas-style, and observe/snapshot boundary
  tests define the deterministic acceptance matrix. Live hooks exist for
  bounded avatar tesseron/stellation, radial workbench, toolkit DOM slider, and
  DesktopWorld stage paths.
- Accepted stellation subset: primary positive-factor non-tesseron edits use
  renderer-local Three.js morph targets after topology-stable setup.
- Retained blocker: factor-zero stellation still uses the CPU buffer route
  because the current generator changes vertex, face, and edge topology at
  zero.

Separate future tracks:

- Profiler-backed leak proof for memory/resource behavior beyond deterministic
  and bounded runtime-duration evidence.
- Full observe-mode snapshot product integration through the existing
  annotation/context-session contract.
- Zero-factor/topology-stable stellation model if product work requires smooth
  zero-to-positive GPU or uniform-only stellation.
- Omega tesseron in-place resource optimization only if profiling or UI usage
  makes that path hot.
- Broad toolkit stabilization for radial gesture and spatial governance,
  independent of this visual-object architecture closure.

## Broader Impact: Unified AOS Visual Architecture

Once this pattern is established, it becomes the **canonical way AOS builds all interactive visuals**:

### 3D Objects (Sigil)
- Avatar with effects
- 3D radial menu
- Spatial UI panels
- Observe mode overlays (cursor trails, ancestry ladder)

### 2D Canvas (AOS/Sigil)
- Radial menu system
- Data visualizations
- Custom graphics

### DOM Controls (Toolkit)
- Workbench sliders, buttons, color pickers
- Panel layouts
- Form controls

### Future Spatial UI
- AR/VR interfaces
- Multi-display coordination
- Gesture-driven 3D manipulation

All share the same DNA:
- **State graph** as source of truth
- **Descriptors** for metadata
- **Routing** for mutations
- **Minimal updates** for performance
- **Snapshot-compatible** for temporal features

## Related Work

- **Observe mode vision** (to be documented separately): Semantic capture system unifying selection mode, ancestry ladder, annotations, and snapshots
- **Toolkit workbench**: Provides UI framework for parameter editing
- **AOS snapshot/annotation contracts**: Define temporal state capture format
- **Canvas object controller**: Establishes subject/adapter pattern for 3D objects
- **Transition registry**: System for declarative state animations (exists in codebase)

## Terminology Notes

**"Observe mode"**: New term coined for the unified semantic capture system. Separate documentation needed to map this to existing concepts (selection mode, ancestry ladder, annotations). Avatar refactor supports observe mode but is architecturally independent.

**"Visual object"**: Any interactive visual element in AOS, regardless of rendering technology (3D mesh, 2D canvas graphic, DOM control).

## Conclusion

This refactor transformed Sigil's avatar from an imperative rendering
implementation into the accepted reference architecture for AOS interactive
visual objects. The current answer to "How do we build interactive visuals?" is
the descriptor/controller/resource-lifecycle loop documented here and in
`docs/design/visual-object-descriptor-contract-v0.md`: canonical state graph,
visual-object descriptors, routed mutation, caller-owned renderer sync, and
resource lifecycle evidence.

The accepted architecture is representative, not universal. It is proven for
the validation matrix above and intentionally leaves profiler-backed leak proof,
topology-stable zero-factor stellation, omega tesseron optimization, broad live
surface migration, and full observe/snapshot product integration as separate
future tracks.
