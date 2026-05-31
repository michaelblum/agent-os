export const VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID = 'aos.visual_object.descriptor.v0';

export const VISUAL_OBJECT_SUPPORTED_TECHNOLOGIES = Object.freeze([
  'threejs-3d',
  'canvas-2d',
  'dom-toolkit',
]);

export const VISUAL_OBJECT_PROJECTION_REASONS = Object.freeze([
  'runtime-or-world-projection',
  'app-action-shortcut',
  'derived-view-only',
]);

const EDITABLE_REQUIRED_FIELDS = Object.freeze([
  'id',
  'label',
  'kind',
  'state_path',
  'route',
  'coerce',
  'renderer_sync',
  'group_key',
  'object_ids',
  'projection',
]);

const PROJECTION_REQUIRED_FIELDS = Object.freeze([
  'id',
  'label',
  'kind',
  'projection',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function normalizedArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => text(entry)).filter(Boolean);
}

function cloneOptions(options) {
  if (!Array.isArray(options)) return undefined;
  return options.map((option) => ({ ...option }));
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStateContainer(value) {
  return isPlainObject(value) || Array.isArray(value);
}

function normalizeRange(source = {}) {
  const range = {};
  for (const key of ['min', 'max', 'step']) {
    if (source[key] !== undefined) range[key] = source[key];
  }
  return Object.keys(range).length > 0 ? range : undefined;
}

function missingFields(descriptor, requiredFields) {
  return requiredFields.filter((field) => {
    if (!(field in descriptor)) return true;
    return descriptor[field] === null || descriptor[field] === undefined || descriptor[field] === '';
  });
}

export function createVisualObjectDescriptor(source = {}) {
  const projection = source.projection || {};
  const descriptor = {
    contract: VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
    id: text(source.id),
    label: text(source.label, text(source.id)),
    kind: text(source.kind || source.type, 'control'),
    technology: text(source.technology, 'threejs-3d'),
    state_path: source.state_path ?? source.statePath ?? null,
    route: source.route ?? null,
    coerce: source.coerce ?? null,
    renderer_sync: normalizedArray(source.renderer_sync ?? source.rendererSync),
    group_key: source.group_key ?? source.groupKey ?? null,
    object_ids: normalizedArray(source.object_ids ?? source.objectIds),
    projection: {
      classification: projection.classification || (source.canonical_avatar_edit === false ? 'projection_only' : 'editable'),
      reason: projection.reason || source.reason || null,
    },
  };
  const range = normalizeRange(source);
  if (range) descriptor.range = range;
  const options = cloneOptions(source.options);
  if (options) descriptor.options = options;
  if (source.visible_when || source.visibleWhen) descriptor.visible_when = { ...(source.visible_when || source.visibleWhen) };
  if (source.action_id || source.actionId) descriptor.action_id = source.action_id || source.actionId;
  if (source.evidence_contracts || source.evidenceContracts) {
    descriptor.evidence_contracts = normalizedArray(source.evidence_contracts || source.evidenceContracts);
  }
  return descriptor;
}

export function visualObjectDescriptorRequiredFields(descriptor = {}) {
  const classification = descriptor.projection?.classification;
  return classification === 'projection_only' ? PROJECTION_REQUIRED_FIELDS : EDITABLE_REQUIRED_FIELDS;
}

export function validateVisualObjectDescriptor(descriptor = {}) {
  const errors = [];
  const required = visualObjectDescriptorRequiredFields(descriptor);
  for (const field of missingFields(descriptor, required)) {
    errors.push({ code: 'missing_field', field, message: `Visual object descriptor requires ${field}.` });
  }
  if (descriptor.contract !== VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID) {
    errors.push({ code: 'contract_id', field: 'contract', message: `Visual object descriptor contract must be ${VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID}.` });
  }
  if (!['editable', 'projection_only'].includes(descriptor.projection?.classification)) {
    errors.push({ code: 'projection_classification', field: 'projection.classification', message: 'Visual object descriptor projection classification must be editable or projection_only.' });
  }
  if (descriptor.projection?.classification === 'projection_only' && !text(descriptor.projection?.reason)) {
    errors.push({ code: 'projection_reason', field: 'projection.reason', message: 'Projection-only descriptors require an explicit reason.' });
  }
  if (descriptor.projection?.classification !== 'projection_only' && descriptor.route && !text(descriptor.state_path)) {
    errors.push({ code: 'state_path', field: 'state_path', message: 'Routed editable descriptors require a state_path.' });
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function validateVisualObjectDescriptors(descriptors = []) {
  const results = descriptors.map((descriptor) => ({
    id: descriptor?.id ?? null,
    ...validateVisualObjectDescriptor(descriptor),
  }));
  return {
    ok: results.every((result) => result.ok),
    results,
    errors: results.flatMap((result) => result.errors.map((error) => ({ id: result.id, ...error }))),
  };
}

export function coerceVisualObjectDescriptorValue(descriptor = {}, value) {
  switch (descriptor.coerce) {
    case 'number': {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        throw new TypeError(`Visual object descriptor ${descriptor.id || '(unknown)'} requires a finite number.`);
      }
      return number;
    }
    case 'boolean':
      return coerceDescriptorBoolean(descriptor, value);
    case 'boolean_inverse':
      return !coerceDescriptorBoolean(descriptor, value);
    case 'string':
      return String(value ?? '');
    default:
      return value;
  }
}

function coerceDescriptorBoolean(descriptor = {}, value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'off', 'no', ''].includes(normalized)) return false;
  }
  throw new TypeError(`Visual object descriptor ${descriptor.id || '(unknown)'} requires an explicit boolean value.`);
}

