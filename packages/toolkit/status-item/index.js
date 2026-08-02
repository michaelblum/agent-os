export const STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION = 'aos.status_item.descriptor.v1'
export const STATUS_ITEM_EVENT_SCHEMA_VERSION = 'aos.status_item.event.v1'
export const STATUS_ITEM_ANCHOR_SCHEMA_VERSION = 'aos.status_item.anchor.v1'
export const STATUS_ITEM_INVOKE_ERROR_CODES = Object.freeze([
  'INVALID_STATUS_ITEM_INVOKE',
  'STATUS_ITEM_NOT_FOUND',
  'STATUS_ITEM_UNAVAILABLE',
  'STATUS_ITEM_STALE_GENERATION',
  'STATUS_ITEM_STALE_REVISION',
  'STATUS_ITEM_STALE_ACTION_SEQUENCE',
  'STATUS_ITEM_ACTION_NOT_FOUND',
  'STATUS_ITEM_ACTION_DISABLED',
  'STATUS_ITEM_ANCHOR_UNAVAILABLE',
  'STATUS_ITEM_ACTION_SEQUENCE_EXHAUSTED',
  'STATUS_ITEM_EVENT_UNAVAILABLE',
])

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const PATH_ID_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u
const ANCHOR_ID_RE = /^native-status-item\/[a-z0-9][a-z0-9._-]{0,127}\/[a-z0-9][a-z0-9._-]{0,127}$/u
const BOUNDARY_WHITESPACE_RE = /^(?:[ \t\r\n])|(?:[ \t\r\n])$/u
const EVENT_TYPES = new Set([
  'ready',
  'bounds_changed',
  'topology_changed',
  'primary_activation',
  'secondary_activation',
  'menu_selection',
])
const ACTION_EVENT_TYPES = new Set(['primary_activation', 'secondary_activation', 'menu_selection'])
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function objectValue(value, label, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} must be an object`)
  return value
}

function onlyKeys(value, allowed, label, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} field ${key} is unsupported`)
  }
}

function stringValue(value, label, { min = 1, max = 128, code = 'INVALID_STATUS_ITEM_DESCRIPTOR' } = {}) {
  if (typeof value !== 'string') fail(code, `${label} must be a string`)
  if (BOUNDARY_WHITESPACE_RE.test(value)) fail(code, `${label} must not have surrounding whitespace`)
  const length = [...value].length
  if (length < min || length > max) fail(code, `${label} is outside its character limit`)
  return value
}

function identifier(value, label, { slash = false, code = 'INVALID_STATUS_ITEM_IDENTITY' } = {}) {
  const normalized = stringValue(value, label, { code })
  const re = slash ? PATH_ID_RE : ID_RE
  if (!re.test(normalized) || normalized.includes('..')) fail(code, `${label} is invalid`)
  return normalized
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, code = 'INVALID_STATUS_ITEM_EVENT' } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail(code, `${label} must be a safe integer`)
  }
  return value
}

function finiteNumber(value, label, { min = Number.NEGATIVE_INFINITY } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    fail('INVALID_STATUS_ITEM_EVENT', `${label} must be a finite number`)
  }
  return value
}

