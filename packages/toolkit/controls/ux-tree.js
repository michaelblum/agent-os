import { createUxTree } from '../runtime/ux-tree.js';

export const CONTROL_UX_TREE_RUNTIME_STATE = 'read_only_shadow';

const HANDLER_REF_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_SOURCE_REFS = Object.freeze({
  button: [
    { id: 'toolkit-controls-button', kind: 'source', ref: 'packages/toolkit/controls/button.js' },
    { id: 'toolkit-controls-ux-tree', kind: 'source', ref: 'packages/toolkit/controls/ux-tree.js' },
  ],
  toggle: [
    { id: 'toolkit-controls-toggle', kind: 'source', ref: 'packages/toolkit/controls/toggle.js' },
    { id: 'toolkit-controls-ux-tree', kind: 'source', ref: 'packages/toolkit/controls/ux-tree.js' },
  ],
  buttonGroup: [
    { id: 'toolkit-controls-button-group', kind: 'source', ref: 'packages/toolkit/controls/button-group.js' },
    { id: 'toolkit-controls-ux-tree', kind: 'source', ref: 'packages/toolkit/controls/ux-tree.js' },
  ],
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function safeSegment(value, fallback) {
  const normalized = text(value, fallback)
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function jsonClone(value) {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return JSON.parse(serialized);
  } catch {
    return String(value);
  }
}

function jsonObject(entries) {
  const object = {};
  for (const [key, value] of Object.entries(entries)) {
    const cloned = jsonClone(value);
    if (cloned !== undefined) object[key] = cloned;
  }
  return object;
}

function handlerRef(value, fallback) {
  const ref = text(value, fallback);
  if (!HANDLER_REF_PATTERN.test(ref)) {
    throw new TypeError(`UX tree handler_ref must be an allowlisted reference: ${ref}`);
  }
  return ref;
}

function baseControlId(config = {}, fallback) {
  return safeSegment(config.uxNodeId ?? config.uxId ?? config.id ?? config.name, fallback);
}

function labelFor(config = {}, fallback) {
  return text(config.uxLabel ?? config.label ?? config.ariaLabel ?? config.title, fallback);
}

function readOnlyMetadata(controlFamily, extra = {}) {
  return {
    runtime_state: CONTROL_UX_TREE_RUNTIME_STATE,
    producer: 'toolkit.controls',
    control_family: controlFamily,
    intent: 'inspect_only',
    command_execution: 'future_adapter',
    ...jsonClone(extra),
  };
}

function command({ id, label, handler_ref, parameters = {}, metadata = {} }) {
  return {
    id,
    label,
    handler_ref,
    parameters: jsonClone(parameters) || {},
    safety: { execution: 'allowlisted' },
    metadata: readOnlyMetadata('command', metadata),
  };
}

function binding({ id, node_id, gesture, command_id, parameters = {}, metadata = {}, priority = 10 }) {
  return {
    id,
    node_id,
    mode: 'global',
    gesture,
    command_id,
    enabled: true,
    priority,
    consume_policy: 'observe',
    parameters: jsonClone(parameters) || {},
    metadata: readOnlyMetadata('binding', metadata),
  };
}

function resolveTree(input, options = {}) {
  return createUxTree(input, { strict: options.strict !== false });
}

export function createButtonUxTreeFragment(config = {}, options = {}) {
  const nodeId = baseControlId(config, 'toolkit.controls.button');
  const commandId = `${nodeId}.activate`;
  const label = labelFor(config, 'Button');
  return resolveTree({
    id: `${nodeId}.ux_tree`,
    label: `${label} UX Tree`,
    owner: text(options.owner ?? config.owner, 'toolkit.controls'),
    source_refs: CONTROL_SOURCE_REFS.button,
    modes: [{ id: 'global', label: 'Global' }],
    nodes: [
      {
        id: nodeId,
        label,
        role: 'button',
        node_type: 'control',
        metadata: {
          runtime_state: CONTROL_UX_TREE_RUNTIME_STATE,
          state: jsonObject({
            disabled: !!config.disabled,
            pressed: config.pressed ?? config.ariaPressed,
            variant: config.variant,
            type: config.type || 'button',
          }),
        },
      },
    ],
    commands: [
      command({
        id: commandId,
        label: `Activate ${label}`,
        handler_ref: handlerRef(config.uxHandlerRef ?? config.handler_ref, 'toolkit.controls.button.activate'),
      }),
    ],
    bindings: [
      binding({ id: `${nodeId}.pointer.click`, node_id: nodeId, gesture: 'pointer.left.click', command_id: commandId }),
      binding({ id: `${nodeId}.keyboard.enter`, node_id: nodeId, gesture: 'keyboard.enter', command_id: commandId }),
      binding({ id: `${nodeId}.keyboard.space`, node_id: nodeId, gesture: 'keyboard.space', command_id: commandId }),
    ],
    relations: [],
    settings: {},
    metadata: readOnlyMetadata('button'),
  }, options);
}

export function createToggleUxTreeFragment(config = {}, options = {}) {
  const nodeId = baseControlId(config, 'toolkit.controls.toggle');
  const commandId = `${nodeId}.toggle`;
  const label = labelFor(config, 'Toggle');
  return resolveTree({
    id: `${nodeId}.ux_tree`,
    label: `${label} UX Tree`,
    owner: text(options.owner ?? config.owner, 'toolkit.controls'),
    source_refs: CONTROL_SOURCE_REFS.toggle,
    modes: [{ id: 'global', label: 'Global' }],
    nodes: [
      {
        id: nodeId,
        label,
        role: 'switch',
        node_type: 'control',
        metadata: {
          runtime_state: CONTROL_UX_TREE_RUNTIME_STATE,
          state: jsonObject({
            checked: !!config.checked,
            disabled: !!config.disabled,
            name: config.name,
          }),
        },
      },
    ],
    commands: [
      command({
        id: commandId,
        label: `Toggle ${label}`,
        handler_ref: handlerRef(config.uxHandlerRef ?? config.handler_ref, 'toolkit.controls.toggle.change'),
      }),
    ],
    bindings: [
      binding({ id: `${nodeId}.pointer.click`, node_id: nodeId, gesture: 'pointer.left.click', command_id: commandId }),
      binding({ id: `${nodeId}.keyboard.space`, node_id: nodeId, gesture: 'keyboard.space', command_id: commandId }),
    ],
    relations: [],
    settings: {},
    metadata: readOnlyMetadata('toggle'),
  }, options);
}

export function createButtonGroupUxTreeFragment(config = {}, options = {}) {
  const groupId = baseControlId(config, 'toolkit.controls.segmented');
  const groupLabel = labelFor(config, 'Segmented Control');
  const optionConfigs = list(config.options);
  const optionNodes = optionConfigs.map((option, index) => {
    const valueSegment = safeSegment(option.uxNodeId ?? option.id ?? option.value, `option_${index + 1}`);
    const optionId = `${groupId}.${valueSegment}`;
    return {
      option,
      index,
      node: {
        id: optionId,
        parent_id: groupId,
        label: text(option.uxLabel ?? option.label ?? option.value, `Option ${index + 1}`),
        role: 'button',
        node_type: 'control_option',
        metadata: {
          runtime_state: CONTROL_UX_TREE_RUNTIME_STATE,
          state: jsonObject({
            value: option.value,
            selected: option.value === config.value,
            danger: !!option.danger,
            disabled: !!option.disabled,
          }),
        },
      },
    };
  });
  const nextCommandId = `${groupId}.select_next`;
  const previousCommandId = `${groupId}.select_previous`;

  return resolveTree({
    id: `${groupId}.ux_tree`,
    label: `${groupLabel} UX Tree`,
    owner: text(options.owner ?? config.owner, 'toolkit.controls'),
    source_refs: CONTROL_SOURCE_REFS.buttonGroup,
    modes: [{ id: 'global', label: 'Global' }],
    nodes: [
      {
        id: groupId,
        label: groupLabel,
        role: 'group',
        node_type: 'control_group',
        children: optionNodes.map((entry) => entry.node.id),
        metadata: {
          runtime_state: CONTROL_UX_TREE_RUNTIME_STATE,
          state: jsonObject({
            value: config.value ?? null,
            option_count: optionNodes.length,
          }),
        },
      },
      ...optionNodes.map((entry) => entry.node),
    ],
    commands: [
      ...optionNodes.map(({ node, option }) => command({
        id: `${node.id}.select`,
        label: `Select ${node.label}`,
        handler_ref: handlerRef(option.uxHandlerRef ?? config.uxHandlerRef ?? config.handler_ref, 'toolkit.controls.segmented.select_option'),
        parameters: jsonObject({ value: option.value }),
        metadata: { option_node_id: node.id },
      })),
      command({
        id: nextCommandId,
        label: `Select next ${groupLabel} option`,
        handler_ref: handlerRef(config.uxNextHandlerRef, 'toolkit.controls.segmented.select_next'),
      }),
      command({
        id: previousCommandId,
        label: `Select previous ${groupLabel} option`,
        handler_ref: handlerRef(config.uxPreviousHandlerRef, 'toolkit.controls.segmented.select_previous'),
      }),
    ],
    bindings: optionNodes.flatMap(({ node }) => {
      const selectCommandId = `${node.id}.select`;
      return [
        binding({ id: `${node.id}.pointer.click`, node_id: node.id, gesture: 'pointer.left.click', command_id: selectCommandId }),
        binding({ id: `${node.id}.keyboard.enter`, node_id: node.id, gesture: 'keyboard.enter', command_id: selectCommandId }),
        binding({ id: `${node.id}.keyboard.space`, node_id: node.id, gesture: 'keyboard.space', command_id: selectCommandId }),
        binding({ id: `${node.id}.keyboard.arrow_right`, node_id: node.id, gesture: 'keyboard.arrow_right', command_id: nextCommandId, priority: 20 }),
        binding({ id: `${node.id}.keyboard.arrow_down`, node_id: node.id, gesture: 'keyboard.arrow_down', command_id: nextCommandId, priority: 20 }),
        binding({ id: `${node.id}.keyboard.arrow_left`, node_id: node.id, gesture: 'keyboard.arrow_left', command_id: previousCommandId, priority: 20 }),
        binding({ id: `${node.id}.keyboard.arrow_up`, node_id: node.id, gesture: 'keyboard.arrow_up', command_id: previousCommandId, priority: 20 }),
      ];
    }),
    relations: optionNodes.map(({ node }) => ({
      id: `${groupId}.owns.${node.id}`,
      relation_type: 'owns',
      from_node_id: groupId,
      to_node_id: node.id,
      metadata: readOnlyMetadata('button_group_relation'),
    })),
    settings: {},
    metadata: readOnlyMetadata('button_group'),
  }, options);
}
