import { emit, wireBridge } from '../../runtime/bridge.js'

const REQUEST_TIMEOUT_MS = 1_500
const RETENTION_LIMIT_MS = 5_000
const FRAME_URL = /^aos:\/\/toolkit\/\.aos-desktop-frame\/v1\/[0-9a-f-]{36}\/frame$/u
const IDENTITY_KEYS = Object.freeze(['extension', 'owner', 'resource'])
const REFERENCE_KEYS = Object.freeze(['digest', 'id', 'ownerId', 'sceneAbi', 'threeRevision'])

function requestId() {
  return `desktop-frame-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
}

function finiteBounds(value) {
  if (!Array.isArray(value) || value.length < 4) return null
  const bounds = value.slice(0, 4).map(Number)
  if (bounds.some((entry) => !Number.isFinite(entry)) || bounds[2] <= 0 || bounds[3] <= 0) return null
  return Object.freeze(bounds)
}

function exactReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.keys(value).sort().join(',') !== [...REFERENCE_KEYS].sort().join(',')) return null
  if (REFERENCE_KEYS.some((key) => typeof value[key] !== 'string' || value[key].length === 0)) return null
  return Object.freeze(Object.fromEntries(REFERENCE_KEYS.map((key) => [key, value[key]])))
}

function exactIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.keys(value).sort().join(',') !== [...IDENTITY_KEYS].sort().join(',')) return null
  const extension = exactReference(value.extension)
  if (
    !extension
    || typeof value.owner !== 'string'
    || value.owner.length === 0
    || typeof value.resource !== 'string'
    || value.resource.length === 0
  ) return null
  return Object.freeze({ extension, owner: value.owner, resource: value.resource })
}

function sameIdentity(left, right) {
  return left.owner === right.owner
    && left.resource === right.resource
    && REFERENCE_KEYS.every((key) => left.extension[key] === right.extension[key])
}

function redactedErrorCode(error) {
  const value = String(error?.code ?? error?.message ?? '')
  if (value.includes('PERMISSION')) return 'DESKTOP_FRAME_PERMISSION_DENIED'
  if (value.includes('TIMEOUT')) return 'DESKTOP_FRAME_TIMEOUT'
  if (value.includes('DISPLAY')) return 'DESKTOP_FRAME_DISPLAY_NOT_FOUND'
  if (value.includes('UNAUTHORIZED')) return 'DESKTOP_FRAME_UNAUTHORIZED'
  if (value.includes('BUSY')) return 'DESKTOP_FRAME_BUSY'
  return 'DESKTOP_FRAME_CAPTURE_FAILED'
}

function loadImage(url, ImageConstructor = globalThis.Image) {
  return new Promise((resolve, reject) => {
    if (typeof ImageConstructor !== 'function') {
      reject(new Error('DESKTOP_FRAME_DECODE_UNAVAILABLE'))
      return
    }
    const image = new ImageConstructor()
    image.decoding = 'async'
    image.onload = () => {
      image.onload = null
      image.onerror = null
      resolve(image)
    }
    image.onerror = () => {
      image.onload = null
      image.onerror = null
      reject(new Error('DESKTOP_FRAME_DECODE_FAILED'))
    }
    image.src = url
  })
}

function frameMessage(message, identity, displayId) {
  if (message?.type !== 'desktop_frame.available') return null
  if (message.owner !== identity.owner || message.resource !== identity.resource) return null
  const extension = exactReference(message.extension)
  if (!extension || !sameIdentity(identity, { ...identity, extension })) return null
  if (message.status !== 'ok') {
    return Object.freeze({
      code: redactedErrorCode({ code: message.code }),
      requestId: typeof message.request_id === 'string' ? message.request_id : null,
      status: 'error',
    })
  }
  if (typeof message.epoch_id !== 'string' || !Array.isArray(message.frames) || message.frames.length > 16) {
    return Object.freeze({ code: 'DESKTOP_FRAME_CAPTURE_FAILED', requestId: null, status: 'error' })
  }
  const frame = message.frames.find((entry) => Number(entry?.display_id) === displayId)
  if (
    !frame
    || typeof frame.handle !== 'string'
    || typeof frame.url !== 'string'
    || !FRAME_URL.test(frame.url)
    || !Number.isFinite(Number(frame.width))
    || !Number.isFinite(Number(frame.height))
  ) {
    return Object.freeze({ code: 'DESKTOP_FRAME_DISPLAY_NOT_FOUND', requestId: null, status: 'error' })
  }
  return Object.freeze({
    captureDurationMs: Number.isFinite(Number(message.capture_duration_ms))
      ? Number(message.capture_duration_ms)
      : null,
    capturedAtEpochMs: Number.isFinite(Number(message.captured_at_epoch_ms))
      ? Number(message.captured_at_epoch_ms)
      : null,
    epochId: message.epoch_id,
    frame: Object.freeze({
      handle: frame.handle,
      height: Math.max(1, Math.min(4096, Number(frame.height))),
      url: frame.url,
      width: Math.max(1, Math.min(4096, Number(frame.width))),
    }),
    requestId: typeof message.request_id === 'string' ? message.request_id : null,
    status: 'ok',
  })
}

export function createDesktopFrameRequestClient({
  emitMessage = emit,
  listen = wireBridge,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const pending = new Map()
  const subscriptions = new Set()
  let disposed = false
  const dispatch = (message) => {
    for (const subscription of subscriptions) {
      const frame = frameMessage(message, subscription.identity, subscription.displayId)
      if (!frame) continue
      if (frame.requestId && pending.has(frame.requestId)) {
        clearTimeout(pending.get(frame.requestId).timer)
        pending.delete(frame.requestId)
      }
      try { subscription.receive(frame) } catch {}
    }
  }
  const detach = listen(dispatch)

  return Object.freeze({
    request(identityInput) {
      if (disposed) return false
      const identity = exactIdentity(identityInput)
      if (!identity) return false
      const request_id = requestId()
      const timer = setTimeout(() => {
        const entry = pending.get(request_id)
        if (!entry) return
        pending.delete(request_id)
        dispatch({
          type: 'desktop_frame.available',
          request_id,
          status: 'error',
          code: 'DESKTOP_FRAME_TIMEOUT',
          owner: identity.owner,
          resource: identity.resource,
          extension: identity.extension,
        })
      }, timeoutMs)
      pending.set(request_id, { identity, timer })
      emitMessage('desktop_frame.acquire', {
        extension: identity.extension,
        owner: identity.owner,
        request_id,
        resource: identity.resource,
      })
      return true
    },
    release(handle) {
      if (!disposed && typeof handle === 'string') emitMessage('desktop_frame.release', { handle })
    },
    subscribe(identityInput, displayId, receive) {
      const identity = exactIdentity(identityInput)
      if (
        disposed
        || !identity
        || !Number.isInteger(displayId)
        || displayId < 0
        || typeof receive !== 'function'
      ) {
        throw new TypeError('Desktop frame subscription is invalid.')
      }
      const entry = Object.freeze({ displayId, identity, receive })
      subscriptions.add(entry)
      return () => subscriptions.delete(entry)
    },
    dispose() {
      if (disposed) return false
      disposed = true
      detach?.()
      for (const entry of pending.values()) clearTimeout(entry.timer)
      pending.clear()
      subscriptions.clear()
      return true
    },
  })
}

export function createDesktopFrameTextureSource({
  THREE,
  bounds,
  client,
  cancelScheduledClear = clearTimeout,
  decode = loadImage,
  displayId,
  identity: identityInput,
  now = () => performance.now(),
  retentionMs = RETENTION_LIMIT_MS,
  scheduleClear = setTimeout,
} = {}) {
  if (!THREE?.Texture) {
    throw new TypeError('Desktop frame texture source requires the AOS Three namespace.')
  }
  const projectionBounds = finiteBounds(bounds)
  const identity = exactIdentity(identityInput)
  if (!projectionBounds) throw new TypeError('Desktop frame texture source requires finite projection bounds.')
  if (!identity || !Number.isInteger(displayId) || displayId < 0) {
    throw new TypeError('Desktop frame texture source requires exact scene and display identity.')
  }
  if (
    !client
    || typeof client.request !== 'function'
    || typeof client.release !== 'function'
    || typeof client.subscribe !== 'function'
  ) {
    throw new TypeError('Desktop frame texture source requires an AOS frame request client.')
  }
  if (typeof cancelScheduledClear !== 'function' || typeof scheduleClear !== 'function') {
    throw new TypeError('Desktop frame texture source requires a bounded clear scheduler.')
  }
  const boundedRetentionMs = Math.max(100, Math.min(RETENTION_LIMIT_MS, Number(retentionMs) || RETENTION_LIMIT_MS))

  const texture = new THREE.Texture()
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter

  let captureDurationMs = null
  let capturedAtEpochMs = null
  let clearTimer = null
  let disposed = false
  let epochId = null
  let errorCode = null
  let generation = 0
  let hasFrame = false
  let height = 1
  let inFlight = false
  let readyAtMs = null
  let status = 'empty'
  let width = 1

  const clear = () => {
    if (disposed) return false
    generation += 1
    if (clearTimer !== null) cancelScheduledClear(clearTimer)
    clearTimer = null
    inFlight = false
    hasFrame = false
    texture.dispose()
    texture.image = null
    captureDurationMs = null
    capturedAtEpochMs = null
    epochId = null
    readyAtMs = null
    status = 'empty'
    width = 1
    height = 1
    return true
  }

  const snapshot = () => Object.freeze({
    bounds: projectionBounds,
    captureDurationMs,
    capturedAtEpochMs,
    epochId,
    errorCode,
    generation,
    height,
    readyAtMs,
    status,
    width,
  })

  const unsubscribe = client.subscribe(identity, displayId, (message) => {
    if (disposed) return
    if (message.status !== 'ok') {
      errorCode = message.code
      inFlight = false
      status = hasFrame ? 'ready' : 'failed'
      return
    }
    const requestedGeneration = ++generation
    inFlight = true
    status = hasFrame ? 'refreshing' : 'loading'
    errorCode = null
    void decode(message.frame.url).then((image) => {
      if (disposed || requestedGeneration !== generation) return
      texture.image = image
      texture.needsUpdate = true
      hasFrame = true
      width = message.frame.width
      height = message.frame.height
      captureDurationMs = message.captureDurationMs
      capturedAtEpochMs = message.capturedAtEpochMs
      epochId = message.epochId
      readyAtMs = now()
      status = 'ready'
      if (clearTimer !== null) cancelScheduledClear(clearTimer)
      clearTimer = scheduleClear(clear, boundedRetentionMs)
    }, (error) => {
      if (!disposed && requestedGeneration === generation) {
        errorCode = redactedErrorCode(error)
        status = hasFrame ? 'ready' : 'failed'
      }
    }).finally(() => {
      client.release(message.frame.handle)
      if (requestedGeneration === generation) inFlight = false
    })
  })

  const source = {
    texture,
    request() {
      if (disposed || inFlight) return false
      inFlight = true
      status = status === 'ready' ? 'refreshing' : 'loading'
      errorCode = null
      if (client.request(identity)) return true
      inFlight = false
      status = hasFrame ? 'ready' : 'failed'
      errorCode = 'DESKTOP_FRAME_CAPTURE_FAILED'
      return false
    },
    clear,
    snapshot,
    dispose() {
      if (disposed) return false
      clear()
      disposed = true
      unsubscribe()
      status = 'disposed'
      return true
    },
  }
  return Object.freeze(source)
}
