import {
  canonicalizeSceneDocument,
  createSceneLease,
  validateSceneTransaction,
} from './scene-document.js'
import { applySceneTransaction } from './scene-transaction.js'
import { validateSceneInteractionDocument } from './scene-interaction.js'
import { validateSceneExtensionReference } from './scene-extension.js'
import { normalizeDesktopWorldSceneEvent } from './desktop-world-client.js'
import {
  isCanonicalSceneId,
  isSceneRecord,
} from './scene-contract-primitives.js'

export const DESKTOP_WORLD_SCENE_SESSION_CONTRACT_ID = 'aos.desktop-world.scene-session.snapshot.v1'
export const DESKTOP_WORLD_SCENE_SESSION_EVENT_NAMES = Object.freeze(['gesture'])
export const DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES = Object.freeze([
  'AOS_COMMAND_FAILED',
  'AOS_SCENE_TRANSPORT_CLOSED',
  'SCENE_OWNER_DISCONNECTED',
  'SCENE_RENDER_FAILED',
  'SCENE_SEGMENT_DIVERGED',
  'SCENE_SEGMENT_FAILED',
  'SCENE_SEGMENT_TIMEOUT',
  'SCENE_STAGE_REMOVED',
  'SCENE_STAGE_RETIRED',
  'SCENE_STAGE_UNAVAILABLE',
  'SCENE_TOPOLOGY_CHANGED',
  'SCENE_TRANSPORT_CLOSED',
])
export const DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES = Object.freeze([
  'AOS_EVENT_RATE_LIMIT',
  'AOS_INVALID_NDJSON',
  'AOS_INVALID_SCENE_EVENT',
  'AOS_LINE_LIMIT',
  'AOS_SCENE_CONSUMER_FAILED',
  'AOS_STDERR_LIMIT',
  'AOS_UNEXPECTED_SCENE_EVENT',
  'SCENE_SESSION_INVALID_EVENT',
  'SCENE_SESSION_INVALID_RESULT',
  'SCENE_STAGE_RETIRE_FAILED',
])

const RECOVERABLE_CODES = new Set(DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES)
const TERMINAL_CODES = new Set(DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES)
const SIGNAL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u
const ANIMATION_ID = /^[a-z0-9][a-z0-9._/-]{0,127}$/u
const OPERATION_NAMES = new Set([
  'mount', 'transact', 'signal', 'play', 'suspend', 'resume', 'inspect',
  'subscribe', 'unsubscribe', 'remove', 'close',
])

function sceneSessionError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  return error
}

function errorCode(error, fallback = 'SCENE_SESSION_FAILED') {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/u.test(error.code)
    ? error.code
    : fallback
}

function cloneFiniteJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function validateIdentity(options) {
  if (options.stageId !== 'desktop-world/main') {
    throw sceneSessionError('INVALID_SCENE_STAGE', 'DesktopWorld scene sessions require desktop-world/main.')
  }
  if (!isCanonicalSceneId(options.ownerId) || options.ownerId.includes('/')) {
    throw sceneSessionError('INVALID_SCENE_OWNER', 'DesktopWorld scene owner is invalid.')
  }
  if (!isCanonicalSceneId(options.resourceId)) {
    throw sceneSessionError('INVALID_SCENE_RESOURCE', 'DesktopWorld scene resource is invalid.')
  }
  if (typeof options.connect !== 'function') {
    throw sceneSessionError('INVALID_SCENE_TRANSPORT', 'DesktopWorld scene sessions require a transport factory.')
  }
}

function validateTransport(value) {
  if (!isSceneRecord(value)
      || typeof value.send !== 'function'
      || typeof value.subscribe !== 'function'
      || typeof value.close !== 'function'
      || !value.completed
      || typeof value.completed.then !== 'function') {
    throw sceneSessionError(
      'INVALID_SCENE_TRANSPORT',
      'Scene transport must expose send, subscribe, close, and completed.',
    )
  }
  return value
}

function normalizeOperationResult(value, operation, resourceId) {
  if (!isSceneRecord(value)
      || value.operation !== operation
      || value.resource !== resourceId
      || value.status !== 'ok'
      || !OPERATION_NAMES.has(value.operation)) {
    throw sceneSessionError(
      'SCENE_SESSION_INVALID_RESULT',
      'Scene transport returned inconsistent operation metadata.',
    )
  }
  if (value.snapshot !== undefined && !isSceneRecord(value.snapshot)) {
    throw sceneSessionError('SCENE_SESSION_INVALID_RESULT', 'Scene operation snapshot is invalid.')
  }
  if (value.events !== undefined
      && (!Array.isArray(value.events)
        || value.events.some((event) => !DESKTOP_WORLD_SCENE_SESSION_EVENT_NAMES.includes(event)))) {
    throw sceneSessionError('SCENE_SESSION_INVALID_RESULT', 'Scene subscription metadata is invalid.')
  }
  return Object.freeze({
    operation,
    resource: resourceId,
    status: 'ok',
    ...(value.snapshot === undefined ? {} : { snapshot: Object.freeze({ ...value.snapshot }) }),
    ...(value.events === undefined ? {} : { events: Object.freeze([...new Set(value.events)]) }),
  })
}

