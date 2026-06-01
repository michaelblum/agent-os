import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID,
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS,
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../packages/toolkit/workbench/visual-object-resource-lifecycle.js';
import {
  addAnnotationCommentText,
  createAnnotationSession,
  enterAnnotationSession,
  normalizeAnnotationSubjectAddress,
} from '../../packages/toolkit/workbench/annotation-session.js';
import {
  contextSessionSnapshot,
  createContextSession,
} from '../../packages/toolkit/workbench/context-session.js';

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
    poolingBoundary: {
      owner: 'sigil-renderer',
      decision: 'renderer-local',
      rationale: 'Three.js geometry and material reuse depends on renderer-owned topology and disposal semantics.',
    },
  });

  assert.equal(evidence.contract, VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID);
  assert.equal(evidence.minimal_update, true);
  assert.deepEqual(evidence.renderer_sync, ['updatePrimaryStellation']);
  assert.deepEqual(evidence.structural_rebuild, { before: 1, after: 1, delta: 0 });
  assert.deepEqual(evidence.retained_resource, { count: 2, limit: 2, within_limit: true });
  assert.deepEqual(evidence.temporary_resource, { created: 200, disposed: 200, balanced: true });
  assert.deepEqual(evidence.json_serializable_state, { checked: true, ok: true });
  assert.deepEqual(evidence.pooling_boundary, {
    owner: 'sigil-renderer',
    decision: 'renderer-local',
    rationale: 'Three.js geometry and material reuse depends on renderer-owned topology and disposal semantics.',
  });
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
    'pooling_boundary',
  ]);
});

test('resource lifecycle validation requires complete pooling boundary metadata when present', () => {
  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor: {
      id: 'pooling-boundary',
      state_path: 'avatar.shape.stellationFactor',
      route: 'canvas_object.transform.patch',
      renderer_sync: ['updatePrimaryStellation'],
    },
    poolingBoundary: {
      owner: '',
      decision: '',
      rationale: 'missing owner and decision should not pass as an explicit boundary record',
    },
  });

  assert.deepEqual(
    validateVisualObjectResourceLifecycleEvidence(evidence).errors.map((error) => error.field),
    ['pooling_boundary.owner', 'pooling_boundary.decision'],
  );
});

test('visual object lifecycle evidence stays separate from annotation snapshot sessions', () => {
  const descriptorState = { radial_menu: { primary: { items: { inspect: { transform: { scale: 1.25 } } } } } };
  const lifecycle = createVisualObjectResourceLifecycleEvidence({
    updateResult: {
      descriptor_id: 'radial-item-scale',
      state_path: 'radial_menu.primary.items.inspect.transform.scale',
      route: 'canvas_object.transform.patch',
      sync_outcomes: [{ label: 'syncPanelRegistry', status: 'called' }],
    },
    editCount: 1,
    rebuildsBefore: 0,
    rebuildsAfter: 0,
    retainedResources: ['selected-item-record'],
    finiteDataValid: true,
    identityStable: true,
    jsonSerializableState: descriptorState,
  });

  const root = normalizeAnnotationSubjectAddress({
    adapter_id: 'surface-inspector',
    root_id: 'display:main',
    root_kind: 'display',
    root_label: 'Main Display',
    subject_id: 'window:inspector',
    subject_path: ['display:main', 'window:inspector'],
    subject_kind: 'window',
    label: 'Inspector',
    projection: {
      adapter_id: 'surface-inspector',
      subject_id: 'window:inspector',
      subject_kind: 'window',
      current_render_status: 'visible',
      can_project_display_overlay: true,
      display_space_rect: { x: 20, y: 30, w: 300, h: 200 },
    },
  });
  const target = normalizeAnnotationSubjectAddress({
    adapter_id: 'surface-inspector',
    root_id: 'display:main',
    root_kind: 'display',
    root_label: 'Main Display',
    subject_id: 'button:capture',
    subject_path: ['display:main', 'window:inspector', 'button:capture'],
    subject_kind: 'button',
    label: 'Capture',
    projection: {
      adapter_id: 'surface-inspector',
      subject_id: 'button:capture',
      subject_kind: 'button',
      current_render_status: 'visible',
      can_project_display_overlay: true,
      display_space_rect: { x: 40, y: 60, w: 90, h: 40 },
    },
  });
  let annotationSession = enterAnnotationSession(createAnnotationSession({
    snapshot_count: 3,
  }), {
    entry_source: 'surface_inspector',
    root,
    committed_scope_stack: [root, target],
    updated_at: '2026-05-31T00:00:00.000Z',
  });
  annotationSession = addAnnotationCommentText(annotationSession, target, 'Point-in-time note', {
    updated_at: '2026-05-31T00:00:01.000Z',
  });
  const snapshot = contextSessionSnapshot(createContextSession({
    source_annotation_session: annotationSession,
    artifacts: [],
    updated_at: '2026-05-31T00:00:02.000Z',
  }), {
    trigger: 'canvas_inspector.capture_bundle',
    asset_refs: {
      surface_inspector_annotation_snapshot: 'annotation-snapshot.json',
    },
  });

  assert.equal(validateVisualObjectResourceLifecycleEvidence(lifecycle).ok, true);
  assert.equal(lifecycle.contract, VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID);
  assert.equal(lifecycle.descriptor_id, 'radial-item-scale');
  assert.equal(lifecycle.minimal_update, true);
  assert.equal(Object.hasOwn(lifecycle, 'snapshot_count'), false);
  assert.equal(Object.hasOwn(lifecycle, 'source_annotation_session'), false);
  assert.equal(Object.hasOwn(lifecycle, 'asset_refs'), false);

  assert.equal(snapshot.schema, 'aos_context_session');
  assert.equal(snapshot.source_annotation_session.schema, 'aos_annotation_session');
  assert.equal(snapshot.source_annotation_session.entry_source, 'surface_inspector');
  assert.equal(snapshot.source_annotation_session.snapshot_count, 3);
  assert.deepEqual(snapshot.source_annotation_session.committed_scope_addresses, [root.address, target.address]);
  assert.equal(snapshot.keyframes[0].trigger, 'canvas_inspector.capture_bundle');
  assert.equal(snapshot.keyframes[0].asset_refs.surface_inspector_annotation_snapshot, 'annotation-snapshot.json');
  assert.equal(Object.hasOwn(snapshot.source_annotation_session, 'descriptor_id'), false);
  assert.equal(Object.hasOwn(snapshot.source_annotation_session, 'renderer_sync'), false);
  assert.equal(Object.hasOwn(snapshot.source_annotation_session, 'minimal_update'), false);
});
