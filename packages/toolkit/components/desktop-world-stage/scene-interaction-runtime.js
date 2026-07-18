import {
  createSceneInteractionController,
  validateSceneInteractionDocument,
} from '../../scene/index.js'
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js'
import { createDesktopWorldSceneRadialMenuRuntime } from './scene-radial-menu-runtime.js'

const MAX_LEASES = 32

function boundedId(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9._/-]/gu, '_').slice(0, 128)
}

export function sceneAffordanceRegionId(owner, resource, affordance) {
  return `scene:${boundedId(owner)}:${boundedId(resource)}:${boundedId(affordance)}`
}

function regionPayload(entry, descriptor, frame) {
  return {
    id: sceneAffordanceRegionId(entry.owner, entry.resource, descriptor.id),
    owner_canvas_id: entry.stageCanvasId,
    frame: [...frame],
    coordinate_space: 'desktop_world',
    semantic_label: typeof descriptor.metadata?.label === 'string' ? descriptor.metadata.label : descriptor.id,
    priority: descriptor.priority,
    consume_policy: descriptor.consumePolicy,
    remove_on_owner_suspend: false,
    enabled: descriptor.enabled !== false,
    metadata: {
      scene_owner: entry.owner,
      scene_resource: entry.resource,
      scene_affordance: descriptor.id,
    },
  }
}

function validateInteractions(interactions, document) {
  if (interactions === undefined || interactions === null) return null
  const validation = validateSceneInteractionDocument(interactions, { scene: document })
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene interactions.')
  return interactions
}

