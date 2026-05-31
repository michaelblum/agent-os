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

Phase 5 adds two non-avatar proofs:

- `packages/toolkit/workbench/radial-menu-subject.js` projects resolved radial
  menu workbench state into `visual_object_descriptors` for selected item
  config, object transform, visibility, effect controls, and projection-only
  preview/export affordances.
- `createToolkitSliderVisualObjectDescriptor()` proves an editable
  `dom-toolkit` control can use the same descriptor envelope without migrating
  the controls package.
- `applyVisualObjectDescriptorMutation()` applies an editable descriptor's
  `state_path`, `route`, and `coerce` metadata to a plain JSON state graph. It
  returns the route and renderer sync labels for the caller's in-place update
  path, and rejects `projection_only` descriptors instead of mutating canonical
  state.
- `applyVisualObjectControllerUpdate()` is the reusable workbench/controller
  adapter for descriptor edit events. It applies the descriptor mutation,
  dispatches the descriptor `route`, then invokes `renderer_sync` handlers in
  descriptor order. The helper is generic and accepts caller-owned route and
  sync handler maps.
- `packages/toolkit/workbench/visual-object-form-binding.js` binds workbench
  form field changes to the controller adapter. It resolves a descriptor from
  field `descriptor_id`, field id, or explicit binding metadata such as
  `state_path` plus `route`, rejects missing bindings and projection-only
  descriptors, and returns the deterministic controller update result.
- `apps/sigil/avatar-editor/compact-surface.js` is the first real surface
  adoption. Its canonical avatar section forms can opt into
  `bindVisualObjectForm()` with caller-owned `visualObjectBinding` options:
  mutable JSON state, route handlers, renderer sync handlers, and optional
  validation. The compact view model carries the model's
  `visual_object_descriptors`; the surface does not create a parallel
  descriptor map or import live renderer internals. Without those binding
  options, legacy `onControlChange`, `onSectionChange`, and projection shortcut
  callbacks remain the only side effects.
- `apps/sigil/radial-item-editor/model.js` and
  `apps/sigil/radial-item-workbench/index.js` are the first non-avatar
  real-surface adoption. The radial item workbench consumes
  `visual_object_descriptors` from `createRadialMenuWorkbenchSubject()` and
  routes descriptor edits through `applyVisualObjectControllerUpdate()`. Sigil
  owns the adapter that exposes the selected radial item as the descriptor state
  graph, then translates routed transform, visibility, and effects updates into
  the existing editor patch handlers. `applyEditorObjectPatch()` and
  `applyEditorEffectsPatch()` remain authoritative for radial object mutation;
  the visual-object layer does not replace `canvas_object.*.patch` semantics.
  Workbench renderer sync labels call the existing registry/preview sync path
  so the object transform panel, exported subject state, and preview snapshot
  observe the same selected-item JSON mutation.

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

DOM/toolkit editable control:

```js
createToolkitSliderVisualObjectDescriptor({
  id: 'toolkit-slider-opacity',
  label: 'Opacity',
  state_path: 'toolkit.controls.opacity.value',
  object_ids: ['dom.aos-slider.opacity'],
});
```

## Phase 5 Target

The first broad Phase 5 slice validates non-avatar visuals against this
contract. Radial menu descriptors prove descriptor validation, projection-only
classification, patch routing, JSON serialization, technology identity, and
non-avatar evidence contracts without migrating Sigil renderer internals.

The follow-up mutation/update proof covers the full deterministic loop:

```text
canonical state graph -> descriptor -> routed mutation -> minimal update
```

The shared mutation helper and controller adapter stay technology-neutral.
Tests use radial menu descriptors to patch transform, visibility, and effect
JSON paths through route handlers; a DesktopWorld 2D fixture to re-run
`applyWorldTransform()` on the same target node; and a toolkit slider descriptor
to route the patched value through the existing `setValue()` path while
preserving root element identity.

Descriptor boolean coercion is explicit. `boolean` accepts booleans, `1`/`0`,
and the strings `true`, `false`, `on`, `off`, `yes`, `no`, and the empty
string. `boolean_inverse` accepts the same vocabulary and inverts the result.
Ambiguous strings throw instead of relying on JavaScript truthiness.

## Workbench Form Binding Loop

Workbench editor surfaces own form construction and live handlers. The shared
contract boundary is:

- Descriptor contract: declares editable state address, route, coercion,
  renderer sync labels, grouping, and projection classification.
- Controller adapter: applies the descriptor update to a caller-owned JSON state
  object, invokes route handlers, and invokes renderer sync handlers.
- Form binding helper: translates a form field-change payload into the
  descriptor addressed controller update.
- Surface or app code: owns concrete route handlers, renderer sync handlers,
  product state, and any live renderer behavior.

The intended field loop is:

```text
workbench form field change
  -> descriptor lookup from descriptor_id/field id/binding metadata
  -> applyVisualObjectControllerUpdate()
  -> route handler
  -> renderer_sync handler
  -> stable target update
```

Projection-only descriptors remain read-only from this path. They can describe
runtime affordances, app actions, or derived views, but form binding must not
turn them into canonical state mutation.

## Radial Workbench Descriptor Loop

The Sigil radial item workbench uses the controller adapter directly because
its active controls are patch-message driven, not form-field driven. The loop
is:

```text
radial workbench descriptor update
  -> descriptor lookup from createRadialMenuWorkbenchSubject()
  -> applyVisualObjectControllerUpdate()
  -> Sigil radial descriptor adapter state
  -> applyEditorObjectPatch() or applyEditorEffectsPatch()
  -> syncPanelRegistry() / preview snapshot / exported subject state
```

Visibility descriptors keep their descriptor route as
`canvas_object.visibility.patch`, but the Sigil adapter applies them through
the existing transform patch handler with a `visible` patch because that is the
current radial object-control contract. This preserves the route as evidence
while keeping mutation authority in the established editor handler.
