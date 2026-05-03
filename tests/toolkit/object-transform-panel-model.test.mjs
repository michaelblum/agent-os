import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRegistryMessage,
  applyTransformResultMessage,
  buildTripletPatchMessage,
  buildVisibilityPatchMessage,
  createObjectTransformState,
  objectAddressKey,
  patchDeliveryForTarget,
  selectObject,
  selectedObject,
  sortedObjectEntries,
} from '../../packages/toolkit/components/object-transform-panel/model.js';

function registry(canvasId = 'avatar-main') {
  return {
    type: 'canvas_object.registry',
    schema_version: '2026-05-03',
    canvas_id: canvasId,
    objects: [
      {
        object_id: 'radial.wiki-brain.tree',
        name: 'Wiki Brain Tree',
        kind: 'three.object3d',
        capabilities: ['transform.read', 'transform.patch', 'visibility.read', 'visibility.patch'],
        visible: true,
        transform: {
          position: { x: 0.018, y: -0.035, z: 0.018 },
          scale: { x: 1.32, y: 1.42, z: 1.2 },
          rotation_degrees: { x: -11.5, y: 0, z: 0 },
        },
        units: {
          position: 'scene',
          scale: 'multiplier',
          rotation: 'degrees',
        },
      },
      {
        object_id: 'radial.wiki-brain.shell',
        name: 'Wiki Brain Shell',
        kind: 'three.object3d',
        capabilities: ['transform.read'],
        transform: {
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          rotation_degrees: { x: 0, y: 0, z: 0 },
        },
        units: {
          position: 'scene',
          scale: 'multiplier',
          rotation: 'degrees',
        },
      },
    ],
  };
}

test('registry ingest stores advertised objects and selects the first object', () => {
  const state = createObjectTransformState();
  const result = applyRegistryMessage(state, registry());

  assert.equal(result.ok, true);
  assert.equal(sortedObjectEntries(state).length, 2);
  assert.equal(selectedObject(state).name, 'Wiki Brain Shell');
  assert.deepEqual(selectedObject(state).transform.scale, { x: 1, y: 1, z: 1 });
});

test('selection targets one advertised object without assuming renderer internals', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());

  const key = objectAddressKey('avatar-main', 'radial.wiki-brain.tree');
  const selected = selectObject(state, key);

  assert.equal(selected.object_id, 'radial.wiki-brain.tree');
  assert.equal(selected.kind, 'three.object3d');
  assert.equal(selected.canvas_id, 'avatar-main');
});

test('triplet edits build a schema-shaped transform patch payload', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  selectObject(state, objectAddressKey('avatar-main', 'radial.wiki-brain.tree'));

  const patch = buildTripletPatchMessage(selectedObject(state), 'scale', {
    x: '1.4',
    y: '1.5',
    z: '1.25',
  }, { requestId: 'req-test' });

  assert.deepEqual(patch, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-test',
    target: {
      canvas_id: 'avatar-main',
      object_id: 'radial.wiki-brain.tree',
    },
    patch: {
      scale: { x: 1.4, y: 1.5, z: 1.25 },
    },
  });
});

test('patch delivery uses existing canvas.send routing to the owning canvas', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  selectObject(state, objectAddressKey('avatar-main', 'radial.wiki-brain.tree'));

  const entry = selectedObject(state);
  const patch = buildTripletPatchMessage(entry, 'rotation_degrees', { x: -9 }, { requestId: 'req-rotate' });
  const delivery = patchDeliveryForTarget(entry, patch);

  assert.equal(delivery.type, 'canvas.send');
  assert.equal(delivery.payload.target, 'avatar-main');
  assert.equal(delivery.payload.message.type, 'canvas_object.transform.patch');
  assert.equal(delivery.payload.message.request_id, 'req-rotate');
});

test('visibility edits build a visibility patch and update local state from owner result', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  selectObject(state, objectAddressKey('avatar-main', 'radial.wiki-brain.tree'));

  const entry = selectedObject(state);
  const patch = buildVisibilityPatchMessage(entry, false, { requestId: 'req-visible' });

  assert.deepEqual(patch, {
    type: 'canvas_object.transform.patch',
    schema_version: '2026-05-03',
    request_id: 'req-visible',
    target: {
      canvas_id: 'avatar-main',
      object_id: 'radial.wiki-brain.tree',
    },
    patch: {
      visible: false,
    },
  });

  const result = applyTransformResultMessage(state, {
    type: 'canvas_object.transform.result',
    schema_version: '2026-05-03',
    request_id: 'req-visible',
    target: {
      canvas_id: 'avatar-main',
      object_id: 'radial.wiki-brain.tree',
    },
    status: 'applied',
    transform: entry.transform,
    visible: false,
  });

  assert.equal(result.ok, true);
  assert.equal(selectedObject(state).visible, false);
});

test('non-patchable advertised objects reject transform patch construction', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  selectObject(state, objectAddressKey('avatar-main', 'radial.wiki-brain.shell'));

  assert.throws(
    () => buildTripletPatchMessage(selectedObject(state), 'scale', { x: 1.1 }, { requestId: 'req-shell' }),
    /does not advertise transform.patch/,
  );
});

test('owner results update local transform state and clear pending requests', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  selectObject(state, objectAddressKey('avatar-main', 'radial.wiki-brain.tree'));
  state.pendingByRequest.set('req-test', { key: state.selectedKey });

  const result = applyTransformResultMessage(state, {
    type: 'canvas_object.transform.result',
    schema_version: '2026-05-03',
    request_id: 'req-test',
    target: {
      canvas_id: 'avatar-main',
      object_id: 'radial.wiki-brain.tree',
    },
    status: 'applied',
    transform: {
      position: { x: 0.018, y: -0.04, z: 0.02 },
      scale: { x: 1.4, y: 1.5, z: 1.25 },
      rotation_degrees: { x: -9, y: 0, z: 0 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(state.pendingByRequest.has('req-test'), false);
  assert.deepEqual(selectedObject(state).transform.scale, { x: 1.4, y: 1.5, z: 1.25 });
});

test('empty registry snapshots remove a canvas object list', () => {
  const state = createObjectTransformState();
  applyRegistryMessage(state, registry());
  applyRegistryMessage(state, {
    type: 'canvas_object.registry',
    schema_version: '2026-05-03',
    canvas_id: 'avatar-main',
    objects: [],
  });

  assert.equal(sortedObjectEntries(state).length, 0);
  assert.equal(selectedObject(state), null);
});
