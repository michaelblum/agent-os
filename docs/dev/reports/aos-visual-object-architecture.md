# AOS Visual Object Architecture: Avatar as Reference Implementation

**Date**: 2026-05-31  
**Status**: Planning  
**Branch**: `gdi/selection-mode-cursor-ancestor-ladder-v0`

## Implementation Slicing

This report describes the full target architecture. It should not be treated as
one implementation stroke. The first GDI slice is intentionally narrower:

1. Establish a canonical, JSON-serializable `state.avatar.*` graph.
2. Migrate active Sigil avatar callers and controls to read/write that graph.
3. Preserve current rendering behavior while making the new state shape the
   source of truth.
4. Add enough deterministic coverage to prove active callers use
   `state.avatar.*` and `JSON.stringify(state.avatar)` succeeds.

GPU morph targets, uniform-only stellation updates, material pooling, complete
descriptor coverage, and non-avatar visual extraction are follow-up slices. They
should build on the canonical state graph instead of being mixed into the first
state migration.

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

## Current Problem: Imperative, Rebuild-Heavy Rendering

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

## Target Architecture: Data-Driven, Minimal Updates

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

## Success Criteria

The criteria below describe the full architecture. Use the "First Slice
Acceptance" section for the initial GDI round.

### Performance

1. **60fps parameter updates**: User drags stellation slider → avatar morphs smoothly without frame drops
2. **Memory stability**: No leaks over extended editing sessions (geometry/material disposal complete)
3. **Instant agent changes**: Agent mutation applies next frame without perceivable lag

### Architecture

4. **State introspection**: All avatar parameters accessible via `state.avatar.*` paths
5. **Serialization**: Complete avatar configuration exports as JSON, reimports identically
6. **Descriptor coverage**: Every editable parameter has descriptor metadata

### Integration

7. **Workbench binding**: Toolkit panels show live-bound controls for all parameters
8. **Agent addressing**: LLM can mutate any parameter via path without code changes
9. **Snapshot capture**: Observe mode snapshots include complete avatar state via AOS contracts
10. **Transition support**: Avatar parameters animate smoothly via declarative transitions

### Pattern Extraction

11. **Reusable primitives**: At least three patterns extracted to `packages/toolkit/` or new package
12. **Documentation**: Pattern documented with examples for 3D, 2D, DOM use cases
13. **Validation**: Pattern successfully applied to at least one non-avatar visual (radial menu or toolkit control)

### First Slice Acceptance

The first implementation slice is accepted when:

1. `state.avatar` exists as the canonical avatar configuration object.
2. Shape, appearance, effect, and transform parameters that active Sigil avatar
   controls or renderer paths use are represented under `state.avatar.*`.
3. Active in-repo callers touched by the slice read/write the new paths; avoid
   adding old-path compatibility shims unless an external boundary cannot be
   updated in the same slice.
4. `JSON.stringify(state.avatar)` succeeds in deterministic tests and in a live
   `avatar-main` canvas when AOS readiness permits.
5. Existing renderer behavior still boots and exposes the avatar through
   `window.__sigilDebug.snapshot()`.
6. Any known stale tests, docs, or inactive callers left behind are recorded in
   `BROKE.md` with a concrete follow-up checkbox.

## Migration Strategy

### Phase 1: Avatar State Unification (Foundation)

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

**Goal**: Eliminate geometry rebuilds for parameter changes

- Implement stellation via GPU uniforms or morph targets
- Add geometry caching layer (don't recreate identical shapes)
- Add material pooling (reuse materials with matching properties)
- Fix disposal lifecycle (track and dispose all intermediate geometries)
- **Deliverable**: 60fps smooth parameter editing

### Phase 3: Descriptor-Driven Controls (Toolkit Integration)

**Goal**: Make avatar fully editable via workbench

- Define descriptors for all avatar parameters
- Wire workbench panels to avatar state via subject/adapter
- Implement live two-way binding (UI ↔ state ↔ renderer)
- Add validation and coercion at descriptor layer
- **Deliverable**: Complete drill-down editing in workbench

### Phase 4: Pattern Extraction (Platform Generalization)

**Goal**: Extract reusable patterns to AOS packages

- Document state graph contracts
- Extract descriptor format specification
- Generalize routing layer (not just `canvas_object`)
- Create base classes for data-driven visual objects
- **Deliverable**: Documented pattern ready for other AOS visuals

### Phase 5: Validation & Iteration (Proof of Generality)

**Goal**: Prove pattern works beyond avatar

- Apply pattern to 3D radial menu (Sigil context menu)
- Apply pattern to 2D radial menu (general AOS)
- Apply pattern to toolkit control (slider or color picker)
- Identify friction points, refine contracts
- **Deliverable**: Pattern proven across rendering technologies

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

This refactor transforms Sigil's avatar from an imperative rendering implementation into **the reference architecture for how AOS builds all interactive visual objects**. By solving the hardest case first (real-time 3D with GPU optimization), we establish patterns that generalize across the entire platform.

The avatar becomes more than visually responsive—it becomes **architecturally exemplary**, proving that data-driven rendering, toolkit integration, agent addressing, and temporal capture can coexist in a unified, performant system.

When complete, AOS will have a clear answer to "How do we build interactive visuals?"—and that answer will be the same whether we're rendering a 3D polyhedron, a radial menu, or a workbench slider.
