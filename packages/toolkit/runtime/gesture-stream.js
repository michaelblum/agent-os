// gesture-stream.js — shared toolkit pointer/gesture lifecycle frames.
//
// This module owns recurring pointer mechanics only. Semantic adapters decide
// what a gesture means after receiving normalized frames.

import { normalizeCanvasInputMessage } from './input-events.js'

export const GESTURE_FRAME_SCHEMA = 'aos.gesture-frame'
export const GESTURE_FRAME_SCHEMA_VERSION = 0

const DOM_START_TYPES = new Set(['pointerdown', 'mousedown'])
const DOM_MOVE_TYPES = new Set(['pointermove', 'mousemove'])
const DOM_END_TYPES = new Set(['pointerup', 'mouseup'])
const DOM_CANCEL_TYPES = new Set(['pointercancel', 'mousecancel'])

const CANVAS_PHASES = {
  left_mouse_down: 'start',
  left_mouse_dragged: 'move',
  left_mouse_up: 'end',
  pointer_cancel: 'cancel',
  mouse_cancel: 'cancel',
}

let nextGestureSequence = 0

function finiteNumber(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function copyPoint(point) {
  if (!point || typeof point !== 'object') return null
  const x = finiteNumber(point.x)
  const y = finiteNumber(point.y)
  return x === null || y === null ? null : { x, y }
}

function pointDelta(from, to) {
  if (!from || !to) return null
  return { x: to.x - from.x, y: to.y - from.y }
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null))
}

function timestampFor(event = {}, now = Date.now()) {
  return finiteNumber(event.timeStamp ?? event.timestamp ?? event.t, now)
}

function domPhase(event = {}) {
  if (DOM_START_TYPES.has(event.type)) return 'start'
  if (DOM_MOVE_TYPES.has(event.type)) return 'move'
  if (DOM_END_TYPES.has(event.type)) return 'end'
  if (DOM_CANCEL_TYPES.has(event.type)) return 'cancel'
  return null
}

function pointerButton(event = {}) {
  if (typeof event.button === 'number') return event.button
  if (event.type?.startsWith?.('left_')) return 0
  if (event.type?.startsWith?.('right_')) return 2
  if (event.type?.startsWith?.('middle_')) return 1
  return null
}

function domPoint(event = {}, fallback = null) {
  const x = finiteNumber(event.clientX ?? event.x ?? event.pageX ?? event.screenX)
  const y = finiteNumber(event.clientY ?? event.y ?? event.pageY ?? event.screenY)
  if (x !== null && y !== null) return { x, y }
  if (x !== null) return { x, y: fallback?.y ?? 0 }
  if (y !== null) return { x: fallback?.x ?? 0, y }
  return null
}

function domNativePoint(event = {}) {
  const x = finiteNumber(event.screenX)
  const y = finiteNumber(event.screenY)
  return x === null || y === null ? null : { x, y }
}

function canvasPoint(input = {}, override = {}) {
  return copyPoint(
    override.desktopWorld
      || override.desktop_world
      || input.desktop_world
      || input.desktopWorld
      || (Number.isFinite(input.x) && Number.isFinite(input.y) ? { x: input.x, y: input.y } : null),
  )
}

function sourceIdentity(raw = {}, options = {}) {
  const source = typeof options.source === 'function' ? options.source(raw) : options.source
  const sourceIdentity = typeof options.sourceIdentity === 'function' ? options.sourceIdentity(raw) : options.sourceIdentity
  const element = raw?.currentTarget || raw?.target || options.element || null
  return compactObject({
    origin: source?.origin || sourceIdentity?.origin || raw.sourceOrigin || raw.source_origin || (raw.type?.startsWith?.('pointer') || raw.type?.startsWith?.('mouse') ? 'dom' : null),
    source_canvas_id: source?.sourceCanvasId || source?.source_canvas_id || sourceIdentity?.sourceCanvasId || sourceIdentity?.source_canvas_id || raw.sourceCanvasId || raw.source_canvas_id,
    owner_canvas_id: source?.ownerCanvasId || source?.owner_canvas_id || sourceIdentity?.ownerCanvasId || sourceIdentity?.owner_canvas_id || raw.ownerCanvasId || raw.owner_canvas_id,
    raw_event_source: source?.rawEventSource || source?.raw_event_source || raw.sourceEvent || raw.source_event || raw.type,
    element_ref: source?.elementRef || source?.element_ref || element?.dataset?.aosRef || element?.dataset?.semanticTargetId || element?.id || null,
  })
}

