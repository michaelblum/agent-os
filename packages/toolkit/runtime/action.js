import { aosAction } from './canvas.js'

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function finiteNumber(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function currentCanvasId(globalObject = globalThis.window || globalThis) {
  return globalObject?.__aosCanvasId
    || globalObject?.__aosSurfaceCanvasId
    || null
}

function currentSegmentDisplayId(globalObject = globalThis.window || globalThis) {
  const id = finiteNumber(globalObject?.__aosSegmentDisplayId, null)
  return id == null ? null : id
}

export function sourceCanvasIdentity({
  globalObject = globalThis.window || globalThis,
  source = null,
} = {}) {
  const canvasId = currentCanvasId(globalObject)
  return {
    source_origin: 'canvas',
    source_canvas_id: canvasId,
    owner_canvas_id: canvasId,
    segment_display_id: currentSegmentDisplayId(globalObject),
    ...(source && typeof source === 'object' ? source : {}),
  }
}

export function desktopWorldPointFromEvent(event = {}) {
  const desktopWorld = event.desktop_world || event.desktopWorld
  const fromPayload = desktopWorld && typeof desktopWorld === 'object'
    ? {
        x: finiteNumber(desktopWorld.x, null),
        y: finiteNumber(desktopWorld.y, null),
      }
    : null
  if (fromPayload?.x != null && fromPayload?.y != null) return fromPayload

  const x = finiteNumber(event.x, finiteNumber(event.clientX, finiteNumber(event.screenX, null)))
  const y = finiteNumber(event.y, finiteNumber(event.clientY, finiteNumber(event.screenY, null)))
  if (x == null || y == null) return null
  return { x, y }
}

export function actionControlMetadata(control = null, element = null) {
  const dataset = element?.dataset || {}
  const source = control && typeof control === 'object' ? control : {}
  const id = text(source.id || element?.id || dataset.aosFieldId || dataset.aosRef, '')
  const descriptorId = text(source.descriptor_id || source.descriptorId || dataset.descriptorId, '')
  const surface = text(source.surface || dataset.aosSurface, '')
  const aosRef = text(source.aos_ref || source.aosRef || dataset.aosRef, '')
  const metadata = {
    ...(source.metadata && typeof source.metadata === 'object' ? source.metadata : {}),
  }
  if (dataset && Object.keys(dataset).length) metadata.dataset = { ...dataset }
  return {
    ...(id ? { id } : {}),
    ...(descriptorId ? { descriptor_id: descriptorId } : {}),
    ...(surface ? { surface } : {}),
    ...(aosRef ? { aos_ref: aosRef } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  }
}

export function createAosActionPayload(action, {
  id = null,
  target = null,
  url = null,
  href = null,
  frame = null,
  anchor = null,
  event = null,
  element = event?.currentTarget || event?.target || null,
  control = null,
  source = null,
  payload = {},
  globalObject = globalThis.window || globalThis,
} = {}) {
  const resolvedAction = text(action)
  if (!resolvedAction) throw new Error('createAosActionPayload requires action')
  const point = event ? desktopWorldPointFromEvent(event) : null
  const nextAnchor = anchor
    ? { ...anchor }
    : (point ? { coordinate_space: 'desktop_world', x: point.x, y: point.y } : null)
  return {
    ...payload,
    action: resolvedAction,
    ...(id ? { id } : {}),
    ...(target ? { target } : {}),
    ...(url ? { url } : {}),
    ...(href ? { href } : {}),
    ...(frame ? { frame } : {}),
    ...(nextAnchor ? { anchor: nextAnchor } : {}),
    source: sourceCanvasIdentity({ globalObject, source }),
    control: actionControlMetadata(control, element),
  }
}

export function dispatchAosAction(action, options = {}) {
  const payload = createAosActionPayload(action, options)
  const { timeoutMs, mapResult } = options
  return aosAction(payload.action, payload, { timeoutMs, mapResult })
}

export function bindAosAction(element, action, {
  eventType = 'click',
  preventDefault = true,
  stopPropagation = false,
  payload = {},
  ...options
} = {}) {
  if (!element?.addEventListener) {
    throw new Error('bindAosAction requires an EventTarget element')
  }
  const handler = (event) => {
    if (preventDefault) event.preventDefault?.()
    if (stopPropagation) event.stopPropagation?.()
    const resolvedAction = typeof action === 'function' ? action(event, element) : action
    const resolvedPayload = typeof payload === 'function' ? payload(event, element) : payload
    return dispatchAosAction(resolvedAction, {
      ...options,
      payload: resolvedPayload,
      event,
      element,
    })
  }
  element.addEventListener(eventType, handler)
  return () => element.removeEventListener(eventType, handler)
}