function normalizeRect(value, label) {
  const rect = objectValue(value, label, 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(rect, new Set(['x', 'y', 'width', 'height', 'origin_x', 'origin_y']), label, 'INVALID_STATUS_ITEM_EVENT')
  return {
    x: finiteNumber(rect.x, `${label}.x`),
    y: finiteNumber(rect.y, `${label}.y`),
    width: finiteNumber(rect.width, `${label}.width`, { min: 0 }),
    height: finiteNumber(rect.height, `${label}.height`, { min: 0 }),
    origin_x: finiteNumber(rect.origin_x, `${label}.origin_x`),
    origin_y: finiteNumber(rect.origin_y, `${label}.origin_y`),
  }
}

function normalizeBounds(value, label = 'bounds') {
  const bounds = objectValue(value, label, 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(bounds, new Set(['x', 'y', 'width', 'height', 'origin_x', 'origin_y', 'display_id']), label, 'INVALID_STATUS_ITEM_EVENT')
  return {
    ...normalizeRect({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      origin_x: bounds.origin_x,
      origin_y: bounds.origin_y,
    }, label),
    display_id: safeInteger(bounds.display_id, `${label}.display_id`, { max: 4_294_967_295 }),
  }
}

function normalizeModifiers(value) {
  if (!Array.isArray(value) || value.length > 8) fail('INVALID_STATUS_ITEM_EVENT', 'modifiers must be a bounded array')
  const allowed = new Set(['command', 'option', 'control', 'shift'])
  const seen = new Set()
  return value.map((modifier) => {
    if (!allowed.has(modifier) || seen.has(modifier)) fail('INVALID_STATUS_ITEM_EVENT', 'modifier is unsupported or duplicated')
    seen.add(modifier)
    return modifier
  })
}

function normalizeMenuItem(value) {
  const item = objectValue(value, 'menu item', 'INVALID_STATUS_ITEM_MENU')
  if (item.kind === 'separator') {
    onlyKeys(item, new Set(['kind']), 'menu separator', 'INVALID_STATUS_ITEM_MENU')
    return { kind: 'separator' }
  }
  onlyKeys(item, new Set(['kind', 'id', 'action_id', 'label', 'enabled', 'state', 'key_equivalent']), 'menu item', 'INVALID_STATUS_ITEM_MENU')
  if (item.kind !== 'item') fail('INVALID_STATUS_ITEM_MENU', 'menu item kind is unsupported')
  const normalized = {
    kind: 'item',
    id: identifier(item.id, 'menu.id', { slash: true }),
    action_id: identifier(item.action_id, 'menu.action_id', { slash: true }),
    label: stringValue(item.label, 'menu.label'),
  }
  if (hasOwn(item, 'enabled')) {
    if (typeof item.enabled !== 'boolean') fail('INVALID_STATUS_ITEM_MENU', 'menu.enabled must be a boolean')
    normalized.enabled = item.enabled
  }
  if (hasOwn(item, 'state')) {
    if (!['off', 'on', 'mixed'].includes(item.state)) fail('INVALID_STATUS_ITEM_MENU', 'menu.state is unsupported')
    normalized.state = item.state
  }
  if (hasOwn(item, 'key_equivalent')) {
    normalized.key_equivalent = stringValue(item.key_equivalent, 'menu.key_equivalent', { min: 0, max: 8 })
  }
  return normalized
}

export function normalizeStatusItemDescriptor(input) {
  const descriptor = objectValue(input, 'descriptor', 'INVALID_STATUS_ITEM_DESCRIPTOR')
  onlyKeys(descriptor, new Set(['schema_version', 'owner', 'item_id', 'revision', 'label', 'help_text', 'primary_action_id', 'menu']), 'descriptor', 'INVALID_STATUS_ITEM_DESCRIPTOR')
  if (descriptor.schema_version !== STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION) fail('INVALID_STATUS_ITEM_SCHEMA', 'descriptor schema_version is invalid')
  const revision = safeInteger(descriptor.revision, 'revision', { code: 'INVALID_STATUS_ITEM_DESCRIPTOR' })
  if (hasOwn(descriptor, 'menu') && !Array.isArray(descriptor.menu)) fail('INVALID_STATUS_ITEM_MENU', 'menu must be an array')
  if (Array.isArray(descriptor.menu) && descriptor.menu.length > 32) fail('INVALID_STATUS_ITEM_MENU', 'menu exceeds 32 items')
  const menu = hasOwn(descriptor, 'menu') ? descriptor.menu.map(normalizeMenuItem) : []
  const owner = identifier(descriptor.owner, 'owner')
  const itemId = identifier(descriptor.item_id, 'item_id')
  const primaryActionId = identifier(descriptor.primary_action_id, 'primary_action_id', { slash: true })
  const itemIDs = new Set()
  const actionIDs = new Set()
  for (const item of menu) {
    if (item.kind === 'separator') continue
    if (item.action_id === primaryActionId) fail('INVALID_STATUS_ITEM_MENU', 'menu action collides with primary action')
    if (itemIDs.has(item.id)) fail('INVALID_STATUS_ITEM_MENU', 'menu contains a duplicate item id')
    if (actionIDs.has(item.action_id)) fail('INVALID_STATUS_ITEM_MENU', 'menu contains a duplicate action id')
    itemIDs.add(item.id)
    actionIDs.add(item.action_id)
  }
  const normalized = {
    schema_version: STATUS_ITEM_DESCRIPTOR_SCHEMA_VERSION,
    owner,
    item_id: itemId,
    revision,
    label: stringValue(descriptor.label, 'label'),
    primary_action_id: primaryActionId,
    menu,
  }
  if (hasOwn(descriptor, 'help_text')) {
    normalized.help_text = stringValue(descriptor.help_text, 'help_text', { min: 0, max: 256 })
  }
  return normalized
}

export function normalizeStatusItemUpdateRequest(input) {
  const request = objectValue(input, 'update request', 'INVALID_STATUS_ITEM_UPDATE')
  onlyKeys(request, new Set(['owner', 'item_id', 'generation', 'current_revision', 'descriptor']), 'update request', 'INVALID_STATUS_ITEM_UPDATE')
  const normalized = {
    owner: identifier(request.owner, 'owner', { code: 'INVALID_STATUS_ITEM_UPDATE' }),
    item_id: identifier(request.item_id, 'item_id', { code: 'INVALID_STATUS_ITEM_UPDATE' }),
    generation: safeInteger(request.generation, 'generation', { min: 1, code: 'INVALID_STATUS_ITEM_UPDATE' }),
    current_revision: safeInteger(request.current_revision, 'current_revision', { code: 'INVALID_STATUS_ITEM_UPDATE' }),
    descriptor: normalizeStatusItemDescriptor(request.descriptor),
  }
  if (normalized.descriptor.owner !== normalized.owner || normalized.descriptor.item_id !== normalized.item_id) {
    fail('STATUS_ITEM_IDENTITY_MISMATCH', 'descriptor owner and item must match the requested lease')
  }
  if (normalized.descriptor.revision <= normalized.current_revision) {
    fail('STATUS_ITEM_REVISION_NOT_ADVANCED', 'descriptor revision must advance current_revision')
  }
  return normalized
}

export function normalizeStatusItemInvokeRequest(input) {
  const request = objectValue(input, 'invoke request', 'INVALID_STATUS_ITEM_INVOKE')
  onlyKeys(request, new Set(['owner', 'item_id', 'action_id', 'generation', 'descriptor_revision', 'action_sequence']), 'invoke request', 'INVALID_STATUS_ITEM_INVOKE')
  return {
    owner: identifier(request.owner, 'owner', { code: 'INVALID_STATUS_ITEM_INVOKE' }),
    item_id: identifier(request.item_id, 'item_id', { code: 'INVALID_STATUS_ITEM_INVOKE' }),
    action_id: identifier(request.action_id, 'action_id', { slash: true, code: 'INVALID_STATUS_ITEM_INVOKE' }),
    generation: safeInteger(request.generation, 'generation', { min: 1, code: 'INVALID_STATUS_ITEM_INVOKE' }),
    descriptor_revision: safeInteger(request.descriptor_revision, 'descriptor_revision', { code: 'INVALID_STATUS_ITEM_INVOKE' }),
    action_sequence: safeInteger(request.action_sequence, 'action_sequence', { min: 1, code: 'INVALID_STATUS_ITEM_INVOKE' }),
  }
}

export function normalizeStatusItemInvocationResult(input) {
  const code = 'INVALID_STATUS_ITEM_INVOKE_RESULT'
  try {
    const result = objectValue(input, 'invocation result', code)
    onlyKeys(result, new Set(['status', 'owner', 'item_id', 'action_id', 'generation', 'descriptor_revision', 'action_sequence', 'event_type', 'menu_item_id', 'bounds', 'anchor']), 'invocation result', code)
    if (!['ok', 'dry_run'].includes(result.status)) fail(code, 'invocation result status is unsupported')
    if (!['primary_activation', 'menu_selection'].includes(result.event_type)) fail(code, 'invocation result event_type is unsupported')
    const bounds = normalizeBounds(result.bounds)
    const anchor = normalizeStatusItemAnchor(result.anchor)
    if (JSON.stringify(bounds) !== JSON.stringify(anchor.bounds)) fail(code, 'invocation result bounds disagree with anchor bounds')
    const normalized = {
      status: result.status,
      owner: identifier(result.owner, 'owner', { code }),
      item_id: identifier(result.item_id, 'item_id', { code }),
      action_id: identifier(result.action_id, 'action_id', { slash: true, code }),
      generation: safeInteger(result.generation, 'generation', { min: 1, code }),
      descriptor_revision: safeInteger(result.descriptor_revision, 'descriptor_revision', { code }),
      action_sequence: safeInteger(result.action_sequence, 'action_sequence', { min: 1, code }),
      event_type: result.event_type,
      bounds,
      anchor,
    }
    if (anchor.anchor_id !== `native-status-item/${normalized.owner}/${normalized.item_id}`) {
      fail(code, 'invocation result owner and item disagree with anchor identity')
    }
    if (result.event_type === 'menu_selection') {
      normalized.menu_item_id = identifier(result.menu_item_id, 'menu_item_id', { slash: true, code })
    } else if (hasOwn(result, 'menu_item_id')) {
      fail(code, 'primary invocation result must not carry menu_item_id')
    }
    return normalized
  } catch (error) {
    if (error?.code === code) throw error
    fail(code, `invocation result is malformed: ${error?.message ?? 'invalid value'}`)
  }
}

export function normalizeStatusItemAnchor(input) {
  const anchor = objectValue(input, 'anchor', 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(anchor, new Set(['schema_version', 'anchor_id', 'host', 'coordinate_space', 'visible', 'bounds', 'display', 'topology']), 'anchor', 'INVALID_STATUS_ITEM_EVENT')
  if (anchor.schema_version !== STATUS_ITEM_ANCHOR_SCHEMA_VERSION) fail('INVALID_STATUS_ITEM_EVENT', 'anchor schema_version is invalid')
  const anchorId = stringValue(anchor.anchor_id, 'anchor.anchor_id', { max: 280, code: 'INVALID_STATUS_ITEM_EVENT' })
  if (!ANCHOR_ID_RE.test(anchorId) || anchorId.includes('..')) fail('INVALID_STATUS_ITEM_EVENT', 'anchor.anchor_id is invalid')
  if (anchor.host !== 'native_status_item' || anchor.coordinate_space !== 'global_display_top_left' || anchor.visible !== true) {
    fail('INVALID_STATUS_ITEM_EVENT', 'anchor host facts are invalid')
  }
  const bounds = normalizeBounds(anchor.bounds, 'anchor.bounds')
  const display = objectValue(anchor.display, 'anchor.display', 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(display, new Set(['id', 'frame', 'visible_frame']), 'anchor.display', 'INVALID_STATUS_ITEM_EVENT')
  const displayId = safeInteger(display.id, 'anchor.display.id', { max: 4_294_967_295 })
  const topology = objectValue(anchor.topology, 'anchor.topology', 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(topology, new Set(['display_count', 'display_ids', 'truncated']), 'anchor.topology', 'INVALID_STATUS_ITEM_EVENT')
  const displayCount = safeInteger(topology.display_count, 'anchor.topology.display_count', { min: 1, max: 1024 })
  if (!Array.isArray(topology.display_ids) || topology.display_ids.length > 32) fail('INVALID_STATUS_ITEM_EVENT', 'anchor.topology.display_ids must be bounded')
  const displayIds = topology.display_ids.map((id) => safeInteger(id, 'anchor.topology.display_ids', { max: 4_294_967_295 }))
  if (new Set(displayIds).size !== displayIds.length || !displayIds.includes(displayId)) fail('INVALID_STATUS_ITEM_EVENT', 'anchor topology display ids are invalid')
  if (typeof topology.truncated !== 'boolean'
      || (!topology.truncated && displayCount !== displayIds.length)
      || (topology.truncated && displayCount <= displayIds.length)
      || bounds.display_id !== displayId) {
    fail('INVALID_STATUS_ITEM_EVENT', 'anchor display facts disagree')
  }
  return {
    schema_version: STATUS_ITEM_ANCHOR_SCHEMA_VERSION,
    anchor_id: anchorId,
    host: 'native_status_item',
    coordinate_space: 'global_display_top_left',
    visible: true,
    bounds,
    display: {
      id: displayId,
      frame: normalizeRect(display.frame, 'anchor.display.frame'),
      visible_frame: normalizeRect(display.visible_frame, 'anchor.display.visible_frame'),
    },
    topology: { display_count: displayCount, display_ids: displayIds, truncated: topology.truncated },
  }
}

export function normalizeStatusItemEvent(input) {
  const event = objectValue(input, 'event', 'INVALID_STATUS_ITEM_EVENT')
  onlyKeys(event, new Set(['schema_version', 'type', 'owner', 'item_id', 'generation', 'descriptor_revision', 'sequence', 'action_sequence', 'timestamp', 'source', 'action_id', 'menu_item_id', 'origin_x', 'origin_y', 'modifiers', 'bounds', 'anchor']), 'event', 'INVALID_STATUS_ITEM_EVENT')
  if (event.schema_version !== STATUS_ITEM_EVENT_SCHEMA_VERSION || !EVENT_TYPES.has(event.type)) fail('INVALID_STATUS_ITEM_EVENT', 'event schema or type is unsupported')
  if (event.source !== 'status_item') fail('INVALID_STATUS_ITEM_EVENT', 'source must be status_item')
  const bounds = normalizeBounds(event.bounds)
  const anchor = normalizeStatusItemAnchor(event.anchor)
  if (JSON.stringify(bounds) !== JSON.stringify(anchor.bounds)) fail('INVALID_STATUS_ITEM_EVENT', 'event bounds disagree with anchor bounds')
  const normalized = {
    schema_version: STATUS_ITEM_EVENT_SCHEMA_VERSION,
    type: event.type,
    owner: identifier(event.owner, 'owner', { code: 'INVALID_STATUS_ITEM_EVENT' }),
    item_id: identifier(event.item_id, 'item_id', { code: 'INVALID_STATUS_ITEM_EVENT' }),
    generation: safeInteger(event.generation, 'generation', { min: 1 }),
    descriptor_revision: safeInteger(event.descriptor_revision, 'descriptor_revision'),
    sequence: safeInteger(event.sequence, 'sequence', { min: 1 }),
    timestamp: stringValue(event.timestamp, 'timestamp', { max: 64, code: 'INVALID_STATUS_ITEM_EVENT' }),
    source: 'status_item',
    bounds,
    anchor,
  }
  if (anchor.anchor_id !== `native-status-item/${normalized.owner}/${normalized.item_id}`) {
    fail('INVALID_STATUS_ITEM_EVENT', 'event owner and item disagree with anchor identity')
  }
  const actionFields = ['action_sequence', 'action_id', 'menu_item_id', 'origin_x', 'origin_y', 'modifiers']
  if (!ACTION_EVENT_TYPES.has(event.type)) {
    if (actionFields.some((key) => hasOwn(event, key))) fail('INVALID_STATUS_ITEM_EVENT', 'lifecycle event must not carry action fields')
    return normalized
  }
  normalized.action_sequence = safeInteger(event.action_sequence, 'action_sequence', { min: 1 })
  normalized.origin_x = safeInteger(event.origin_x, 'origin_x', { min: Number.MIN_SAFE_INTEGER })
  normalized.origin_y = safeInteger(event.origin_y, 'origin_y', { min: Number.MIN_SAFE_INTEGER })
  normalized.modifiers = normalizeModifiers(event.modifiers)
  if (event.type === 'primary_activation') {
    normalized.action_id = identifier(event.action_id, 'action_id', { slash: true, code: 'INVALID_STATUS_ITEM_EVENT' })
    if (hasOwn(event, 'menu_item_id')) fail('INVALID_STATUS_ITEM_EVENT', 'primary activation event must not carry menu_item_id')
  } else if (event.type === 'secondary_activation') {
    if (hasOwn(event, 'action_id') || hasOwn(event, 'menu_item_id')) fail('INVALID_STATUS_ITEM_EVENT', 'secondary activation event must not carry action or menu identity')
  } else {
    normalized.action_id = identifier(event.action_id, 'action_id', { slash: true, code: 'INVALID_STATUS_ITEM_EVENT' })
    normalized.menu_item_id = identifier(event.menu_item_id, 'menu_item_id', { slash: true, code: 'INVALID_STATUS_ITEM_EVENT' })
  }
  return normalized
}
