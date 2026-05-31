# Visual Object Descriptor Contract V0

Phase 4 extracts the Sigil avatar's proven descriptor shape into a reusable
toolkit workbench contract. The implementation lives in
`packages/toolkit/workbench/visual-object-contract.js` and is identified by
`aos.visual_object.descriptor.v0`.

## Descriptor Fields

Editable visual-object descriptors use these fields:

- `contract`: fixed contract id, `aos.visual_object.descriptor.v0`.
- `id`, `label`, `kind`: stable identity and control kind.
- `technology`: expected renderer family, such as `threejs-3d`, `canvas-2d`,
  or `dom-toolkit`.
- `state_path`: JSON state graph address owned by the object.
- `route`: patch route, commonly `canvas_object.transform.patch` or
  `canvas_object.effects.patch`.
- `coerce`, `range`, `options`: input coercion and control-domain metadata.
- `renderer_sync`: deterministic renderer hooks or sync labels required after
  state writes.
- `group_key`, `object_ids`: object graph grouping and affected visual objects.
- `visible_when`: optional dependency on another descriptor/control.
- `projection.classification`: `editable` for canonical object edits.
- `evidence_contracts`: validation and runtime evidence expected from the
  adapter.

Projection-only descriptors use the same envelope but set
`projection.classification` to `projection_only` and include
`projection.reason`. They may omit `state_path`, `route`, `coerce`,
`renderer_sync`, `group_key`, and `object_ids` when they are app actions,
runtime/world controls, or derived view controls rather than canonical object
state.

## Reference Implementations

Sigil remains the reference implementation:

- `apps/sigil/context-menu/descriptors.js` remains the compatibility descriptor
  source for the live compact surface.
- `apps/sigil/avatar-editor/model.js` projects those descriptors into
  canonical avatar controls plus `visual_object_descriptors`.
- Projection-only controls such as world/grid settings, diagnostics toggles,
  copy/save/import actions, and compact-surface shortcuts are explicitly kept
  out of canonical avatar edit groups.

The contract intentionally does not move Sigil-specific behavior into toolkit.
Polyhedron composition, tesseron geometry, aura, omega, lightning, magnetic,
path-trail effects, fast-travel visuals, and live renderer internals stay in
`apps/sigil/`.

## Technology Examples

Three.js 3D object:

```js
createVisualObjectContractExample({
  technology: 'threejs-3d',
  id: 'sigil-avatar-stellation',
  label: 'Stellation',
  route: 'canvas_object.transform.patch',
  objectIds: ['avatar.primary.shape'],
});
```

2D/canvas-style object:

```js
createVisualObjectContractExample({
  technology: 'canvas-2d',
  id: 'map-overlay-opacity',
  label: 'Overlay Opacity',
  route: 'canvas_object.effects.patch',
  objectIds: ['map.overlay.heat'],
});
```

DOM/toolkit control projection:

```js
createVisualObjectContractExample({
  technology: 'dom-toolkit',
  id: 'inspector-toggle',
  label: 'Inspector',
  projectionOnly: true,
});
```

## Phase 5 Target

The next broad slice should validate a non-avatar visual against this contract,
preferably a small toolkit-owned radial menu or DOM control surface. That slice
should prove descriptor validation, projection-only classification, and patch
routing without migrating Sigil renderer internals.
