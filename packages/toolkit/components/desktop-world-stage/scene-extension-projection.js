import {
  canonicalizeSceneDocument,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
} from '../../scene/index.js'

function objectNamed(root, id) {
  if (!root || typeof id !== 'string') return null
  if (root.name === id) return root
  if (typeof root.getObjectByName === 'function') return root.getObjectByName(id) ?? null
  let match = null
  root.traverse?.((object) => {
    if (!match && object?.name === id) match = object
  })
  return match
}

function interactionResult(value) {
  if (value === true) return Object.freeze({ handled: true, routeStarted: false })
  if (value === false || value === null || value === undefined) {
    return Object.freeze({ handled: false, routeStarted: false })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Scene extension interaction results must be boolean or bounded result objects.')
  }
  const keys = Object.keys(value)
  if (keys.some((key) => !['handled', 'routeStarted'].includes(key)) || typeof value.handled !== 'boolean') {
    throw new TypeError('Scene extension interaction results contain invalid fields.')
  }
  if (value.routeStarted !== undefined && typeof value.routeStarted !== 'boolean') {
    throw new TypeError('Scene extension routeStarted must be boolean.')
  }
  return Object.freeze({
    handled: value.handled,
    routeStarted: value.handled && value.routeStarted === true,
  })
}

const INTERACTION_EVENT_LIMITS = Object.freeze({
  maxArrayLength: 256,
  maxDepth: 16,
  maxObjectKeys: 128,
  maxStringLength: 16_384,
  maxValues: 4_096,
})

function immutableInteractionValue(value, state, depth = 0) {
  state.values += 1
  if (state.values > INTERACTION_EVENT_LIMITS.maxValues || depth > INTERACTION_EVENT_LIMITS.maxDepth) {
    throw new TypeError('Scene extension interaction event exceeds bounded clone limits.')
  }
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Scene extension interaction event contains a non-finite number.')
    return value
  }
  if (typeof value === 'string') {
    if (value.length > INTERACTION_EVENT_LIMITS.maxStringLength) {
      throw new TypeError('Scene extension interaction event contains an oversized string.')
    }
    return value
  }
  if (value === undefined) return undefined
  if (typeof value !== 'object') {
    throw new TypeError('Scene extension interaction event contains an unsupported value.')
  }
  if (Array.isArray(value)) {
    if (value.length > INTERACTION_EVENT_LIMITS.maxArrayLength) {
      throw new TypeError('Scene extension interaction event contains an oversized array.')
    }
    return Object.freeze(value.map((entry) => immutableInteractionValue(entry, state, depth + 1)))
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Scene extension interaction event contains a non-record object.')
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable)
  if (entries.length > INTERACTION_EVENT_LIMITS.maxObjectKeys) {
    throw new TypeError('Scene extension interaction event contains an oversized record.')
  }
  const result = {}
  for (const [key, descriptor] of entries) {
    if ('get' in descriptor || 'set' in descriptor) {
      throw new TypeError('Scene extension interaction event contains an accessor.')
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: immutableInteractionValue(descriptor.value, state, depth + 1),
      writable: false,
    })
  }
  return Object.freeze(result)
}

function immutableInteractionEvent(value) {
  return immutableInteractionValue(value, { values: 0 })
}

