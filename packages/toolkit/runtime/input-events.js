// input-events.js — normalize canvas input stream envelopes.
//
// Canonical callers should provide raw input-event-v2 payloads or routed-v1
// envelopes. Unversioned event names and wrappers remain only as explicit
// bridges for native producer fanout and canvas-origin synthetic messages.

const RAW_INPUT_EVENT_TYPES = new Set([
  'left_mouse_down',
  'left_mouse_up',
  'left_mouse_dragged',
  'mouse_moved',
  'right_mouse_down',
  'right_mouse_up',
  'right_mouse_dragged',
  'middle_mouse_down',
  'middle_mouse_up',
  'middle_mouse_dragged',
  'other_mouse_down',
  'other_mouse_up',
  'other_mouse_dragged',
  'scroll_wheel',
  'pointer_cancel',
  'mouse_cancel',
  'key_down',
  'key_up',
])

const POINTER_PHASE_BY_TYPE = {
  left_mouse_down: 'down',
  left_mouse_dragged: 'drag',
  left_mouse_up: 'up',
  right_mouse_down: 'down',
  right_mouse_dragged: 'drag',
  right_mouse_up: 'up',
  middle_mouse_down: 'down',
  middle_mouse_dragged: 'drag',
  middle_mouse_up: 'up',
  other_mouse_down: 'down',
  other_mouse_dragged: 'drag',
  other_mouse_up: 'up',
  mouse_moved: 'move',
  scroll_wheel: 'scroll',
  pointer_cancel: 'cancel',
  mouse_cancel: 'cancel',
}

const RAW_REQUIRED_BY_KIND = {
  pointer: ['phase', 'device', 'timestamp_monotonic_ms', 'sequence', 'native', 'display_id', 'topology_version', 'button', 'buttons', 'modifiers'],
  scroll: ['phase', 'device', 'timestamp_monotonic_ms', 'sequence', 'native', 'display_id', 'topology_version', 'scroll', 'modifiers'],
  key: ['timestamp_monotonic_ms', 'sequence', 'key', 'modifiers'],
  cancel: ['phase', 'timestamp_monotonic_ms', 'sequence', 'cancel_reason'],
}

const ROUTED_REQUIRED_BY_KIND = {
  pointer: ['phase', 'button', 'buttons'],
  scroll: ['phase', 'scroll'],
  key: ['key'],
  cancel: ['phase', 'cancel_reason'],
}

const POINTER_ROUTED_PHASES = new Set(['down', 'move', 'drag', 'up', 'enter', 'hover', 'leave', 'hover_cancel'])
const CANONICAL_CANCEL_REASONS = new Set([
  'os_cancelled',
  'surface_removed',
  'surface_suspended',
  'surface_disabled',
  'owner_disconnected',
  'topology_stale',
  'capture_timeout',
  'emergency_command',
])

const RAW_ALLOWED_COMMON_FIELDS = [
  'input_schema_version',
  'event_kind',
  'type',
  'timestamp_monotonic_ms',
  'sequence',
  'source_origin',
  'source_canvas_id',
  'gesture_id',
  'x',
  'y',
  'native',
  'display_id',
  'topology_version',
  'desktop_world',
  'coordinate_authority',
  'modifiers',
  'flags',
]

const RAW_ALLOWED_FIELDS_BY_KIND = {
  pointer: new Set([...RAW_ALLOWED_COMMON_FIELDS, 'phase', 'device', 'button', 'buttons', 'click_count']),
  scroll: new Set([...RAW_ALLOWED_COMMON_FIELDS, 'phase', 'device', 'scroll']),
  key: new Set([
    'input_schema_version',
    'event_kind',
    'type',
    'timestamp_monotonic_ms',
    'sequence',
    'source_origin',
    'source_canvas_id',
    'key',
    'key_code',
    'modifiers',
    'flags',
    'native',
    'display_id',
    'topology_version',
    'desktop_world',
    'coordinate_authority',
  ]),
  cancel: new Set([...RAW_ALLOWED_COMMON_FIELDS, 'phase', 'caused_by_sequence', 'cancel_reason', 'button', 'buttons']),
}

