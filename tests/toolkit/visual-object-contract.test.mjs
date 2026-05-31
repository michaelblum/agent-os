import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVisualObjectContractExample,
  createVisualObjectDescriptor,
  createToolkitSliderVisualObjectDescriptor,
  applyVisualObjectDescriptorMutation,
  validateVisualObjectDescriptor,
  validateVisualObjectDescriptors,
  VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
} from '../../packages/toolkit/workbench/visual-object-contract.js';

test('visual object descriptor contract validates editable descriptors', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'sigil-avatar-stellation',
    label: 'Stellation',
    kind: 'slider',
    technology: 'threejs-3d',
    state_path: 'avatar.shape.stellationFactor',
    route: 'canvas_object.transform.patch',
    coerce: 'number',
    renderer_sync: ['updatePrimaryStellation'],
    group_key: 'primary-polyhedron',
    object_ids: ['avatar.primary.shape'],
    min: -1,
    max: 2,
    step: 0.05,
    evidence_contracts: ['json_serializable'],
  });

  assert.equal(descriptor.contract, VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID);
  assert.equal(descriptor.projection.classification, 'editable');
  assert.deepEqual(descriptor.range, { min: -1, max: 2, step: 0.05 });
  assert.deepEqual(validateVisualObjectDescriptor(descriptor), { ok: true, errors: [] });
});

test('visual object descriptor contract requires explicit projection-only reason', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'inspector-toggle',
    label: 'Inspector',
    kind: 'action',
    technology: 'dom-toolkit',
    projection: { classification: 'projection_only' },
  });

  const result = validateVisualObjectDescriptor(descriptor);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'projection_reason'));
});

test('visual object contract examples cover 3D, 2D canvas, and DOM toolkit surfaces', () => {
  const examples = [
    createVisualObjectContractExample({
      technology: 'threejs-3d',
      id: 'sigil-avatar-stellation',
      label: 'Stellation',
      route: 'canvas_object.transform.patch',
      objectIds: ['avatar.primary.shape'],
    }),
    createVisualObjectContractExample({
      technology: 'canvas-2d',
      id: 'heatmap-opacity',
      label: 'Heatmap Opacity',
      route: 'canvas_object.effects.patch',
      objectIds: ['heatmap.layer'],
    }),
    createVisualObjectContractExample({
      technology: 'dom-toolkit',
      id: 'inspector-toggle',
      label: 'Inspector',
      projectionOnly: true,
    }),
  ];

  assert.deepEqual(examples.map((example) => example.technology), ['threejs-3d', 'canvas-2d', 'dom-toolkit']);
  assert.equal(examples[2].projection.classification, 'projection_only');
  assert.equal(validateVisualObjectDescriptors(examples).ok, true);
});

test('toolkit slider descriptor proves editable DOM controls use the same contract', () => {
  const descriptor = createToolkitSliderVisualObjectDescriptor({
    id: 'toolkit-slider-opacity',
    label: 'Opacity',
    state_path: 'toolkit.controls.opacity.value',
    min: 0,
    max: 1,
    step: 0.05,
    object_ids: ['dom.aos-slider.opacity'],
  });
  const roundTrip = JSON.parse(JSON.stringify(descriptor));

  assert.equal(roundTrip.contract, VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID);
  assert.equal(roundTrip.technology, 'dom-toolkit');
  assert.equal(roundTrip.projection.classification, 'editable');
  assert.equal(roundTrip.state_path, 'toolkit.controls.opacity.value');
  assert.equal(roundTrip.route, 'dom_toolkit.control.value.patch');
  assert.deepEqual(roundTrip.range, { min: 0, max: 1, step: 0.05 });
  assert.ok(roundTrip.evidence_contracts.includes('dom_toolkit_control_value'));
  assert.ok(roundTrip.evidence_contracts.includes('non_avatar_visual_object'));
  assert.equal(validateVisualObjectDescriptor(roundTrip).ok, true);
});

test('descriptor-addressed mutation applies coerced values into plain JSON state', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'overlay-opacity',
    label: 'Overlay opacity',
    kind: 'slider',
    technology: 'canvas-2d',
    state_path: 'overlays.heatmap.opacity',
    route: 'canvas_object.effects.patch',
    coerce: 'number',
    renderer_sync: ['syncOverlayOpacity'],
    group_key: 'overlays.heatmap',
    object_ids: ['overlay.heatmap'],
  });
  const state = { overlays: { heatmap: { opacity: 0.25 } } };

  const result = applyVisualObjectDescriptorMutation(state, descriptor, '0.75');

  assert.equal(state.overlays.heatmap.opacity, 0.75);
  assert.deepEqual(result, {
    descriptor_id: 'overlay-opacity',
    state_path: 'overlays.heatmap.opacity',
    route: 'canvas_object.effects.patch',
    renderer_sync: ['syncOverlayOpacity'],
    previous_value: 0.25,
    value: 0.75,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('descriptor-addressed mutation resolves existing dotted object keys', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'radial-radius-scale',
    label: 'Radius scale',
    kind: 'slider',
    technology: 'threejs-3d',
    state_path: 'radial_menu.sigil.radial.main.items.wiki-graph.geometry.radiusScale',
    route: 'canvas_object.transform.patch',
    coerce: 'number',
    renderer_sync: ['renderRadialMenuPreview'],
    group_key: 'radial-menu.geometry',
    object_ids: ['radial-menu.sigil.radial.main.item.wiki-graph'],
  });
  const state = {
    radial_menu: {
      'sigil.radial.main': {
        items: {
          'wiki-graph': {
            geometry: { radiusScale: 1 },
          },
        },
      },
    },
  };

  const result = applyVisualObjectDescriptorMutation(state, descriptor, 1.5);

  assert.equal(state.radial_menu['sigil.radial.main'].items['wiki-graph'].geometry.radiusScale, 1.5);
  assert.equal(result.previous_value, 1);
  assert.equal(result.value, 1.5);
});

test('projection-only descriptors cannot silently mutate canonical state', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'preview-resource',
    label: 'Preview',
    kind: 'resource',
    technology: 'threejs-3d',
    projection: {
      classification: 'projection_only',
      reason: 'runtime-or-world-projection',
    },
  });
  const state = { preview: { visible: true } };

  assert.throws(
    () => applyVisualObjectDescriptorMutation(state, descriptor, false),
    /Projection-only descriptor preview-resource cannot mutate canonical state/,
  );
  assert.deepEqual(state, { preview: { visible: true } });
});
