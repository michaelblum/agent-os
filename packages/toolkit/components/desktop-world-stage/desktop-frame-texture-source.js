import { emit, wireBridge } from '../../runtime/bridge.js'

const REQUEST_TIMEOUT_MS = 1_500
const RETIRED_REQUEST_LIMIT = 64
const RETENTION_LIMIT_MS = 5_000
const FRAME_URL = /^aos:\/\/toolkit\/\.aos-desktop-frame\/v1\/[0-9a-f-]{36}\/frame$/u
const IDENTITY_KEYS = Object.freeze(['extension', 'owner', 'resource', 'revision'])
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
    || !Number.isInteger(value.revision)
    || value.revision < 0
  ) return null
  return Object.freeze({
    extension,
    owner: value.owner,
    resource: value.resource,
    revision: value.revision,
  })
}

function sameIdentity(left, right) {
  return left.owner === right.owner
    && left.resource === right.resource
    && left.revision === right.revision
    && REFERENCE_KEYS.every((key) => left.extension[key] === right.extension[key])
}

function redactedErrorCode(error) {
  const value = String(error?.code ?? error?.message ?? '')
  if (value.includes('CONSENT_REQUIRED')) return 'DESKTOP_FRAME_CONSENT_REQUIRED'
  if (value.includes('PERMISSION')) return 'DESKTOP_FRAME_PERMISSION_DENIED'
  if (value.includes('TIMEOUT')) return 'DESKTOP_FRAME_TIMEOUT'
  if (value.includes('DISPLAY')) return 'DESKTOP_FRAME_DISPLAY_NOT_FOUND'
  if (value.includes('UNAUTHORIZED')) return 'DESKTOP_FRAME_UNAUTHORIZED'
  if (value.includes('BUSY')) return 'DESKTOP_FRAME_BUSY'
  return 'DESKTOP_FRAME_CAPTURE_FAILED'
}

function unavailableStatus(code, hasFrame) {
  if (code === 'DESKTOP_FRAME_CONSENT_REQUIRED'
      || code === 'DESKTOP_FRAME_PERMISSION_DENIED') {
    return 'consent_required'
  }
  return hasFrame ? 'ready' : 'failed'
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

function frameEvent(message, identity, displayId) {
  if (![
    'desktop_frame.abort',
    'desktop_frame.available',
    'desktop_frame.commit',
    'desktop_frame.complete',
    'desktop_frame.started',
  ].includes(message?.type)) return null
  if (
    message.owner !== identity.owner
    || message.resource !== identity.resource
    || message.revision !== identity.revision
  ) return null
  const extension = exactReference(message.extension)
  if (!extension || !sameIdentity(identity, { ...identity, extension })) return null
  const requestId = typeof message.request_id === 'string' ? message.request_id : null
  if (!requestId) return null
  if (message.status !== 'ok') {
    return Object.freeze({
      code: redactedErrorCode({ code: message.code }),
      kind: 'error',
      requestId,
      status: 'error',
    })
  }
  if (message.type === 'desktop_frame.started') {
    return Object.freeze({ kind: 'started', requestId, status: 'ok' })
  }
  if (message.type === 'desktop_frame.abort') {
    return Object.freeze({
      epochId: typeof message.epoch_id === 'string' ? message.epoch_id : null,
      kind: 'abort',
      requestId,
      status: 'ok',
    })
  }
  if (message.type === 'desktop_frame.complete') {
    if (typeof message.epoch_id !== 'string') return null
    return Object.freeze({
      epochId: message.epoch_id,
      kind: 'complete',
      requestId,
      status: 'ok',
    })
  }
  if (message.type === 'desktop_frame.commit') {
    const committedAtEpochMs = Number(message.committed_at_epoch_ms)
    if (typeof message.epoch_id !== 'string' || !Number.isFinite(committedAtEpochMs)) return null
    return Object.freeze({
      committedAtEpochMs,
      epochId: message.epoch_id,
      kind: 'commit',
      requestId,
      status: 'ok',
    })
  }
  if (typeof message.epoch_id !== 'string' || !Array.isArray(message.frames) || message.frames.length > 16) {
    return Object.freeze({
      code: 'DESKTOP_FRAME_CAPTURE_FAILED',
      kind: 'error',
      requestId,
      status: 'error',
    })
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
    return Object.freeze({
      code: 'DESKTOP_FRAME_DISPLAY_NOT_FOUND',
      kind: 'error',
      requestId,
      status: 'error',
    })
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
    kind: 'available',
    requestId,
    status: 'ok',
  })
}

