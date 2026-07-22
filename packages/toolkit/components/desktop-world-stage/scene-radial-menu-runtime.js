import {
  createSceneEventEnvelope,
  resolveSceneRadialMenuItemLabel,
  resolveSceneRadialMenuLayout,
} from '../../scene/index.js'
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js'

const MAX_ACTIVE_MENUS = 32
const MAX_BUFFERED_GENERATION_INPUTS = 64

function boundedId(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9._/-]/gu, '_').slice(0, 128)
}

function regionId(session, item) {
  return `scene:${boundedId(session.owner)}:${boundedId(session.resource)}:menu:${boundedId(session.response.menuId)}:generation:${session.generation}:${boundedId(item.id)}`
}

function regionPayload(session, item, stageCanvasId) {
  const radius = item.hitRadius
  return {
    id: regionId(session, item),
    owner_canvas_id: stageCanvasId,
    frame: [item.center.x - radius, item.center.y - radius, radius * 2, radius * 2],
    coordinate_space: 'desktop_world',
    semantic_label: resolveSceneRadialMenuItemLabel(
      session.interaction?.response?.parameters,
      item.id,
    ),
    priority: Math.min(1000, Math.max(0, Number(session.affordance.priority) || 0) + 2),
    consume_policy: 'captured',
    remove_on_owner_suspend: false,
    enabled: !item.disabled,
    metadata: {
      scene_owner: session.owner,
      scene_resource: session.resource,
      scene_radial_menu: session.response.menuId,
      scene_radial_item: item.id,
    },
  }
}

function backdropRegionId(session, display, index) {
  return `${regionId(session, { id: 'outside' })}:display:${boundedId(display.displayId ?? index)}`
}

function backdropPayloads(session, stageCanvasId, topology) {
  const displays = Array.isArray(topology?.displays) ? topology.displays.slice(0, 16) : []
  return displays.flatMap((display, index) => {
    const bounds = display?.bounds
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return []
    if (bounds[2] <= 0 || bounds[3] <= 0) return []
    return [{
      id: backdropRegionId(session, display, index),
      owner_canvas_id: stageCanvasId,
      frame: [...bounds],
      coordinate_space: 'desktop_world',
      semantic_label: `${session.response.menuId} outside dismissal`,
      priority: Math.min(999, Math.max(0, Number(session.affordance.priority) || 0) + 1),
      consume_policy: 'never',
      remove_on_owner_suspend: false,
      enabled: true,
      metadata: {
        scene_owner: session.owner,
        scene_resource: session.resource,
        scene_radial_menu: session.response.menuId,
        scene_radial_outside: 'true',
      },
    }]
  })
}

function inactivePayload(payload) {
  return { ...payload, consume_policy: 'never', enabled: false }
}

function regionIsAlreadyAbsent(error) {
  return error?.code === 'NOT_FOUND' || String(error?.message ?? '').includes('NOT_FOUND')
}

function syntheticFrame(
  session,
  action,
  input,
  reason = null,
  phase = action === 'cancel' ? 'cancel' : 'end',
  gestureId = null,
  pointerSessionId = undefined,
) {
  const current = input?.desktop_world ?? input?.desktopWorld ?? session.layout.center
  return {
    affordanceId: session.affordance.id,
    interactionId: session.interaction.id,
    gesture_id: gestureId ?? `${session.response.menuId}:${session.generation}:${action}`,
    gesture_type: 'tap',
    phase,
    pointer: {
      capture_id: pointerSessionId === undefined
        ? input?.captureId ?? input?.capture_id ?? null
        : pointerSessionId,
    },
    origin: session.response.origin,
    previous: current,
    current,
    coordinates: { desktop_world: current },
    delta: { x: 0, y: 0 },
    total_delta: { x: 0, y: 0 },
    cancelReason: reason,
    timing: { t: Number(input?.timestamp_monotonic_ms) || session.now() },
  }
}

