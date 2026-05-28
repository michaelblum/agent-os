export const UX_TREE_SCHEMA = 'aos_ux_tree';
export const UX_TREE_VERSION = '0.1.0';

const KEYED_ARRAYS = new Set(['nodes', 'commands', 'bindings', 'modes']);
const HANDLER_REF_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const ALLOWLISTED_EXECUTION = 'allowlisted';

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneJson(entry));
  if (!isPlainObject(value)) return value;
  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = cloneJson(entry);
  }
  return next;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter((entry) => entry !== undefined && entry !== null) : [];
}

function validationError(code, message, path = '') {
  return { code, message, path };
}

function sourceRefValue(ref) {
  if (typeof ref === 'string') return ref;
  if (!isPlainObject(ref)) return '';
  return ref.ref ?? ref.url ?? ref.path ?? '';
}

function isEmbeddedRef(value) {
  return typeof value === 'string' && /^(?:data|blob):/i.test(value.trim());
}

function validateEmbeddedRefs(refs, { pathPrefix = '', code = 'resource.binary', label = 'resource refs' } = {}) {
  const errors = [];
  for (const [index, ref] of list(refs).entries()) {
    if (isEmbeddedRef(sourceRefValue(ref))) {
      errors.push(validationError(code, `${label} must not embed data/blob payloads`, `${pathPrefix}/${index}`));
    }
  }
  return errors;
}

function validateRawCommandContracts(source = {}) {
  const errors = [];
  for (const [index, command] of list(source.commands).entries()) {
    const handlerRef = command?.handler_ref;
    if (typeof handlerRef !== 'string') {
      errors.push(validationError('command.handler_ref.type', `commands[${index}].handler_ref must be a string`, `/commands/${index}/handler_ref`));
    } else if (handlerRef.length === 0) {
      errors.push(validationError('command.handler_ref', `commands[${index}].handler_ref is required`, `/commands/${index}/handler_ref`));
    } else if (!HANDLER_REF_PATTERN.test(handlerRef)) {
      errors.push(validationError('command.handler_ref.pattern', `commands[${index}].handler_ref must be an allowlisted reference`, `/commands/${index}/handler_ref`));
    }

    if (command?.safety?.execution !== ALLOWLISTED_EXECUTION) {
      errors.push(validationError('command.safety.execution', `commands[${index}].safety.execution must be ${ALLOWLISTED_EXECUTION}`, `/commands/${index}/safety/execution`));
    }
  }
  return { ok: errors.length === 0, errors };
}

