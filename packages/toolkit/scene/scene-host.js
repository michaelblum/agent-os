import {
  canonicalizeSceneDocument,
  validateSceneDocument,
  validateSceneLease,
} from './scene-document.js'
import { applySceneTransaction } from './scene-transaction.js'
import {
  compileSceneAnimationBindings,
  createSceneAnimationController,
} from './scene-animation.js'
import {
  compileSceneSignalBindings,
  createSceneSignalController,
} from './scene-signal.js'

export const DEFAULT_SCENE_HOST_BUDGETS = Object.freeze({
  maxAnimationBindings: 1024,
  maxObjects: 1024,
  maxResources: 256,
  maxSignalBindings: 1024,
})
export const SCENE_INSPECTION_CONTRACT_ID = 'aos.scene.inspection.v1'

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function resolveBudgets(input = {}) {
  return Object.freeze({
    maxAnimationBindings: boundedInteger(
      input.maxAnimationBindings,
      DEFAULT_SCENE_HOST_BUDGETS.maxAnimationBindings,
      0,
      1024,
    ),
    maxObjects: boundedInteger(input.maxObjects, DEFAULT_SCENE_HOST_BUDGETS.maxObjects, 1, 1024),
    maxResources: boundedInteger(input.maxResources, DEFAULT_SCENE_HOST_BUDGETS.maxResources, 0, 256),
    maxSignalBindings: boundedInteger(
      input.maxSignalBindings,
      DEFAULT_SCENE_HOST_BUDGETS.maxSignalBindings,
      0,
      1024,
    ),
  })
}

function errorMessage() {
  return 'Scene host callback failed.'
}

function failure(code, errors) {
  return { ok: false, code, errors }
}

function hostError(code, path, message) {
  return failure(code, [{ code, path, message }])
}

function validateProjection(projection, signalBindings, animationBindings) {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return hostError('scene_projection_invalid', 'projection', 'Scene projection factory must return an object.')
  }
  if (typeof projection.dispose !== 'function') {
    return hostError('scene_projection_invalid', 'projection.dispose', 'Scene projections require deterministic disposal.')
  }
  if (signalBindings.length > 0 && typeof projection.applySignal !== 'function') {
    return hostError(
      'scene_projection_signal_unsupported',
      'projection.applySignal',
      'Scene projections with signal bindings require applySignal().',
    )
  }
  if (animationBindings.length > 0 && typeof projection.applyAnimation !== 'function') {
    return hostError(
      'scene_projection_animation_unsupported',
      'projection.applyAnimation',
      'Scene projections with animation bindings require applyAnimation().',
    )
  }
  for (const key of ['activate', 'suspend', 'resume', 'contextLost', 'applyAnimation', 'applySignal']) {
    if (projection[key] !== undefined && typeof projection[key] !== 'function') {
      return hostError('scene_projection_invalid', `projection.${key}`, `Scene projection ${key} must be a function.`)
    }
  }
  return null
}

function validateLifecycle(lifecycle) {
  if (!lifecycle) return null
  for (const key of ['start', 'suspend', 'resume', 'snapshot', 'dispose']) {
    if (typeof lifecycle[key] !== 'function') {
      return hostError('scene_lifecycle_invalid', `projection.lifecycle.${key}`, 'Scene lifecycle is incomplete.')
    }
  }
  return null
}

function validateBudget(document, budgets) {
  if (document.objects.length > budgets.maxObjects) {
    return hostError('scene_host_object_budget', 'objects', 'Scene objects exceed the host budget.')
  }
  if (document.resources.length > budgets.maxResources) {
    return hostError('scene_host_resource_budget', 'resources', 'Scene resources exceed the host budget.')
  }
  return null
}

