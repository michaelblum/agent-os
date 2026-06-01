import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID,
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS,
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../packages/toolkit/workbench/visual-object-resource-lifecycle.js';

test('resource lifecycle helper normalizes descriptor update evidence', () => {
  const state = { avatar: { shape: { stellationFactor: 0.75 } } };
  const evidence = createVisualObjectResourceLifecycleEvidence({
    updateResult: {
      descriptor_id: 'sigil-avatar-stellation',
      state_path: 'avatar.shape.stellationFactor',
      route: 'canvas_object.transform.patch',
      sync_outcomes: [{ label: 'updatePrimaryStellation', status: 'called' }],
    },
    editCount: 100,
    rebuildsBefore: 1,
    rebuildsAfter: 1,
    retainedResources: ['coreGeometry', 'wireGeometry'],
    retainedResourceLimit: 2,
    replacementResourcesCreated: 0,
    replacementResourcesDisposed: 0,
    temporaryResourcesCreated: 200,
    temporaryResourcesDisposed: 200,
    finiteDataValid: true,
    jsonSerializableState: state,
  });

  assert.equal(evidence.contract, VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID);
  assert.equal(evidence.minimal_update, true);
  assert.deepEqual(evidence.renderer_sync, ['updatePrimaryStellation']);
  assert.deepEqual(evidence.structural_rebuild, { before: 1, after: 1, delta: 0 });
  assert.deepEqual(evidence.retained_resource, { count: 2, limit: 2, within_limit: true });
  assert.deepEqual(evidence.temporary_resource, { created: 200, disposed: 200, balanced: true });
  assert.deepEqual(evidence.json_serializable_state, { checked: true, ok: true });
  assert.deepEqual(validateVisualObjectResourceLifecycleEvidence(evidence), { ok: true, errors: [] });
});

test('resource lifecycle helper reports unbalanced or non-serializable evidence', () => {
  const state = {};
  state.self = state;

  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor: {
      id: 'bad-resource',
      state_path: 'resource.value',
      route: 'canvas_object.transform.patch',
      renderer_sync: ['syncResource'],
    },
    editCount: 1,
    retainedResources: 3,
    retainedResourceLimit: 2,
    temporaryResourcesCreated: 2,
    temporaryResourcesDisposed: 1,
    jsonSerializableState: state,
  });
  const result = validateVisualObjectResourceLifecycleEvidence(evidence);

  assert.equal(evidence.retained_resource.within_limit, false);
  assert.equal(evidence.temporary_resource.balanced, false);
  assert.equal(evidence.json_serializable_state.ok, false);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((error) => error.code),
    ['retained_resource_limit', 'temporary_resource_balance', 'json_serializable_state'],
  );
});

test('resource lifecycle vocabulary is explicit and stable', () => {
  assert.deepEqual(VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS, [
    'structural_rebuild',
    'minimal_update',
    'retained_resource',
    'replacement_resource',
    'temporary_resource',
    'disposed_resource',
    'renderer_sync',
    'identity_stable',
    'json_serializable_state',
  ]);
});
