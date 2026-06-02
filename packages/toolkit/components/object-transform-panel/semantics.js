import { semanticTargetAttrString } from '../../runtime/semantic-targets.js';

const SURFACE = 'object-transform-panel';
const ATTRIBUTE_ORDER = Object.freeze([
  'aria-label',
  'data-aos-ref',
  'data-aos-surface',
  'data-semantic-target-id',
  'data-aos-action',
  'aria-selected',
  'aria-checked',
  'aria-valuetext',
  'aria-disabled',
  'role',
]);

function semanticAttrString(target = {}, options = {}) {
  return semanticTargetAttrString({
    ...target,
    surface: SURFACE,
  }, {
    nativeRole: options.nativeRole,
    attributeOrder: ATTRIBUTE_ORDER,
    includeParentCanvas: false,
  });
}

export function objectRowAttrs(entry, selected = false) {
  return semanticAttrString({
    id: `object-${entry.key}`,
    role: 'AXButton',
    name: `Select ${entry.name}`,
    action: 'select_object',
    ref: `${SURFACE}:object:${entry.canvas_id}:${entry.object_id}`,
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
    ref: `${SURFACE}:visibility:${entry.canvas_id}:${entry.object_id}`,
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
    ref: `${SURFACE}:input:${entry.canvas_id}:${entry.object_id}:${group}:${axis}`,
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
    ref: `${SURFACE}:descriptor:${entry.canvas_id}:${entry.object_id}:${field}`,
    value,
  }, { nativeRole: 'textbox' });
}
