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
  'other_mouse_down',
  'other_mouse_up',
  'other_mouse_dragged',
  'key_down',
  'key_up',
])

export function isCanvasInputEventType(type) {
  return typeof type === 'string' && RAW_INPUT_EVENT_TYPES.has(type)
}

export function normalizeCanvasInputMessage(msg) {
  if (!msg || typeof msg !== 'object') return null

  if (msg.type === 'input_event') {
    const payload = (msg.payload && typeof msg.payload === 'object') ? msg.payload : null
    if (!payload) return { ...msg }
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