function mergeValidationResults(...results) {
  const errors = [];
  const seen = new Set();
  for (const result of results) {
    for (const error of list(result?.errors)) {
      const key = `${error.code}\0${error.path}\0${error.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(error);
    }
  }
  return { ok: errors.length === 0, errors };
}

function keyedMergeArray(baseItems = [], overrideItems = [], mergeEntry = mergeUxTreeValue) {
  const result = [];
  const indexes = new Map();
  for (const item of list(baseItems)) {
    if (!isPlainObject(item)) continue;
    const id = text(item.id);
    if (!id) continue;
    indexes.set(id, result.length);
    result.push(cloneJson(item));
  }
  for (const item of list(overrideItems)) {
    if (!isPlainObject(item)) continue;
    const id = text(item.id);
    if (!id || !indexes.has(id)) {
      if (id) indexes.set(id, result.length);
      result.push(cloneJson(item));
      continue;
    }
    const index = indexes.get(id);
    result[index] = mergeEntry(result[index], item);
  }
  return result;
}

function mergeUxTreeValue(base, override, key = '') {
  if (override === undefined) return cloneJson(base);
  if (KEYED_ARRAYS.has(key)) return keyedMergeArray(base, override);
  if (Array.isArray(base) || Array.isArray(override)) return cloneJson(override);
  if (!isPlainObject(base) || !isPlainObject(override)) return cloneJson(override);
  const next = cloneJson(base);
  for (const [entryKey, value] of Object.entries(override)) {
    next[entryKey] = mergeUxTreeValue(next[entryKey], value, entryKey);
  }
  return next;
}

function hasExecutableValue(value, seen = new Set()) {
  if (typeof value === 'function' || typeof value === 'symbol') return true;
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasExecutableValue(entry, seen));
  return Object.values(value).some((entry) => hasExecutableValue(entry, seen));
}

export function normalizeUxTreeNode(node = {}, options = {}) {
  const id = text(node.id || options.id);
  return {
    id,
    ...(text(node.parent_id) ? { parent_id: text(node.parent_id) } : {}),
    label: text(node.label, id),
    role: text(node.role, 'generic'),
    node_type: text(node.node_type, 'affordance'),
    ...(node.hit !== undefined ? { hit: cloneJson(node.hit) } : {}),
    ...(node.hit_source !== undefined ? { hit_source: cloneJson(node.hit_source) } : {}),
    ...(text(node.settings_ref) ? { settings_ref: text(node.settings_ref) } : {}),
    resource_refs: list(node.resource_refs).map((entry) => cloneJson(entry)),
    children: list(node.children).map((entry) => text(entry)).filter(Boolean),
    source_metadata: cloneJson(node.source_metadata || {}),
    metadata: cloneJson(node.metadata || {}),
  };
}

export function normalizeUxTreeCommand(command = {}, options = {}) {
  const id = text(command.id || options.id);
  return {
    id,
    label: text(command.label, id),
    description: text(command.description),
    handler_ref: text(command.handler_ref),
    parameters: cloneJson(command.parameters || {}),
    safety: cloneJson(command.safety || { execution: 'allowlisted' }),
    source_metadata: cloneJson(command.source_metadata || {}),
    metadata: cloneJson(command.metadata || {}),
  };
}

export function normalizeUxTreeBinding(binding = {}, options = {}) {
  const id = text(binding.id || options.id);
  return {
    id,
    node_id: text(binding.node_id),
    mode: text(binding.mode, 'global'),
    gesture: text(binding.gesture),
    command_id: text(binding.command_id),
    enabled: binding.enabled !== false,
    priority: numberOr(binding.priority, 0),
    consume_policy: text(binding.consume_policy, 'observe'),
    parameters: cloneJson(binding.parameters || {}),
    source_metadata: cloneJson(binding.source_metadata || {}),
    metadata: cloneJson(binding.metadata || {}),
  };
}

export function mergeUxTreeDefinitions(base = {}, override = {}) {
  return mergeUxTreeValue(base, override);
}

function normalizeMode(mode = {}) {
  if (typeof mode === 'string') {
    return { id: text(mode), label: text(mode), source_metadata: {} };
  }
  const id = text(mode.id);
  return {
    id,
    label: text(mode.label, id),
    description: text(mode.description),
    source_metadata: cloneJson(mode.source_metadata || {}),
    metadata: cloneJson(mode.metadata || {}),
  };
}

function validateUxTree(tree = {}) {
  const errors = [];
  if (!isPlainObject(tree)) {
    return { ok: false, errors: [validationError('tree.type', 'UX tree must be an object')] };
  }
  if (tree.schema !== UX_TREE_SCHEMA) errors.push(validationError('tree.schema', `schema must be ${UX_TREE_SCHEMA}`, '/schema'));
  if (!text(tree.version)) errors.push(validationError('tree.version', 'version is required', '/version'));
  if (!text(tree.id)) errors.push(validationError('tree.id', 'id is required', '/id'));
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    errors.push(validationError('nodes.required', 'nodes must contain at least one node', '/nodes'));
  }

  const nodeIds = new Set();
  const commandIds = new Set();
  const modeIds = new Set(['global']);

  errors.push(...validateEmbeddedRefs(tree.source_refs, {
    pathPrefix: '/source_refs',
    code: 'source.binary',
    label: 'source refs',
  }));

  for (const [index, mode] of list(tree.modes).entries()) {
    if (!text(mode.id)) errors.push(validationError('mode.id', `modes[${index}].id is required`, `/modes/${index}/id`));
    else modeIds.add(mode.id);
  }
  for (const [index, node] of list(tree.nodes).entries()) {
    if (!text(node.id)) errors.push(validationError('node.id', `nodes[${index}].id is required`, `/nodes/${index}/id`));
    if (nodeIds.has(node.id)) errors.push(validationError('node.duplicate', `duplicate node id ${node.id}`, `/nodes/${index}/id`));
    nodeIds.add(node.id);
    errors.push(...validateEmbeddedRefs(node.resource_refs, { pathPrefix: `/nodes/${index}/resource_refs` }));
  }
  for (const [index, command] of list(tree.commands).entries()) {
    if (!text(command.id)) errors.push(validationError('command.id', `commands[${index}].id is required`, `/commands/${index}/id`));
    if (commandIds.has(command.id)) errors.push(validationError('command.duplicate', `duplicate command id ${command.id}`, `/commands/${index}/id`));
    commandIds.add(command.id);
    if (typeof command.handler_ref !== 'string') {
      errors.push(validationError('command.handler_ref.type', `commands[${index}].handler_ref must be a string`, `/commands/${index}/handler_ref`));
    } else if (!command.handler_ref) {
      errors.push(validationError('command.handler_ref', `commands[${index}].handler_ref is required`, `/commands/${index}/handler_ref`));
    } else if (!HANDLER_REF_PATTERN.test(command.handler_ref)) {
      errors.push(validationError('command.handler_ref.pattern', `commands[${index}].handler_ref must be an allowlisted reference`, `/commands/${index}/handler_ref`));
    }
    if (command.safety?.execution !== ALLOWLISTED_EXECUTION) {
      errors.push(validationError('command.safety.execution', `commands[${index}].safety.execution must be ${ALLOWLISTED_EXECUTION}`, `/commands/${index}/safety/execution`));
    }
    if (hasExecutableValue(command)) errors.push(validationError('command.executable', 'commands must not contain executable values', `/commands/${index}`));
  }
  for (const [index, binding] of list(tree.bindings).entries()) {
    if (!text(binding.id)) errors.push(validationError('binding.id', `bindings[${index}].id is required`, `/bindings/${index}/id`));
    if (!nodeIds.has(binding.node_id)) errors.push(validationError('binding.node_ref', `binding ${binding.id || index} references unknown node ${binding.node_id}`, `/bindings/${index}/node_id`));
    if (!commandIds.has(binding.command_id)) errors.push(validationError('binding.command_ref', `binding ${binding.id || index} references unknown command ${binding.command_id}`, `/bindings/${index}/command_id`));
    if (binding.mode && !modeIds.has(binding.mode)) errors.push(validationError('binding.mode_ref', `binding ${binding.id || index} references unknown mode ${binding.mode}`, `/bindings/${index}/mode`));
    if (!text(binding.gesture)) errors.push(validationError('binding.gesture', `bindings[${index}].gesture is required`, `/bindings/${index}/gesture`));
  }
  return { ok: errors.length === 0, errors };
}

export function resolveUxTree(input = {}, options = {}) {
  const source = cloneJson(input);
  const rawValidation = validateRawCommandContracts(source);
  const tree = {
    schema: UX_TREE_SCHEMA,
    version: text(source.version, UX_TREE_VERSION),
    id: text(source.id),
    label: text(source.label, source.id),
    owner: text(source.owner, 'unknown'),
    source_refs: list(source.source_refs).map((entry) => cloneJson(entry)),
    modes: list(source.modes).map((mode) => normalizeMode(mode)),
    nodes: list(source.nodes).map((node) => normalizeUxTreeNode(node)),
    commands: list(source.commands).map((command) => normalizeUxTreeCommand(command)),
    bindings: list(source.bindings).map((binding) => normalizeUxTreeBinding(binding)),
    settings: cloneJson(source.settings || {}),
    metadata: cloneJson(source.metadata || {}),
  };
  const validation = mergeValidationResults(rawValidation, validateUxTree(tree));
  tree.validation = validation;
  if (options.strict && !validation.ok) {
    throw new Error(`Invalid UX tree: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return tree;
}

export function createUxTree(input = {}, options = {}) {
  return resolveUxTree(input, options);
}

export function uxTreeBindingsForGesture(tree = {}, { nodeId = '', mode = 'global', gesture = '' } = {}) {
  const normalizedNodeId = text(nodeId);
  const normalizedMode = text(mode, 'global');
  const normalizedGesture = text(gesture);
  return list(tree.bindings)
    .filter((binding) => binding.enabled !== false)
    .filter((binding) => !normalizedNodeId || binding.node_id === normalizedNodeId)
    .filter((binding) => !normalizedGesture || binding.gesture === normalizedGesture)
    .filter((binding) => binding.mode === normalizedMode || binding.mode === 'global')
    .sort((a, b) => numberOr(b.priority, 0) - numberOr(a.priority, 0) || String(a.id).localeCompare(String(b.id)));
}

export function uxTreeCommandById(tree = {}, commandId = '') {
  const id = text(commandId);
  return list(tree.commands).find((command) => command.id === id) || null;
}
