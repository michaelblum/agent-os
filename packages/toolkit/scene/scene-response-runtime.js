import { resolveSceneRadialMenuResponse } from './scene-radial-menu.js'
import {
  SCENE_EVENT_CONTRACT_ID,
  SCENE_GESTURE_CANCELLATION_REASONS,
  sceneResponseKind,
} from './scene-interaction-contract.js'
import {
  parentLocalDelta,
  parentLocalPoint,
  sceneObjectTransform,
  transformPoint,
} from './scene-affordance-geometry.js'
import {
  cloneScenePoint as clonePoint,
  isSceneRecord as isRecord,
  sceneFinite as finite,
  scenePointAngle as angle,
  scenePointDistance as distance,
} from './scene-contract-primitives.js'

function signalValues(parameters, frame) {
  const list = Array.isArray(parameters?.signals)
    ? parameters.signals
    : typeof parameters?.signalId === 'string'
      ? [{ signalId: parameters.signalId, source: 'distance' }]
      : []
  const total = frame.total_delta ?? { x: 0, y: 0 }
  const sources = {
    constant: 1,
    distance: Math.hypot(total.x ?? 0, total.y ?? 0),
    selection_active: Number.isInteger(frame.radial?.selectionIndex) ? 1 : 0,
    selection_index: Number.isInteger(frame.radial?.selectionIndex) ? frame.radial.selectionIndex : -1,
    x: total.x ?? 0,
    y: total.y ?? 0,
  }
  return list.slice(0, 32).flatMap((entry) => {
    if (!entry || typeof entry.signalId !== 'string') return []
    const source = sources[entry.source ?? 'constant']
    if (!Number.isFinite(source)) return []
    return [{
      signalId: entry.signalId,
      value: source * finite(entry.scale, 1, -1e6, 1e6) + finite(entry.offset, 0, -1e6, 1e6),
    }]
  })
}

function canonicalCancellationReason(value) {
  if (!value) return null
  if (SCENE_GESTURE_CANCELLATION_REASONS.includes(value)) return value
  if (value === 'owner_disconnected') return 'owner_disconnected'
  if (value === 'surface_removed') return 'resource_removed'
  if (value === 'surface_suspended') return 'resource_suspended'
  if (value === 'topology_stale') return 'topology_changed'
  return 'pointer_cancelled'
}

export function publicAppliedSceneResponse(resolved, applied) {
  if (!isRecord(applied)) return resolved
  const result = { ...resolved }
  if (typeof applied.applied === 'boolean') result.applied = applied.applied
  if (Number.isInteger(applied.revision) && applied.revision >= 0) result.revision = applied.revision
  if (resolved.kind === 'signal_graph' && Number.isInteger(applied.appliedSignals)) {
    result.appliedSignals = finite(applied.appliedSignals, 0, 0, 32)
  }
  return Object.freeze(result)
}

export function resolveSceneGestureResponse({ document, affordance, interaction, frame } = {}) {
  const kind = sceneResponseKind(interaction)
  if (!kind) throw new TypeError('Scene interaction response implementation is unavailable.')
  const object = document?.objects?.find((entry) => entry.id === affordance?.objectId)
  if (!object) throw new TypeError('Scene interaction response target is unavailable.')
  const originPosition = object.transform?.position ?? [0, 0, 0]
  const total = frame.total_delta ?? { x: 0, y: 0 }
  const current = frame.current ?? frame.origin ?? { x: 0, y: 0 }
  if (kind === 'translate') {
    const axis = interaction.response.parameters?.axis ?? 'both'
    const worldDelta = {
      x: axis === 'y' ? 0 : finite(total.x),
      y: axis === 'x' ? 0 : finite(total.y),
    }
    const localDelta = parentLocalDelta(document, object, worldDelta)
    return Object.freeze({
      kind,
      objectId: affordance.objectId,
      position: [originPosition[0] + localDelta.x, originPosition[1] + localDelta.y, originPosition[2] ?? 0],
    })
  }
  if (kind === 'aim_commit') {
    const routeOrigin = transformPoint(sceneObjectTransform(document, affordance.objectId), { x: 0, y: 0 })
    const targetPosition = parentLocalPoint(document, object, current)
    return Object.freeze({
      kind,
      objectId: affordance.objectId,
      origin: routeOrigin,
      pointer: clonePoint(current),
      position: [targetPosition.x, targetPosition.y, originPosition[2] ?? 0],
      angle: angle(routeOrigin, current),
      distance: distance(routeOrigin, current),
      route: interaction.response.parameters?.route ?? 'line',
    })
  }
  if (kind === 'drop') return Object.freeze({ kind, objectId: affordance.objectId, point: clonePoint(current) })
  if (kind === 'radial_menu') return resolveSceneRadialMenuResponse({ frame, interaction })
  return Object.freeze({ kind, signals: signalValues(interaction.response.parameters, frame) })
}

export function createSceneEventEnvelope({ identity, frame, response, sequence, topology = null, at = Date.now() } = {}) {
  return Object.freeze({
    contract: SCENE_EVENT_CONTRACT_ID,
    schemaVersion: 1,
    type: 'gesture',
    sequence,
    stageId: identity.stageId,
    ownerId: identity.ownerId,
    resourceId: identity.resourceId,
    affordanceId: frame.affordanceId,
    interactionId: frame.interactionId,
    gesture: Object.freeze({
      id: frame.gesture_id,
      kind: frame.gesture_type,
      phase: frame.phase,
      pointerSessionId: frame.pointer?.capture_id ?? null,
      cancellationReason: canonicalCancellationReason(frame.cancelReason),
    }),
    coordinates: Object.freeze({
      origin: clonePoint(frame.origin),
      previous: clonePoint(frame.previous),
      current: clonePoint(frame.current),
      desktopWorld: clonePoint(frame.coordinates?.desktop_world ?? frame.current),
      native: clonePoint(frame.coordinates?.native),
      delta: clonePoint(frame.delta),
      totalDelta: clonePoint(frame.total_delta),
    }),
    topology,
    response,
    at,
  })
}
