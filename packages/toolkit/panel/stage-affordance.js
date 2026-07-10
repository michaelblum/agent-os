// stage-affordance.js — bind passive DesktopWorld stage visuals to daemon input regions.

import { registerInputRegion, removeInputRegion } from '../runtime/input-region.js'
import { normalizeCanvasInputMessage } from '../runtime/input-events.js'
import { createResourceScope } from '../runtime/resource-scope.js'
import { wireBridge } from '../runtime/bridge.js'
import { subscribe, unsubscribe } from '../runtime/subscribe.js'
import { spawnChild } from '../runtime/canvas.js'
import {
  defaultDesktopWorldStageUrl,
  ensureDesktopWorldStage,
  sendDesktopWorldStageLayer,
} from './drag-transfer.js'

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function cloneFrame(frame = []) {
  return [
    Math.round(finiteNumber(frame[0], 0)),
    Math.round(finiteNumber(frame[1], 0)),
    Math.round(Math.max(1, finiteNumber(frame[2], 1))),
    Math.round(Math.max(1, finiteNumber(frame[3], 1))),
  ]
}

export function stageAffordanceRegionId(affordanceId, name) {
  return `${affordanceId}:${name}`
}

export function insetFrame(frame, {
  insetLeft = 0,
  insetRight = 0,
  insetTop = 0,
  insetBottom = 0,
} = {}) {
  const source = cloneFrame(frame)
  const x = source[0] + finiteNumber(insetLeft, 0)
  const y = source[1] + finiteNumber(insetTop, 0)
  const w = Math.max(1, source[2] - finiteNumber(insetLeft, 0) - finiteNumber(insetRight, 0))
  const h = Math.max(1, source[3] - finiteNumber(insetTop, 0) - finiteNumber(insetBottom, 0))
  return [x, y, w, h]
}

function normalizeLayer(layer = {}) {
  const id = String(layer.id || '').trim()
  if (!id) return null
  return {
    ...layer,
    id,
    frame: cloneFrame(layer.frame || layer.rect || layer.bounds),
    metadata: layer.metadata && typeof layer.metadata === 'object' ? { ...layer.metadata } : {},
  }
}

function normalizeRegion(region = {}, common = {}) {
  const id = String(region.id || '').trim()
  if (!id) return null
  return {
    ...common,
    ...region,
    id,
    frame: cloneFrame(region.frame),
    metadata: {
      ...(common.metadata || {}),
      ...(region.metadata || {}),
    },
  }
}

function normalizedInputRegionEvent(message = {}) {
  const input = normalizeCanvasInputMessage(message)
  return input?.envelopeType === 'input_region.event' ? input : null
}

function lifecycleCanvasRemoved(message = {}) {
  const payload = message?.payload || message?.data || message
  const type = message?.type || payload?.type
  if (type !== 'canvas_lifecycle') return null
  const action = payload?.action || payload?.canvas?.action || null
  if (action !== 'removed') return null
  return payload?.canvas_id || payload?.id || payload?.canvas?.id || null
}

function cleanupRegionOrder(cleanupRegionIds, regionId) {
  if (!Array.isArray(cleanupRegionIds)) return null
  const index = cleanupRegionIds.indexOf(regionId)
  return index >= 0 ? index : null
}

function normalizeStageEnsureStatus(result, { id, url } = {}) {
  if (result && typeof result === 'object' && 'ok' in result) {
    return {
      ok: Boolean(result.ok),
      status: result.status || (result.ok ? 'ready' : 'unavailable'),
      id: result.id || id,
      url: result.url || url,
      created: Boolean(result.created),
      error: result.error || null,
    }
  }
  if (result === true) {
    return {
      ok: true,
      status: 'ready',
      id,
      url,
      created: false,
      error: null,
    }
  }
  return {
    ok: false,
    status: result == null ? 'unknown' : 'unavailable',
    id,
    url,
    created: false,
    error: null,
  }
}

export function isStageAffordanceInputEvent(state = {}, message = {}) {
  const regionId = normalizedInputRegionEvent(message)?.regionId
  if (!regionId) return false
  const regionIds = state.regionIds || []
  return regionIds.includes(regionId)
}

