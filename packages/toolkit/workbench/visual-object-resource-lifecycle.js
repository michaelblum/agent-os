export const VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID = 'aos.visual_object.resource_lifecycle.v0';

export const VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS = Object.freeze([
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

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function countResources(value) {
  if (Array.isArray(value)) return value.length;
  if (value instanceof Set || value instanceof Map) return value.size;
  return numberValue(value, 0);
}

function jsonSerializationResult(state) {
  if (state === undefined) return { checked: false, ok: null };
  try {
    JSON.stringify(state);
    return { checked: true, ok: true };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      error: text(error?.message, 'JSON serialization failed.'),
    };
  }
}

function syncLabels(updateResult = {}, rendererSync = []) {
  const labels = Array.isArray(rendererSync) ? rendererSync.map((label) => text(label)).filter(Boolean) : [];
  const outcomes = Array.isArray(updateResult.sync_outcomes)
    ? updateResult.sync_outcomes.map((outcome) => text(outcome?.label)).filter(Boolean)
    : [];
  return outcomes.length ? outcomes : labels;
}

export function createVisualObjectResourceLifecycleEvidence({
  descriptor = {},
  updateResult = {},
  statePath,
  route,
  rendererSync,
  editCount = 1,
  rebuildsBefore = 0,
  rebuildsAfter = 0,
  retainedResources = 0,
  retainedResourceLimit = null,
  replacementResourcesCreated = 0,
  replacementResourcesDisposed = 0,
  temporaryResourcesCreated = 0,
  temporaryResourcesDisposed = 0,
  finiteDataValid = null,
  jsonSerializableState,
  identityStable = true,
  poolingBoundary = null,
  cleanupResult = null,
} = {}) {
  const before = numberValue(rebuildsBefore);
  const after = numberValue(rebuildsAfter);
  const retained = countResources(retainedResources);
  const retainedLimit = retainedResourceLimit === null || retainedResourceLimit === undefined
    ? null
    : numberValue(retainedResourceLimit);
  const replacementCreated = countResources(replacementResourcesCreated);
  const replacementDisposed = countResources(replacementResourcesDisposed);
  const temporaryCreated = countResources(temporaryResourcesCreated);
  const temporaryDisposed = countResources(temporaryResourcesDisposed);

  return {
    contract: VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID,
    descriptor_id: updateResult.descriptor_id || descriptor.id || null,
    state_path: statePath || updateResult.state_path || descriptor.state_path || null,
    route: route || updateResult.route || descriptor.route || null,
    renderer_sync: syncLabels(updateResult, rendererSync || descriptor.renderer_sync),
    edit_count: numberValue(editCount, 1),
    structural_rebuild: {
      before,
      after,
      delta: after - before,
    },
    minimal_update: after === before,
    retained_resource: {
      count: retained,
      limit: retainedLimit,
      within_limit: retainedLimit === null ? null : retained <= retainedLimit,
    },
    replacement_resource: {
      created: replacementCreated,
      disposed: replacementDisposed,
    },
    temporary_resource: {
      created: temporaryCreated,
      disposed: temporaryDisposed,
      balanced: temporaryCreated === temporaryDisposed,
    },
    disposed_resource: {
      replacement: replacementDisposed,
      temporary: temporaryDisposed,
      total: replacementDisposed + temporaryDisposed,
    },
    identity_stable: booleanValue(identityStable),
    finite_data_valid: finiteDataValid === null ? null : booleanValue(finiteDataValid),
    json_serializable_state: jsonSerializationResult(jsonSerializableState),
    pooling_boundary: poolingBoundary === null || poolingBoundary === undefined
      ? null
      : {
          owner: text(poolingBoundary.owner),
          decision: text(poolingBoundary.decision),
          rationale: text(poolingBoundary.rationale),
        },
    live_cleanup: cleanupResult,
  };
}

export function validateVisualObjectResourceLifecycleEvidence(evidence = {}) {
  const errors = [];
  if (evidence.contract !== VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID) {
    errors.push({ code: 'contract_id', field: 'contract' });
  }
  for (const field of ['descriptor_id', 'state_path', 'route']) {
    if (!text(evidence[field])) errors.push({ code: 'missing_field', field });
  }
  if (!Array.isArray(evidence.renderer_sync) || evidence.renderer_sync.length === 0) {
    errors.push({ code: 'missing_renderer_sync', field: 'renderer_sync' });
  }
  if (!Number.isFinite(evidence.edit_count) || evidence.edit_count < 1) {
    errors.push({ code: 'edit_count', field: 'edit_count' });
  }
  if (!evidence.structural_rebuild || !Number.isFinite(evidence.structural_rebuild.delta)) {
    errors.push({ code: 'structural_rebuild', field: 'structural_rebuild.delta' });
  }
  if (evidence.retained_resource?.within_limit === false) {
    errors.push({ code: 'retained_resource_limit', field: 'retained_resource.within_limit' });
  }
  if (evidence.temporary_resource?.balanced === false) {
    errors.push({ code: 'temporary_resource_balance', field: 'temporary_resource.balanced' });
  }
  if (evidence.json_serializable_state?.checked && evidence.json_serializable_state.ok !== true) {
    errors.push({ code: 'json_serializable_state', field: 'json_serializable_state.ok' });
  }
  if (evidence.pooling_boundary !== null && evidence.pooling_boundary !== undefined) {
    for (const field of ['owner', 'decision']) {
      if (!text(evidence.pooling_boundary[field])) {
        errors.push({ code: 'pooling_boundary', field: `pooling_boundary.${field}` });
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}
