const DEFAULT_PENDING_REQUEST_LIMIT = 32
const DEFAULT_HANDLED_REQUEST_LIMIT = 128
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u

function normalizedIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const canvasGeneration = value.canvasGeneration
  const topologyGeneration = value.topologyGeneration
  const displayId = value.displayId
  const displayIndex = value.displayIndex
  if (
    !Number.isSafeInteger(canvasGeneration)
    || canvasGeneration < 1
    || !Number.isSafeInteger(topologyGeneration)
    || topologyGeneration < 1
    || typeof displayId !== 'string'
    || displayId.length < 1
    || !Number.isSafeInteger(displayIndex)
    || displayIndex < 0
    || displayIndex > 31
  ) return null
  return Object.freeze({ canvasGeneration, topologyGeneration, displayId, displayIndex })
}

function sameIdentity(left, right) {
  return left?.canvasGeneration === right?.canvasGeneration
    && left?.topologyGeneration === right?.topologyGeneration
    && left?.displayId === right?.displayId
    && left?.displayIndex === right?.displayIndex
}

export function createDesktopWorldDevToolsRequestLifecycle({
  getIdentity,
  handledRequestLimit = DEFAULT_HANDLED_REQUEST_LIMIT,
  pendingRequestLimit = DEFAULT_PENDING_REQUEST_LIMIT,
  probe,
} = {}) {
  if (typeof getIdentity !== 'function' || typeof probe?.emitSnapshot !== 'function') {
    throw new TypeError('DesktopWorld DevTools requests require an identity reader and stage probe.')
  }
  if (!Number.isSafeInteger(pendingRequestLimit) || pendingRequestLimit < 1) {
    throw new RangeError('DesktopWorld DevTools pending request limit must be positive.')
  }
  if (!Number.isSafeInteger(handledRequestLimit) || handledRequestLimit < pendingRequestLimit) {
    throw new RangeError('DesktopWorld DevTools handled request limit must cover pending requests.')
  }

  const pending = new Map()
  const handled = new Map()
  let disposed = false
  let readyIdentity = null
  let targetIdentity = null

  function rememberHandled(requestId, identity) {
    handled.delete(requestId)
    handled.set(requestId, identity)
    while (handled.size > handledRequestLimit) {
      handled.delete(handled.keys().next().value)
    }
  }

  function retirePendingOutside(identity) {
    for (const [requestId, pendingIdentity] of pending) {
      if (sameIdentity(pendingIdentity, identity)) continue
      pending.delete(requestId)
      rememberHandled(requestId, pendingIdentity)
    }
  }

  function retirePending() {
    for (const [requestId, pendingIdentity] of pending) {
      rememberHandled(requestId, pendingIdentity)
    }
    pending.clear()
  }

  function retry() {
    if (disposed) return 0
    const current = normalizedIdentity(getIdentity())
    if (!sameIdentity(readyIdentity, current)) return 0
    let emitted = 0
    for (const [requestId, pendingIdentity] of pending) {
      if (!sameIdentity(pendingIdentity, current)) {
        pending.delete(requestId)
        continue
      }
      if (!probe.emitSnapshot('requested', undefined, { request_id: requestId })) continue
      pending.delete(requestId)
      rememberHandled(requestId, current)
      emitted += 1
    }
    return emitted
  }

  function retain(requestId, identity) {
    const existing = pending.get(requestId)
    if (existing) return sameIdentity(existing, identity)
    if (pending.size >= pendingRequestLimit) return false
    pending.set(requestId, identity)
    return true
  }

  return Object.freeze({
    configure(next = {}) {
      if (disposed) return false
      if (next.enabled !== true) {
        retirePending()
        return true
      }
      retry()
      return true
    },
    dispose() {
      if (disposed) return false
      disposed = true
      pending.clear()
      handled.clear()
      readyIdentity = null
      targetIdentity = null
      return true
    },
    identityChanging(nextIdentity = getIdentity()) {
      if (disposed) return false
      targetIdentity = normalizedIdentity(nextIdentity)
      readyIdentity = null
      retirePendingOutside(targetIdentity)
      probe.setIdentityReady(false)
      return targetIdentity !== null
    },
    identityReady(nextIdentity = getIdentity(), beforeRetry = null) {
      if (disposed) return false
      const next = normalizedIdentity(nextIdentity)
      const current = normalizedIdentity(getIdentity())
      if (!next || !sameIdentity(next, current)) return false
      if (targetIdentity && !sameIdentity(targetIdentity, next)) return false
      if (!probe.setIdentityReady(next)) return false
      targetIdentity = next
      readyIdentity = next
      if (typeof beforeRetry === 'function') beforeRetry()
      retry()
      return true
    },
    request(requestId = null) {
      if (disposed) return false
      if (requestId == null) return probe.emitSnapshot('requested')
      if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) return false
      if (handled.has(requestId)) return true
      const current = normalizedIdentity(getIdentity())
      if (!current) return false
      const existing = pending.get(requestId)
      if (existing) return sameIdentity(existing, current)
      if (sameIdentity(readyIdentity, current)) {
        if (probe.emitSnapshot('requested', undefined, { request_id: requestId })) {
          rememberHandled(requestId, current)
          return true
        }
      }
      return retain(requestId, current)
    },
    retire() {
      if (disposed) return false
      retirePending()
      readyIdentity = null
      targetIdentity = null
      probe.setIdentityReady(false)
      return true
    },
    state() {
      return Object.freeze({
        disposed,
        handledRequestCount: handled.size,
        pendingRequestCount: pending.size,
        ready: readyIdentity !== null,
      })
    },
  })
}
