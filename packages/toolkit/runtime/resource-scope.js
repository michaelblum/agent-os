// resource-scope.js — deterministic ownership tracking for toolkit runtime resources.

import { removeCanvas } from './canvas.js'
import { removeInputRegion } from './input-region.js'
import { unsubscribe as unsubscribeEvents } from './subscribe.js'

function cleanId(value) {
  const id = String(value || '').trim()
  return id || null
}

function uniqueList(values = []) {
  return [...new Set(values.filter(Boolean))]
}

function eventList(events = []) {
  return uniqueList((Array.isArray(events) ? events : [events]).map(cleanId))
}

async function runCleanup(callback, resource) {
  if (typeof callback !== 'function') return false
  await callback(resource)
  return true
}

function normalizeResource(kind, id, options = {}) {
  const resourceId = cleanId(id)
  if (!resourceId) throw new Error(`ResourceScope ${kind} requires id`)
  return {
    kind,
    id: resourceId,
    remove: options.remove,
    cleanupOrder: Number.isFinite(Number(options.cleanupOrder)) ? Number(options.cleanupOrder) : null,
    metadata: options.metadata && typeof options.metadata === 'object'
      ? { ...options.metadata }
      : {},
  }
}

export function createResourceScope({
  id,
  ownerCanvasId = null,
  active = true,
} = {}) {
  const scopeId = cleanId(id)
  if (!scopeId) throw new Error('ResourceScope requires id')

  let isActive = Boolean(active)
  let cleanupStarted = false
  let cleanupComplete = false
  let cleanupPromise = null
  const childCanvases = []
  const stageLayers = []
  const inputRegions = []
  const subscriptions = []
  const customCleanups = []
  const bridgeHandlers = []
  const cleanupStatus = {
    removedChildCanvases: false,
    removedStageLayers: false,
    removedInputRegions: false,
    unsubscribed: false,
    retainedSubscriptions: false,
    ranCustomCleanups: false,
    errors: [],
  }

  function state(extra = {}) {
    const subscriptionEventsUnsubscribed = uniqueList(
      subscriptions
        .filter((entry) => entry.cleaned === 'unsubscribed')
        .flatMap((entry) => entry.events),
    )
    const subscriptionEventsRetained = uniqueList(
      subscriptions
        .filter((entry) => entry.cleaned === 'retained')
        .flatMap((entry) => entry.events),
    )
    return {
      id: scopeId,
      scopeId,
      ownerCanvasId,
      childCanvasIds: childCanvases.map((entry) => entry.id),
      stageLayerIds: stageLayers.map((entry) => entry.id),
      inputRegionIds: inputRegions.map((entry) => entry.id),
      subscriptionEvents: uniqueList(subscriptions.flatMap((entry) => entry.events)),
      subscriptionEventsRetained,
      subscriptionEventsUnsubscribed,
      bridgeHandlerCount: bridgeHandlers.length,
      cleanupStarted,
      cleanupComplete,
      cleanupStatus: {
        ...cleanupStatus,
        errors: cleanupStatus.errors.map((error) => ({ ...error })),
      },
      active: isActive,
      ...extra,
    }
  }

  function addChildCanvas(id, options = {}) {
    const resource = normalizeResource('childCanvas', id, {
      remove: options.remove || ((entry) => removeCanvas(entry.id, options.removeOptions || {})),
      metadata: options.metadata,
    })
    resource.owned = options.owned !== false
    childCanvases.push(resource)
    return resource.id
  }

  function addStageLayer(id, options = {}) {
    const resource = normalizeResource('stageLayer', id, options)
    stageLayers.push(resource)
    return resource.id
  }

  function addInputRegion(id, options = {}) {
    const resource = normalizeResource('inputRegion', id, {
      remove: options.remove || ((entry) => removeInputRegion(entry.id)),
      cleanupOrder: options.cleanupOrder,
      metadata: options.metadata,
    })
    inputRegions.push(resource)
    return resource.id
  }

  function addSubscription(events, options = {}) {
    const normalizedEvents = eventList(events)
    if (!normalizedEvents.length) return []
    subscriptions.push({
      events: normalizedEvents,
      unsubscribe: options.unsubscribe || unsubscribeEvents,
      exclusive: Boolean(options.exclusive),
      cleaned: null,
    })
    return normalizedEvents
  }

  function addBridgeHandler(wire, handler) {
    if (typeof wire !== 'function' || typeof handler !== 'function') return false
    const entry = { active: true }
    bridgeHandlers.push(entry)
    wire((message) => {
      if (!isActive || !entry.active) return
      handler(message)
    })
    return true
  }

  function addCleanup(id, callback) {
    const cleanupId = cleanId(id) || `cleanup-${customCleanups.length + 1}`
    if (typeof callback !== 'function') return cleanupId
    customCleanups.push({ id: cleanupId, callback })
    return cleanupId
  }

  async function cleanup() {
    if (cleanupPromise) return cleanupPromise
    cleanupStarted = true
    isActive = false
    for (const entry of bridgeHandlers) entry.active = false
    cleanupPromise = (async () => {
      const orderedInputRegions = [...inputRegions].sort((a, b) => {
        if (a.cleanupOrder == null && b.cleanupOrder == null) return 0
        if (a.cleanupOrder == null) return 1
        if (b.cleanupOrder == null) return -1
        return a.cleanupOrder - b.cleanupOrder
      })
      for (const resource of orderedInputRegions) {
        try {
          if (await runCleanup(resource.remove, resource)) cleanupStatus.removedInputRegions = true
        } catch (error) {
          cleanupStatus.errors.push({ kind: 'inputRegion', id: resource.id, message: String(error?.message || error) })
        }
      }

      for (const resource of [...stageLayers].reverse()) {
        try {
          if (await runCleanup(resource.remove, resource)) cleanupStatus.removedStageLayers = true
        } catch (error) {
          cleanupStatus.errors.push({ kind: 'stageLayer', id: resource.id, message: String(error?.message || error) })
        }
      }

      for (const resource of [...childCanvases].reverse()) {
        if (resource.owned === false) continue
        try {
          if (await runCleanup(resource.remove, resource)) cleanupStatus.removedChildCanvases = true
        } catch (error) {
          cleanupStatus.errors.push({ kind: 'childCanvas', id: resource.id, message: String(error?.message || error) })
        }
      }

      for (const subscription of subscriptions) {
        if (subscription.exclusive) {
          try {
            subscription.unsubscribe(subscription.events)
            subscription.cleaned = 'unsubscribed'
            cleanupStatus.unsubscribed = true
          } catch (error) {
            cleanupStatus.errors.push({ kind: 'subscription', id: subscription.events.join(','), message: String(error?.message || error) })
          }
        } else {
          subscription.cleaned = 'retained'
          cleanupStatus.retainedSubscriptions = true
        }
      }

      for (const entry of [...customCleanups].reverse()) {
        try {
          await entry.callback()
          cleanupStatus.ranCustomCleanups = true
        } catch (error) {
          cleanupStatus.errors.push({ kind: 'cleanup', id: entry.id, message: String(error?.message || error) })
        }
      }
      cleanupComplete = true
      return state()
    })()
    return cleanupPromise
  }

  return {
    id: scopeId,
    activate() {
      if (!cleanupStarted) isActive = true
      return state()
    },
    deactivate() {
      isActive = false
      return state()
    },
    addChildCanvas,
    adoptChildCanvas: addChildCanvas,
    addStageLayer,
    addInputRegion,
    addSubscription,
    addBridgeHandler,
    addCleanup,
    cleanup,
    getState: state,
  }
}
