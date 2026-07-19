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

export function sceneAffordanceRegionId(owner, resource, affordance, generation = null) {
  const base = `scene:${boundedId(owner)}:${boundedId(resource)}:${boundedId(affordance)}`
  return generation === null || generation === undefined
    ? base
    : `${base}:generation:${boundedId(generation)}`
}

function regionPayload(entry, descriptor, frame) {
  return {
    id: sceneAffordanceRegionId(entry.owner, entry.resource, descriptor.id, entry.regionGeneration),
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

function inactiveRegionPayload(payload) {
  return { ...payload, consume_policy: 'never', enabled: false }
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
  const preparations = new Map()
  const stagedRegionIds = new Map()
  const retiredRegions = new Map()
  let nextRegionGeneration = 0
  let retiredCleanupAttempt = 0
  let retiredCleanupScheduled = false
  let retiredCleanupTimer = null
  let runtimeDisposed = false

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
      document: () => leases.get(entry.key) === entry ? outlet.document(entry.key) : entry.document,
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

  function createEntry({ key, owner, resource, document, interactions, regionGeneration = null }) {
    const entry = {
      key,
      owner,
      resource,
      document,
      stageCanvasId,
      regionGeneration,
      interactions,
      controller: null,
      regionIds: new Map(),
      registeredIds: new Set(),
      suspended: false,
      disposed: false,
      generation: 0,
      regionSync: Promise.resolve(),
      regionSyncErrorCode: null,
      sequence: leases.get(key)?.sequence ?? 0,
    }
    entry.controller = createController(entry)
    return entry
  }

  async function cleanupRetiredRegions(ids = [...retiredRegions.keys()]) {
    const pending = ids.filter((id) => retiredRegions.has(id))
    const results = await Promise.allSettled(pending.map((id) => removeRegion(id)))
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') retiredRegions.delete(pending[index])
    })
    if (retiredRegions.size === 0) retiredCleanupAttempt = 0
    if (retiredRegions.size > 0) scheduleRetiredRegionCleanup()
    return results.every((result) => result.status === 'fulfilled')
  }

  function scheduleRetiredRegionCleanup() {
    if (runtimeDisposed || !isPrimary() || retiredCleanupScheduled || retiredRegions.size === 0) return
    const defer = scheduleTimer ?? ((callback, delay) => setTimeout(callback, delay))
    const delay = Math.min(100 * (2 ** Math.min(retiredCleanupAttempt, 6)), 5_000)
    retiredCleanupAttempt += 1
    retiredCleanupScheduled = true
    retiredCleanupTimer = defer(async () => {
      retiredCleanupScheduled = false
      retiredCleanupTimer = null
      await cleanupRetiredRegions()
    }, delay)
    retiredCleanupTimer?.unref?.()
  }

  async function retireAndRemoveRegions(entries) {
    const unique = new Map(entries)
    for (const [id, payload] of unique) retiredRegions.set(id, payload)
    await Promise.allSettled([...unique.values()].map((payload) => updateRegion(inactiveRegionPayload(payload))))
    return cleanupRetiredRegions([...unique.keys()])
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

  async function rollbackPreparation(preparation) {
    if (!preparation || preparation.state !== 'prepared') return false
    preparation.state = 'rolling_back'
    preparation.candidate?.controller.dispose('resource_changed')
    const tasks = []
    for (const id of preparation.candidate?.regionIds.keys() ?? []) {
      if (stagedRegionIds.get(id) === preparation) stagedRegionIds.delete(id)
    }
    for (const id of preparation.addedIds) {
      const payload = preparation.candidate?.regionIds.get(id)?.payload
      tasks.push(removeRegion(id).then(() => {
        if (stagedRegionIds.get(id) === preparation) stagedRegionIds.delete(id)
      }, (error) => {
        if (stagedRegionIds.get(id) === preparation) stagedRegionIds.delete(id)
        if (payload) retiredRegions.set(id, payload)
        scheduleRetiredRegionCleanup()
        throw error
      }))
    }
    const results = await Promise.allSettled(tasks)
    preparations.delete(preparation.key)
    preparation.state = 'rolled_back'
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
    if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld scene interaction preparation rollback failed.')
    return true
  }

  async function prepareReplacement({ key, owner, resource, document, interactions = undefined }) {
    if (preparations.has(key)) throw new TypeError('DesktopWorld scene interaction replacement is already pending.')
    const previous = leases.get(key) ?? null
    const resolved = interactions === undefined ? previous?.interactions ?? null : interactions
    const validated = validateInteractions(resolved, document)
    if (previous && (previous.owner !== owner || previous.resource !== resource)) {
      throw new TypeError('DesktopWorld scene interaction lease identity cannot change.')
    }
    if (validated && !previous && leases.size >= MAX_LEASES) {
      throw new RangeError('DesktopWorld scene interaction lease budget exceeded.')
    }
    const candidate = validated ? createEntry({
      key,
      owner,
      resource,
      document,
      interactions: validated,
      regionGeneration: `r${++nextRegionGeneration}`,
    }) : null
    const preparation = {
      key,
      previous,
      candidate,
      addedIds: new Set(),
      state: 'prepared',
    }
    preparations.set(key, preparation)

    try {
      if (candidate) {
        const next = indexRegions(candidate)
        if (isPrimary() && !candidate.suspended) {
          for (const [id, { payload }] of next) {
            stagedRegionIds.set(id, preparation)
            preparation.addedIds.add(id)
            await registerRegion(inactiveRegionPayload(payload))
            candidate.registeredIds.add(id)
          }
        }
      }
    } catch (error) {
      try {
        await rollbackPreparation(preparation)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'DesktopWorld scene interaction preparation and rollback both failed.')
      }
      throw error
    }

    return Object.freeze({
      assertCurrent() {
        if (preparation.state !== 'prepared' || preparations.get(key) !== preparation) {
          throw new TypeError('DesktopWorld scene interaction replacement is no longer pending.')
        }
        if ((leases.get(key) ?? null) !== previous) {
          throw new TypeError('DesktopWorld scene interaction base changed before commit.')
        }
        return true
      },
      commit(commitOutlet) {
        this.assertCurrent()
        previous?.controller.dispose('resource_changed')
        radialMenus.close(key, 'resource_changed')
        commitOutlet()
        if (previous) {
          previous.disposed = true
          previous.generation += 1
        }
        if (candidate) leases.set(key, candidate)
        else leases.delete(key)
        for (const id of candidate?.registeredIds ?? []) retiredRegions.delete(id)
        preparations.delete(key)
        preparation.state = 'committed'
        for (const id of previous?.registeredIds ?? []) {
          if (!candidate?.registeredIds.has(id)) {
            const payload = previous?.regionIds.get(id)?.payload
            if (payload) retiredRegions.set(id, payload)
          }
        }
        return true
      },
      async rollback() {
        return rollbackPreparation(preparation)
      },
      async settle() {
        if (preparation.state !== 'committed') return false
        for (const id of candidate?.registeredIds ?? []) {
          const payload = candidate?.regionIds.get(id)?.payload
          if (!payload) continue
          try {
            await updateRegion(payload)
          } catch {
            if (candidate) candidate.regionSyncErrorCode = 'INPUT_REGION_ACTIVATION_FAILED'
            return false
          }
          if (stagedRegionIds.get(id) === preparation) stagedRegionIds.delete(id)
        }
        let pending = [...(previous?.registeredIds ?? [])].filter((id) => !candidate?.registeredIds.has(id))
        for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
          const results = await Promise.allSettled(pending.map((id) => removeRegion(id)))
          pending = pending.filter((id, index) => {
            if (results[index].status === 'fulfilled') {
              previous?.registeredIds.delete(id)
              retiredRegions.delete(id)
              return false
            }
            return true
          })
        }
        try {
          await radialMenus.settle(key, { requireClean: true })
        } catch {
          if (candidate) candidate.regionSyncErrorCode = 'INPUT_REGION_CLEANUP_FAILED'
          return false
        }
        if (pending.length > 0) {
          if (candidate) candidate.regionSyncErrorCode = 'INPUT_REGION_CLEANUP_FAILED'
          return false
        }
        preparation.state = 'settled'
        return true
      },
      async failClosed() {
        if (preparation.state !== 'committed') return false
        preparation.state = 'failing_closed'
        candidate?.controller.dispose('resource_removed')
        radialMenus.close(key, 'resource_removed')
        if (candidate) {
          candidate.disposed = true
          candidate.generation += 1
        }
        if (leases.get(key) === candidate) leases.delete(key)
        const entries = new Map()
        for (const id of previous?.registeredIds ?? []) {
          const payload = previous?.regionIds.get(id)?.payload ?? retiredRegions.get(id)
          if (payload) entries.set(id, payload)
        }
        for (const id of candidate?.registeredIds ?? []) {
          const payload = candidate?.regionIds.get(id)?.payload
          if (payload) entries.set(id, payload)
          if (stagedRegionIds.get(id) === preparation) stagedRegionIds.delete(id)
        }
        try { await radialMenus.settle(key, { requireClean: true }) } catch {}
        await retireAndRemoveRegions(entries)
        preparation.state = 'failed_closed'
        return true
      },
    })
  }

  async function mount({ key, owner, resource, document, interactions }) {
    const validated = validateInteractions(interactions, document)
    await release(key, 'resource_changed')
    if (!validated) return snapshot(key)
    if (leases.size >= MAX_LEASES) throw new RangeError('DesktopWorld scene interaction lease budget exceeded.')
    const entry = createEntry({ key, owner, resource, document, interactions: validated })
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
    if (stagedRegionIds.has(regionId) || retiredRegions.has(regionId)) return true
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
    runtimeDisposed = true
    if (retiredCleanupScheduled && retiredCleanupTimer !== null) {
      const cancel = cancelTimer ?? (scheduleTimer ? null : clearTimeout)
      cancel?.(retiredCleanupTimer)
      retiredCleanupScheduled = false
      retiredCleanupTimer = null
      retiredCleanupAttempt = 0
    }
    for (const preparation of [...preparations.values()]) {
      try {
        await rollbackPreparation(preparation)
      } catch (error) {
        failures.push(error)
      }
    }
    for (const key of [...leases.keys()]) {
      try {
        await release(key, reason)
      } catch (error) {
        failures.push(error)
      }
    }
    const retiredIds = [...retiredRegions.keys()]
    const retiredResults = await Promise.allSettled(retiredIds.map((id) => removeRegion(id)))
    retiredIds.forEach((id, index) => {
      if (retiredResults[index].status === 'fulfilled') retiredRegions.delete(id)
      else failures.push(retiredResults[index].reason)
    })
    await radialMenus.dispose(reason)
    if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld scene interaction disposal failed.')
  }

  return Object.freeze({
    mount,
    prepareReplacement,
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