export function createDesktopWorldSceneInteractionRuntime({
  stageCanvasId = 'aos-desktop-world-stage',
  outlet,
  registerRegion,
  updateRegion,
  removeRegion,
  emitEvent = () => {},
  isPrimary = () => true,
  topology = () => null,
  now = () => Date.now(),
  scheduleFrame,
  scheduleTimer,
  cancelTimer,
} = {}) {
  if (!outlet) throw new TypeError('DesktopWorld scene interaction runtime requires a scene outlet.')
  for (const [name, value] of Object.entries({ registerRegion, updateRegion, removeRegion })) {
    if (typeof value !== 'function') throw new TypeError(`DesktopWorld scene interaction runtime requires ${name}.`)
  }
  const leases = new Map()

  function publishEntryEvent(entry, event) {
    if (!isPrimary()) return
    entry.sequence += 1
    emitEvent({ lease_key: entry.key, event_type: event.type, event: { ...event, sequence: entry.sequence } })
  }

  const radialMenus = createDesktopWorldSceneRadialMenuRuntime({
    stageCanvasId,
    registerRegion,
    removeRegion,
    outlet,
    topology,
    isPrimary,
    now,
    publishEvent(session, event) {
      const entry = leases.get(session.key)
      if (entry) publishEntryEvent(entry, event)
    },
  })

  function createController(entry) {
    return createSceneInteractionController({
      identity: {
        stageId: 'desktop-world/main',
        ownerId: entry.owner,
        resourceId: entry.resource,
      },
      document: () => outlet.document(entry.key),
      interactions: entry.interactions,
      topology,
      now,
      scheduleFrame,
      scheduleTimer,
      cancelTimer,
      onResponse(event) {
        if (event.response.kind === 'radial_menu' && event.frame.phase === 'end') {
          return radialMenus.open({
            key: entry.key,
            owner: entry.owner,
            resource: entry.resource,
            affordance: event.affordance,
            interaction: event.interaction,
            response: event.response,
            frame: event.frame,
          })
        }
        const result = outlet.applyInteractionResponse(entry.key, { ...event, topology: topology() })
        if (['aim_commit', 'translate'].includes(event.response.kind) && event.frame.phase === 'end' && result?.applied) {
          scheduleRegionRefresh(entry)
        }
        return result
      },
      onEvent(event) {
        publishEntryEvent(entry, event)
      },
    })
  }

  function indexRegions(entry) {
    const indexed = new Map()
    for (const { descriptor, frame } of entry.controller.affordances()) {
      const payload = regionPayload(entry, descriptor, frame)
      indexed.set(payload.id, { affordanceId: descriptor.id, payload })
    }
    entry.regionIds = indexed
    return indexed
  }

  async function removeRegions(entry) {
    entry.generation += 1
    if (!isPrimary()) {
      entry.registeredIds.clear()
      return
    }
    const ids = new Set([...entry.regionIds.keys(), ...entry.registeredIds])
    const orderedIds = [...ids]
    const results = await Promise.allSettled(orderedIds.map((id) => removeRegion(id)))
    const failures = []
    orderedIds.forEach((id, index) => {
      if (results[index].status === 'fulfilled') entry.registeredIds.delete(id)
      else failures.push(results[index].reason)
    })
    if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld scene input-region cleanup failed.')
  }

  async function syncRegions(entry, preferUpdate = false) {
    const next = indexRegions(entry)
    entry.generation += 1
    const generation = entry.generation
    if (!isPrimary() || entry.suspended || entry.disposed) return

    const priorRegistered = new Set(entry.registeredIds)
    const registered = new Set()
    for (const [id, { payload }] of next) {
      if (entry.disposed || entry.suspended || generation !== entry.generation) break
      const update = preferUpdate && priorRegistered.has(id)
      try {
        await (update ? updateRegion(payload) : registerRegion(payload))
      } catch (error) {
        if (!update || !String(error?.message ?? '').includes('NOT_FOUND')) throw error
        await registerRegion(payload)
      }
      if (entry.disposed || entry.suspended || generation !== entry.generation) {
        await removeRegion(id)
        break
      }
      registered.add(id)
    }
    if (entry.disposed || entry.suspended || generation !== entry.generation) return
    for (const id of priorRegistered) {
      if (!next.has(id)) await removeRegion(id)
    }
    entry.registeredIds = registered
  }

  function scheduleRegionRefresh(entry) {
    const defer = scheduleTimer ?? ((callback, delay) => setTimeout(callback, delay))
    entry.regionSync = entry.regionSync.then(async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (entry.disposed || entry.suspended || leases.get(entry.key) !== entry) return
        try {
          await syncRegions(entry, true)
          entry.regionSyncErrorCode = null
          return
        } catch {
          entry.regionSyncErrorCode = 'INPUT_REGION_SYNC_FAILED'
          if (attempt === 0) await new Promise((resolve) => defer(resolve, 100))
        }
      }
    })
  }

  async function mount({ key, owner, resource, document, interactions }) {
    const validated = validateInteractions(interactions, document)
    await release(key, 'resource_changed')
    if (!validated) return snapshot(key)
    if (leases.size >= MAX_LEASES) throw new RangeError('DesktopWorld scene interaction lease budget exceeded.')
    const entry = {
      key,
      owner,
      resource,
      stageCanvasId,
      interactions: validated,
      controller: null,
      regionIds: new Map(),
      registeredIds: new Set(),
      suspended: false,
      disposed: false,
      generation: 0,
      regionSync: Promise.resolve(),
      regionSyncErrorCode: null,
      sequence: 0,
    }
    entry.controller = createController(entry)
    leases.set(key, entry)
    try {
      await syncRegions(entry)
    } catch (error) {
      await release(key, 'resource_removed')
      throw error
    }
    return snapshot(key)
  }

  async function refresh(key, interactions = undefined) {
    const entry = leases.get(key)
    if (!entry) return false
    await entry.regionSync
    const document = outlet.document(key)
    if (interactions !== undefined) {
      const validated = validateInteractions(interactions, document)
      if (!validated) {
        await release(key, 'resource_changed')
        return true
      }
      entry.interactions = validated
    }
    entry.controller.dispose('resource_changed')
    entry.controller = createController(entry)
    await syncRegions(entry, true)
    return true
  }

  async function reconcile({ key, owner, resource, document, interactions = undefined }) {
    const entry = leases.get(key)
    const resolved = interactions === undefined ? entry?.interactions ?? null : interactions
    if (!resolved) {
      if (entry) await release(key, 'resource_changed')
      return false
    }
    if (!entry) return mount({ key, owner, resource, document, interactions: resolved })
    if (entry.owner !== owner || entry.resource !== resource) {
      throw new TypeError('DesktopWorld scene interaction lease identity cannot change.')
    }
    return refresh(key, resolved)
  }

  function cancel(key, reason = 'resource_changed') {
    const gesture = leases.get(key)?.controller.cancel(reason) ?? false
    return radialMenus.close(key, reason) || gesture
  }

  async function suspend(key) {
    const entry = leases.get(key)
    if (!entry) return false
    if (!entry.suspended) {
      entry.suspended = true
      entry.generation += 1
      entry.controller.cancel('resource_suspended')
      radialMenus.close(key, 'resource_suspended')
    }
    await entry.regionSync
    await radialMenus.settle(key, { requireClean: true })
    await removeRegions(entry)
    return true
  }

  async function resume(key) {
    const entry = leases.get(key)
    if (!entry || !entry.suspended) return false
    await entry.regionSync
    entry.suspended = false
    await syncRegions(entry)
    return true
  }

  async function topologyChanged() {
    for (const entry of leases.values()) {
      entry.controller.cancel('topology_changed')
      radialMenus.close(entry.key, 'topology_changed')
      await entry.regionSync
      await radialMenus.settle(entry.key, { requireClean: true })
      await syncRegions(entry, true)
    }
  }

  async function release(key, reason = 'resource_removed') {
    const entry = leases.get(key)
    if (!entry) return false
    entry.disposed = true
    entry.generation += 1
    entry.controller.dispose(reason)
    radialMenus.close(key, reason)
    await entry.regionSync
    await radialMenus.settle(key, { requireClean: true })
    await removeRegions(entry)
    leases.delete(key)
    return true
  }

  function handleInput(message) {
    if (radialMenus.handleInput(message)) return true
    const input = normalizeCanvasInputMessage(message)
    const regionId = input?.regionId
    if (!regionId) return false
    for (const entry of leases.values()) {
      const affordanceId = entry.regionIds.get(regionId)?.affordanceId
      if (affordanceId && !entry.suspended) return entry.controller.handle(affordanceId, message)
    }
    return false
  }

  function cancelAll(reason = 'stage_disposed') {
    return [...leases.values()].map((entry) => cancel(entry.key, reason)).some(Boolean)
  }

  function snapshot(key = null) {
    const entries = key ? [leases.get(key)].filter(Boolean) : [...leases.values()]
    return {
      leases: entries.map((entry) => ({
        key: entry.key,
        owner: entry.owner,
        resource: entry.resource,
        regions: [...entry.regionIds.keys()],
        registered: entry.registeredIds.size,
        regionSyncErrorCode: entry.regionSyncErrorCode,
        suspended: entry.suspended,
        controller: entry.controller.snapshot(),
      })),
      maxLeases: MAX_LEASES,
      radialMenus: radialMenus.snapshot(key),
    }
  }

  function devtoolsSnapshot() {
    const hitRegions = []
    const affordances = []
    const gestures = []
    const interactions = []
    for (const entry of leases.values()) {
      const controller = entry.controller.snapshot()
      const recognizers = [...new Set((entry.interactions.interactions ?? [])
        .map((interaction) => interaction.recognizer?.implementation)
        .filter(Boolean))]
      for (const { affordanceId, payload } of entry.regionIds.values()) {
        hitRegions.push({
          affordanceId,
          frame: payload.frame,
          id: payload.id,
          registered: entry.registeredIds.has(payload.id),
          resourceId: entry.resource,
        })
      }
      for (const descriptor of entry.interactions.affordances ?? []) {
        affordances.push({
          enabled: descriptor.enabled !== false,
          id: descriptor.id,
          objectId: descriptor.objectId,
          priority: descriptor.priority,
          resourceId: entry.resource,
        })
      }
      for (const arena of controller.affordances ?? []) {
        if (!arena.active) continue
        gestures.push({
          affordanceId: arena.affordanceId,
          id: arena.pointerSessionId ?? `${entry.resource}:${arena.affordanceId}`,
          interactionId: arena.interactionId ?? '',
          kind: arena.interactionKind ?? 'unknown',
          phase: 'active',
          pointerSessionId: arena.pointerSessionId,
          resourceId: entry.resource,
        })
      }
      interactions.push({
        active: controller.affordances.some((arena) => arena.active),
        id: entry.key,
        owner: entry.owner,
        recognizers,
        regionCount: entry.registeredIds.size,
        regionSyncErrorCode: entry.regionSyncErrorCode,
        resourceId: entry.resource,
        suspended: entry.suspended,
      })
    }
    for (const menu of radialMenus.snapshot()) {
      for (const region of menu.regions) hitRegions.push({
        affordanceId: menu.menuId,
        frame: region.frame,
        id: region.id,
        registered: true,
        resourceId: menu.resource,
      })
    }
    return { affordances, gestures, hitRegions, interactions }
  }

  function configuration(key) {
    const entry = leases.get(key)
    if (!entry) return null
    return Object.freeze({
      interactions: entry.interactions,
      owner: entry.owner,
      resource: entry.resource,
      suspended: entry.suspended,
    })
  }

  async function dispose(reason = 'stage_disposed') {
    const failures = []
    for (const key of [...leases.keys()]) {
      try {
        await release(key, reason)
      } catch (error) {
        failures.push(error)
      }
    }
    await radialMenus.dispose(reason)
    if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld scene interaction disposal failed.')
  }

  return Object.freeze({
    mount,
    reconcile,
    refresh,
    cancel,
    suspend,
    resume,
    topologyChanged,
    release,
    handleInput,
    cancelAll,
    configuration,
    devtoolsSnapshot,
    snapshot,
    dispose,
  })
}