function semanticIdentity(raw = {}, options = {}) {
  const semantic = typeof options.semantic === 'function' ? options.semantic(raw) : options.semantic
  const target = raw?.currentTarget || raw?.target || options.element || null
  const descriptor = semantic?.target_descriptor || semantic?.targetDescriptor || semantic?.target
  if (descriptor && typeof descriptor === 'object') {
    return {
      target: compactObject(descriptor),
      action: semantic?.action || semantic?.semanticAction || target?.dataset?.aosActions?.split?.(/\s+/)?.find((item) => item === 'set-value' || item === 'drag') || null,
    }
  }
  return {
    target: compactObject({
      target_id: semantic?.targetId || semantic?.target_id || target?.dataset?.semanticTargetId || null,
      ref: semantic?.ref || target?.dataset?.aosRef || null,
      kind: semantic?.kind || target?.dataset?.aosTargetKind || null,
    }),
    action: semantic?.action || semantic?.semanticAction || target?.dataset?.aosActions?.split?.(/\s+/)?.find((item) => item === 'set-value' || item === 'drag') || null,
  }
}

function nextGestureId(prefix = 'gesture') {
  nextGestureSequence += 1
  return `${prefix}:${nextGestureSequence}`
}

function typeFor(kind, phase) {
  return `gesture.${kind}.${phase}`
}

function createFrame({
  kind = 'drag',
  phase,
  rawEvent = {},
  gestureId,
  transactionId,
  captureId,
  pointerId,
  origin,
  previous,
  current,
  frameIndex = 0,
  options = {},
  coordinateSpaces = {},
  now,
}) {
  const semantic = semanticIdentity(rawEvent, options)
  return compactObject({
    schema: GESTURE_FRAME_SCHEMA,
    schema_version: GESTURE_FRAME_SCHEMA_VERSION,
    type: typeFor(kind, phase),
    gesture_type: kind,
    phase,
    gesture_id: gestureId,
    transaction_id: transactionId || gestureId,
    source: sourceIdentity(rawEvent, options),
    pointer: compactObject({
      pointer_id: pointerId ?? rawEvent.pointerId ?? rawEvent.pointer_id ?? null,
      button: pointerButton(rawEvent),
      buttons: rawEvent.buttons ?? null,
      capture_id: captureId,
    }),
    coordinates: compactObject(coordinateSpaces),
    origin: copyPoint(origin),
    previous: copyPoint(previous),
    current: copyPoint(current),
    delta: pointDelta(previous || origin, current),
    total_delta: pointDelta(origin, current),
    constraints: options.constraints || null,
    bounds: options.bounds || null,
    axis: options.axis || null,
    semantic_target: Object.keys(semantic.target).length ? semantic.target : null,
    semantic_action: semantic.action,
    timing: {
      t: timestampFor(rawEvent, now),
      frame_index: frameIndex,
    },
    raw_event_type: rawEvent.type,
  })
}

export function createGestureFrameHub() {
  const subscribers = new Set()
  return {
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    publish(frame) {
      if (!frame) return frame
      for (const listener of [...subscribers]) listener(frame)
      return frame
    },
    clear() {
      subscribers.clear()
    },
  }
}

