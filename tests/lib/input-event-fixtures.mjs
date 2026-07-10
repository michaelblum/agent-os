const PHASE_BY_TYPE = {
  left_mouse_down: 'down',
  left_mouse_dragged: 'drag',
  left_mouse_up: 'up',
  mouse_moved: 'move',
}

let sequence = 0

function nextSequence() {
  sequence += 1
  return sequence
}

function pointerButton(type) {
  return type === 'mouse_moved' ? 'none' : 'left'
}

function pointerButtons(button, phase) {
  return {
    left: button === 'left' && (phase === 'down' || phase === 'drag'),
    right: false,
    middle: false,
    other_pressed: [],
  }
}

export function canonicalRawPointerInput({
  type = 'left_mouse_down',
  x = 0,
  y = 0,
  phase = PHASE_BY_TYPE[type] || 'down',
  sequenceValue = nextSequence(),
  extra = {},
} = {}) {
  const button = pointerButton(type)
  return {
    input_schema_version: 2,
    event_kind: 'pointer',
    type,
    phase,
    device: 'mouse',
    timestamp_monotonic_ms: sequenceValue,
    sequence: { source: 'daemon', value: sequenceValue },
    native: { x, y },
    display_id: 1,
    topology_version: 1,
    button,
    buttons: pointerButtons(button, phase),
    modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
    ...extra,
  }
}

export function canonicalRoutedPointerInput({
  type = 'left_mouse_down',
  x = 0,
  y = 0,
  phase = PHASE_BY_TYPE[type] || 'down',
  deliveryRole = 'owned',
  regionId = 'input-region',
  ownerCanvasId = 'owner-canvas',
  captureId = 'input-capture',
  sequenceValue = nextSequence(),
  gestureId = `input-gesture-${sequenceValue}`,
  coordinateAuthority = 'daemon',
  sourceOrigin = 'daemon',
  sourceEvent = `daemon:${sequenceValue}`,
  extra = {},
} = {}) {
  const button = pointerButton(type)
  return {
    routed_schema_version: 1,
    event_kind: 'pointer',
    type,
    phase,
    delivery_role: deliveryRole,
    sequence: { source: 'daemon', value: sequenceValue },
    gesture_id: gestureId,
    desktop_world: { x, y },
    coordinate_authority: coordinateAuthority,
    source_origin: sourceOrigin,
    source_event: sourceEvent,
    region_id: regionId,
    owner_canvas_id: ownerCanvasId,
    ...(deliveryRole === 'captured' ? { capture_id: captureId } : {}),
    button,
    buttons: pointerButtons(button, phase),
    ...extra,
  }
}

export function canonicalInputRegionEvent(options = {}) {
  return {
    type: 'input_region.event',
    routed_input: canonicalRoutedPointerInput(options),
  }
}
