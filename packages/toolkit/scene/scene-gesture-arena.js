import { normalizeCanvasInputMessage } from '../runtime/input-events.js'
import { createPointerGestureStream } from '../runtime/gesture-stream.js'
import { withSceneRadialSelection } from './scene-radial-menu.js'
import {
  SCENE_AFFORDANCE_LIMITS,
  SCENE_GESTURE_KINDS,
  SCENE_GESTURE_PHASES,
  sceneRecognizerKind as recognizerKind,
} from './scene-interaction-contract.js'
import {
  cloneScenePoint as clonePoint,
  sceneFinite as finite,
  scenePoint as point,
  scenePointDistance as distance,
} from './scene-contract-primitives.js'

const DEFAULT_RECOGNIZER_PRIORITY = Object.freeze({
  long_press: 400,
  radial: 300,
  drag: 200,
  tap: 100,
})

function recognizerPriority(interaction) {
  const kind = recognizerKind(interaction)
  const explicit = interaction?.recognizer?.parameters?.priority
  return Number.isInteger(explicit) ? explicit : DEFAULT_RECOGNIZER_PRIORITY[kind] ?? 0
}
function sortedInteractions(interactions) {
  return [...interactions].sort((left, right) => {
    const priority = recognizerPriority(right) - recognizerPriority(left)
    return priority || left.id.localeCompare(right.id)
  })
}

function thresholdFor(interaction) {
  const configured = interaction?.recognizer?.parameters?.threshold
  return finite(configured, recognizerKind(interaction) === SCENE_GESTURE_KINDS.tap ? 6 : 4, 0, 256)
}

function holdFor(interaction) {
  return finite(interaction?.recognizer?.parameters?.holdMs, 500, 100, 10_000)
}

function buttonMatches(interaction, input) {
  const expected = interaction?.recognizer?.parameters?.button
  if (expected === undefined || expected === null) return true
  if (typeof expected === 'number') {
    const button = ['left', 'middle', 'right'][expected]
    return button ? input.button === button : false
  }
  return expected === input.button
}

function candidateClaims(interaction, session, at, ending = false) {
  if (!buttonMatches(interaction, session.input)) return false
  const kind = recognizerKind(interaction)
  const moved = distance(session.origin, session.current)
  if (kind === SCENE_GESTURE_KINDS.tap) return ending && moved <= thresholdFor(interaction)
  if (kind === SCENE_GESTURE_KINDS.longPress) return moved <= thresholdFor(interaction) && at - session.startedAt >= holdFor(interaction)
  if (kind === SCENE_GESTURE_KINDS.drag || kind === SCENE_GESTURE_KINDS.radial) return moved >= thresholdFor(interaction)
  return false
}

function syntheticInput(session, type, phase, current = session.current) {
  const source = session.rawInput?.routed_input ?? session.rawInput
  return {
    ...source,
    type,
    phase,
    desktop_world: clonePoint(current),
    buttons: type === 'left_mouse_up'
      ? { left: false, right: false, middle: false, other_pressed: [] }
      : source.buttons,
  }
}

function normalizedGesturePhase(frame) {
  if (frame.phase === 'move') return SCENE_GESTURE_PHASES.update
  return frame.phase
}

