// input-events.js — normalize canvas input stream envelopes.
//
// The daemon-side canvas fanout currently delivers raw input event names like
// `mouse_moved` and `left_mouse_down` directly to canvases, while some
// synthetic/tests paths still post `{ type: 'input_event', payload: {...} }`.
// Consumers should accept either form until the daemon contract is unified.

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

export function isCanvasInputEventType(type) {
  return typeof type === 'string' && RAW_INPUT_EVENT_TYPES.has(type)
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
    sourceEvent: event.source_event ?? null,
  }
}

export function normalizeCanvasInputMessage(msg) {
  if (!msg || typeof msg !== 'object') return null

  if (msg.input_schema_version === 2 || msg.routed_schema_version === 1) {
    return normalizeV2InputEvent(msg, msg.routed_schema_version === 1 ? 'aos_routed_input' : null)
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
