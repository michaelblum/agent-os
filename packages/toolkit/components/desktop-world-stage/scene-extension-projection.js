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

function extensionProjectionAdapter(projection, releaseExtension) {
  let disposed = false
  return {
    object: projection.object,
    activate: (...args) => projection.activate?.apply(projection, args),
    applyAnimation: (...args) => projection.applyAnimation.apply(projection, args),
    applySignal: (...args) => projection.applySignal.apply(projection, args),
    contextLost: (...args) => projection.contextLost.apply(projection, args),
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
