import { normalizeSemanticTarget } from '../../runtime/semantic-targets.js';

const SURFACE = 'object-transform-panel';

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function boolAttr(value) {
  return value ? 'true' : 'false';
}

function checkedAttr(value) {
  return value === 'mixed' ? 'mixed' : boolAttr(value);
}

function semanticAttrString(target = {}, options = {}) {
  const normalized = normalizeSemanticTarget({
    ...target,
    surface: SURFACE,
  });
  const attrs = [
    ['aria-label', normalized.name],
    ['data-aos-ref', normalized.aosRef],
    ['data-aos-surface', normalized.surface],
    ['data-semantic-target-id', normalized.id],
  ];
  if (normalized.action) attrs.push(['data-aos-action', normalized.action]);
  if (normalized.selected !== null) attrs.push(['aria-selected', boolAttr(normalized.selected)]);
  if (normalized.checked !== null) attrs.push(['aria-checked', checkedAttr(normalized.checked)]);
  if (normalized.value !== null) attrs.push(['aria-valuetext', normalized.value]);
  if (!normalized.enabled) attrs.push(['aria-disabled', 'true']);
  if (normalized.role && !(options.nativeRole && normalized.role === options.nativeRole)) {
    attrs.push(['role', normalized.role]);
  }
  return attrs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `${name}="${escAttr(value)}"`)
    .join(' ');
}

export function objectRowAttrs(entry, selected = false) {
  return semanticAttrString({
    id: `object-${entry.key}`,
    role: 'AXButton',
    name: `Select ${entry.name}`,
    action: 'select_object',
    aosRef: `${SURFACE}:object:${entry.canvas_id}:${entry.object_id}`,
    selected,
  }, { nativeRole: 'button' });
}

export function visibilityToggleAttrs(entry, options = {}) {
  const visible = options.checked ?? entry.visible !== false;
  const checked = options.mixed ? 'mixed' : visible;
  return semanticAttrString({
    id: `visibility-${entry.key}`,
    role: 'AXCheckBox',
    name: `${visible ? 'Hide' : 'Show'} ${entry.name}`,
    action: 'toggle_visibility',
    aosRef: `${SURFACE}:visibility:${entry.canvas_id}:${entry.object_id}`,
    checked,
  }, { nativeRole: 'checkbox' });
}

export function tripletInputAttrs(entry, group, axis, value) {
  const label = `${group.replace('_degrees', '')} ${axis} for ${entry.name}`;
  return semanticAttrString({
    id: `${group}-${axis}-${entry.key}`,
    role: 'AXTextField',
    name: label,
    action: 'edit_transform',
    aosRef: `${SURFACE}:input:${entry.canvas_id}:${entry.object_id}:${group}:${axis}`,
    value,
  }, { nativeRole: 'textbox' });
}

export function descriptorInputAttrs(entry, field, value) {
  const label = `${field.replace('_', ' ')} descriptor for ${entry.name}`;
  return semanticAttrString({
    id: `descriptor-${field}-${entry.key}`,
    role: 'AXTextArea',
    name: label,
    action: 'edit_descriptor',
    aosRef: `${SURFACE}:descriptor:${entry.canvas_id}:${entry.object_id}:${field}`,
    value,
  }, { nativeRole: 'textbox' });
}
