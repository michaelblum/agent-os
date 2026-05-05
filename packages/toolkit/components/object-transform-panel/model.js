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

const DEFAULT_DESCRIPTORS = Object.freeze({
  geometry: '',
  animation_effects: '',
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

function normalizeDescriptorText(value) {
  return String(value ?? '').trim();
}

function normalizeDescriptors(value = {}) {
  return {
    geometry: normalizeDescriptorText(value.geometry ?? value.description ?? DEFAULT_DESCRIPTORS.geometry),
    animation_effects: normalizeDescriptorText(
      value.animation_effects
        ?? value.animationEffects
        ?? value.effects
        ?? DEFAULT_DESCRIPTORS.animation_effects
    ),
  };
}

function normalizeControlValue(value, fallback = null) {
  if (typeof fallback === 'boolean') return value === undefined ? fallback : !!value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return fallback ?? String(value ?? '');
}

function normalizeEffectControl(control = {}) {
  const id = text(control.id);
  if (!id) return null;
  const type = text(control.type, 'range');
  const fallbackValue = type === 'checkbox' ? false : 0;
  return {
    id,
    label: text(control.label, id),
    type,
    value: normalizeControlValue(control.value, fallbackValue),
    min: finiteNumber(control.min, 0),
    max: finiteNumber(control.max, 3),
    step: finiteNumber(control.step, type === 'range' ? 0.05 : 1),
    unit: text(control.unit),
    tooltip: text(control.tooltip),
  };
}

function normalizeEffectControls(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  const animationEffects = Array.isArray(value.animation_effects)
    ? value.animation_effects
    : Array.isArray(value.animationEffects)
      ? value.animationEffects
      : [];
  return {
    ...source,
    animation_effects: animationEffects
      .map((control) => normalizeEffectControl(control))
      .filter(Boolean),
  };
}

export function effectsJsonForEntry(entry) {
  return JSON.stringify(entry?.controls || normalizeEffectControls({}), null, 2);
}

export function updateEntryEffectsJsonDraft(entry, jsonText = '') {
  if (!entry) return { entry: null, ok: false, error: 'missing entry' };
  try {
    const parsed = JSON.parse(String(jsonText || '{}'));
    return {
      entry: {
        ...entry,
        controls: normalizeEffectControls(parsed),
        controls_json_error: '',
      },
      ok: true,
      error: '',
    };
  } catch (error) {
    return {
      entry: {
        ...entry,
        controls_json_error: error?.message || String(error),
      },
      ok: false,
      error: error?.message || String(error),
    };
  }
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
    descriptorModesByKey: new Map(),
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
    const metadata = object.metadata && typeof object.metadata === 'object' ? { ...object.metadata } : {};
    const key = objectAddressKey(canvasId, objectId);
    objects.push({
      key,
      canvas_id: canvasId,
      object_id: objectId,
      parent_object_id: text(object.parent_object_id ?? metadata.parent_object_id),
      name: text(object.name, objectId),
      kind: text(object.kind, 'custom'),
      capabilities: Array.isArray(object.capabilities)
        ? object.capabilities.filter((item) => typeof item === 'string')
        : [],
      transform: normalizeTransform(object.transform),
      units: normalizeUnits(object.units),
      visible: object.visible === undefined ? null : !!object.visible,
      descriptors: normalizeDescriptors(object.descriptors ?? metadata.descriptors),
      controls: normalizeEffectControls(object.controls ?? metadata.controls),
      metadata,
      order: objects.length,
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
    const groupOrder = (a.metadata?.role === 'group' ? 0 : 1) - (b.metadata?.role === 'group' ? 0 : 1);
    if (groupOrder !== 0) return groupOrder;
    const hasParent = !!(a.parent_object_id || b.parent_object_id);
    const parentOrder = text(a.parent_object_id).localeCompare(text(b.parent_object_id));
    if (hasParent && parentOrder !== 0) return parentOrder;
    if (hasParent && Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) return a.order - b.order;
    return a.name.localeCompare(b.name) || a.object_id.localeCompare(b.object_id);
  });
}

export function isGroupEntry(entry) {
  return entry?.metadata?.role === 'group' || entry?.kind === 'group' || entry?.kind === 'composition';
}

function sortSiblingEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const groupOrder = (isGroupEntry(a) ? 0 : 1) - (isGroupEntry(b) ? 0 : 1);
    if (groupOrder !== 0) return groupOrder;
    if ((a.parent_object_id || b.parent_object_id) && Number.isFinite(a.order) && Number.isFinite(b.order) && a.order !== b.order) {
      return a.order - b.order;
    }
    return a.name.localeCompare(b.name) || a.object_id.localeCompare(b.object_id);
  });
}

function childrenForEntry(entriesByObjectKey, childrenByParentKey, entry) {
  const parentKey = objectAddressKey(entry.canvas_id, entry.object_id);
  return childrenByParentKey.get(parentKey) || [];
}