const ROUTED_ALLOWED_FIELDS = new Set([
  'routed_schema_version',
  'event_kind',
  'type',
  'delivery_role',
  'sequence',
  'gesture_id',
  'desktop_world',
  'coordinate_authority',
  'source_origin',
  'source_canvas_id',
  'owner_canvas_id',
  'source_sequence',
  'source_event',
  'phase',
  'region_id',
  'capture_id',
  'cancel_reason',
  'button',
  'buttons',
  'scroll',
  'key',
])

export function isCanvasInputEventType(type) {
  return typeof type === 'string' && RAW_INPUT_EVENT_TYPES.has(type)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function pickObject(...values) {
  for (const value of values) {
    if (value && typeof value === 'object') return value
  }
  return null
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function assertRequiredFields(event, fields, context) {
  const missing = fields.filter((field) => event[field] === undefined || event[field] === null)
  if (missing.length) {
    throw new Error(`${context} missing required field(s): ${missing.join(', ')}`)
  }
}

function assertAllowedFields(event, allowed, context) {
  const unknown = Object.keys(event).filter((field) => !allowed.has(field))
  if (unknown.length) {
    throw new Error(`${context} has unsupported field(s): ${unknown.join(', ')}`)
  }
}

function assertPoint(value, field, context) {
  if (!value || typeof value !== 'object' || finiteNumber(value.x) === null || finiteNumber(value.y) === null) {
    throw new Error(`${context} requires ${field}.x and ${field}.y`)
  }
}

function assertSequence(value, field, context) {
  if (!value || typeof value !== 'object' || value.source === undefined || value.value === undefined) {
    throw new Error(`${context} requires ${field}.source and ${field}.value`)
  }
}

function assertScroll(value, field, context) {
  if (!value || typeof value !== 'object' || finiteNumber(value.dx) === null || finiteNumber(value.dy) === null || value.unit !== 'point') {
    throw new Error(`${context} requires ${field}.dx, ${field}.dy, and ${field}.unit "point"`)
  }
}

function assertButtons(value, field, context) {
  if (!value || typeof value !== 'object' || typeof value.left !== 'boolean' || typeof value.right !== 'boolean' || typeof value.middle !== 'boolean' || !Array.isArray(value.other_pressed)) {
    throw new Error(`${context} requires ${field} button-state booleans`)
  }
}

function validateRawV2InputEvent(event) {
  const context = 'input-event-v2 payload'
  assertRequiredFields(event, ['input_schema_version', 'event_kind', 'type', 'timestamp_monotonic_ms', 'sequence'], context)
  const required = RAW_REQUIRED_BY_KIND[event.event_kind]
  if (!required) throw new Error(`${context} has unsupported event_kind: ${event.event_kind}`)
  assertAllowedFields(event, RAW_ALLOWED_FIELDS_BY_KIND[event.event_kind], context)
  assertRequiredFields(event, required, context)
  assertSequence(event.sequence, 'sequence', context)
  if (event.native) assertPoint(event.native, 'native', context)
  if (event.desktop_world || event.coordinate_authority) {
    assertPoint(event.desktop_world, 'desktop_world', context)
    assertRequiredFields(event, ['coordinate_authority'], context)
  }
  if (event.event_kind === 'pointer' && !['down', 'move', 'drag', 'up'].includes(event.phase)) {
    throw new Error(`${context} pointer phase is invalid: ${event.phase}`)
  }
  if (event.event_kind === 'scroll') {
    if (event.phase !== 'scroll') throw new Error(`${context} scroll phase must be "scroll"`)
    assertScroll(event.scroll, 'scroll', context)
  }
  if (event.event_kind === 'key' && event.phase !== undefined) {
    throw new Error(`${context} key events must not include phase`)
  }
  if (event.event_kind === 'cancel') {
    if (event.phase !== 'cancel') throw new Error(`${context} cancel phase must be "cancel"`)
    if (!CANONICAL_CANCEL_REASONS.has(event.cancel_reason)) throw new Error(`${context} cancel_reason is invalid: ${event.cancel_reason}`)
  }
  if (event.buttons) assertButtons(event.buttons, 'buttons', context)
}

function validateRoutedV1InputEvent(event) {
  const context = 'routed-v1 input payload'
  assertRequiredFields(event, [
    'routed_schema_version',
    'event_kind',
    'type',
    'delivery_role',
    'sequence',
    'gesture_id',
    'desktop_world',
    'coordinate_authority',
    'source_origin',
    'source_event',
  ], context)
  const required = ROUTED_REQUIRED_BY_KIND[event.event_kind]
  if (!required) throw new Error(`${context} has unsupported event_kind: ${event.event_kind}`)
  assertAllowedFields(event, ROUTED_ALLOWED_FIELDS, context)
  assertRequiredFields(event, required, context)
  assertSequence(event.sequence, 'sequence', context)
  assertPoint(event.desktop_world, 'desktop_world', context)
  if (event.source_sequence) assertSequence(event.source_sequence, 'source_sequence', context)
  if (event.delivery_role === 'owned' || event.delivery_role === 'captured') {
    assertRequiredFields(event, ['region_id', 'owner_canvas_id'], context)
  }
  if (event.delivery_role === 'captured') {
    assertRequiredFields(event, ['capture_id'], context)
  }
  if (!['observed', 'owned', 'captured'].includes(event.delivery_role)) {
    throw new Error(`${context} delivery_role is invalid: ${event.delivery_role}`)
  }
  if (event.event_kind === 'pointer') {
    if (!POINTER_ROUTED_PHASES.has(event.phase)) throw new Error(`${context} pointer phase is invalid: ${event.phase}`)
    assertButtons(event.buttons, 'buttons', context)
  }
  if (event.event_kind === 'scroll') {
    if (event.phase !== 'scroll') throw new Error(`${context} scroll phase must be "scroll"`)
    assertScroll(event.scroll, 'scroll', context)
  }
  if (event.event_kind === 'cancel' && event.phase !== 'cancel') {
    throw new Error(`${context} cancel phase must be "cancel"`)
  }
  if (event.source_event && typeof event.source_event === 'object') {
    if (event.source_event.input_schema_version !== 2) {
      throw new Error(`${context} source_event object must be a raw input-event-v2 payload`)
    }
    validateRawV2InputEvent(event.source_event)
  }
}

function validateVersionedInputEvent(event) {
  if (event.input_schema_version === 2) validateRawV2InputEvent(event)
  if (event.routed_schema_version === 1) validateRoutedV1InputEvent(event)
}

function childLocalPoint(payload = {}, facts = {}) {
  const x = finiteNumber(facts.localX ?? facts.offsetX ?? payload.local_x ?? payload.localX ?? payload.offset_x ?? payload.offsetX)
  const y = finiteNumber(facts.localY ?? facts.offsetY ?? payload.local_y ?? payload.localY ?? payload.offset_y ?? payload.offsetY)
  if (x === null || y === null) return null
  return { x, y }
}

function nativePoint(payload = {}, facts = {}) {
  const native = pickObject(facts.native, payload.native)
  if (native) {
    const x = finiteNumber(native.x)
    const y = finiteNumber(native.y)
    if (x !== null && y !== null) return { x, y }
  }
  const x = finiteNumber(facts.nativeX ?? facts.screenX ?? payload.native_x ?? payload.nativeX ?? payload.screen_x ?? payload.screenX ?? payload.x)
  const y = finiteNumber(facts.nativeY ?? facts.screenY ?? payload.native_y ?? payload.nativeY ?? payload.screen_y ?? payload.screenY ?? payload.y)
  if (x === null || y === null) return null
  return { x, y }
}

function desktopWorldPoint(payload = {}, facts = {}) {
  const desktopWorld = pickObject(facts.desktopWorld, facts.desktop_world, payload.desktop_world, payload.desktopWorld)
  if (desktopWorld) {
    const x = finiteNumber(desktopWorld.x)
    const y = finiteNumber(desktopWorld.y)
    if (x !== null && y !== null) return { x, y }
  }
  const x = finiteNumber(facts.x ?? payload.desktop_world_x ?? payload.desktopWorldX)
  const y = finiteNumber(facts.y ?? payload.desktop_world_y ?? payload.desktopWorldY)
  if (x === null || y === null) return null
  return { x, y }
}

function canvasOriginSequenceValue({ sourceCanvasId, ownerCanvasId, pointerId, button }) {
  const pointerKey = pointerId !== null && pointerId !== undefined ? String(pointerId) : 'mouse'
  const buttonKey = button || 'none'
  return `${sourceCanvasId || 'canvas'}:${ownerCanvasId || 'owner'}:${pointerKey}:${buttonKey}`
}

function inferButton(type, payload = {}) {
  if (payload.button) return payload.button
  if (type?.startsWith('left_')) return 'left'
  if (type?.startsWith('right_')) return 'right'
  if (type?.startsWith('middle_')) return 'middle'
  if (type?.startsWith('other_')) return 'other'
  return 'none'
}

function inferButtons(button, phase) {
  const pressed = phase === 'down' || phase === 'drag'
  return {
    left: button === 'left' ? pressed : false,
    right: button === 'right' ? pressed : false,
    middle: button === 'middle' ? pressed : false,
    other_pressed: button === 'other' && pressed ? ['other'] : [],
  }
}

function eventKindForType(type) {
  if (type === 'scroll_wheel') return 'scroll'
  if (type === 'pointer_cancel' || type === 'mouse_cancel') return 'cancel'
  if (type === 'key_down' || type === 'key_up') return 'key'
  return 'pointer'
}

export function createCanvasOriginInputEvent(message = {}, facts = {}) {
  const payload = (message?.payload && typeof message.payload === 'object') ? message.payload : message
  if (!payload || typeof payload !== 'object') return null

  const sourceEvent = pickString(
    facts.sourceEvent,
    facts.source_event,
    payload.source_event,
    payload.sourceEvent,
    payload.kind,
    payload.input_type,
    payload.event_type,
    payload.type,
  )
  const type = isCanvasInputEventType(sourceEvent) ? sourceEvent : pickString(payload.type, facts.type)
  if (!isCanvasInputEventType(type)) return null

  const sourceCanvasId = pickString(
    facts.sourceCanvasId,
    facts.source_canvas_id,
    payload.source_canvas_id,
    payload.sourceCanvasId,
    message?.id,
  )
  const ownerCanvasId = pickString(
    facts.ownerCanvasId,
    facts.owner_canvas_id,
    payload.owner_canvas_id,
    payload.ownerCanvasId,
    payload.parent_canvas_id,
    payload.parentCanvasId,
    payload.parent,
  )
  const regionId = pickString(
    facts.regionId,
    facts.region_id,
    payload.region_id,
    payload.regionId,
    sourceCanvasId,
  )
  const pointerId = facts.pointerId ?? facts.pointer_id ?? payload.pointer_id ?? payload.pointerId ?? null
  const phase = facts.phase || payload.phase || POINTER_PHASE_BY_TYPE[type] || null
  const button = inferButton(type, payload)
  const desktopWorld = desktopWorldPoint(payload, facts)
  const childLocal = childLocalPoint(payload, facts)
  const sourceSequence = pickObject(facts.sourceSequence, facts.source_sequence, payload.source_sequence, payload.sourceSequence) || {
    source: 'toolkit',
    value: canvasOriginSequenceValue({ sourceCanvasId, ownerCanvasId, pointerId, button, sourceEvent }),
  }
  const gestureId = pickString(
    facts.gestureId,
    facts.gesture_id,
    payload.gesture_id,
    payload.gestureId,
    `canvas:${sourceSequence.value}`,
  )
  const captureId = phase === 'down' || phase === 'drag' || phase === 'up' || phase === 'cancel'
    ? pickString(facts.captureId, facts.capture_id, payload.capture_id, payload.captureId, `${gestureId}:capture`)
    : null
  const dx = finiteNumber(facts.dx ?? payload.dx ?? payload.delta_x ?? payload.deltaX)
  const dy = finiteNumber(facts.dy ?? payload.dy ?? payload.delta_y ?? payload.deltaY)
  const scroll = type === 'scroll_wheel'
    ? {
        dx: dx ?? 0,
        dy: dy ?? 0,
        unit: payload.scroll_unit || payload.scrollUnit || 'point',
      }
    : undefined
  const eventKind = eventKindForType(type)
  const cancelReason = pickString(
    facts.cancelReason,
    facts.cancel_reason,
    payload.cancel_reason,
    payload.cancelReason,
    'surface_removed',
  )

  const event = {
    routed_schema_version: 1,
    event_kind: eventKind,
    type,
    phase,
    delivery_role: payload.delivery_role || facts.deliveryRole || facts.delivery_role || 'owned',
    sequence: sourceSequence,
    gesture_id: gestureId,
    ...(captureId ? { capture_id: captureId } : {}),
    desktop_world: desktopWorld,
    coordinate_authority: 'toolkit',
    source_origin: 'canvas',
    source_canvas_id: sourceCanvasId,
    owner_canvas_id: ownerCanvasId,
    region_id: regionId,
    source_event: sourceEvent,
    source_sequence: sourceSequence,
    ...(eventKind === 'pointer' ? {
      button,
      buttons: payload.buttons || inferButtons(button, phase),
    } : {}),
    ...(eventKind === 'scroll' ? { scroll } : {}),
    ...(eventKind === 'cancel' ? { cancel_reason: cancelReason } : {}),
  }
  validateRoutedV1InputEvent(event)
  return event
}

export function normalizeCanvasOriginInputMessage(message = {}, facts = {}) {
  const event = createCanvasOriginInputEvent(message, facts)
  if (!event) return null
  const normalized = normalizeCanvasInputMessage(event)
  const payload = (message?.payload && typeof message.payload === 'object') ? message.payload : message
  const childLocal = childLocalPoint(payload, facts)
  return {
    ...normalized,
    ...(childLocal ? {
      child_local: childLocal,
      childLocal,
      offsetX: childLocal.x,
      offsetY: childLocal.y,
    } : {}),
  }
}

function pointFromV2Event(event) {
  const point = event?.desktop_world || event?.native || null
  if (!point || typeof point !== 'object') return null
  const x = Number(point.x)
  const y = Number(point.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

function normalizeV2InputEvent(event, envelopeType = null) {
  validateVersionedInputEvent(event)
  const point = pointFromV2Event(event)
  return {
    ...event,
    ...(point || {}),
    envelopeType,
    eventKind: event.event_kind,
    coordinateAuthority: event.coordinate_authority ?? null,
    gestureId: event.gesture_id ?? null,
    captureId: event.capture_id ?? null,
    deliveryRole: event.delivery_role ?? null,
    regionId: event.region_id ?? null,
    ownerCanvasId: event.owner_canvas_id ?? null,
    sourceCanvasId: event.source_canvas_id ?? null,
    sourceOrigin: event.source_origin ?? null,
    sourceSequence: event.source_sequence ?? event.sequence ?? null,
    sourceEvent: event.source_event ?? null,
  }
}

function normalizeInputRegionEnvelope(msg) {
  const routed = msg.routed_input || msg.payload?.routed_input || msg.data?.routed_input || null
  if (routed && typeof routed === 'object') {
    return {
      ...msg,
      ...normalizeV2InputEvent(routed, 'input_region.event'),
      inputRegionEventType: msg.type,
      routedInput: routed,
    }
  }

  const payload = msg.payload || msg.data || msg
  const desktopWorld = payload.desktop_world || payload.point || payload.native || null
  const native = payload.native || null
  const sourceSequence = payload.source_sequence && typeof payload.source_sequence === 'object'
    ? payload.source_sequence
    : null
  const sourceEvent = payload.source_event ?? payload.source_sequence ?? null
  const type = typeof sourceEvent === 'string' && isCanvasInputEventType(sourceEvent)
    ? sourceEvent
    : (payload.input_type || payload.event_type || payload.type || msg.type)
  const compat = {
    event_kind: type === 'scroll_wheel' ? 'scroll' : 'pointer',
    type,
    phase: payload.phase ?? null,
    delivery_role: payload.captured ? 'captured' : 'owned',
    sequence: sourceSequence || { source: 'daemon', value: String(sourceEvent || type) },
    gesture_id: payload.gesture_id || payload.gestureId || String(sourceEvent || type),
    desktop_world: desktopWorld,
    coordinate_authority: payload.coordinate_authority || 'daemon',
    source_origin: payload.source_origin || 'daemon',
    source_sequence: sourceSequence,
    source_event: sourceEvent,
    region_id: payload.region_id,
    owner_canvas_id: payload.owner_canvas_id,
    capture_id: payload.capture_id,
    button: payload.button || 'none',
    buttons: payload.buttons || { left: false, right: false, middle: false, other_pressed: [] },
  }
  return {
    ...msg,
    ...compat,
    ...pointFromV2Event(compat),
    envelopeType: 'input_region.event',
    eventKind: compat.event_kind,
    gestureId: compat.gesture_id ?? null,
    captureId: compat.capture_id ?? null,
    deliveryRole: compat.delivery_role ?? null,
    regionId: compat.region_id ?? null,
    ownerCanvasId: compat.owner_canvas_id ?? null,
    sourceOrigin: compat.source_origin ?? null,
    sourceSequence: compat.source_sequence ?? compat.sequence ?? null,
    sourceEvent: compat.source_event ?? null,
    native,
    inputRegionEventType: msg.type,
  }
}

export function normalizeCanvasInputMessage(msg) {
  if (!msg || typeof msg !== 'object') return null

  if (msg.input_schema_version === 2 || msg.routed_schema_version === 1) {
    return normalizeV2InputEvent(msg, msg.routed_schema_version === 1 ? 'aos_routed_input' : null)
  }

  if (msg.type === 'input_region.event') {
    return normalizeInputRegionEnvelope(msg)
  }

  if (msg.type === 'canvas_message') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : null
    const desktopWorld = payload ? desktopWorldPoint(payload) : null
    if (
      payload
      && desktopWorld
      && (
        payload.source_origin === 'canvas'
        || payload.sourceOrigin === 'canvas'
        || payload.source_canvas_id
        || payload.sourceCanvasId
      )
    ) {
      return normalizeCanvasOriginInputMessage(msg)
    }
  }

  if (msg.type === 'input_event') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : null
    if (!payload) return { ...msg }
    if (payload.input_schema_version === 2 || payload.routed_schema_version === 1) {
      return normalizeV2InputEvent(payload, msg.type)
    }
    return {
      ...msg,
      ...payload,
      type: payload.type ?? msg.type,
      envelopeType: 'input_event',
    }
  }

  if (isCanvasInputEventType(msg.type)) {
    return {
      ...msg,
      envelopeType: null,
    }
  }

  return null
}
