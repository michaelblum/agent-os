import { createInteractionSurface } from './interaction-surface.js'
import { desktopWorldToNativeRect } from './spatial.js'

function randomSurfaceId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeFrame(frame) {
  if (!Array.isArray(frame) || frame.length < 4) return null
  const next = frame.slice(0, 4).map((value) => Math.round(finite(value, 0)))
  if (next[2] <= 0 || next[3] <= 0) return null
  return next
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null
  const next = {
    x: finite(rect.x, NaN),
    y: finite(rect.y, NaN),
    w: finite(rect.w ?? rect.width, NaN),
    h: finite(rect.h ?? rect.height, NaN),
  }
  if (![next.x, next.y, next.w, next.h].every(Number.isFinite)) return null
  if (next.w <= 0 || next.h <= 0) return null
  return next
}

function offscreenFrame(size = [1, 1]) {
  return [
    -10000,
    -10000,
    Math.max(1, Math.round(finite(size?.[0], 1))),
    Math.max(1, Math.round(finite(size?.[1], 1))),
  ]
}

function appendQuery(url, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const encoded = query.toString()
  if (!encoded) return url
  return `${url}${String(url).includes('?') ? '&' : '?'}${encoded}`
}

function payloadKey(payload) {
  return JSON.stringify(payload ?? null)
}

function postCanvasMessage(runtime, target, message) {
  if (typeof runtime?.post === 'function') {
    runtime.post('canvas.send', { target, message })
    return true
  }
  return false
}

export function resolveDesktopWorldHitRegionOwnerCanvasId({
  ownerCanvasId = null,
  fallbackOwnerCanvasId = null,
  globalObject = globalThis,
} = {}) {
  return ownerCanvasId
    || globalObject?.__aosCanvasId
    || globalObject?.__aosSurfaceCanvasId
    || fallbackOwnerCanvasId
    || null
}

export function desktopWorldHitRegionFrame(worldRect, displays = []) {
  const rect = normalizeRect(worldRect)
  if (!rect) return null
  const nativeRect = desktopWorldToNativeRect(rect, displays) || rect
  return normalizeFrame([nativeRect.x, nativeRect.y, nativeRect.w, nativeRect.h])
}

export function createDesktopWorldHitRegionController(options = {}) {
  const {
    runtime,
    url,
    id = null,
    idPrefix = 'desktop-world-hit-region',
    ownerCanvasId = null,
    fallbackOwnerCanvasId = null,
    globalObject = globalThis,
    initialSize = [1, 1],
    windowLevel = 'screen_saver',
    messageType = 'desktop_world_hit_region.update',
    appendIdentityQuery = true,
    createSurface = createInteractionSurface,
  } = options

  if (!runtime) throw new Error('DesktopWorldHitRegionController requires runtime')
  if (!url) throw new Error('DesktopWorldHitRegionController requires url')

  const surfaceId = id || randomSurfaceId(idPrefix)
  const parent = resolveDesktopWorldHitRegionOwnerCanvasId({
    ownerCanvasId,
    fallbackOwnerCanvasId,
    globalObject,
  })
  const initialFrame = offscreenFrame(initialSize)
  const state = {
    id: surfaceId,
    parent,
    ready: false,
    creating: false,
    interactive: false,
    frame: initialFrame,
    lastPayloadKey: null,
    lastPayload: null,
    worldRect: null,
  }

  const surface = createSurface({
    runtime,
    id: surfaceId,
    url: appendIdentityQuery ? appendQuery(url, { parent, id: surfaceId }) : url,
    parent,
    frame: initialFrame,
    interactive: false,
    windowLevel,
  })

  async function ensureCreated() {
    if (state.ready || state.creating) return state.id
    state.creating = true
    try {
      await surface.ensureCreated()
      state.ready = true
      return state.id
    } finally {
      state.creating = false
    }
  }

  function postUpdate(payload) {
    const key = payloadKey(payload)
    if (key === state.lastPayloadKey) return false
    state.lastPayloadKey = key
    state.lastPayload = payload == null ? null : JSON.parse(key)
    return postCanvasMessage(runtime, state.id, {
      type: messageType,
      payload,
    })
  }

  function refreshPayload() {
    if (state.lastPayload === null) return false
    return postCanvasMessage(runtime, state.id, {
      type: messageType,
      payload: JSON.parse(JSON.stringify(state.lastPayload)),
    })
  }

  function sync({
    worldRect = null,
    displays = [],
    interactive = true,
    payload = undefined,
  } = {}) {
    if (!state.ready) return false

    let changed = false
    const nextFrame = desktopWorldHitRegionFrame(worldRect, displays)
    if (nextFrame && interactive) {
      changed = surface.setPlacement(nextFrame, true) || changed
      state.frame = nextFrame
      state.interactive = true
      state.worldRect = normalizeRect(worldRect)
    } else {
      const disabledFrame = offscreenFrame([state.frame?.[2], state.frame?.[3]])
      changed = surface.setPlacement(disabledFrame, false) || changed
      state.frame = disabledFrame
      state.interactive = false
      state.worldRect = null
    }

    if (payload !== undefined) {
      changed = postUpdate(payload) || changed
    }
    return changed
  }

  function disable({ payload = undefined } = {}) {
    if (!state.ready) return false
    return sync({ worldRect: null, interactive: false, payload })
  }

  async function remove() {
    if (!state.ready && !state.creating) return
    try {
      await surface.remove()
    } finally {
      state.ready = false
      state.creating = false
      state.interactive = false
      state.frame = offscreenFrame(initialSize)
      state.worldRect = null
      state.lastPayloadKey = null
      state.lastPayload = null
    }
  }

  function handleLifecycle(message = {}) {
    if (typeof surface.handleLifecycle !== 'function') return false
    if (!surface.handleLifecycle(message)) return false
    const snapshot = surface.snapshot()
    state.ready = snapshot.ready
    state.creating = snapshot.creating
    state.interactive = snapshot.interactive
    state.frame = snapshot.frame || offscreenFrame(initialSize)
    if (!state.ready) state.worldRect = null
    return true
  }

  function snapshot() {
    return {
      id: state.id,
      parent: state.parent,
      ready: state.ready,
      creating: state.creating,
      interactive: state.interactive,
      frame: state.frame ? [...state.frame] : null,
      worldRect: state.worldRect ? { ...state.worldRect } : null,
      lastPayload: state.lastPayload == null ? null : JSON.parse(JSON.stringify(state.lastPayload)),
      surface: typeof surface.snapshot === 'function' ? surface.snapshot() : null,
    }
  }

  return {
    id: state.id,
    parent: state.parent,
    ensureCreated,
    sync,
    disable,
    refreshPayload,
    remove,
    handleLifecycle,
    snapshot,
  }
}