export function createDesktopWorldSceneRadialMenuRuntime({
  stageCanvasId = 'aos-desktop-world-stage',
  registerRegion,
  replaceRegionGeneration,
  removeRegion,
  outlet,
  topology = () => null,
  isPrimary = () => true,
  now = () => Date.now(),
  publishEvent = () => {},
} = {}) {
  if (
    !outlet
    || typeof registerRegion !== 'function'
    || typeof replaceRegionGeneration !== 'function'
    || typeof removeRegion !== 'function'
  ) {
    throw new TypeError('DesktopWorld radial-menu runtime requires an outlet and input-region transport.')
  }
  const active = new Map()
  const retired = new Set()
  const regionIndex = new Map()
  const guardedRegionIndex = new Map()
  const queues = new Map()
  let generation = 0

  function enqueue(key, operation) {
    const next = (queues.get(key) ?? Promise.resolve()).then(operation, operation)
    const tracked = next.finally(() => {
      if (queues.get(key) === tracked) queues.delete(key)
    })
    queues.set(key, tracked)
    return tracked
  }

  async function removeRegions(session) {
    const ids = [...session.regionIds]
    if (!isPrimary()) {
      session.regionIds.clear()
      session.regionPayloads.clear()
      ids.forEach((id) => {
        regionIndex.delete(id)
        guardedRegionIndex.delete(id)
      })
      return
    }
    let pending = ids
    let failures = []
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
      const results = await Promise.allSettled(pending.map((id) => removeRegion(id)))
      const retry = []
      failures = []
      pending.forEach((id, index) => {
        if (
          results[index].status === 'fulfilled'
          || regionIsAlreadyAbsent(results[index].reason)
        ) {
          session.regionIds.delete(id)
          session.regionPayloads.delete(id)
          regionIndex.delete(id)
          guardedRegionIndex.delete(id)
        }
        else {
          retry.push(id)
          failures.push(results[index].reason)
        }
      })
      pending = retry
    }
    if (pending.length > 0) throw new AggregateError(failures, 'DesktopWorld radial-menu cleanup failed.')
  }

  function clearRegions(session) {
    for (const id of session.regionIds) {
      regionIndex.delete(id)
      guardedRegionIndex.delete(id)
    }
    session.regionIds.clear()
    session.regionPayloads.clear()
    session.dispatchGuard = null
    session.focusedRegionId = null
    session.hoverGestureId = null
    session.hoverPointerSessionId = null
  }

  function releaseDispatchGuard(session, guard = session.dispatchGuard) {
    if (!guard) return
    for (const [id, candidate] of guardedRegionIndex) {
      if (candidate === guard) guardedRegionIndex.delete(id)
    }
    if (session.dispatchGuard === guard) session.dispatchGuard = null
  }

  function stageDispatchGuard(session, entries) {
    const guard = {
      bufferedInputs: [],
      inputOverflow: false,
      session,
      state: 'activating',
    }
    session.dispatchGuard = guard
    for (const entry of entries) guardedRegionIndex.set(entry.payload.id, guard)
    return guard
  }

  function retainRetirementGuard(session) {
    if (session.regionIds.size === 0 && !session.dispatchGuard) return
    const guard = session.dispatchGuard ?? {
      bufferedInputs: [],
      inputOverflow: false,
      session,
      state: 'retiring',
    }
    guard.state = 'retiring'
    guard.bufferedInputs.length = 0
    guard.inputOverflow = false
    session.dispatchGuard = guard
    for (const id of session.regionIds) guardedRegionIndex.set(id, guard)
  }

  function requireBoundedDispatchGuard(guard) {
    if (guard?.inputOverflow) {
      throw new RangeError('DesktopWorld radial-menu activation input buffer exceeded.')
    }
  }

  function finalizeClose(session) {
    if (session.finalized) return
    const { emitEvent, input, reason } = session.closeRequest
    const response = Object.freeze({
      kind: 'radial_menu', action: 'cancel', menuId: session.response.menuId,
    })
    if (emitEvent) {
      const gestureId = session.pointerGestureId ?? `${session.response.menuId}:${session.generation}:cancel`
      if (!session.pointerGestureId) {
        emit(session, response, syntheticFrame(
          session, 'cancel', input, null, 'start', gestureId, session.pointerSessionId,
        ))
      }
      emit(session, response, syntheticFrame(
        session, 'cancel', input, reason, 'cancel', gestureId, session.pointerSessionId,
      ))
    } else if (session.visualApplied) {
      outlet.applyInteractionResponse(session.key, {
        frame: syntheticFrame(session, 'cancel', input, reason),
        interaction: session.interaction,
        radialLayout: session.layout,
        response,
        topology: topology(),
      })
    }
    session.visualApplied = false
    session.pointerGestureId = null
    session.pointerSessionId = null
    session.focusedRegionId = null
    session.hoverGestureId = null
    session.hoverPointerSessionId = null
    session.finalized = true
    session.errorCode = null
    releaseDispatchGuard(session)
    retired.delete(session)
  }

  async function retireAndFinalize(session) {
    const ids = [...session.regionIds]
    if (isPrimary() && ids.length > 0) {
      try {
        await replaceRegionGeneration({ activate: [], retire: ids })
        clearRegions(session)
      } catch (replaceError) {
        try {
          await removeRegions(session)
        } catch (cleanupError) {
          throw new AggregateError(
            [replaceError, cleanupError],
            'DesktopWorld radial-menu generation retirement failed.',
          )
        }
      }
    } else {
      clearRegions(session)
    }
    finalizeClose(session)
  }

  async function cleanupRetired(key = null, except = null) {
    const failures = []
    for (const session of [...retired]) {
      if (session === except || (key !== null && session.key !== key)) continue
      try {
        await retireAndFinalize(session)
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld retired radial-menu cleanup failed.')
  }

  function emit(session, response, frame, { applyVisual = true } = {}) {
    const applied = applyVisual
      ? outlet.applyInteractionResponse(session.key, {
          frame,
          interaction: session.interaction,
          radialLayout: session.layout,
          response,
          topology: topology(),
        })
      : { applied: true, revision: outlet.document?.(session.key)?.revision }
    publishEvent(session, createSceneEventEnvelope({
      identity: { stageId: 'desktop-world/main', ownerId: session.owner, resourceId: session.resource },
      frame,
      response: Object.freeze({ ...response, applied: applied?.applied === true, revision: applied?.revision }),
      sequence: 1,
      topology: topology(),
      at: frame.timing.t,
    }))
  }

  function applyOpenVisual(session, input) {
    const frame = syntheticFrame(session, 'open', input)
    outlet.applyInteractionResponse(session.key, {
      frame,
      interaction: session.interaction,
      radialLayout: session.layout,
      response: session.response,
      topology: topology(),
    })
    return frame
  }

  function restoreHoverVisual(session, input) {
    const frame = applyOpenVisual(session, input)
    const indexed = session.focusedRegionId ? regionIndex.get(session.focusedRegionId) : null
    if (!indexed || indexed.session !== session || indexed.outside || indexed.item?.disabled) return frame
    outlet.applyInteractionResponse(session.key, {
      frame: syntheticFrame(
        session, 'focus', input, null, 'start', session.hoverGestureId, session.hoverPointerSessionId,
      ),
      interaction: session.interaction,
      radialLayout: session.layout,
      response: Object.freeze({
        kind: 'radial_menu',
        action: 'focus',
        menuId: session.response.menuId,
        itemId: indexed.item.id,
        selectionIndex: indexed.item.index,
      }),
      topology: topology(),
    })
    return frame
  }

  function close(key, reason = 'resource_changed', { emitEvent = true, input = null } = {}) {
    const session = active.get(key)
    if (!session) return false
    blur(session, input)
    active.delete(key)
    retired.add(session)
    session.closed = true
    session.dispatchable = false
    session.closeRequest = { emitEvent, input, reason }
    retainRetirementGuard(session)
    for (const id of session.regionIds) regionIndex.delete(id)
    enqueue(key, async () => {
      try {
        await retireAndFinalize(session)
      } catch {
        session.errorCode = 'RADIAL_MENU_REGION_CLEANUP_FAILED'
      }
    })
    return true
  }

  function open({ key, owner, resource, affordance, interaction, response, frame }) {
    if (active.size >= MAX_ACTIVE_MENUS && !active.has(key)) throw new RangeError('DesktopWorld radial-menu lease budget exceeded.')
    close(key, 'resource_changed', { emitEvent: false })
    const session = {
      key,
      owner,
      resource,
      affordance,
      interaction,
      response,
      layout: resolveSceneRadialMenuLayout(response, topology()),
      regionIds: new Set(),
      regionPayloads: new Map(),
      pressedRegionId: null,
      pointerGestureId: null,
      pointerSessionId: null,
      focusedRegionId: null,
      hoverGestureId: null,
      hoverPointerSessionId: null,
      generation: ++generation,
      closed: false,
      closeRequest: null,
      dispatchable: false,
      errorCode: null,
      finalized: false,
      now,
      visualApplied: false,
      dispatchGuard: null,
    }
    active.set(key, session)
    enqueue(key, async () => {
      if (session.closed || active.get(key) !== session) return
      try {
        await cleanupRetired(key, session)
        if (session.closed || active.get(key) !== session) return
        const itemEntries = session.layout.items
          .filter((item) => !item.disabled)
          .map((item) => ({ item, outside: false, payload: regionPayload(session, item, stageCanvasId) }))
        const outsideEntries = backdropPayloads(session, stageCanvasId, topology())
          .map((payload) => ({ item: null, outside: true, payload }))
        const entries = [...itemEntries, ...outsideEntries]
        if (isPrimary()) {
          for (const entry of entries) {
            if (session.closed || active.get(key) !== session) break
            session.regionIds.add(entry.payload.id)
            session.regionPayloads.set(entry.payload.id, entry.payload)
            await registerRegion(inactivePayload(entry.payload))
          }
        }
        if (session.closed || active.get(key) !== session) {
          await retireAndFinalize(session)
          return
        }
        let dispatchGuard = null
        if (isPrimary()) {
          dispatchGuard = stageDispatchGuard(session, entries)
          await replaceRegionGeneration({
            activate: entries.map(({ payload }) => payload),
            retire: [],
          })
        }
        if (session.closed || active.get(key) !== session) {
          await retireAndFinalize(session)
          return
        }
        requireBoundedDispatchGuard(dispatchGuard)
        session.visualApplied = true
        const applied = outlet.applyInteractionResponse(key, {
          frame,
          interaction,
          radialLayout: session.layout,
          response,
          topology: topology(),
        })
        if (applied?.applied !== true) throw new Error('DesktopWorld radial-menu visual activation failed.')
        requireBoundedDispatchGuard(dispatchGuard)
        if (session.closed || active.get(key) !== session) {
          await retireAndFinalize(session)
          return
        }
        for (const entry of entries) {
          regionIndex.set(entry.payload.id, { session, item: entry.item, outside: entry.outside })
        }
        session.dispatchable = true
        const bufferedInputs = dispatchGuard ? [...dispatchGuard.bufferedInputs] : []
        if (dispatchGuard) {
          dispatchGuard.state = 'committed'
          releaseDispatchGuard(session, dispatchGuard)
        }
        for (const bufferedInput of bufferedInputs) {
          if (session.closed || active.get(key) !== session) break
          handleInput(bufferedInput)
        }
      } catch {
        session.errorCode = 'RADIAL_MENU_REGION_ACTIVATION_FAILED'
        if (active.get(key) === session) close(key, 'pointer_cancelled')
      }
    })
    const revision = outlet.document?.(key)?.revision
    return Object.freeze({ applied: true, ...(Number.isInteger(revision) ? { revision } : {}) })
  }

  function select(indexed, input) {
    const { session, item } = indexed
    if (!session.dispatchable || session.closed || item.disabled || active.get(session.key) !== session) return false
    const response = Object.freeze({
      kind: 'radial_menu',
      action: 'select',
      menuId: session.response.menuId,
      itemId: item.id,
      selectionIndex: item.index,
    })
    const frame = syntheticFrame(
      session, 'select', input, null, 'end', session.pointerGestureId, session.pointerSessionId,
    )
    const closes = session.response.closeOnSelect !== false
    // A closing selection is published immediately, but its visual remains
    // present until the native region generation has retired successfully.
    // This prevents an invisible region from consuming input during cleanup.
    emit(session, response, frame, { applyVisual: !closes })
    if (closes) close(session.key, 'resource_changed', { emitEvent: false, input })
    else {
      session.pressedRegionId = null
      session.pointerGestureId = null
      session.pointerSessionId = null
      restoreHoverVisual(session, input)
    }
    return true
  }

  function pressFocus(indexed, input) {
    const { session, item } = indexed
    if (!session.dispatchable || session.closed || item.disabled || active.get(session.key) !== session) return false
    emit(session, Object.freeze({
      kind: 'radial_menu', action: 'focus', menuId: session.response.menuId,
      itemId: item.id, selectionIndex: item.index,
    }), syntheticFrame(
      session, 'focus', input, null, 'start', session.pointerGestureId, session.pointerSessionId,
    ))
    return true
  }

  function blur(session, input) {
    if (!session.focusedRegionId || session.closed || active.get(session.key) !== session) return false
    const gestureId = session.hoverGestureId
    emit(session, Object.freeze({
      kind: 'radial_menu', action: 'blur', menuId: session.response.menuId,
    }), syntheticFrame(
      session, 'blur', input, null, 'end', gestureId, session.hoverPointerSessionId,
    ))
    session.focusedRegionId = null
    session.hoverGestureId = null
    session.hoverPointerSessionId = null
    return true
  }

  function hoverFocus(indexed, input) {
    const { session, item } = indexed
    if (!session.dispatchable || session.closed || item.disabled || active.get(session.key) !== session) return false
    if (session.focusedRegionId === input.regionId) return true
    blur(session, input)
    session.focusedRegionId = input.regionId
    session.hoverGestureId = `${session.response.menuId}:${session.generation}:hover:${item.index}`
    session.hoverPointerSessionId = input.captureId ?? input.capture_id ?? null
    emit(session, Object.freeze({
      kind: 'radial_menu', action: 'focus', menuId: session.response.menuId,
      itemId: item.id, selectionIndex: item.index,
    }), syntheticFrame(
      session, 'focus', input, null, 'start', session.hoverGestureId, session.hoverPointerSessionId,
    ))
    return true
  }

  function handleInput(message) {
    const input = normalizeCanvasInputMessage(message)
    if (!input) return false
    if (input.eventKind === 'key' && input.type === 'key_down' && input.key?.logical === 'Escape') {
      return [...active.keys()].map((key) => close(key, 'escape', { input })).some(Boolean)
    }
    const guarded = input.regionId ? guardedRegionIndex.get(input.regionId) : null
    if (guarded) {
      if (guarded.state === 'activating') {
        if (guarded.bufferedInputs.length < MAX_BUFFERED_GENERATION_INPUTS) {
          guarded.bufferedInputs.push(message)
        } else {
          guarded.inputOverflow = true
        }
      }
      return true
    }
    const indexed = regionIndex.get(input.regionId)
    if (!indexed) return false
    if (indexed.outside) {
      if (input.phase === 'move') {
        blur(indexed.session, input)
        return true
      }
      if (input.phase === 'down') {
        return close(indexed.session.key, 'pointer_cancelled', { input })
      }
      return true
    }
    if (input.phase === 'move') return hoverFocus(indexed, input)
    if (input.phase === 'down') {
      indexed.session.pressedRegionId = input.regionId
      indexed.session.pointerGestureId = input.gestureId ?? input.gesture_id ?? `${indexed.session.response.menuId}:${indexed.session.generation}:select`
      indexed.session.pointerSessionId = input.captureId ?? input.capture_id ?? null
      return pressFocus(indexed, input)
    }
    if (input.phase === 'up') {
      const accepted = indexed.session.pressedRegionId === input.regionId
      indexed.session.pressedRegionId = null
      const selected = accepted ? select(indexed, input) : true
      indexed.session.pointerGestureId = null
      indexed.session.pointerSessionId = null
      return selected
    }
    if (input.phase === 'cancel') {
      if (input.cancel_reason === 'escape') {
        return close(indexed.session.key, 'escape', { input })
      }
      if (indexed.session.pointerGestureId) emit(indexed.session, Object.freeze({
        kind: 'radial_menu', action: 'cancel', menuId: indexed.session.response.menuId,
      }), syntheticFrame(
        indexed.session,
        'cancel',
        input,
        input.cancel_reason ?? 'pointer_cancelled',
        'cancel',
        indexed.session.pointerGestureId,
        indexed.session.pointerSessionId,
      ))
      indexed.session.pressedRegionId = null
      indexed.session.pointerGestureId = null
      indexed.session.pointerSessionId = null
      restoreHoverVisual(indexed.session, input)
      return true
    }
    return true
  }

  async function settle(key = null, { requireClean = false } = {}) {
    if (key !== null) await (queues.get(key) ?? Promise.resolve())
    else await Promise.allSettled([...queues.values()])
    if (requireClean) await cleanupRetired(key)
  }

  function snapshot(key = null) {
    return [...active.values()]
      .filter((entry) => entry.dispatchable && (key === null || entry.key === key))
      .map((entry) => ({
      key: entry.key,
      owner: entry.owner,
      resource: entry.resource,
      menuId: entry.response.menuId,
      itemCount: entry.layout.items.length,
      regions: [...entry.regionPayloads.values()]
        .filter((payload) => payload.metadata?.scene_radial_outside !== 'true')
        .map((payload) => ({ id: payload.id, frame: payload.frame })),
      errorCode: entry.errorCode,
      }))
  }

  async function dispose(reason = 'stage_disposed') {
    for (const key of [...active.keys()]) close(key, reason)
    await settle(null, { requireClean: true })
  }

  return Object.freeze({ open, close, handleInput, settle, snapshot, dispose })
}
