import { applyVisualObjectControllerUpdate } from './visual-object-controller.js';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function bindingForChange(change = {}) {
  return objectValue(change.binding || change.field?.binding || change.metadata);
}

function candidateDescriptorIds(change = {}) {
  const binding = bindingForChange(change);
  return [
    change.descriptor_id,
    change.descriptorId,
    change.field?.descriptor_id,
    change.field?.descriptorId,
    binding.descriptor_id,
    binding.descriptorId,
    change.id,
    change.field_id,
    change.fieldId,
    change.field?.id,
  ].map((value) => text(value)).filter(Boolean);
}

function bindingMetadata(change = {}) {
  const binding = bindingForChange(change);
  return {
    state_path: text(change.state_path || change.statePath || change.field?.state_path || change.field?.statePath || binding.state_path || binding.statePath),
    route: text(change.route || change.field?.route || binding.route),
    group_key: text(change.group_key || change.groupKey || change.field?.group_key || change.field?.groupKey || binding.group_key || binding.groupKey),
  };
}

function descriptorMatchesBinding(descriptor = {}, binding = {}) {
  if (binding.state_path && descriptor.state_path !== binding.state_path) return false;
  if (binding.route && descriptor.route !== binding.route) return false;
  if (binding.group_key && descriptor.group_key !== binding.group_key) return false;
  return !!(binding.state_path || binding.route || binding.group_key);
}

export function findVisualObjectFormDescriptor(change = {}, descriptors = []) {
  const list = arrayValue(descriptors);
  const byId = new Map(list.map((descriptor) => [descriptor?.id, descriptor]));
  for (const id of candidateDescriptorIds(change)) {
    if (byId.has(id)) return byId.get(id);
  }

  const binding = bindingMetadata(change);
  const matches = list.filter((descriptor) => descriptorMatchesBinding(descriptor, binding));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new TypeError(`Visual object form binding for ${text(change.id || change.field_id, '(unknown)')} matched multiple descriptors.`);
  }
  return null;
}

export function applyVisualObjectFormFieldChange(change = {}, {
  descriptors = [],
  state = {},
  routeHandlers = {},
  rendererSyncHandlers = {},
  validate = true,
} = {}) {
  const descriptor = findVisualObjectFormDescriptor(change, descriptors);
  const fieldId = text(change.id || change.field_id || change.fieldId || change.field?.id, '(unknown)');
  if (!descriptor) {
    throw new TypeError(`Missing visual object descriptor binding for form field ${fieldId}.`);
  }
  if (descriptor.projection?.classification === 'projection_only') {
    throw new TypeError(`Projection-only descriptor ${descriptor.id || fieldId} cannot be used as a form binding.`);
  }
  const value = change.value !== undefined ? change.value : change.field?.value;
  const update = applyVisualObjectControllerUpdate(descriptor, value, state, {
    routeHandlers,
    rendererSyncHandlers,
    validate,
  });
  return {
    field_id: fieldId,
    binding: {
      descriptor_id: descriptor.id,
      state_path: descriptor.state_path,
      route: descriptor.route,
    },
    update,
  };
}

export function bindVisualObjectForm(form = {}, options = {}) {
  if (typeof form.onFieldChange === 'function') {
    return form.onFieldChange((change) => applyVisualObjectFormFieldChange(change, options));
  }
  if (typeof form.on === 'function') {
    return form.on('field-change', (change) => applyVisualObjectFormFieldChange(change, options));
  }
  throw new TypeError('Visual object form binding requires a form with onFieldChange() or on("field-change").');
}