function createSceneHost(options = {}, hooks = {}) {
  if (!options.registry || typeof options.registry.validateDocument !== 'function') {
    throw new TypeError('Scene hosts require an implementation registry.')
  }
  if (typeof options.prepareProjection !== 'function') {
    throw new TypeError('Scene hosts require a projection factory.')
  }
  const documentValidation = validateSceneDocument(options.document)
  if (!documentValidation.ok) {
    throw new TypeError(documentValidation.errors[0]?.message || 'Invalid scene document.')
  }
  const leaseValidation = validateSceneLease(options.lease)
  if (!leaseValidation.ok) throw new TypeError(leaseValidation.errors[0]?.message || 'Invalid scene lease.')
  let document = canonicalizeSceneDocument(options.document)
  if (document.id !== options.lease.resourceId) {
    throw new TypeError('Scene document ID must match the lease resource ID.')
  }

  const budgets = resolveBudgets(options.budgets)
  const hostKind = hooks.hostKind ?? 'local'
  const lease = Object.freeze({ ...options.lease })
  let status = 'idle'
  let projection = null
  let signalController = null
  let animationController = null
  let transactions = 0
  let contextLosses = 0
  let recoveries = 0
  let suspended = false
  let disposed = false
  let disposePromise = null
  const disposalErrors = []

  const setStatus = (next) => {
    status = next
    options.onStatusChange?.(next)
  }

  const disposeProjection = async (candidate) => {
    if (!candidate) return
    try {
      candidate.lifecycle?.dispose({ forceContextLoss: true })
    } catch (error) {
      disposalErrors.push({ kind: 'lifecycle', message: errorMessage(error) })
    }
    try {
      await candidate.dispose()
    } catch (error) {
      disposalErrors.push({ kind: 'projection', message: errorMessage(error) })
    }
  }

  const prepare = async (candidateDocument, reason) => {
    const budgetFailure = validateBudget(candidateDocument, budgets)
    if (budgetFailure) return budgetFailure
    const registryValidation = options.registry.validateDocument(candidateDocument)
    if (!registryValidation.ok) {
      return failure('scene_implementation_unavailable', [
        ...registryValidation.missing.map((entry) => ({
          code: 'scene_implementation_missing',
          path: entry.sourceId,
          message: `Scene implementation ${entry.id} is not registered.`,
        })),
        ...registryValidation.mismatched.map((entry) => ({
          code: 'scene_implementation_kind',
          path: entry.sourceId,
          message: `Scene implementation ${entry.id} is registered for ${entry.registeredKind}.`,
        })),
      ])
    }
    const compiledSignals = compileSceneSignalBindings(candidateDocument, {
      maxBindings: budgets.maxSignalBindings,
    })
    if (!compiledSignals.ok) return failure('scene_signal_bindings_invalid', compiledSignals.errors)
    const compiledAnimations = compileSceneAnimationBindings(candidateDocument, {
      maxBindings: budgets.maxAnimationBindings,
    })
    if (!compiledAnimations.ok) {
      return failure('scene_animation_bindings_invalid', compiledAnimations.errors)
    }
    let candidate
    try {
      candidate = await options.prepareProjection(Object.freeze({
        budgets,
        document: candidateDocument,
        hostKind,
        lease,
        reason,
        registry: options.registry,
        reportContextLost: () => api.markContextLost(),
        tickAnimation: (elapsedMs) => api.tick(elapsedMs),
      }))
    } catch (error) {
      return hostError('scene_projection_prepare_failed', 'projection', errorMessage(error))
    }
    const projectionFailure = validateProjection(
      candidate,
      compiledSignals.bindings,
      compiledAnimations.bindings,
    )
      ?? validateLifecycle(candidate?.lifecycle)
      ?? hooks.validateProjection?.(candidate)
    if (projectionFailure) {
      if (candidate?.dispose) await disposeProjection(candidate)
      return projectionFailure
    }
    return { ok: true, projection: candidate }
  }

  const activate = async (prepared, candidateDocument) => {
    try {
      await prepared.projection.activate?.()
      prepared.projection.lifecycle?.start()
      await hooks.activateProjection?.(prepared.projection, candidateDocument)
    } catch (error) {
      await disposeProjection(prepared.projection)
      return hostError('scene_projection_activate_failed', 'projection', errorMessage(error))
    }
    const previousProjection = projection
    const previousSignals = signalController
    const previousAnimations = animationController
    projection = prepared.projection
    document = candidateDocument
    signalController = createSceneSignalController(document, {
      maxBindings: budgets.maxSignalBindings,
      apply: (binding, value, input, at) => projection?.applySignal?.(binding, value, input, at),
      now: options.now,
    })
    animationController = createSceneAnimationController(document, {
      maxBindings: budgets.maxAnimationBindings,
      apply: (binding, value, elapsedMs, progress) => (
        projection?.applyAnimation?.(binding, value, elapsedMs, progress)
      ),
    })
    previousSignals?.dispose()
    previousAnimations?.dispose()
    await disposeProjection(previousProjection)
    suspended = false
    setStatus('ready')
    return { ok: true, snapshot: api.snapshot() }
  }

  const mountDocument = async (candidateDocument, reason) => {
    if (disposed) return hostError('scene_host_disposed', 'host', 'Scene host is disposed.')
    const previousStatus = status
    setStatus(reason === 'context_recovery' ? 'recovering' : 'mounting')
    const prepared = await prepare(candidateDocument, reason)
    if (!prepared.ok) {
      setStatus(reason === 'context_recovery'
        ? 'context_lost'
        : projection
          ? previousStatus
          : 'error')
      return prepared
    }
    const activated = await activate(prepared, candidateDocument)
    if (!activated.ok && projection) setStatus(previousStatus)
    return activated
  }

  const api = {
    async mount() {
      if (status === 'ready' && projection) return { ok: true, snapshot: api.snapshot() }
      return mountDocument(document, 'mount')
    },
    async transact(transaction) {
      if (disposed) return hostError('scene_host_disposed', 'host', 'Scene host is disposed.')
      if (!projection || status !== 'ready') {
        return hostError('scene_host_not_ready', 'host', 'Scene host must be ready before transactions.')
      }
      const result = applySceneTransaction(document, transaction, { lease })
      if (!result.ok) return result
      const mounted = await mountDocument(result.document, 'transaction')
      if (!mounted.ok) return mounted
      transactions += 1
      return {
        ok: true,
        document: canonicalizeSceneDocument(document),
        previousRevision: result.previousRevision,
        revision: result.revision,
        transactionId: result.transactionId,
        snapshot: api.snapshot(),
      }
    },
    publishSignal(signalId, value, at) {
      if (disposed || status !== 'ready' || suspended) return 0
      return signalController?.publish(signalId, value, at) ?? 0
    },
    tick(elapsedMs) {
      if (disposed || status !== 'ready' || suspended) return 0
      return animationController?.tick(elapsedMs) ?? 0
    },
    suspend() {
      if (disposed || !projection || suspended) return api.snapshot()
      projection.lifecycle?.suspend()
      projection.suspend?.()
      suspended = true
      setStatus('suspended')
      return api.snapshot()
    },
    resume() {
      if (disposed || !projection || !suspended) return api.snapshot()
      projection.resume?.()
      projection.lifecycle?.resume()
      suspended = false
      setStatus('ready')
      return api.snapshot()
    },
    markContextLost() {
      if (disposed || !projection || status === 'context_lost') return api.snapshot()
      contextLosses += 1
      projection.lifecycle?.suspend()
      projection.contextLost?.()
      suspended = true
      setStatus('context_lost')
      return api.snapshot()
    },
    async recoverContext() {
      if (disposed) return hostError('scene_host_disposed', 'host', 'Scene host is disposed.')
      if (status !== 'context_lost') {
        return hostError('scene_context_available', 'host', 'Scene context is not lost.')
      }
      const result = await mountDocument(document, 'context_recovery')
      if (!result.ok) return result
      recoveries += 1
      return { ...result, snapshot: api.snapshot() }
    },
    inspect() {
      const registry = options.registry.validateDocument(document)
      return {
        contract: SCENE_INSPECTION_CONTRACT_ID,
        hostKind,
        lease,
        status,
        revision: document.revision,
        rootObjectId: document.rootObjectId,
        objects: document.objects.map(({ id, parentId, kind, visible }) => ({ id, parentId, kind, visible })),
        resources: document.resources.map(({ id, kind, implementation, asset }) => ({
          id,
          kind,
          implementation,
          asset: asset ? { sha256: asset.sha256, mediaType: asset.mediaType, bytes: asset.bytes } : null,
        })),
        metadataKeys: Object.keys(document.metadata).sort(),
        implementations: {
          missing: registry.missing.map(({ id, kind }) => ({ id, kind })),
          mismatched: registry.mismatched.map(({ id, kind, registeredKind }) => ({
            id,
            kind,
            registeredKind,
          })),
        },
        signals: signalController?.snapshot() ?? {
          bindings: [], disposed: false, failures: 0, publications: 0,
        },
        animations: animationController?.snapshot() ?? {
          bindings: [], disposed: false, failures: 0, frames: 0,
        },
        lifecycle: projection?.lifecycle?.snapshot?.() ?? null,
      }
    },
    snapshot() {
      return {
        hostKind,
        status,
        disposed,
        suspended,
        revision: document.revision,
        objects: document.objects.length,
        resources: document.resources.length,
        budgets,
        transactions,
        contextLosses,
        recoveries,
        signalPublications: signalController?.snapshot().publications ?? 0,
        signalFailures: signalController?.snapshot().failures ?? 0,
        animationFrames: animationController?.snapshot().frames ?? 0,
        animationFailures: animationController?.snapshot().failures ?? 0,
        disposalErrors: disposalErrors.map((entry) => ({ ...entry })),
      }
    },
    async dispose() {
      if (disposePromise) return disposePromise
      disposePromise = (async () => {
        disposed = true
        signalController?.dispose()
        signalController = null
        animationController?.dispose()
        animationController = null
        await disposeProjection(projection)
        projection = null
        try {
          await hooks.disposeHost?.()
        } catch (error) {
          disposalErrors.push({ kind: 'host', message: errorMessage(error) })
        }
        suspended = false
        setStatus('disposed')
        return api.snapshot()
      })()
      return disposePromise
    },
  }
  return Object.freeze(api)
}

export function createLocalSceneViewportHost(options = {}) {
  return createSceneHost(options, { hostKind: 'local' })
}

export function createDesktopWorldSceneHost(options = {}) {
  const surface = options.surface
  if (!surface || typeof surface.start !== 'function' || typeof surface.mountScene !== 'function' || typeof surface.stop !== 'function') {
    throw new TypeError('DesktopWorld scene hosts require a DesktopWorld surface adapter.')
  }
  let started = false
  return createSceneHost(options, {
    hostKind: 'desktop-world',
    validateProjection(projection) {
      if (!projection.scene || !projection.renderer) {
        return hostError(
          'scene_desktop_projection_invalid',
          'projection',
          'DesktopWorld projections require a scene and renderer.',
        )
      }
      return null
    },
    async activateProjection(projection) {
      if (!started) {
        await surface.start(options.surfaceHandlers)
        started = true
      }
      surface.mountScene({
        scene: projection.scene,
        camera: projection.camera ?? null,
        renderer: projection.renderer ?? null,
        manageViewport: projection.manageViewport !== false,
      })
      surface.refreshViewport?.()
    },
    async disposeHost() {
      if (!started) return
      surface.stop()
      started = false
    },
  })
}