function extensionProjectionAdapter(projection, releaseExtension) {
  let disposed = false
  return {
    object: projection.object,
    activate: (...args) => projection.activate?.apply(projection, args),
    applyInteraction: typeof projection.applyInteraction === 'function'
      ? (event) => interactionResult(projection.applyInteraction.call(projection, immutableInteractionEvent(event)))
      : undefined,
    applyAnimation: (...args) => projection.applyAnimation.apply(projection, args),
    applySignal: (...args) => projection.applySignal.apply(projection, args),
    contextLost: (...args) => projection.contextLost.apply(projection, args),
    contextRestored: (...args) => projection.contextRestored.apply(projection, args),
    dispose(...args) {
      if (disposed) return
      const result = projection.dispose.apply(projection, args)
      disposed = true
      releaseExtension()
      return result
    },
    resourceMetrics: () => projection.resourceMetrics(),
    resume: (...args) => projection.resume.apply(projection, args),
    suspend: (...args) => projection.suspend.apply(projection, args),
    tick: (...args) => projection.tick.apply(projection, args),
    objectPosition(objectId) {
      const object = objectNamed(projection.object, objectId)
      return object?.position
        ? [Number(object.position.x) || 0, Number(object.position.y) || 0, Number(object.position.z) || 0]
        : null
    },
    setObjectPosition(objectId, position) {
      const object = objectNamed(projection.object, objectId)
      if (!object?.position || !Array.isArray(position) || position.length < 2) return false
      const next = [Number(position[0]), Number(position[1]), Number(position[2] ?? object.position.z)]
      if (next.some((value) => !Number.isFinite(value))) return false
      if (typeof object.position.set === 'function') object.position.set(...next)
      else {
        object.position.x = next[0]
        object.position.y = next[1]
        object.position.z = next[2]
      }
      return true
    },
  }
}

function validateImplementationCoverage(document, genericRegistry, extensionHandle) {
  const extensionIds = new Set(extensionHandle?.manifest.implementationIds ?? [])
  let extensionUses = 0
  for (const required of genericRegistry.required(document)) {
    const exact = genericRegistry.resolve(required.id, required.kind)
    if (exact) continue
    const conflicting = genericRegistry.resolve(required.id)
    if (conflicting) {
      throw new TypeError(`Scene implementation ${required.id} is registered for ${conflicting.kind}, not ${required.kind}.`)
    }
    if (!extensionHandle || !extensionIds.has(required.id)) {
      throw new TypeError(`Scene implementation ${required.id} is unavailable.`)
    }
    extensionUses += 1
  }
  if (extensionHandle && extensionUses === 0) {
    throw new TypeError('Scene projection extension does not implement any required scene identifier.')
  }
}

export function createDesktopWorldSceneProjection({
  budgets = null,
  THREE,
  document: documentInput,
  expectedOwner,
  extensionReference = null,
  extensionRegistry = null,
} = {}) {
  if (!THREE || typeof THREE !== 'object') throw new TypeError('DesktopWorld scene projection requires Three.js.')
  const document = canonicalizeSceneDocument(documentInput)
  const genericRegistry = createGenericSceneImplementationRegistry()
  let extensionHandle = null
  let extensionLease = null

  if (extensionReference !== null) {
    if (!extensionRegistry || typeof extensionRegistry.retain !== 'function') {
      throw new TypeError('DesktopWorld scene projection extension registry is unavailable.')
    }
    if (extensionReference.ownerId !== expectedOwner) {
      throw new TypeError('Scene projection extension owner does not match the scene lease owner.')
    }
    extensionLease = extensionRegistry.retain(extensionReference)
    extensionHandle = extensionLease?.handle ?? null
    if (!extensionHandle) throw new TypeError('Scene projection extension is not loaded.')
  }

  try {
    validateImplementationCoverage(document, genericRegistry, extensionHandle)
  } catch (error) {
    extensionLease?.release()
    throw error
  }
  if (!extensionHandle) {
    return Object.freeze({
      extension: null,
      projection: createGenericThreeSceneProjection({ THREE, document }),
    })
  }

  try {
    const effectiveBudgets = Object.freeze(Object.fromEntries(
      Object.entries(extensionHandle.manifest.budgets).map(([key, manifestLimit]) => [
        key,
        Math.min(manifestLimit, budgets?.[key] ?? manifestLimit),
      ]),
    ))
    const projection = extensionHandle.createProjection({
      THREE,
      budgets: effectiveBudgets,
      document,
    })
    return Object.freeze({
      extension: extensionHandle.manifest,
      projection: extensionProjectionAdapter(projection, () => extensionLease.release()),
    })
  } catch (error) {
    extensionLease.release()
    throw error
  }
}