export function createPointerGestureStream(options = {}) {
  const hub = createGestureFrameHub()
  const kind = options.kind || 'drag'
  let active = null

  function emitFrame(phase, rawEvent = {}, extra = {}) {
    const current = copyPoint(extra.current)
    if (!current && phase !== 'cancel') return null
    if (phase === 'start' && active) return null
    if (phase !== 'start' && !active) return null
    if (phase === 'start') {
      const gestureId = extra.gestureId || rawEvent.gestureId || rawEvent.gesture_id || nextGestureId(kind)
      active = {
        gestureId,
        transactionId: extra.transactionId || rawEvent.transactionId || rawEvent.transaction_id || gestureId,
        captureId: extra.captureId || rawEvent.captureId || rawEvent.capture_id || `${gestureId}:capture`,
        pointerId: extra.pointerId ?? rawEvent.pointerId ?? rawEvent.pointer_id ?? null,
        origin: current,
        previous: current,
        frameIndex: 0,
      }
    }

    const frame = createFrame({
      kind,
      phase,
      rawEvent,
      gestureId: active.gestureId,
      transactionId: active.transactionId,
      captureId: active.captureId,
      pointerId: active.pointerId,
      origin: active.origin,
      previous: phase === 'start' ? active.origin : active.previous,
      current: current || active.previous || active.origin,
      frameIndex: active.frameIndex,
      options,
      coordinateSpaces: extra.coordinateSpaces,
      now: extra.now,
    })
    active.previous = frame.current
    active.frameIndex += 1
    hub.publish(frame)
    if (phase === 'end' || phase === 'cancel') active = null
    return frame
  }

  function handleDomEvent(event = {}, extra = {}) {
    const phase = extra.phase || domPhase(event)
    if (!phase) return null
    if (active?.pointerId !== null && active?.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== active.pointerId) {
      return null
    }
    const current = domPoint(event, active?.previous || active?.origin)
    const native = domNativePoint(event)
    return emitFrame(phase, event, {
      current,
      now: extra.now,
      coordinateSpaces: compactObject({
        dom_client: current,
        native,
      }),
    })
  }

  function handleCanvasInput(message = {}, extra = {}) {
    const input = normalizeCanvasInputMessage(message) || message
    const phase = extra.phase || CANVAS_PHASES[input?.type]
    if (!phase) return null
    const current = canvasPoint(input, extra)
    return emitFrame(phase, input, {
      current,
      now: extra.now,
      gestureId: input.gestureId || input.gesture_id,
      captureId: input.captureId || input.capture_id,
      pointerId: input.pointerId || input.pointer_id,
      coordinateSpaces: compactObject({
        desktop_world: current,
        native: copyPoint(input.native) || (Number.isFinite(input.x) && Number.isFinite(input.y) ? { x: input.x, y: input.y } : null),
      }),
    })
  }

  function cancel(reason = 'cancelled', rawEvent = {}, extra = {}) {
    if (!active) return null
    return emitFrame('cancel', { ...rawEvent, type: rawEvent.type || 'pointer_cancel', cancel_reason: reason }, {
      current: extra.current || active.previous || active.origin,
      now: extra.now,
    })
  }

  return {
    subscribe: hub.subscribe,
    publish: hub.publish,
    handleDomEvent,
    handleCanvasInput,
    cancel,
    destroy() {
      cancel('destroyed')
      hub.clear()
    },
    snapshot() {
      return { active: active ? { ...active } : null }
    },
  }
}

export function bindDomPointerGesture(element, options = {}) {
  if (!element?.addEventListener) return () => {}
  const stream = options.stream || createPointerGestureStream({ ...options, element })
  let cleanupDocumentListeners = null
  let captureElement = null

  function removeDocumentListeners() {
    cleanupDocumentListeners?.()
    cleanupDocumentListeners = null
  }

  function onMove(event) {
    if (options.preventDefault !== false) event.preventDefault?.()
    const frame = stream.handleDomEvent(event)
    options.onFrame?.(frame, event)
  }

  function onEnd(event) {
    if (options.preventDefault !== false) event.preventDefault?.()
    const frame = stream.handleDomEvent(event)
    options.onFrame?.(frame, event)
    if (event.pointerId !== undefined) captureElement?.releasePointerCapture?.(event.pointerId)
    captureElement = null
    removeDocumentListeners()
  }

  function onStart(event) {
    if (stream.snapshot?.().active) return
    if (options.shouldStart?.(event) === false) return
    if (options.preventDefault !== false) event.preventDefault?.()
    const frame = stream.handleDomEvent(event)
    if (!frame) return
    captureElement = event.currentTarget || event.target || element
    if (event.pointerId !== undefined) captureElement?.setPointerCapture?.(event.pointerId)
    options.onFrame?.(frame, event)

    const doc = element.ownerDocument
    const view = doc?.defaultView
    const target = doc || view
    target?.addEventListener?.('pointermove', onMove)
    target?.addEventListener?.('pointerup', onEnd)
    target?.addEventListener?.('pointercancel', onEnd)
    target?.addEventListener?.('mousemove', onMove)
    target?.addEventListener?.('mouseup', onEnd)
    cleanupDocumentListeners = () => {
      target?.removeEventListener?.('pointermove', onMove)
      target?.removeEventListener?.('pointerup', onEnd)
      target?.removeEventListener?.('pointercancel', onEnd)
      target?.removeEventListener?.('mousemove', onMove)
      target?.removeEventListener?.('mouseup', onEnd)
    }
  }

  element.addEventListener('pointerdown', onStart)
  element.addEventListener('mousedown', onStart)
  return () => {
    removeDocumentListeners()
    element.removeEventListener?.('pointerdown', onStart)
    element.removeEventListener?.('mousedown', onStart)
    stream.cancel('destroyed')
    if (!options.stream) stream.destroy()
  }
}