export function createDesktopFrameRequestClient({
  emitMessage = emit,
  listen = wireBridge,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const pending = new Map()
  const retired = new Set()
  const subscriptions = new Set()
  let disposed = false
  const retire = (requestId) => {
    retired.delete(requestId)
    retired.add(requestId)
    while (retired.size > RETIRED_REQUEST_LIMIT) retired.delete(retired.values().next().value)
  }
  const finish = (requestId) => {
    const entry = pending.get(requestId)
    if (!entry) return null
    clearTimeout(entry.timer)
    pending.delete(requestId)
    return entry
  }
  const notify = (event, identity) => {
    for (const subscription of subscriptions) {
      if (!sameIdentity(subscription.identity, identity)) continue
      try { subscription.receive(event) } catch {}
    }
  }
  const arm = (requestId, identity) => {
    const previous = finish(requestId)
    const timer = setTimeout(() => {
      const entry = finish(requestId)
      if (!entry) return
      retire(requestId)
      emitMessage('desktop_frame.cancel', { request_id: requestId })
      notify(Object.freeze({
        code: 'DESKTOP_FRAME_TIMEOUT',
        kind: 'error',
        requestId,
        status: 'error',
      }), entry.identity)
    }, timeoutMs)
    pending.set(requestId, { identity, timer })
    return previous
  }
  const dispatch = (message) => {
    if (disposed) return
    const requestId = typeof message?.request_id === 'string' ? message.request_id : null
    if (!requestId) return
    const messageIdentity = exactIdentity({
      extension: message.extension,
      owner: message.owner,
      resource: message.resource,
      revision: message.revision,
    })
    if (!messageIdentity) return
    if (message.type === 'desktop_frame.started') {
      if (retired.has(requestId)) return
      const existing = pending.get(requestId)
      if (existing && !sameIdentity(existing.identity, messageIdentity)) return
      for (const [candidateId, candidate] of pending) {
        if (candidateId === requestId || !sameIdentity(candidate.identity, messageIdentity)) continue
        finish(candidateId)
        retire(candidateId)
        emitMessage('desktop_frame.cancel', { request_id: candidateId })
      }
      arm(requestId, messageIdentity)
    }
    if (message.type === 'desktop_frame.abort' || message.type === 'desktop_frame.complete') {
      for (const subscription of subscriptions) {
        const event = frameEvent(message, subscription.identity, subscription.displayId)
        if (!event) continue
        try { subscription.receive(event) } catch {}
      }
      finish(requestId)
      retire(requestId)
      return
    }
    const request = pending.get(requestId)
    if (!request || !sameIdentity(request.identity, messageIdentity)) {
      if (message.type === 'desktop_frame.available' && Array.isArray(message.frames)) {
        const handles = new Set()
        for (const subscription of subscriptions) {
          if (!sameIdentity(subscription.identity, messageIdentity)) continue
          const frame = message.frames.find(
            (entry) => Number(entry?.display_id) === subscription.displayId,
          )
          if (typeof frame?.handle === 'string') handles.add(frame.handle)
        }
        for (const handle of handles) emitMessage('desktop_frame.release', { handle })
      }
      return
    }
    for (const subscription of subscriptions) {
      const event = frameEvent(message, subscription.identity, subscription.displayId)
      if (!event) continue
      try { subscription.receive(event) } catch {}
    }
    if (message.status !== 'ok') {
      finish(requestId)
      retire(requestId)
    }
  }
  const detach = listen(dispatch)

  return Object.freeze({
    request(identityInput) {
      if (disposed) return null
      const identity = exactIdentity(identityInput)
      if (!identity) return null
      const request_id = requestId()
      arm(request_id, identity)
      emitMessage('desktop_frame.acquire', {
        extension: identity.extension,
        owner: identity.owner,
        request_id,
        resource: identity.resource,
        revision: identity.revision,
      })
      return request_id
    },
    cancel(requestId) {
      if (disposed || typeof requestId !== 'string') return false
      const entry = finish(requestId)
      if (!entry) return false
      retire(requestId)
      emitMessage('desktop_frame.cancel', { request_id: requestId })
      return true
    },
    ready(requestId, epochId) {
      if (
        disposed
        || typeof requestId !== 'string'
        || typeof epochId !== 'string'
        || !pending.has(requestId)
      ) return false
      emitMessage('desktop_frame.ready', {
        epoch_id: epochId,
        request_id: requestId,
      })
      return true
    },
    presented(requestId, epochId) {
      if (
        disposed
        || typeof requestId !== 'string'
        || typeof epochId !== 'string'
        || !pending.has(requestId)
      ) return false
      emitMessage('desktop_frame.presented', {
        epoch_id: epochId,
        request_id: requestId,
      })
      finish(requestId)
      retire(requestId)
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
      detach?.()
      for (const [requestId, entry] of pending) {
        clearTimeout(entry.timer)
        emitMessage('desktop_frame.cancel', { request_id: requestId })
      }
      pending.clear()
      retired.clear()
      subscriptions.clear()
      disposed = true
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
    || typeof client.cancel !== 'function'
    || typeof client.presented !== 'function'
    || typeof client.ready !== 'function'
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
  let committedEpochId = null
  let committedRequestId = null
  let committedAtEpochMs = null
  let disposed = false
  let epochId = null
  let errorCode = null
  let generation = 0
  let hasFrame = false
  let height = 1
  let inFlight = false
  let activeRequestId = null
  let pendingFrame = null
  let readyAtMs = null
  let status = 'empty'
  let width = 1

  const clear = () => {
    if (disposed) return false
    generation += 1
    if (activeRequestId !== null) client.cancel(activeRequestId)
    activeRequestId = null
    committedEpochId = null
    committedRequestId = null
    pendingFrame = null
    if (clearTimer !== null) cancelScheduledClear(clearTimer)
    clearTimer = null
    inFlight = false
    hasFrame = false
    texture.dispose()
    texture.image = null
    captureDurationMs = null
    capturedAtEpochMs = null
    committedAtEpochMs = null
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
    committedAtEpochMs,
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
    if (message.kind === 'started') {
      activeRequestId = message.requestId
      inFlight = true
      status = hasFrame ? 'refreshing' : 'loading'
      errorCode = null
      return
    }
    if (message.kind === 'abort') {
      const matchesActive = message.requestId === activeRequestId
      const matchesCommitted = message.requestId === committedRequestId
        && (message.epochId === null || message.epochId === committedEpochId)
      if (!matchesActive && !matchesCommitted) return
      generation += 1
      activeRequestId = null
      committedEpochId = null
      committedRequestId = null
      pendingFrame = null
      inFlight = false
      hasFrame = false
      texture.dispose()
      texture.image = null
      captureDurationMs = null
      capturedAtEpochMs = null
      committedAtEpochMs = null
      epochId = null
      readyAtMs = null
      status = 'empty'
      width = 1
      height = 1
      if (clearTimer !== null) cancelScheduledClear(clearTimer)
      clearTimer = null
      return
    }
    if (message.kind === 'complete') {
      if (
        message.requestId !== committedRequestId
        || message.epochId !== committedEpochId
      ) return
      activeRequestId = null
      inFlight = false
      status = 'ready'
      if (clearTimer === null) clearTimer = scheduleClear(clear, boundedRetentionMs)
      return
    }
    if (message.requestId !== activeRequestId) return
    if (message.status !== 'ok') {
      errorCode = message.code
      activeRequestId = null
      pendingFrame = null
      inFlight = false
      status = unavailableStatus(errorCode, hasFrame)
      return
    }
    if (message.kind === 'commit') {
      if (!pendingFrame || pendingFrame.epochId !== message.epochId) return
      texture.image = pendingFrame.image
      texture.needsUpdate = true
      hasFrame = true
      width = pendingFrame.width
      height = pendingFrame.height
      captureDurationMs = pendingFrame.captureDurationMs
      capturedAtEpochMs = pendingFrame.capturedAtEpochMs
      committedAtEpochMs = message.committedAtEpochMs
      committedEpochId = message.epochId
      committedRequestId = message.requestId
      epochId = pendingFrame.epochId
      readyAtMs = now()
      pendingFrame = null
      status = 'presenting'
      if (!client.presented(message.requestId, message.epochId)) {
        errorCode = 'DESKTOP_FRAME_UNAUTHORIZED'
        clear()
        return
      }
      if (clearTimer !== null) cancelScheduledClear(clearTimer)
      clearTimer = scheduleClear(clear, boundedRetentionMs)
      return
    }
    if (message.kind !== 'available') return
    const requestedGeneration = ++generation
    inFlight = true
    status = hasFrame ? 'refreshing' : 'loading'
    errorCode = null
    void decode(message.frame.url)
      .then((image) => {
        if (
          disposed
          || requestedGeneration !== generation
          || message.requestId !== activeRequestId
        ) return
        pendingFrame = {
          captureDurationMs: message.captureDurationMs,
          capturedAtEpochMs: message.capturedAtEpochMs,
          epochId: message.epochId,
          height: message.frame.height,
          image,
          width: message.frame.width,
        }
        status = 'staging'
        if (!client.ready(message.requestId, message.epochId)) {
          throw new Error('DESKTOP_FRAME_UNAUTHORIZED')
        }
      })
      .catch((error) => {
        if (!disposed && requestedGeneration === generation) {
          errorCode = redactedErrorCode(error)
          client.cancel(message.requestId)
          activeRequestId = null
          pendingFrame = null
          inFlight = false
          status = unavailableStatus(errorCode, hasFrame)
        }
      })
      .finally(() => {
        client.release(message.frame.handle)
      })
  })

  const source = {
    texture,
    request() {
      if (disposed || inFlight) return false
      inFlight = true
      status = status === 'ready' ? 'refreshing' : 'loading'
      errorCode = null
      const requestId = client.request(identity)
      if (requestId) {
        activeRequestId = requestId
        return true
      }
      inFlight = false
      status = unavailableStatus(errorCode, hasFrame)
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
