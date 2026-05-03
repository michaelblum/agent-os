export const SCHEMA_VERSION = '2026-05-03';

export const TRANSFORM_GROUPS = [
  { key: 'position', label: 'Position', unitKey: 'position' },
  { key: 'scale', label: 'Scale', unitKey: 'scale' },
  { key: 'rotation_degrees', label: 'Rotation', unitKey: 'rotation' },
];

export const VECTOR_AXES = ['x', 'y', 'z'];

const DEFAULT_TRANSFORM = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  scale: Object.freeze({ x: 1, y: 1, z: 1 }),
  rotation_degrees: Object.freeze({ x: 0, y: 0, z: 0 }),
});

const DEFAULT_UNITS = Object.freeze({
  position: 'scene',
  scale: 'multiplier',
  rotation: 'degrees',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneTriplet(triplet) {
  return {
    x: finiteNumber(triplet?.x, 0),
    y: finiteNumber(triplet?.y, 0),
    z: finiteNumber(triplet?.z, 0),
  };
}

function normalizeTriplet(value, fallback) {
  const base = fallback || { x: 0, y: 0, z: 0 };
  return {
    x: finiteNumber(value?.x, base.x),
    y: finiteNumber(value?.y, base.y),
    z: finiteNumber(value?.z, base.z),
  };
}

function normalizePartialTriplet(value) {
  const triplet = {};
  for (const axis of VECTOR_AXES) {
    if (value?.[axis] === undefined || value?.[axis] === '') continue;
    const n = finiteNumber(value[axis], null);
    if (n == null) continue;
    triplet[axis] = n;
  }
  return triplet;
}

function normalizeTransform(value = {}) {
  return {
    position: normalizeTriplet(value.position, DEFAULT_TRANSFORM.position),
    scale: normalizeTriplet(value.scale, DEFAULT_TRANSFORM.scale),
    rotation_degrees: normalizeTriplet(value.rotation_degrees, DEFAULT_TRANSFORM.rotation_degrees),
  };
}

function normalizeUnits(value = {}) {
  return {
    position: text(value.position, DEFAULT_UNITS.position),
    scale: text(value.scale, DEFAULT_UNITS.scale),
    rotation: text(value.rotation, DEFAULT_UNITS.rotation),
  };
}

function unwrapMessage(message = {}) {
  if (message?.payload && typeof message.payload === 'object') {
    return { ...message.payload, type: message.payload.type || message.type };
  }
  return message || {};
}

export function objectAddressKey(canvasId, objectId) {
  return `${encodeURIComponent(text(canvasId, 'unknown'))}::${encodeURIComponent(text(objectId, 'unknown'))}`;
}

export function objectAddressLabel(entry) {
  if (!entry) return 'No object selected';
  return `${entry.canvas_id} / ${entry.object_id}`;
}

export function createObjectTransformState() {
  return {
    objectsByKey: new Map(),
    selectedKey: null,
    lastResult: null,
    errors: [],
    pendingByRequest: new Map(),
  };
}

export function normalizeRegistryMessage(message = {}) {
  const payload = unwrapMessage(message);
  if (payload.type && payload.type !== 'canvas_object.registry') {
    return { ok: false, error: `unexpected message type ${payload.type}` };
  }

  const canvasId = text(payload.canvas_id);
  if (!canvasId) return { ok: false, error: 'registry missing canvas_id' };
  if (!Array.isArray(payload.objects)) return { ok: false, error: 'registry missing objects array' };

  const objects = [];
  for (const object of payload.objects) {
    const objectId = text(object?.object_id);
    if (!objectId) continue;
    const key = objectAddressKey(canvasId, objectId);
    objects.push({
      key,
      canvas_id: canvasId,
      object_id: objectId,
      name: text(object.name, objectId),
      kind: text(object.kind, 'custom'),
      capabilities: Array.isArray(object.capabilities)
        ? object.capabilities.filter((item) => typeof item === 'string')
        : [],
      transform: normalizeTransform(object.transform),
      units: normalizeUnits(object.units),
      visible: object.visible === undefined ? null : !!object.visible,
      metadata: object.metadata && typeof object.metadata === 'object' ? { ...object.metadata } : {},
    });
  }

  return {
    ok: true,
    registry: {
      type: 'canvas_object.registry',
      schema_version: text(payload.schema_version, SCHEMA_VERSION),
      canvas_id: canvasId,
      source_id: text(payload.source_id),
      objects,
    },
  };
}

export function sortedObjectEntries(state) {
  return [...(state?.objectsByKey?.values?.() || [])].sort((a, b) => {
    const canvasOrder = a.canvas_id.localeCompare(b.canvas_id);
    if (canvasOrder !== 0) return canvasOrder;
    return a.name.localeCompare(b.name) || a.object_id.localeCompare(b.object_id);
  });
}

export function selectedObject(state) {
  if (!state?.selectedKey) return null;
  return state.objectsByKey.get(state.selectedKey) || null;
}

export function selectObject(state, key) {
  if (!state || !state.objectsByKey.has(key)) return null;
  state.selectedKey = key;
  return selectedObject(state);
}

function pickNextSelection(state) {
  const entries = sortedObjectEntries(state);
  state.selectedKey = entries[0]?.key || null;
}

export function applyRegistryMessage(state, message = {}) {
  const normalized = normalizeRegistryMessage(message);
  if (!normalized.ok) {
    state.errors.push(normalized.error);
    while (state.errors.length > 12) state.errors.shift();
    return normalized;
  }

  const { registry } = normalized;
  for (const [key, entry] of [...state.objectsByKey.entries()]) {
    if (entry.canvas_id === registry.canvas_id) state.objectsByKey.delete(key);
  }
  for (const object of registry.objects) {
    state.objectsByKey.set(object.key, object);
  }
  if (!state.selectedKey || !state.objectsByKey.has(state.selectedKey)) pickNextSelection(state);
  return normalized;
}

export function normalizeTransformResultMessage(message = {}) {
  const payload = unwrapMessage(message);
  if (payload.type && payload.type !== 'canvas_object.transform.result') {
    return { ok: false, error: `unexpected message type ${payload.type}` };
  }
  const requestId = text(payload.request_id);
  const canvasId = text(payload.target?.canvas_id);
  const objectId = text(payload.target?.object_id);
  const status = text(payload.status);
  if (!requestId) return { ok: false, error: 'result missing request_id' };
  if (!canvasId || !objectId) return { ok: false, error: 'result missing target address' };
  if (!['applied', 'rejected', 'stale'].includes(status)) return { ok: false, error: `invalid result status ${status}` };
  return {
    ok: true,
    result: {
      type: 'canvas_object.transform.result',
      schema_version: text(payload.schema_version, SCHEMA_VERSION),
      request_id: requestId,
      target: { canvas_id: canvasId, object_id: objectId },
      key: objectAddressKey(canvasId, objectId),
      status,
      reason: text(payload.reason),
      message: text(payload.message),
      transform: payload.transform ? normalizeTransform(payload.transform) : null,
      visible: payload.visible === undefined ? null : !!payload.visible,
    },
  };
}

export function applyTransformResultMessage(state, message = {}) {
  const normalized = normalizeTransformResultMessage(message);
  if (!normalized.ok) {
    state.errors.push(normalized.error);
    while (state.errors.length > 12) state.errors.shift();
    return normalized;
  }

  const { result } = normalized;
  state.lastResult = result;
  state.pendingByRequest.delete(result.request_id);
  if (result.status === 'applied' && result.transform && state.objectsByKey.has(result.key)) {
    const entry = state.objectsByKey.get(result.key);
    state.objectsByKey.set(result.key, {
      ...entry,
      transform: result.transform,
      visible: result.visible === null ? entry.visible : result.visible,
    });
  } else if (result.status === 'applied' && result.visible !== null && state.objectsByKey.has(result.key)) {
    const entry = state.objectsByKey.get(result.key);
    state.objectsByKey.set(result.key, {
      ...entry,
      visible: result.visible,
    });
  }
  return normalized;
}

export function canPatchObject(entry) {
  return !!entry?.capabilities?.includes?.('transform.patch');
}

export function canPatchVisibility(entry) {
  return !!entry?.capabilities?.includes?.('visibility.patch');
}

export function buildTripletPatchMessage(entry, group, values, options = {}) {
  if (!entry) throw new Error('target entry is required');
  if (!TRANSFORM_GROUPS.some((candidate) => candidate.key === group)) {
    throw new Error(`unknown transform group ${group}`);
  }
  if (!canPatchObject(entry)) throw new Error(`object ${entry.object_id} does not advertise transform.patch`);

  const triplet = normalizePartialTriplet(values);
  if (Object.keys(triplet).length === 0) throw new Error('patch requires at least one numeric axis');
  const requestId = text(options.requestId, `object-transform-${Date.now().toString(36)}`);

  return {
    type: 'canvas_object.transform.patch',
    schema_version: SCHEMA_VERSION,
    request_id: requestId,
    target: {
      canvas_id: entry.canvas_id,
      object_id: entry.object_id,
    },
    patch: {
      [group]: triplet,
    },
  };
}

export function buildVisibilityPatchMessage(entry, visible, options = {}) {
  if (!entry) throw new Error('target entry is required');
  if (!canPatchVisibility(entry)) throw new Error(`object ${entry.object_id} does not advertise visibility.patch`);
  const requestId = text(options.requestId, `object-transform-${Date.now().toString(36)}`);

  return {
    type: 'canvas_object.transform.patch',
    schema_version: SCHEMA_VERSION,
    request_id: requestId,
    target: {
      canvas_id: entry.canvas_id,
      object_id: entry.object_id,
    },
    patch: {
      visible: !!visible,
    },
  };
}

export function patchDeliveryForTarget(entry, patchMessage) {
  if (!entry) throw new Error('target entry is required');
  return {
    type: 'canvas.send',
    payload: {
      target: entry.canvas_id,
      message: patchMessage,
    },
  };
}

export function updateEntryVisibilityDraft(entry, visible) {
  if (!entry) return null;
  return {
    ...entry,
    visible: !!visible,
  };
}

export function updateEntryTransformDraft(entry, group, values) {
  if (!entry) return null;
  const current = entry.transform || DEFAULT_TRANSFORM;
  return {
    ...entry,
    transform: {
      ...current,
      [group]: {
        ...cloneTriplet(current[group]),
        ...normalizePartialTriplet(values),
      },
    },
  };
}

export function formatTripletValue(value) {
  const n = finiteNumber(value, 0);
  if (Math.abs(n) >= 1000 || (Math.abs(n) > 0 && Math.abs(n) < 0.001)) return String(n);
  return Number.parseFloat(n.toFixed(4)).toString();
}
