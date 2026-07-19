import {
  validateSceneInteractionDocument,
} from './scene-interaction-contract.js'
import { resolveSceneAffordanceFrame } from './scene-affordance-geometry.js'
import { createSceneGestureArena } from './scene-gesture-arena.js'
import {
  createSceneEventEnvelope,
  publicAppliedSceneResponse,
  resolveSceneGestureResponse,
} from './scene-response-runtime.js'

export {
  SCENE_AFFORDANCE_LIMITS,
  SCENE_EVENT_CONTRACT_ID,
  SCENE_GESTURE_CANCELLATION_REASONS,
  SCENE_GESTURE_KINDS,
  SCENE_GESTURE_PHASES,
  SCENE_INTERACTIONS_CONTRACT_ID,
  validateSceneAffordanceDescriptor,
  validateSceneInteractionDocument,
} from './scene-interaction-contract.js'
export { resolveSceneAffordanceFrame } from './scene-affordance-geometry.js'
export { createSceneGestureArena } from './scene-gesture-arena.js'
export {
  createSceneEventEnvelope,
  resolveSceneGestureResponse,
} from './scene-response-runtime.js'

export function createSceneInteractionController({
  identity,
  document,
  interactions,
  topology = () => null,
  now = () => Date.now(),
  scheduleFrame,
  scheduleTimer,
  cancelTimer,
  onResponse = () => null,
  onEvent = () => {},
} = {}) {
  if (!identity?.stageId || !identity?.ownerId || !identity?.resourceId) throw new TypeError('Scene interaction controller requires lease identity.')
  const getDocument = typeof document === 'function' ? document : () => document
  const getTopology = typeof topology === 'function' ? topology : () => topology
  const validation = validateSceneInteractionDocument(interactions, { scene: getDocument() })
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene interaction document.')
  let sequence = 0
  let disposed = false
  const affordances = new Map((interactions.affordances ?? []).map((entry) => [entry.id, entry]))
  const arenas = new Map()

  function handleFrame(frame, interaction) {
    if (disposed) return
    const affordance = affordances.get(frame.affordanceId)
    const resolved = resolveSceneGestureResponse({ document: getDocument(), affordance, interaction, frame })
    const applied = onResponse({ affordance, document: getDocument(), frame, interaction, response: resolved })
    const response = publicAppliedSceneResponse(resolved, applied)
    sequence += 1
    onEvent(createSceneEventEnvelope({
      identity,
      frame,
      response,
      sequence,
      topology: getTopology(),
      at: frame.timing?.t ?? now(),
    }))
  }

  for (const affordance of affordances.values()) {
    if (affordance.enabled === false) continue
    arenas.set(affordance.id, createSceneGestureArena({
      affordance,
      interactions: interactions.interactions,
      now,
      scheduleFrame,
      scheduleTimer,
      cancelTimer,
      onFrame: handleFrame,
    }))
  }

  return Object.freeze({
    affordances() {
      return [...affordances.values()].filter((entry) => entry.enabled !== false).map((entry) => Object.freeze({
        descriptor: entry,
        frame: resolveSceneAffordanceFrame(getDocument(), entry),
      }))
    },
    handle(affordanceId, message, options) {
      if (disposed) return false
      return arenas.get(affordanceId)?.handle(message, options) ?? false
    },
    tick(at = now()) {
      if (disposed) return false
      return [...arenas.values()].map((arena) => arena.tick(at)).some(Boolean)
    },
    cancel(reason = 'resource_removed', at = now()) {
      return [...arenas.values()].map((arena) => arena.cancel(reason, at)).some(Boolean)
    },
    dispose(reason = 'stage_disposed') {
      if (disposed) return false
      disposed = true
      for (const arena of arenas.values()) arena.dispose(reason)
      arenas.clear()
      return true
    },
    snapshot() {
      return Object.freeze({
        affordances: [...arenas.values()].map((arena) => arena.snapshot()),
        disposed,
        identity: { ...identity },
        sequence,
      })
    },
  })
}
