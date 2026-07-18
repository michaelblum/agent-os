import {
  normalizeDesktopWorldDevToolsSnapshot,
  normalizeDesktopWorldDevToolsStageSnapshot,
} from './desktop-world-devtools.js'

export const DESKTOP_WORLD_SCENE_REPLAY_LIMITS = Object.freeze({ events: 10_000, resources: 128 })

const RESOURCE_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u
const OWNER_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const GESTURE_PHASES = new Set(['start', 'update', 'end', 'cancel'])
const GESTURE_KINDS = new Set(['tap', 'drag', 'long_press', 'radial'])
const CANCELLATION_REASONS = new Set([
  'escape', 'owner_disconnected', 'pointer_cancelled', 'resource_changed',
  'resource_removed', 'resource_suspended', 'stage_disposed', 'topology_changed',
])
const HEADLESS_SNAPSHOT_ATTEMPTS = 20
const HEADLESS_SNAPSHOT_DELAY_MS = 50

function fail(code, message) {
  const error = new TypeError(message)
  error.code = code
  throw error
}

function resourceId(value, optional = false) {
  if (optional && value == null) return null
  if (typeof value !== 'string' || value.length > 128 || !RESOURCE_ID.test(value)) {
    fail('INVALID_SCENE_RESOURCE', 'DesktopWorld resource identifier is invalid.')
  }
  return value
}

function sessionId(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    fail('INVALID_DEVTOOLS_SESSION', 'DesktopWorld DevTools session identifier is invalid.')
  }
  return value
}

function devtoolsRevision(value) {
  if (!Number.isInteger(value) || value < 1) fail('INVALID_DEVTOOLS_REVISION', 'DesktopWorld DevTools revision is invalid.')
  return value
}

function recomputeCounters(stage) {
  return Object.freeze({
    displays: stage.world.displays.length,
    resources: stage.resources.length,
    nodes: stage.world.nodes.length,
    hitRegions: stage.world.hitRegions.length,
    affordances: stage.world.affordances.length,
    activeGestures: stage.world.gestures.filter((entry) => !['end', 'cancel'].includes(entry.phase)).length,
    activeRoutes: stage.world.routes.filter((entry) => entry.active).length,
    errors: stage.resources.filter((entry) => entry.errorCode).length
      + stage.interactions.filter((entry) => entry.errorCode).length,
  })
}

export function selectDesktopWorldResourceSnapshot(input, requestedResource) {
  const stage = input?.stage
    ? normalizeDesktopWorldDevToolsSnapshot(input).stage
    : normalizeDesktopWorldDevToolsStageSnapshot(input)
  const id = resourceId(requestedResource)
  const resources = stage.resources.filter((entry) => entry.id === id)
  if (resources.length !== 1) fail('SCENE_RESOURCE_NOT_FOUND', 'DesktopWorld resource was not found.')
  const byResource = (entry) => entry.resourceId === id
  const selected = {
    ...stage,
    world: {
      displays: stage.world.displays,
      nodes: stage.world.nodes.filter(byResource),
      hitRegions: stage.world.hitRegions.filter(byResource),
      affordances: stage.world.affordances.filter(byResource),
      gestures: stage.world.gestures.filter(byResource),
      routes: stage.world.routes.filter(byResource),
    },
    resources,
    interactions: stage.interactions.filter(byResource),
    events: stage.events.filter((entry) => entry.resourceId == null || entry.resourceId === id),
  }
  selected.counters = recomputeCounters(selected)
  return normalizeDesktopWorldDevToolsStageSnapshot(selected)
}

export function listDesktopWorldResources(input) {
  const stage = input?.stage
    ? normalizeDesktopWorldDevToolsSnapshot(input).stage
    : normalizeDesktopWorldDevToolsStageSnapshot(input)
  return Object.freeze({
    stage: 'desktop-world/main',
    sequence: stage.sequence,
    status: stage.status,
    resources: Object.freeze([...stage.resources].sort((left, right) => left.id.localeCompare(right.id)).map((entry) => Object.freeze({
      id: entry.id,
      owner: entry.owner,
      sceneId: entry.sceneId,
      revision: entry.revision,
      lifecycle: entry.lifecycle,
      suspended: entry.suspended,
      errorCode: entry.errorCode,
    }))),
  })
}

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
}

function descriptorId(value, limit = 128) {
  return typeof value === 'string' && value.length <= limit && RESOURCE_ID.test(value)
}

