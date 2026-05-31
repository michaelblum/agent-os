import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVisualObjectContractExample,
  createVisualObjectDescriptor,
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
