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
  'profiler_measurement',
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

function profilerMeasurementValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeProfilerMeasurement(profilerMeasurement) {
  if (profilerMeasurement === null || profilerMeasurement === undefined) return null;
  const source = text(profilerMeasurement.source, 'unknown');
  const kind = text(profilerMeasurement.kind, 'runtime_profiler_window');
  const metric = text(profilerMeasurement.metric, 'heap_used_bytes');
  const windowMs = profilerMeasurementValue(profilerMeasurement.window_ms ?? profilerMeasurement.windowMs, 0);
  const sampleCount = profilerMeasurementValue(profilerMeasurement.sample_count ?? profilerMeasurement.sampleCount, 0);
  const before = profilerMeasurementValue(profilerMeasurement.before, null);
  const after = profilerMeasurementValue(profilerMeasurement.after, null);
  const peak = profilerMeasurementValue(profilerMeasurement.peak, null);
  const delta = profilerMeasurementValue(profilerMeasurement.delta, null);
  const limit = profilerMeasurementValue(profilerMeasurement.limit, null);
  const available = profilerMeasurement.available === null || profilerMeasurement.available === undefined
    ? null
    : booleanValue(profilerMeasurement.available);
  const withinLimit = profilerMeasurement.within_limit === null || profilerMeasurement.within_limit === undefined
    ? null
    : booleanValue(profilerMeasurement.within_limit);
  const resourceCounts = profilerMeasurement.resource_counts && typeof profilerMeasurement.resource_counts === 'object'
    ? {
        geometries: profilerMeasurementValue(profilerMeasurement.resource_counts.geometries, null),
        textures: profilerMeasurementValue(profilerMeasurement.resource_counts.textures, null),
        programs: profilerMeasurementValue(profilerMeasurement.resource_counts.programs, null),
        draw_calls: profilerMeasurementValue(
          profilerMeasurement.resource_counts.draw_calls ?? profilerMeasurement.resource_counts.drawCalls,
          null,
        ),
      }
    : null;

  return {
    source,
    kind,
    metric,
    window_ms: windowMs,
    sample_count: sampleCount,
    available,
    before,
    after,
    peak,
    delta,
    limit,
    within_limit: withinLimit,
    resource_counts: resourceCounts,
  };
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
  profilerMeasurement = null,
  cleanupResult = null,
  proofWindow = null,
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
    profiler_measurement: normalizeProfilerMeasurement(profilerMeasurement),
    proof_window: proofWindow === null || proofWindow === undefined
      ? null
      : {
          kind: text(proofWindow.kind, 'edit_loop'),
          duration_ms: numberValue(proofWindow.duration_ms ?? proofWindow.durationMs, 0),
          min_duration_ms: (proofWindow.min_duration_ms ?? proofWindow.minDurationMs) === null
            || (proofWindow.min_duration_ms ?? proofWindow.minDurationMs) === undefined
            ? null
            : numberValue(proofWindow.min_duration_ms ?? proofWindow.minDurationMs, 0),
          iteration_limit: (proofWindow.iteration_limit ?? proofWindow.iterationLimit) === null
            || (proofWindow.iteration_limit ?? proofWindow.iterationLimit) === undefined
            ? null
            : numberValue(proofWindow.iteration_limit ?? proofWindow.iterationLimit, 0),
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
  if (evidence.proof_window !== null && evidence.proof_window !== undefined) {
    if (!text(evidence.proof_window.kind)) {
      errors.push({ code: 'proof_window', field: 'proof_window.kind' });
    }
    if (!Number.isFinite(evidence.proof_window.duration_ms) || evidence.proof_window.duration_ms < 0) {
      errors.push({ code: 'proof_window', field: 'proof_window.duration_ms' });
    }
  }
  if (evidence.pooling_boundary !== null && evidence.pooling_boundary !== undefined) {
    for (const field of ['owner', 'decision']) {
      if (!text(evidence.pooling_boundary[field])) {
        errors.push({ code: 'pooling_boundary', field: `pooling_boundary.${field}` });
      }
    }
  }
  if (evidence.profiler_measurement !== null && evidence.profiler_measurement !== undefined) {
    if (!text(evidence.profiler_measurement.kind)) {
      errors.push({ code: 'profiler_measurement', field: 'profiler_measurement.kind' });
    }
    if (!text(evidence.profiler_measurement.source)) {
      errors.push({ code: 'profiler_measurement', field: 'profiler_measurement.source' });
    }
    if (!Number.isFinite(evidence.profiler_measurement.window_ms) || evidence.profiler_measurement.window_ms < 0) {
      errors.push({ code: 'profiler_measurement', field: 'profiler_measurement.window_ms' });
    }
    if (!Number.isFinite(evidence.profiler_measurement.sample_count) || evidence.profiler_measurement.sample_count < 0) {
      errors.push({ code: 'profiler_measurement', field: 'profiler_measurement.sample_count' });
    }
    for (const field of ['before', 'after', 'peak', 'delta', 'limit']) {
      if (evidence.profiler_measurement[field] !== null
        && evidence.profiler_measurement[field] !== undefined
        && !Number.isFinite(evidence.profiler_measurement[field])) {
        errors.push({ code: 'profiler_measurement', field: `profiler_measurement.${field}` });
      }
    }
    if (evidence.profiler_measurement.resource_counts !== null
      && evidence.profiler_measurement.resource_counts !== undefined) {
      for (const field of ['geometries', 'textures', 'programs', 'draw_calls']) {
        if (evidence.profiler_measurement.resource_counts[field] !== null
          && evidence.profiler_measurement.resource_counts[field] !== undefined
          && !Number.isFinite(evidence.profiler_measurement.resource_counts[field])) {
          errors.push({ code: 'profiler_measurement', field: `profiler_measurement.resource_counts.${field}` });
        }
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}