function normalizeMountInput(input, resourceId) {
  if (!isSceneRecord(input)) {
    throw sceneSessionError('INVALID_SCENE_MOUNT', 'Scene mount input must be an object.')
  }
  const allowed = new Set(['document', 'extension', 'interactions'])
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw sceneSessionError('INVALID_SCENE_MOUNT', 'Scene mount input contains unknown fields.')
  }
  let document
  try {
    document = canonicalizeSceneDocument(input.document)
  } catch (cause) {
    throw sceneSessionError('INVALID_SCENE_DOCUMENT', 'Scene mount document is invalid.', cause)
  }
  if (document.id !== resourceId) {
    throw sceneSessionError('INVALID_SCENE_RESOURCE', 'Scene document ID must match the session resource.')
  }
  const interactions = input.interactions === undefined
    ? undefined
    : cloneFiniteJson(input.interactions)
  if (interactions !== undefined) {
    const validation = validateSceneInteractionDocument(interactions, { scene: document })
    if (!validation.ok) {
      throw sceneSessionError(
        'INVALID_SCENE_INTERACTIONS',
        validation.errors[0]?.message ?? 'Scene interaction document is invalid.',
      )
    }
  }
  const extension = input.extension === undefined
    ? undefined
    : cloneFiniteJson(input.extension)
  if (extension !== undefined) {
    const validation = validateSceneExtensionReference(extension)
    if (!validation.ok) {
      throw sceneSessionError(
        'INVALID_SCENE_EXTENSION',
        validation.errors[0]?.message ?? 'Scene extension reference is invalid.',
      )
    }
  }
  return Object.freeze({
    document,
    ...(interactions === undefined ? {} : { interactions }),
    ...(extension === undefined ? {} : { extension }),
  })
}

function mountOperation(mount) {
  return {
    op: 'mount',
    document: mount.document,
    ...(mount.interactions === undefined ? {} : { interactions: mount.interactions }),
    ...(mount.extension === undefined ? {} : { extension: mount.extension }),
  }
}

function recoverable(error) {
  const code = errorCode(error, '')
  return code === '' || RECOVERABLE_CODES.has(code)
}

function terminal(error) {
  return TERMINAL_CODES.has(errorCode(error, ''))
}