function resolveStatePathParent(root, statePath) {
  const parts = text(statePath).split('.').filter(Boolean);
  if (parts.length === 0) {
    throw new TypeError('Visual object descriptor mutation requires a state_path.');
  }

  let node = root;
  for (let index = 0; index < parts.length - 1;) {
    if (!isStateContainer(node)) {
      throw new TypeError(`Cannot traverse non-object state at ${parts.slice(0, index).join('.') || '(root)'}.`);
    }

    let matchedKey = null;
    let matchedEnd = index;
    for (let end = parts.length - 1; end > index; end -= 1) {
      const candidate = parts.slice(index, end).join('.');
      if (Object.prototype.hasOwnProperty.call(node, candidate)) {
        matchedKey = candidate;
        matchedEnd = end;
        break;
      }
    }

    if (!matchedKey) {
      matchedKey = parts[index];
      matchedEnd = index + 1;
      node[matchedKey] = {};
    }

    node = node[matchedKey];
    index = matchedEnd;
  }

  if (!isStateContainer(node)) {
    throw new TypeError(`Cannot write visual object descriptor state_path ${statePath}.`);
  }

  for (let index = parts.length - 1; index > 0; index -= 1) {
    const candidate = parts.slice(index).join('.');
    if (Object.prototype.hasOwnProperty.call(node, candidate)) {
      return { parent: node, key: candidate };
    }
  }

  return { parent: node, key: parts[parts.length - 1] };
}

export function applyVisualObjectDescriptorMutation(state, descriptor = {}, value, {
  validate = true,
} = {}) {
  if (!isPlainObject(state)) {
    throw new TypeError('Visual object descriptor mutation requires a plain JSON state object.');
  }
  if (descriptor.projection?.classification === 'projection_only') {
    throw new TypeError(`Projection-only descriptor ${descriptor.id || '(unknown)'} cannot mutate canonical state.`);
  }
  if (validate) {
    const result = validateVisualObjectDescriptor(descriptor);
    if (!result.ok) {
      throw new TypeError(`Invalid visual object descriptor ${descriptor.id || '(unknown)'}: ${result.errors.map((error) => error.code).join(', ')}`);
    }
  }
  if (!text(descriptor.route)) {
    throw new TypeError(`Visual object descriptor ${descriptor.id || '(unknown)'} requires a route.`);
  }

  const { parent, key } = resolveStatePathParent(state, descriptor.state_path);
  const previousValue = parent[key];
  const nextValue = coerceVisualObjectDescriptorValue(descriptor, value);
  parent[key] = nextValue;
  return {
    descriptor_id: descriptor.id || null,
    state_path: descriptor.state_path,
    route: descriptor.route,
    renderer_sync: normalizedArray(descriptor.renderer_sync),
    previous_value: previousValue,
    value: nextValue,
  };
}

export function createVisualObjectContractExample({ technology, id, label, route, objectIds = [], projectionOnly = false } = {}) {
  return createVisualObjectDescriptor({
    id,
    label,
    kind: projectionOnly ? 'projection-control' : 'control',
    technology,
    state_path: projectionOnly ? null : `${id}.state`,
    route: projectionOnly ? null : route,
    coerce: projectionOnly ? null : 'number',
    renderer_sync: projectionOnly ? [] : ['render'],
    group_key: projectionOnly ? null : `${technology}.example`,
    object_ids: objectIds,
    projection: {
      classification: projectionOnly ? 'projection_only' : 'editable',
      reason: projectionOnly ? 'derived-view-only' : null,
    },
    evidence_contracts: ['json_serializable', 'deterministic_descriptor_validation'],
  });
}

export function createToolkitSliderVisualObjectDescriptor({
  id,
  label,
  state_path,
  route = 'dom_toolkit.control.value.patch',
  min = 0,
  max = 1,
  step = 0.01,
  object_ids = [],
} = {}) {
  return createVisualObjectDescriptor({
    id,
    label,
    kind: 'slider',
    technology: 'dom-toolkit',
    state_path,
    route,
    coerce: 'number',
    min,
    max,
    step,
    renderer_sync: ['syncDomControlValue'],
    group_key: 'toolkit.controls.slider',
    object_ids,
    evidence_contracts: [
      'json_serializable',
      'deterministic_descriptor_validation',
      'dom_toolkit_control_value',
      'non_avatar_visual_object',
    ],
  });
}