export function createStageAffordance({
  id,
  ownerCanvasId,
  sourceCanvasId = ownerCanvasId,
  targetCanvasId = 'aos-desktop-world-stage',
  mode = 'stage',
  layer,
  regions = [],
  cleanupRegionIds = null,
  stageCanvasId = targetCanvasId,
  stageUrl = defaultDesktopWorldStageUrl,
  createStage = spawnChild,
  ensureStage = ensureDesktopWorldStage,
  sendStageMessage = (message) => sendDesktopWorldStageLayer(stageCanvasId, message),
  registerRegion = registerInputRegion,
  removeRegion = removeInputRegion,
  wire = wireBridge,
  subscribeEvents = subscribe,
  unsubscribeEvents = unsubscribe,
  lifecycleEvents = ['canvas_lifecycle'],
  unsubscribeOnCleanup = false,
  onInputRegionEvent = null,
  onSourceRemoved = null,
} = {}) {
  const affordanceId = String(id || '').trim()
  const normalizedLayer = normalizeLayer(layer || { id: affordanceId, frame: [0, 0, 1, 1] })
  const normalizedRegions = regions
    .map((region) => normalizeRegion(region, {
      owner_canvas_id: ownerCanvasId,
      coordinate_space: 'native',
      remove_on_owner_suspend: false,
      enabled: true,
      metadata: {
        toolkit_affordance_id: affordanceId,
      },
    }))
    .filter(Boolean)

  if (!affordanceId) throw new Error('StageAffordance requires id')
  if (!ownerCanvasId) throw new Error('StageAffordance requires ownerCanvasId')
  if (!normalizedLayer) throw new Error('StageAffordance requires a layer id')
  normalizedLayer.metadata = {
    ...normalizedLayer.metadata,
    toolkit_affordance_id: affordanceId,
    resource_scope_id: affordanceId,
    owner_canvas_id: ownerCanvasId,
    source_canvas_id: sourceCanvasId,
    target_canvas_id: stageCanvasId,
    stage_affordance_mode: mode,
  }

  let setupComplete = false
  let cleanupComplete = false
  let registeredRegionIds = []
  let handlerInstalled = false
  let stageEnsureStatus = null
  let stageLayerUpsertSent = false
  const scope = createResourceScope({
    id: affordanceId,
    ownerCanvasId,
    active: false,
  })

  function state(extra = {}) {
    const scopeState = scope.getState()
    return {
      id: affordanceId,
      layerIds: [normalizedLayer.id],
      regionIds: normalizedRegions.map((region) => region.id),
      registeredRegionIds: [...registeredRegionIds],
      ownerCanvasId,
      sourceCanvasId,
      targetCanvasId: stageCanvasId,
      mode,
      stageEnsureStatus,
      stageLayerUpsertSent,
      setupComplete,
      cleanupStarted: scopeState.cleanupStarted,
      cleanupComplete,
      cleanupStatus: {
        removedRegions: Boolean(scopeState.cleanupStatus.removedInputRegions),
        removedLayer: Boolean(scopeState.cleanupStatus.removedStageLayers),
        unsubscribed: Boolean(scopeState.cleanupStatus.unsubscribed),
        subscriptionRetained: Boolean(scopeState.cleanupStatus.retainedSubscriptions),
        errors: scopeState.cleanupStatus.errors,
      },
      active: scopeState.active,
      resourceScope: scopeState,
      ...extra,
    }
  }

  function installBridgeHandler() {
    if (handlerInstalled) return
    if (typeof window === 'undefined') return
    handlerInstalled = true
    scope.addBridgeHandler(wire, (message) => {
      const sourceRemoved = lifecycleCanvasRemoved(message)
      if (sourceRemoved && sourceRemoved === sourceCanvasId) {
        onSourceRemoved?.({ affordance: api, message, state: state() })
        return
      }
      const input = normalizedInputRegionEvent(message)
      if (!input || !state().regionIds.includes(input.regionId)) return
      onInputRegionEvent?.({ affordance: api, message, input, phase: input.phase, state: state() })
    })
  }

  async function setup() {
    if (setupComplete) return state()
    scope.activate()
    installBridgeHandler()
    try {
      scope.addStageLayer(normalizedLayer.id, {
        remove() {
          sendStageMessage({
            type: 'desktop_world_stage.layer.remove',
            payload: { id: normalizedLayer.id },
          })
        },
      })
      const stageUrlValue = typeof stageUrl === 'function' ? stageUrl() : stageUrl
      stageEnsureStatus = normalizeStageEnsureStatus(await ensureStage({
        id: stageCanvasId,
        url: stageUrlValue,
        createStage,
      }), { id: stageCanvasId, url: stageUrlValue })
      if (!stageEnsureStatus.ok) {
        const error = new Error(`STAGE_UNAVAILABLE: ${stageEnsureStatus.status}`)
        error.stageEnsureStatus = stageEnsureStatus
        throw error
      }
      sendStageMessage({
        type: 'desktop_world_stage.layer.upsert',
        payload: normalizedLayer,
      })
      stageLayerUpsertSent = true
      for (const region of normalizedRegions) {
        await registerRegion(region)
        registeredRegionIds.push(region.id)
        scope.addInputRegion(region.id, {
          cleanupOrder: cleanupRegionOrder(cleanupRegionIds, region.id),
          remove(entry) {
            return removeRegion(entry.id)
          },
        })
      }
      if (lifecycleEvents?.length) {
        subscribeEvents(lifecycleEvents, { snapshot: false })
        scope.addSubscription(lifecycleEvents, {
          unsubscribe: unsubscribeEvents,
          exclusive: unsubscribeOnCleanup,
        })
      }
      setupComplete = true
      return state()
    } catch (error) {
      await cleanup()
      throw error
    }
  }

  async function cleanup() {
    if (Array.isArray(cleanupRegionIds) && cleanupRegionIds.length && !registeredRegionIds.length) {
      for (const regionId of cleanupRegionIds) {
        scope.addInputRegion(regionId, {
          cleanupOrder: cleanupRegionOrder(cleanupRegionIds, regionId),
          remove(entry) {
            return removeRegion(entry.id)
          },
        })
      }
    }
    await scope.cleanup()
    registeredRegionIds = []
    cleanupComplete = true
    return state()
  }

  const api = {
    setup,
    cleanup,
    getState: state,
  }
  return api
}