export function createSceneGestureArena({
  affordance,
  interactions = [],
  now = () => Date.now(),
  scheduleFrame = (callback) => queueMicrotask(callback),
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer = (timer) => clearTimeout(timer),
  onFrame = () => {},
} = {}) {
  if (!affordance?.id) throw new TypeError('Scene gesture arena requires an affordance.')
  const candidates = sortedInteractions(interactions.filter((entry) => entry.affordanceId === affordance.id))
  if (candidates.length > SCENE_AFFORDANCE_LIMITS.maxRecognizersPerAffordance) throw new RangeError('Scene affordance has too many recognizers.')
  let session = null
  let scheduled = false
  let pendingMove = null
  let generation = 0
  let holdTimer = null

  function clearHoldTimer() {
    if (holdTimer === null) return
    cancelTimer(holdTimer)
    holdTimer = null
  }

  function scheduleLongPress(at) {
    clearHoldTimer()
    if (!session) return
    const holds = candidates.filter((entry) => (
      recognizerKind(entry) === SCENE_GESTURE_KINDS.longPress
      && buttonMatches(entry, session.input)
    ))
    if (holds.length === 0) return
    const delay = Math.max(0, Math.min(...holds.map((entry) => holdFor(entry) - (at - session.startedAt))))
    const expectedGeneration = generation
    holdTimer = scheduleTimer(() => {
      holdTimer = null
      if (expectedGeneration !== generation || !session || session.winner) return
      tick(now())
    }, delay)
  }

  function publish(frame, interaction) {
    const publishedFrame = recognizerKind(interaction) === SCENE_GESTURE_KINDS.radial
      ? withSceneRadialSelection(frame, interaction)
      : frame
    onFrame({
      ...publishedFrame,
      phase: normalizedGesturePhase(publishedFrame),
      affordanceId: affordance.id,
      interactionId: interaction.id,
      cancelReason: publishedFrame.cancel_reason ?? null,
    }, interaction)
  }

  function claim(interaction, at) {
    if (!session || session.winner) return false
    clearHoldTimer()
    const kind = recognizerKind(interaction)
    const stream = createPointerGestureStream({ kind })
    stream.subscribe((frame) => publish(frame, interaction))
    session.winner = interaction
    session.stream = stream
    session.claimedAt = at
    stream.handleCanvasInput(syntheticInput(session, 'left_mouse_down', 'down', session.origin), { now: at })
    if (distance(session.origin, session.current) > 0) pendingMove = { current: clonePoint(session.current), at }
    return true
  }

  function resolveWinner(at, ending = false) {
    if (!session || session.winner) return session?.winner ?? null
    const winner = candidates.find((interaction) => candidateClaims(interaction, session, at, ending)) ?? null
    if (winner) claim(winner, at)
    return winner
  }

  function flush() {
    scheduled = false
    const pending = pendingMove
    pendingMove = null
    if (!pending || !session?.stream) return false
    session.current = pending.current
    session.stream.handleCanvasInput(syntheticInput(session, 'left_mouse_dragged', 'drag', pending.current), { now: pending.at })
    return true
  }

  function requestFlush() {
    if (scheduled) return
    scheduled = true
    const expectedGeneration = generation
    scheduleFrame(() => {
      if (expectedGeneration === generation) flush()
    })
  }

  function finish(input, at) {
    if (!session) return false
    clearHoldTimer()
    const terminalCurrent = point(input.desktop_world ?? input.desktopWorld) ?? session.current
    resolveWinner(at, true)
    flush()
    session.current = terminalCurrent
    if (session.stream) session.stream.handleCanvasInput(syntheticInput(session, 'left_mouse_up', 'up'), { now: at })
    else cancel('recognizer_rejected', at)
    session?.stream?.destroy()
    session = null
    pendingMove = null
    generation += 1
    return true
  }

  function cancel(reason = 'pointer_cancelled', at = now()) {
    if (!session) return false
    clearHoldTimer()
    pendingMove = null
    session.stream?.cancel(reason, {}, { now: at })
    session.stream?.destroy()
    session = null
    generation += 1
    return true
  }

  function handle(message, options = {}) {
    const input = normalizeCanvasInputMessage(message)
    if (!input) return false
    const at = finite(options.now, now())
    if (input.eventKind === 'key' && input.type === 'key_down' && input.key?.logical === 'Escape') return cancel('escape', at)
    const current = point(input.desktop_world ?? input.desktopWorld)
    if (input.phase === 'down') {
      if (session || !current) return false
      generation += 1
      session = {
        generation,
        input,
        rawInput: message,
        origin: current,
        current,
        startedAt: at,
        winner: null,
        stream: null,
      }
      scheduleLongPress(at)
      return true
    }
    if (!session) return false
    if (current) session.current = current
    if (input.phase === 'drag' || input.phase === 'move') {
      resolveWinner(at)
      if (session.winner) {
        pendingMove = { current: clonePoint(session.current), at }
        requestFlush()
      }
      return true
    }
    if (input.phase === 'up') return finish(input, at)
    if (input.phase === 'cancel' || input.eventKind === 'cancel') return cancel(input.cancel_reason ?? 'pointer_cancelled', at)
    return false
  }

  function tick(at = now()) {
    if (!session || session.winner) return false
    const winner = resolveWinner(at)
    if (winner) requestFlush()
    return Boolean(winner)
  }

  return Object.freeze({
    handle,
    tick,
    flush,
    cancel,
    dispose(reason = 'stage_disposed') { return cancel(reason) },
    snapshot() {
      return Object.freeze({
        affordanceId: affordance.id,
        active: Boolean(session),
        interactionId: session?.winner?.id ?? null,
        interactionKind: session?.winner ? recognizerKind(session.winner) : null,
        pendingUpdate: Boolean(pendingMove),
        pointerSessionId: session?.input?.captureId ?? session?.input?.capture_id ?? null,
      })
    },
  })
}