function replayPoint(value, nullable = true) {
  if (nullable && value == null) return null
  if (!hasExactKeys(value, ['x', 'y']) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay point is invalid.')
  }
  return Object.freeze({ x: value.x, y: value.y })
}

function replayPosition(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay position is invalid.')
  }
  return Object.freeze([...value])
}

function replayApplied(value) {
  if (value.applied != null && typeof value.applied !== 'boolean') fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay applied state is invalid.')
  if (value.revision != null && (!Number.isInteger(value.revision) || value.revision < 0)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay revision is invalid.')
  return {
    ...(value.applied == null ? {} : { applied: value.applied }),
    ...(value.revision == null ? {} : { revision: value.revision }),
  }
}

function replayResponse(value) {
  if (!isRecord(value)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay response is invalid.')
  const applied = replayApplied(value)
  if (value.kind === 'translate') {
    if (!hasExactKeys(value, ['kind', 'objectId', 'position'], ['applied', 'revision']) || !descriptorId(value.objectId)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay translate response is invalid.')
    return Object.freeze({ kind: value.kind, objectId: value.objectId, position: replayPosition(value.position), ...applied })
  }
  if (value.kind === 'aim_commit') {
    if (!hasExactKeys(value, ['kind', 'objectId', 'origin', 'pointer', 'position', 'angle', 'distance', 'route'], ['applied', 'revision'])
        || !descriptorId(value.objectId) || !Number.isFinite(value.angle) || !Number.isFinite(value.distance) || value.distance < 0
        || !['line', 'wormhole'].includes(value.route)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay aim response is invalid.')
    return Object.freeze({
      kind: value.kind, objectId: value.objectId, origin: replayPoint(value.origin), pointer: replayPoint(value.pointer),
      position: replayPosition(value.position), angle: value.angle, distance: value.distance, route: value.route, ...applied,
    })
  }
  if (value.kind === 'drop') {
    if (!hasExactKeys(value, ['kind', 'objectId', 'point'], ['applied', 'revision']) || !descriptorId(value.objectId)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay drop response is invalid.')
    return Object.freeze({ kind: value.kind, objectId: value.objectId, point: replayPoint(value.point), ...applied })
  }
  if (value.kind === 'signal_graph') {
    if (!hasExactKeys(value, ['kind', 'signals'], ['applied', 'appliedSignals', 'revision']) || !Array.isArray(value.signals) || value.signals.length > 32
        || (value.appliedSignals != null && (!Number.isInteger(value.appliedSignals) || value.appliedSignals < 0 || value.appliedSignals > 32))) {
      fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay signal response is invalid.')
    }
    const signals = value.signals.map((entry) => {
      if (!hasExactKeys(entry, ['signalId', 'value']) || !descriptorId(entry.signalId) || !Number.isFinite(entry.value)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay signal is invalid.')
      return Object.freeze({ signalId: entry.signalId, value: entry.value })
    })
    return Object.freeze({ kind: value.kind, signals: Object.freeze(signals), ...(value.appliedSignals == null ? {} : { appliedSignals: value.appliedSignals }), ...applied })
  }
  fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay response kind is invalid.')
}

function replayTopology(value) {
  if (value == null) return null
  if (!hasExactKeys(value, ['displays']) || !Array.isArray(value.displays) || value.displays.length > 16) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay topology is invalid.')
  return Object.freeze({ displays: Object.freeze(value.displays.map((display) => {
    if (!hasExactKeys(display, ['displayId', 'index', 'bounds'])
        || (!['string', 'number'].includes(typeof display.displayId) && display.displayId !== null)
        || (typeof display.displayId === 'number' && !Number.isInteger(display.displayId))
        || (display.index != null && (!Number.isInteger(display.index) || display.index < 0 || display.index > 1024))
        || (display.bounds != null && (!Array.isArray(display.bounds) || display.bounds.length !== 4 || !display.bounds.every(Number.isFinite)))) {
      fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay display topology is invalid.')
    }
    if (typeof display.displayId === 'string' && display.displayId.length > 128) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay display identifier is invalid.')
    return Object.freeze({ displayId: display.displayId, index: display.index, bounds: display.bounds == null ? null : Object.freeze([...display.bounds]) })
  })) })
}

function normalizeReplayEvent(value) {
  const topLevel = ['contract', 'schemaVersion', 'type', 'sequence', 'stageId', 'ownerId', 'resourceId', 'affordanceId', 'interactionId', 'gesture', 'coordinates', 'topology', 'response', 'at']
  if (!hasExactKeys(value, topLevel) || value.contract !== 'aos.scene.event.v1' || value.schemaVersion !== 1
      || value.type !== 'gesture' || !Number.isInteger(value.sequence) || value.sequence < 1
      || value.stageId !== 'desktop-world/main' || !OWNER_ID.test(value.ownerId ?? '')
      || !descriptorId(value.resourceId) || !descriptorId(value.affordanceId) || !descriptorId(value.interactionId)
      || !Number.isFinite(value.at) || value.at < 0) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay event is invalid.')
  const gesture = value.gesture
  if (!hasExactKeys(gesture, ['id', 'kind', 'phase', 'pointerSessionId', 'cancellationReason'])
      || typeof gesture.id !== 'string' || gesture.id.length < 1 || gesture.id.length > 256
      || !GESTURE_KINDS.has(gesture.kind) || !GESTURE_PHASES.has(gesture.phase)
      || gesture.pointerSessionId != null && (typeof gesture.pointerSessionId !== 'string' || gesture.pointerSessionId.length > 256)
      || gesture.phase === 'cancel' && !CANCELLATION_REASONS.has(gesture.cancellationReason)
      || gesture.phase !== 'cancel' && gesture.cancellationReason !== null) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay gesture is invalid.')
  const coordinates = value.coordinates
  const coordinateKeys = ['origin', 'previous', 'current', 'desktopWorld', 'native', 'delta', 'totalDelta']
  if (!hasExactKeys(coordinates, coordinateKeys)) fail('INVALID_SCENE_REPLAY_EVENT', 'Scene replay coordinates are invalid.')
  return Object.freeze({
    contract: value.contract, schemaVersion: 1, type: 'gesture', sequence: value.sequence, stageId: value.stageId,
    ownerId: value.ownerId, resourceId: value.resourceId, affordanceId: value.affordanceId, interactionId: value.interactionId,
    gesture: Object.freeze({ ...gesture }),
    coordinates: Object.freeze(Object.fromEntries(coordinateKeys.map((key) => [key, replayPoint(coordinates[key])]))),
    topology: replayTopology(value.topology), response: replayResponse(value.response), at: value.at,
  })
}

export function replayDesktopWorldSceneEvents(values, { onEvent = () => {} } = {}) {
  if (!Array.isArray(values) || values.length > DESKTOP_WORLD_SCENE_REPLAY_LIMITS.events) {
    fail('SCENE_REPLAY_LIMIT_EXCEEDED', 'Scene replay exceeds the event budget.')
  }
  const sequences = new Map()
  const active = new Map()
  const resources = new Set()
  const finalPositions = new Map()
  let completed = 0
  let canceled = 0
  for (const raw of values) {
    const event = normalizeReplayEvent(raw)
    const lease = `${event.ownerId}::${event.resourceId}`
    const previousSequence = sequences.get(lease) ?? 0
    if (event.sequence <= previousSequence) fail('SCENE_REPLAY_SEQUENCE_INVALID', 'Scene replay sequence is not monotonic.')
    sequences.set(lease, event.sequence)
    resources.add(event.resourceId)
    if (resources.size > DESKTOP_WORLD_SCENE_REPLAY_LIMITS.resources) {
      fail('SCENE_REPLAY_LIMIT_EXCEEDED', 'Scene replay exceeds the resource budget.')
    }
    const gesture = `${lease}::${event.gesture.id}`
    if (event.gesture.phase === 'start') {
      if (active.has(gesture)) fail('SCENE_REPLAY_LIFECYCLE_INVALID', 'Scene replay starts an active gesture twice.')
      active.set(gesture, Object.freeze({
        kind: event.gesture.kind,
        affordanceId: event.affordanceId,
        interactionId: event.interactionId,
        pointerSessionId: event.gesture.pointerSessionId,
      }))
    } else {
      const started = active.get(gesture)
      if (!started) fail('SCENE_REPLAY_LIFECYCLE_INVALID', 'Scene replay event has no active gesture.')
      if (started.kind !== event.gesture.kind || started.affordanceId !== event.affordanceId
          || started.interactionId !== event.interactionId || started.pointerSessionId !== event.gesture.pointerSessionId) {
        fail('SCENE_REPLAY_LIFECYCLE_INVALID', 'Scene replay gesture identity changed during its lifecycle.')
      }
    }
    if (event.gesture.phase === 'end' || event.gesture.phase === 'cancel') {
      active.delete(gesture)
      if (event.gesture.phase === 'cancel') canceled += 1
      else completed += 1
    }
    if (event.gesture.phase === 'end' && ['aim_commit', 'translate'].includes(event.response.kind)
        && Array.isArray(event.response.position) && event.response.position.length === 3
        && event.response.position.every(Number.isFinite)) {
      finalPositions.set(event.resourceId, Object.freeze([...event.response.position]))
    }
    onEvent(event)
  }
  if (active.size > 0) fail('SCENE_REPLAY_INCOMPLETE', 'Scene replay ended with active gestures.')
  return Object.freeze({
    status: 'ok',
    contract: 'aos.scene.replay.v1',
    eventCount: values.length,
    resourceCount: resources.size,
    resources: Object.freeze([...resources].sort()),
    completedGestures: completed,
    canceledGestures: canceled,
    finalPositions: Object.freeze(Object.fromEntries([...finalPositions].sort(([left], [right]) => left.localeCompare(right)))),
  })
}

export function createDesktopWorldSceneClient({ request, subscribe } = {}) {
  if (typeof request !== 'function') throw new TypeError('DesktopWorld scene client requires a request transport.')
  const call = (action, data = {}) => request({ service: 'scene', action, data })
  const delay = () => new Promise((resolve) => setTimeout(resolve, HEADLESS_SNAPSHOT_DELAY_MS))
  async function withHeadlessSnapshot(resource, project) {
    let session = null
    let revision = null
    let primaryError = null
    try {
      const opened = await call('devtools_open', {
        headless: true,
        ...(resource == null ? {} : { resource: resourceId(resource) }),
      })
      session = sessionId(opened?.session?.session?.id)
      revision = devtoolsRevision(opened?.session?.session?.revision)
      for (let attempt = 0; attempt < HEADLESS_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const status = await call('devtools_status', { session })
        const snapshot = status?.session
        const currentRevision = snapshot?.session?.revision
        if (Number.isInteger(currentRevision)) revision = currentRevision
        if (snapshot?.stage?.status === 'available') return project(snapshot)
        if (attempt + 1 < HEADLESS_SNAPSHOT_ATTEMPTS) await delay()
      }
      fail('SCENE_SNAPSHOT_TIMEOUT', 'DesktopWorld scene snapshot did not become available.')
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      if (session != null) {
        try {
          await call('devtools_close', { session, expected_revision: revision })
        } catch {
          try { await call('devtools_close', { session }) }
          catch (cleanupError) { if (primaryError == null) throw cleanupError }
        }
      }
    }
  }
  return Object.freeze({
    list: () => withHeadlessSnapshot(null, listDesktopWorldResources),
    inspect: (resource) => withHeadlessSnapshot(resource, (snapshot) => selectDesktopWorldResourceSnapshot(snapshot, resource)),
    perf: (resource) => withHeadlessSnapshot(resource, (snapshot) => {
      const stage = selectDesktopWorldResourceSnapshot(snapshot, resource)
      return Object.freeze({
        status: 'ok',
        resource: stage.resources[0],
        performance: stage.performance,
      })
    }),
    monitor(resource, options = {}) {
      if (typeof subscribe !== 'function') throw new TypeError('DesktopWorld scene client requires a subscription transport.')
      return subscribe({ ...options, service: 'scene', action: 'devtools_monitor', data: { resource: resourceId(resource) } })
    },
    replay: replayDesktopWorldSceneEvents,
    devtools: Object.freeze({
      open: ({ resource = null, host = null, headless = false } = {}) => call('devtools_open', {
        ...(resource == null ? {} : { resource: resourceId(resource) }),
        ...(host == null ? {} : { host }),
        ...(headless ? { headless: true } : {}),
      }),
      status: (session = null) => call('devtools_status', session == null ? {} : { session: sessionId(session) }),
      update: (session, expectedRevision, changes = {}) => call('devtools_update', {
        ...changes, session: sessionId(session), expected_revision: devtoolsRevision(expectedRevision),
      }),
      transfer: (session, expectedRevision, host) => call('devtools_transfer', {
        session: sessionId(session), expected_revision: devtoolsRevision(expectedRevision), host,
      }),
      close: (session, expectedRevision = null) => call('devtools_close', {
        session: sessionId(session), ...(expectedRevision == null ? {} : { expected_revision: devtoolsRevision(expectedRevision) }),
      }),
    }),
  })
}
