function sameFrame(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length >= 4
    && b.length >= 4
    && a[0] === b[0]
    && a[1] === b[1]
    && a[2] === b[2]
    && a[3] === b[3]
}

function cloneFrame(frame) {
  return Array.isArray(frame) ? frame.slice(0, 4) : null
}

function normalizeDescriptors(descriptors = []) {
  if (Array.isArray(descriptors)) return descriptors
  return Object.entries(descriptors).map(([key, descriptor]) => ({ key, ...descriptor }))
}

function defaultPayloadForDescriptor(descriptor, frame, ownerCanvasId) {
  return {
    id: descriptor.id,
    owner_canvas_id: ownerCanvasId,
    frame,
    coordinate_space: descriptor.coordinateSpace || descriptor.coordinate_space || 'native',
    semantic_label: descriptor.semanticLabel || descriptor.semantic_label || descriptor.label || descriptor.id,
    priority: descriptor.priority ?? 0,
    consume_policy: descriptor.consumePolicy || descriptor.consume_policy || 'captured',
    remove_on_owner_suspend: descriptor.removeOnOwnerSuspend ?? descriptor.remove_on_owner_suspend ?? true,
    enabled: descriptor.payloadEnabled ?? true,
    metadata: {
      ...(descriptor.metadata && typeof descriptor.metadata === 'object' ? descriptor.metadata : {}),
    },
  }
}

function regionSnapshot(entry) {
  return {
    registered: !!entry?.registered,
    frame: cloneFrame(entry?.frame),
  }
}

function shouldSkipSync(prior, payload) {
  return prior
    && prior.owner_canvas_id === payload.owner_canvas_id
    && prior.enabled === payload.enabled
    && sameFrame(prior.frame, payload.frame)
}

export function createManagedInputRegionSet({
  host,
  descriptors = [],
  ownerCanvasId = () => null,
  logger = console,
} = {}) {
  if (!host) throw new Error('createManagedInputRegionSet requires host')

  const entries = new Map()
  const descriptorList = normalizeDescriptors(descriptors)
  const descriptorsByKey = new Map()
  const descriptorsById = new Map()
  for (const descriptor of descriptorList) {
    if (!descriptor?.id) throw new Error('managed input-region descriptor requires id')
    const key = descriptor.key || descriptor.name || descriptor.id
    const normalized = { ...descriptor, key }
    descriptorsByKey.set(key, normalized)
    descriptorsById.set(normalized.id, normalized)
  }

  function currentOwnerCanvasId() {
    return typeof ownerCanvasId === 'function' ? ownerCanvasId() : ownerCanvasId
  }

  function payloadFor(descriptor, frame) {
    if (typeof descriptor.payload === 'function') {
      return descriptor.payload({ descriptor, frame, ownerCanvasId: currentOwnerCanvasId() })
    }
    return defaultPayloadForDescriptor(descriptor, frame, currentOwnerCanvasId())
  }

  function isEnabled(descriptor) {
    return typeof descriptor.enabled === 'function' ? !!descriptor.enabled() : descriptor.enabled !== false
  }

  function resolveFrame(descriptor) {
    const frame = typeof descriptor.frame === 'function'
      ? descriptor.frame()
      : typeof descriptor.frameResolver === 'function'
        ? descriptor.frameResolver()
        : descriptor.frame
    return cloneFrame(frame)
  }

  function syncDescriptor(descriptor) {
    if (!isEnabled(descriptor)) return remove(descriptor.id)
    const frame = resolveFrame(descriptor)
    if (!frame) return remove(descriptor.id)
    const payload = payloadFor(descriptor, frame)
    const prior = entries.get(descriptor.id)
    if (shouldSkipSync(prior, payload)) return false

    const method = prior?.registered ? 'inputRegionUpdate' : 'inputRegionRegister'
    entries.set(descriptor.id, { ...payload, frame: cloneFrame(payload.frame), registered: true })
    void host[method](payload).catch((error) => {
      const message = String(error?.message || error)
      if (method === 'inputRegionUpdate' && message.includes('NOT_FOUND')) {
        void host.inputRegionRegister(payload).catch((registerError) => {
          logger?.warn?.('[toolkit] input region register failed:', registerError)
        })
        return
      }
      logger?.warn?.('[toolkit] input region sync failed:', error)
    })
    return true
  }

  function sync(keyOrId = null) {
    if (keyOrId) {
      const descriptor = descriptorsByKey.get(keyOrId) || descriptorsById.get(keyOrId)
      return descriptor ? syncDescriptor(descriptor) : false
    }
    return syncAll()
  }

  function syncAll() {
    return descriptorList.map(syncDescriptor).some(Boolean)
  }

  function remove(keyOrId) {
    const descriptor = descriptorsByKey.get(keyOrId) || descriptorsById.get(keyOrId)
    const id = descriptor?.id || keyOrId
    if (!entries.has(id)) return false
    entries.delete(id)
    void host.inputRegionRemove(id).catch((error) => {
      logger?.warn?.('[toolkit] input region remove failed:', error)
    })
    return true
  }

  function removeAll() {
    return descriptorList.map((descriptor) => remove(descriptor.id)).some(Boolean)
  }

  function snapshot() {
    const regions = {}
    for (const descriptor of descriptorList) {
      regions[descriptor.key] = {
        id: descriptor.id,
        ...regionSnapshot(entries.get(descriptor.id)),
      }
    }
    return {
      ownerCanvasId: currentOwnerCanvasId(),
      regions,
    }
  }

  return {
    currentOwnerCanvasId,
    sync,
    syncAll,
    remove,
    removeAll,
    snapshot,
  }
}