export function createDesktopWorldSceneSession(input = {}) {
  const identity = Object.freeze({
    stageId: input.stageId ?? 'desktop-world/main',
    ownerId: input.ownerId,
    resourceId: input.resourceId,
  })
  validateIdentity({ ...identity, connect: input.connect })

  let status = 'idle'
  let generation = 0
  let transport = null
  let committedMount = null
  let suspended = false
  let recoveryAttempts = 0
  let lastErrorCode = null
  let listenerErrors = 0
  let lastEventSequence = 0
  let queue = Promise.resolve()
  const listeners = new Map()
  const transportUnsubscribers = new Map()

  const snapshot = () => Object.freeze({
    contract: DESKTOP_WORLD_SCENE_SESSION_CONTRACT_ID,
    stageId: identity.stageId,
    ownerId: identity.ownerId,
    resourceId: identity.resourceId,
    status,
    generation,
    mounted: committedMount !== null,
    committedRevision: committedMount?.document.revision ?? null,
    suspended,
    subscriptions: Object.freeze([...listeners.keys()].sort()),
    recoveryAttempts,
    lastErrorCode,
    listenerErrors,
  })

  const enqueue = (work) => {
    const task = queue.then(work, work)
    queue = task.catch(() => {})
    return task
  }

  const markFault = async (error) => {
    lastErrorCode = errorCode(error)
    status = 'faulted'
    const retiring = transport
    transport = null
    transportUnsubscribers.clear()
    if (retiring) {
      try { await retiring.close() } catch {}
    }
    return sceneSessionError('SCENE_SESSION_FAULTED', 'DesktopWorld scene session faulted.', error)
  }

  const dispatchEvent = (event, eventName, eventGeneration) => {
    if (eventGeneration !== generation || status === 'closed' || status === 'faulted') return
    let canonical
    try {
      canonical = normalizeDesktopWorldSceneEvent(event)
      if (canonical.type !== eventName
          || canonical.stageId !== identity.stageId
          || canonical.ownerId !== identity.ownerId
          || canonical.resourceId !== identity.resourceId
          || canonical.sequence <= lastEventSequence) {
        throw sceneSessionError('SCENE_SESSION_INVALID_EVENT', 'Scene event identity or sequence is invalid.')
      }
    } catch (error) {
      void enqueue(async () => { throw await markFault(error) }).catch(() => {})
      return
    }
    lastEventSequence = canonical.sequence
    for (const listener of listeners.get(eventName) ?? []) {
      try { listener(canonical) } catch { listenerErrors += 1 }
    }
  }

  const attachSubscription = async (eventName, candidate = transport, eventGeneration = generation) => {
    if (!candidate) throw sceneSessionError('SCENE_SESSION_NOT_OPEN', 'Scene transport is unavailable.')
    const unsubscribe = await candidate.subscribe(
      eventName,
      (event) => dispatchEvent(event, eventName, eventGeneration),
    )
    if (typeof unsubscribe !== 'function') {
      throw sceneSessionError('INVALID_SCENE_TRANSPORT', 'Scene transport subscription did not return cleanup.')
    }
    if (candidate !== transport || eventGeneration !== generation) {
      try { await unsubscribe() } catch {}
      return
    }
    transportUnsubscribers.set(eventName, unsubscribe)
  }

  const observeCompletion = (candidate, candidateGeneration) => {
    const settle = (reason) => {
      void enqueue(async () => {
        if (candidate !== transport || candidateGeneration !== generation) return
        if (status === 'closing' || status === 'closed') return
        if (terminal(reason)) throw await markFault(reason)
        await recover(reason)
      }).catch(() => {})
    }
    Promise.resolve(candidate.completed).then(settle, settle)
  }

  const connect = async (nextStatus) => {
    status = nextStatus
    const nextGeneration = generation + 1
    let candidate
    try {
      candidate = validateTransport(await input.connect(Object.freeze({
        ...identity,
        generation: nextGeneration,
      })))
    } catch (error) {
      throw await markFault(error)
    }
    generation = nextGeneration
    lastEventSequence = 0
    transport = candidate
    observeCompletion(candidate, generation)
    return candidate
  }

  const rawSend = async (candidate, operation) => normalizeOperationResult(
    await candidate.send(operation),
    operation.op,
    identity.resourceId,
  )

  const recover = async (cause) => {
    if (status === 'closed' || status === 'closing') return snapshot()
    if (status === 'faulted') throw sceneSessionError('SCENE_SESSION_FAULTED', 'Scene session is faulted.', cause)
    if (recoveryAttempts >= 1) throw await markFault(cause)
    recoveryAttempts += 1
    lastErrorCode = errorCode(cause, 'SCENE_TRANSPORT_CLOSED')
    const previous = transport
    transport = null
    transportUnsubscribers.clear()
    if (previous) {
      try { await previous.close() } catch {}
    }
    const candidate = await connect('recovering')
    try {
      if (committedMount) await rawSend(candidate, mountOperation(committedMount))
      for (const eventName of [...listeners.keys()].sort()) {
        await attachSubscription(eventName, candidate, generation)
      }
      if (committedMount && suspended) await rawSend(candidate, { op: 'suspend' })
      status = 'ready'
      return snapshot()
    } catch (error) {
      throw await markFault(error)
    }
  }

  const ensureReady = async () => {
    if (status === 'closed' || status === 'closing') {
      throw sceneSessionError('SCENE_SESSION_CLOSED', 'Scene session is closed.')
    }
    if (status === 'faulted') {
      throw sceneSessionError('SCENE_SESSION_FAULTED', 'Scene session is faulted.')
    }
    if (!transport) {
      await connect('connecting')
      status = 'ready'
    }
    return transport
  }

  const send = async (operation) => {
    const candidate = await ensureReady()
    try {
      return await rawSend(candidate, operation)
    } catch (error) {
      if (candidate !== transport || recoverable(error)) {
        await recover(error)
        throw sceneSessionError(
          'SCENE_OPERATION_UNCERTAIN',
          `Scene ${operation.op} outcome is uncertain and was not replayed.`,
          error,
        )
      }
      if (terminal(error)) throw await markFault(error)
      throw error
    }
  }

  const api = {
    async open() {
      return enqueue(async () => {
        await ensureReady()
        return snapshot()
      })
    },
    async mount(mountInput) {
      return enqueue(async () => {
        const candidate = normalizeMountInput(mountInput, identity.resourceId)
        const result = await send(mountOperation(candidate))
        committedMount = candidate
        suspended = false
        return result
      })
    },
    async transact(transaction) {
      return enqueue(async () => {
        if (!committedMount) {
          throw sceneSessionError('SCENE_SESSION_NOT_MOUNTED', 'Scene transactions require a committed mount.')
        }
        const validation = validateSceneTransaction(transaction)
        if (!validation.ok) {
          throw sceneSessionError(
            'INVALID_SCENE_TRANSACTION',
            validation.errors[0]?.message ?? 'Scene transaction is invalid.',
          )
        }
        const lease = createSceneLease({
          ...identity,
          scopeId: `session.${generation || 1}`,
        })
        const applied = applySceneTransaction(committedMount.document, transaction, { lease })
        if (!applied.ok) {
          throw sceneSessionError(
            'SCENE_TRANSACTION_REJECTED',
            applied.errors[0]?.message ?? 'Scene transaction was rejected.',
          )
        }
        const result = await send({ op: 'transact', transaction, lease })
        committedMount = Object.freeze({ ...committedMount, document: applied.document })
        return result
      })
    },
    async signal(signalId, value, at) {
      return enqueue(async () => {
        if (typeof signalId !== 'string' || !SIGNAL_ID.test(signalId)
            || !Number.isFinite(value)
            || (at !== undefined && (!Number.isFinite(at) || at < 0))) {
          throw sceneSessionError('INVALID_SCENE_SIGNAL', 'Scene signal is invalid.')
        }
        return send({ op: 'signal', signalId, value, ...(at === undefined ? {} : { at }) })
      })
    },
    async play(animationId) {
      return enqueue(async () => {
        if (animationId !== undefined && (typeof animationId !== 'string' || !ANIMATION_ID.test(animationId))) {
          throw sceneSessionError('INVALID_SCENE_ANIMATION', 'Scene animation ID is invalid.')
        }
        return send({ op: 'play', ...(animationId === undefined ? {} : { animationId }) })
      })
    },
    async suspend() {
      return enqueue(async () => {
        const result = await send({ op: 'suspend' })
        suspended = true
        return result
      })
    },
    async resume() {
      return enqueue(async () => {
        const result = await send({ op: 'resume' })
        suspended = false
        return result
      })
    },
    async inspect() {
      return enqueue(() => send({ op: 'inspect' }))
    },
    async subscribe(eventName, listener) {
      return enqueue(async () => {
        if (!DESKTOP_WORLD_SCENE_SESSION_EVENT_NAMES.includes(eventName) || typeof listener !== 'function') {
          throw sceneSessionError('INVALID_SCENE_SUBSCRIPTION', 'Scene subscription is invalid.')
        }
        await ensureReady()
        let eventListeners = listeners.get(eventName)
        const first = !eventListeners
        if (!eventListeners) {
          eventListeners = new Set()
          listeners.set(eventName, eventListeners)
        }
        eventListeners.add(listener)
        try {
          if (first) await attachSubscription(eventName)
        } catch (error) {
          if (recoverable(error)) {
            try {
              await recover(error)
            } catch (recoveryError) {
              eventListeners.delete(listener)
              if (eventListeners.size === 0) listeners.delete(eventName)
              throw recoveryError
            }
          } else {
            eventListeners.delete(listener)
            if (eventListeners.size === 0) listeners.delete(eventName)
            if (terminal(error)) throw await markFault(error)
            throw error
          }
        }
        let active = true
        return async () => enqueue(async () => {
          if (!active) return snapshot()
          active = false
          const current = listeners.get(eventName)
          current?.delete(listener)
          if (current && current.size > 0) return snapshot()
          listeners.delete(eventName)
          const unsubscribe = transportUnsubscribers.get(eventName)
          transportUnsubscribers.delete(eventName)
          if (unsubscribe) {
            try { await unsubscribe() }
            catch (error) {
              if (recoverable(error)) await recover(error)
              else if (terminal(error)) throw await markFault(error)
              else throw error
            }
          }
          return snapshot()
        })
      })
    },
    async remove() {
      return enqueue(async () => {
        const result = await send({ op: 'remove' })
        committedMount = null
        suspended = false
        return result
      })
    },
    async close() {
      return enqueue(async () => {
        if (status === 'closed') return snapshot()
        status = 'closing'
        const candidate = transport
        transport = null
        transportUnsubscribers.clear()
        let failure = null
        if (candidate) {
          try { await rawSend(candidate, { op: 'close' }) } catch (error) { failure = error }
          try { await candidate.close() } catch (error) { failure ??= error }
        }
        listeners.clear()
        committedMount = null
        suspended = false
        status = 'closed'
        if (failure) throw sceneSessionError('SCENE_SESSION_CLOSE_FAILED', 'Scene session cleanup failed.', failure)
        return snapshot()
      })
    },
    snapshot,
  }

  return Object.freeze(api)
}