export function treeObjectEntries(state) {
  const entries = sortedObjectEntries(state);
  const entriesByObjectKey = new Map(entries.map((entry) => [
    objectAddressKey(entry.canvas_id, entry.object_id),
    entry,
  ]));
  const childrenByParentKey = new Map();
  const roots = [];

  for (const entry of entries) {
    const parentKey = entry.parent_object_id
      ? objectAddressKey(entry.canvas_id, entry.parent_object_id)
      : '';
    if (parentKey && entriesByObjectKey.has(parentKey) && parentKey !== objectAddressKey(entry.canvas_id, entry.object_id)) {
      const children = childrenByParentKey.get(parentKey) || [];
      children.push(entry);
      childrenByParentKey.set(parentKey, children);
    } else {
      roots.push(entry);
    }
  }

  const rows = [];
  const visited = new Set();

  function descendantsFor(entry, seen = new Set()) {
    if (!entry || seen.has(entry.key)) return [];
    seen.add(entry.key);
    const children = sortSiblingEntries(childrenForEntry(entriesByObjectKey, childrenByParentKey, entry));
    return children.flatMap((child) => [child, ...descendantsFor(child, seen)]);
  }

  function walk(entry, depth) {
    if (!entry || visited.has(entry.key)) return;
    visited.add(entry.key);
    const children = sortSiblingEntries(childrenForEntry(entriesByObjectKey, childrenByParentKey, entry));
    const descendants = descendantsFor(entry);
    rows.push({
      entry,
      depth,
      hasChildren: children.length > 0,
      visibility: visibilityStateForEntry(entry, descendants),
    });
    for (const child of children) walk(child, depth + 1);
  }

  for (const root of sortSiblingEntries(roots)) walk(root, 0);
  for (const entry of entries) {
    if (!visited.has(entry.key)) walk(entry, 0);
  }
  return rows;
}

export function visibilityStateForEntry(entry, children = []) {
  const ownVisible = entry?.visible !== false;
  if (!isGroupEntry(entry) || children.length === 0) {
    return { checked: ownVisible, mixed: false };
  }
  const childVisibleCount = children.filter((child) => child.visible !== false).length;
  return {
    checked: ownVisible,
    mixed: ownVisible && childVisibleCount > 0 && childVisibleCount < children.length,
  };
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

export function normalizeEffectsResultMessage(message = {}) {
  const payload = unwrapMessage(message);
  if (payload.type && payload.type !== 'canvas_object.effects.result') {
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
      type: 'canvas_object.effects.result',
      schema_version: text(payload.schema_version, SCHEMA_VERSION),
      request_id: requestId,
      target: { canvas_id: canvasId, object_id: objectId },
      key: objectAddressKey(canvasId, objectId),
      status,
      reason: text(payload.reason),
      message: text(payload.message),
      controls: payload.controls && typeof payload.controls === 'object' ? { ...payload.controls } : {},
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

export function applyEffectsResultMessage(state, message = {}) {
  const normalized = normalizeEffectsResultMessage(message);
  if (!normalized.ok) {
    state.errors.push(normalized.error);
    while (state.errors.length > 12) state.errors.shift();
    return normalized;
  }

  const { result } = normalized;
  state.lastResult = result;
  state.pendingByRequest.delete(result.request_id);
  if (result.status === 'applied' && state.objectsByKey.has(result.key)) {
    let entry = state.objectsByKey.get(result.key);
    for (const [controlId, value] of Object.entries(result.controls || {})) {
      entry = updateEntryEffectControlDraft(entry, controlId, value);
    }
    state.objectsByKey.set(result.key, entry);
  }
  return normalized;
}

export function canPatchObject(entry) {
  return !!entry?.capabilities?.includes?.('transform.patch');
}

export function canPatchVisibility(entry) {
  return !!entry?.capabilities?.includes?.('visibility.patch');
}

export function effectControlsForEntry(entry, field = 'animation_effects') {
  return Array.isArray(entry?.controls?.[field]) ? entry.controls[field] : [];
}

export function hasEffectControls(entry, field = 'animation_effects') {
  return effectControlsForEntry(entry, field).length > 0;
}

export function descriptorMode(state, entry, field) {
  if (!entry || !field) return 'description';
  return state?.descriptorModesByKey?.get?.(`${entry.key}:${field}`) || 'description';
}

export function setDescriptorMode(state, entry, field, mode) {
  if (!state?.descriptorModesByKey || !entry || !field) return 'description';
  const next = ['description', 'json', 'controls'].includes(mode) ? mode : 'description';
  state.descriptorModesByKey.set(`${entry.key}:${field}`, next);
  return next;
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

export function buildEffectsPatchMessage(entry, controlId, value, options = {}) {
  if (!entry) throw new Error('target entry is required');
  const control = effectControlsForEntry(entry)
    .find((candidate) => candidate.id === controlId);
  if (!control) throw new Error(`object ${entry.object_id} does not advertise effect control ${controlId}`);
  const requestId = text(options.requestId, `object-effects-${Date.now().toString(36)}`);
  return {
    type: 'canvas_object.effects.patch',
    schema_version: SCHEMA_VERSION,
    request_id: requestId,
    target: {
      canvas_id: entry.canvas_id,
      object_id: entry.object_id,
    },
    patch: {
      controls: {
        [controlId]: normalizeControlValue(value, control.value),
      },
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

export function updateEntryEffectControlDraft(entry, controlId, value) {
  if (!entry) return null;
  const controls = normalizeEffectControls(entry.controls || {});
  return {
    ...entry,
    controls: {
      ...controls,
      animation_effects: controls.animation_effects.map((control) => (
        control.id === controlId
          ? { ...control, value: normalizeControlValue(value, control.value) }
          : control
      )),
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

export function updateEntryDescriptorDraft(entry, field, value) {
  if (!entry || !['geometry', 'animation_effects'].includes(field)) return entry;
  return {
    ...entry,
    descriptors: {
      ...DEFAULT_DESCRIPTORS,
      ...(entry.descriptors || {}),
      [field]: normalizeDescriptorText(value),
    },
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
