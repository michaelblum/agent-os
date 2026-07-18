import {
  appendRenderSample,
  summarizeRenderPerformance,
} from '../components/render-performance/model.js'

export const DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID = 'aos.desktop-world.devtools.stage.v1'
export const DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID = 'aos.desktop-world.devtools.snapshot.v1'

export const DESKTOP_WORLD_DEVTOOLS_LIMITS = Object.freeze({
  events: 256,
  filters: 16,
  hitRegions: 256,
  interactions: 256,
  nodes: 1024,
  performanceSamples: 240,
  resources: 32,
  string: 256,
})

const TABS = Object.freeze(['world', 'resources', 'interactions', 'performance', 'events'])
const HOST_KINDS = Object.freeze(['compatibility', 'external', 'panel'])
const HOST_STATES = Object.freeze(['activating', 'active', 'suspended'])
const GPU_TIMER_QUERY_BUDGET = 4

function boundedString(value, fallback = '', limit = DESKTOP_WORLD_DEVTOOLS_LIMITS.string) {
  return typeof value === 'string' ? value.slice(0, limit) : fallback
}

function finite(value, fallback = null, min = -1e9, max = 1e9) {
  if (value == null || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function boundedInteger(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = finite(value, fallback, min, max)
  return Math.floor(number)
}

function point(value, dimensions = 2) {
  if (!Array.isArray(value) || value.length < dimensions) return null
  const output = []
  for (let index = 0; index < dimensions; index += 1) {
    const number = finite(value[index])
    if (number === null) return null
    output.push(number)
  }
  return output
}

function uniqueStrings(values, limit = 32) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => boundedString(value)).filter(Boolean))].slice(0, limit)
}

function normalizeDisplay(value = {}, index = 0) {
  const bounds = point(value.bounds, 4)
  if (!bounds || bounds[2] <= 0 || bounds[3] <= 0) return null
  return Object.freeze({
    id: boundedString(value.id ?? value.displayId, `display-${index}`),
    index: boundedInteger(value.index, index, 0, 31),
    bounds: Object.freeze(bounds),
  })
}

function normalizeNode(value = {}) {
  const id = boundedString(value.id)
  const position = point(value.position, 3)
  if (!id || !position) return null
  return Object.freeze({
    id,
    resourceId: boundedString(value.resourceId),
    parentId: value.parentId == null ? null : boundedString(value.parentId),
    kind: boundedString(value.kind, 'group', 32),
    implementation: value.implementation == null ? null : boundedString(value.implementation),
    position: Object.freeze(position),
    visible: value.visible !== false,
  })
}

function normalizeRegion(value = {}) {
  const id = boundedString(value.id)
  const frame = point(value.frame, 4)
  if (!id || !frame || frame[2] <= 0 || frame[3] <= 0) return null
  return Object.freeze({
    id,
    resourceId: boundedString(value.resourceId),
    affordanceId: boundedString(value.affordanceId),
    frame: Object.freeze(frame),
    registered: value.registered === true,
  })
}

function normalizeAffordance(value = {}) {
  const id = boundedString(value.id)
  if (!id) return null
  return Object.freeze({
    id,
    resourceId: boundedString(value.resourceId),
    objectId: boundedString(value.objectId),
    enabled: value.enabled !== false,
    priority: boundedInteger(value.priority, 0, 0, 1000),
  })
}

function normalizeGesture(value = {}) {
  const id = boundedString(value.id ?? value.gestureId)
  if (!id) return null
  return Object.freeze({
    id,
    resourceId: boundedString(value.resourceId),
    affordanceId: boundedString(value.affordanceId),
    interactionId: boundedString(value.interactionId),
    kind: boundedString(value.kind, 'unknown', 32),
    phase: boundedString(value.phase, 'unknown', 32),
    pointerSessionId: value.pointerSessionId == null ? null : boundedString(value.pointerSessionId),
  })
}

function normalizeRoute(value = {}) {
  const resourceId = boundedString(value.resourceId)
  const origin = point(value.origin, 2)
  const destination = point(value.destination, 2)
  if (!resourceId || !origin || !destination) return null
  return Object.freeze({
    resourceId,
    kind: value.kind === 'wormhole' ? 'wormhole' : 'line',
    active: value.active === true,
    progress: finite(value.progress, 0, 0, 1),
    origin: Object.freeze(origin),
    destination: Object.freeze(destination),
  })
}

function normalizeResource(value = {}) {
  const id = boundedString(value.id ?? value.resourceId)
  if (!id) return null
  const allocations = value.allocations && typeof value.allocations === 'object' ? value.allocations : {}
  return Object.freeze({
    id,
    owner: boundedString(value.owner),
    sceneId: boundedString(value.sceneId),
    revision: boundedInteger(value.revision, 0),
    suspended: value.suspended === true,
    objectCount: boundedInteger(value.objectCount, 0, 0, DESKTOP_WORLD_DEVTOOLS_LIMITS.nodes),
    descriptorCount: boundedInteger(value.descriptorCount, 0, 0, DESKTOP_WORLD_DEVTOOLS_LIMITS.nodes),
    animationCount: boundedInteger(value.animationCount, 0, 0, 1024),
    signalCount: boundedInteger(value.signalCount, 0, 0, 1024),
    interactionCount: boundedInteger(value.interactionCount, 0, 0, DESKTOP_WORLD_DEVTOOLS_LIMITS.interactions),
    implementations: Object.freeze(uniqueStrings(value.implementations, 128)),
    allocations: Object.freeze({
      geometries: boundedInteger(allocations.geometries, 0, 0, 100_000),
      materials: boundedInteger(allocations.materials, 0, 0, 100_000),
      textures: boundedInteger(allocations.textures, 0, 0, 100_000),
      programs: boundedInteger(allocations.programs, 0, 0, 100_000),
    }),
    lifecycle: boundedString(value.lifecycle, value.suspended === true ? 'suspended' : 'active', 32),
    errorCode: value.errorCode == null ? null : boundedString(value.errorCode, '', 64),
  })
}

function normalizeInteraction(value = {}) {
  const id = boundedString(value.id ?? value.key)
  if (!id) return null
  return Object.freeze({
    id,
    resourceId: boundedString(value.resourceId ?? value.resource),
    owner: boundedString(value.owner),
    active: value.active === true,
    suspended: value.suspended === true,
    recognizers: uniqueStrings(value.recognizers, 32),
    regionCount: boundedInteger(value.regionCount ?? value.registered, 0, 0, DESKTOP_WORLD_DEVTOOLS_LIMITS.hitRegions),
    errorCode: value.errorCode == null && value.regionSyncErrorCode == null
      ? null
      : boundedString(value.errorCode ?? value.regionSyncErrorCode, '', 64),
  })
}

function normalizePerformance(value = {}) {
  const metric = (key, min = 0, max = 1e9) => finite(value[key], null, min, max)
  return Object.freeze({
    enabled: value.enabled === true,
    recording: value.recording === true,
    sampleCount: boundedInteger(value.sampleCount, 0, 0, DESKTOP_WORLD_DEVTOOLS_LIMITS.performanceSamples),
    currentFps: metric('currentFps', 0, 1000),
    p95FrameMs: metric('p95FrameMs'),
    avgFrameMs: metric('avgFrameMs'),
    avgRenderMs: metric('avgRenderMs'),
    avgUpdateMs: metric('avgUpdateMs'),
    avgGpuMs: metric('avgGpuMs'),
    drawCalls: metric('drawCalls'),
    triangles: metric('triangles'),
    geometries: metric('geometries'),
    textures: metric('textures'),
    programs: metric('programs'),
    backingPixels: metric('backingPixels'),
    state: ['hot', 'idle', 'stable', 'warn'].includes(value.state) ? value.state : 'idle',
  })
}

function normalizeEvent(value = {}, index = 0) {
  return Object.freeze({
    sequence: boundedInteger(value.sequence, index + 1),
    kind: boundedString(value.kind, 'unknown', 64),
    resourceId: value.resourceId == null ? null : boundedString(value.resourceId),
    code: value.code == null ? null : boundedString(value.code, '', 64),
    at: finite(value.at, 0, 0, Number.MAX_SAFE_INTEGER),
  })
}

function boundedNormalized(values, limit, normalize) {
  return Object.freeze((Array.isArray(values) ? values : []).slice(0, limit).map(normalize).filter(Boolean))
}

export function createDesktopWorldGpuTimer(context) {
  const webgl2Extension = context?.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null
  const webgl1Extension = webgl2Extension ? null : context?.getExtension?.('EXT_disjoint_timer_query') ?? null
  const extension = webgl2Extension ?? webgl1Extension
  const webgl2 = Boolean(webgl2Extension && context?.createQuery && context?.beginQuery && context?.endQuery)
  const createQuery = webgl2
    ? () => context.createQuery()
    : () => webgl1Extension?.createQueryEXT?.() ?? null
  const deleteQuery = webgl2
    ? (query) => context.deleteQuery?.(query)
    : (query) => webgl1Extension?.deleteQueryEXT?.(query)
  const beginQuery = webgl2
    ? (query) => context.beginQuery(extension.TIME_ELAPSED_EXT, query)
    : (query) => webgl1Extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query)
  const endQuery = webgl2
    ? () => context.endQuery(extension.TIME_ELAPSED_EXT)
    : () => webgl1Extension.endQueryEXT(extension.TIME_ELAPSED_EXT)
  const resultAvailable = webgl2
    ? (query) => context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)
    : (query) => webgl1Extension.getQueryObjectEXT(query, webgl1Extension.QUERY_RESULT_AVAILABLE_EXT)
  const queryResult = webgl2
    ? (query) => context.getQueryParameter(query, context.QUERY_RESULT)
    : (query) => webgl1Extension.getQueryObjectEXT(query, webgl1Extension.QUERY_RESULT_EXT)
  const disjointToken = extension?.GPU_DISJOINT_EXT
  const supported = Boolean(extension && disjointToken != null)
  const available = []
  const pending = []
  let active = null
  let disposed = false
  let lastMilliseconds = null

  if (supported) {
    for (let index = 0; index < GPU_TIMER_QUERY_BUDGET; index += 1) {
      const query = createQuery()
      if (query) available.push(query)
    }
  }

  function poll() {
    if (disposed || !supported) return null
    while (pending.length > 0) {
      const query = pending[0]
      let ready = false
      try { ready = resultAvailable(query) === true }
      catch { ready = false }
      if (!ready) break
      pending.shift()
      try {
        const disjoint = context.getParameter(disjointToken) === true
        const nanoseconds = Number(queryResult(query))
        if (!disjoint && Number.isFinite(nanoseconds) && nanoseconds >= 0) {
          lastMilliseconds = nanoseconds / 1_000_000
        } else if (disjoint) {
          lastMilliseconds = null
        }
      } catch {
        lastMilliseconds = null
      }
      available.push(query)
    }
    return lastMilliseconds
  }

  return Object.freeze({
    begin() {
      if (disposed || !supported || active) return false
      poll()
      const query = available.pop()
      if (!query) return false
      try {
        beginQuery(query)
        active = query
        return true
      } catch {
        available.push(query)
        return false
      }
    },
    dispose() {
      if (disposed) return false
      if (active) {
        try { endQuery() } catch {}
        pending.push(active)
        active = null
      }
      disposed = true
      for (const query of [...available, ...pending]) {
        try { deleteQuery(query) } catch {}
      }
      available.length = 0
      pending.length = 0
      lastMilliseconds = null
      return true
    },
    end() {
      if (disposed || !supported) return null
      if (active) {
        try {
          endQuery()
          pending.push(active)
        } catch {
          try { deleteQuery(active) } catch {}
        }
        active = null
      }
      return poll()
    },
    poll,
    state() {
      return Object.freeze({
        active: active !== null,
        available: available.length,
        disposed,
        pending: pending.length,
        supported: supported && available.length + pending.length + (active ? 1 : 0) > 0,
      })
    },
  })
}

export function normalizeDesktopWorldDevToolsStageSnapshot(input = {}) {
  if (input.contract !== DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID) throw new TypeError('Invalid DesktopWorld DevTools stage contract.')
  const world = input.world && typeof input.world === 'object' ? input.world : {}
  const events = boundedNormalized(input.events, DESKTOP_WORLD_DEVTOOLS_LIMITS.events, normalizeEvent)
  const resources = boundedNormalized(input.resources, DESKTOP_WORLD_DEVTOOLS_LIMITS.resources, normalizeResource)
  const nodes = boundedNormalized(world.nodes, DESKTOP_WORLD_DEVTOOLS_LIMITS.nodes, normalizeNode)
  const hitRegions = boundedNormalized(world.hitRegions, DESKTOP_WORLD_DEVTOOLS_LIMITS.hitRegions, normalizeRegion)
  const affordances = boundedNormalized(world.affordances, DESKTOP_WORLD_DEVTOOLS_LIMITS.hitRegions, normalizeAffordance)
  const gestures = boundedNormalized(world.gestures, DESKTOP_WORLD_DEVTOOLS_LIMITS.interactions, normalizeGesture)
  const routes = boundedNormalized(world.routes, DESKTOP_WORLD_DEVTOOLS_LIMITS.resources, normalizeRoute)
  const interactions = boundedNormalized(input.interactions, DESKTOP_WORLD_DEVTOOLS_LIMITS.interactions, normalizeInteraction)
  const displays = boundedNormalized(world.displays, 16, normalizeDisplay)
  return Object.freeze({
    contract: DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
    sequence: boundedInteger(input.sequence, 0),
    status: ['available', 'unavailable'].includes(input.status) ? input.status : 'unknown',
    world: Object.freeze({ displays, nodes, hitRegions, affordances, gestures, routes }),
    resources,
    interactions,
    performance: normalizePerformance(input.performance),
    counters: Object.freeze({
      displays: displays.length,
      resources: resources.length,
      nodes: nodes.length,
      hitRegions: hitRegions.length,
      affordances: affordances.length,
      activeGestures: gestures.filter((entry) => entry.phase !== 'end' && entry.phase !== 'cancel').length,
      activeRoutes: routes.filter((entry) => entry.active).length,
      errors: resources.filter((entry) => entry.errorCode).length + interactions.filter((entry) => entry.errorCode).length,
    }),
    events,
    lastError: input.lastError && typeof input.lastError === 'object'
      ? Object.freeze({ code: boundedString(input.lastError.code, 'UNKNOWN', 64), at: finite(input.lastError.at, 0, 0, Number.MAX_SAFE_INTEGER) })
      : null,
  })
}

function normalizeHost(value) {
  if (!value || !HOST_KINDS.includes(value.kind) || !HOST_STATES.includes(value.state)) return null
  const id = boundedString(value.id)
  return id ? Object.freeze({ kind: value.kind, id, state: value.state }) : null
}

export function normalizeDesktopWorldDevToolsSnapshot(input = {}) {
  if (input.contract !== DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID) throw new TypeError('Invalid DesktopWorld DevTools snapshot contract.')
  const session = input.session && typeof input.session === 'object' ? input.session : {}
  const filters = session.filters && typeof session.filters === 'object' ? session.filters : {}
  const stage = normalizeDesktopWorldDevToolsStageSnapshot(input.stage)
  return Object.freeze({
    contract: DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
    schemaVersion: 1,
    session: Object.freeze({
      id: boundedString(session.id),
      revision: boundedInteger(session.revision, 0),
      activeTab: TABS.includes(session.activeTab) ? session.activeTab : 'world',
      selectedResource: session.selectedResource == null ? null : boundedString(session.selectedResource),
      filters: Object.freeze({
        query: boundedString(filters.query, '', 128),
        eventKinds: Object.freeze(uniqueStrings(filters.eventKinds, DESKTOP_WORLD_DEVTOOLS_LIMITS.filters)),
        errorsOnly: filters.errorsOnly === true,
      }),
      recording: session.recording === true,
      host: normalizeHost(session.host),
    }),
    stage,
  })
}

export function buildDesktopWorldMinimapLayout(snapshot, { width = 640, height = 360, padding = 16 } = {}) {
  const stage = snapshot?.stage?.world ? snapshot.stage : normalizeDesktopWorldDevToolsStageSnapshot(snapshot)
  const displays = stage.world.displays
  if (displays.length === 0) return Object.freeze({ bounds: null, scale: 1, displays: [], nodes: [], hitRegions: [] })
  const minX = Math.min(...displays.map((entry) => entry.bounds[0]))
  const minY = Math.min(...displays.map((entry) => entry.bounds[1]))
  const maxX = Math.max(...displays.map((entry) => entry.bounds[0] + entry.bounds[2]))
  const maxY = Math.max(...displays.map((entry) => entry.bounds[1] + entry.bounds[3]))
  const worldWidth = Math.max(1, maxX - minX)
  const worldHeight = Math.max(1, maxY - minY)
  const usableWidth = Math.max(1, finite(width, 640, 1, 4096) - padding * 2)
  const usableHeight = Math.max(1, finite(height, 360, 1, 4096) - padding * 2)
  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight)
  const projectPoint = ([x, y]) => [padding + (x - minX) * scale, padding + (y - minY) * scale]
  const projectRect = ([x, y, w, h]) => [...projectPoint([x, y]), w * scale, h * scale]
  return Object.freeze({
    bounds: Object.freeze([minX, minY, worldWidth, worldHeight]),
    scale,
    displays: Object.freeze(displays.map((entry) => Object.freeze({ ...entry, frame: Object.freeze(projectRect(entry.bounds)) }))),
    nodes: Object.freeze(stage.world.nodes.map((entry) => Object.freeze({ ...entry, point: Object.freeze(projectPoint(entry.position)) }))),
    hitRegions: Object.freeze(stage.world.hitRegions.map((entry) => Object.freeze({ ...entry, frame: Object.freeze(projectRect(entry.frame)) }))),
  })
}

export function createDesktopWorldDevToolsStageProbe({
  now = () => performance.now(),
  emit = () => {},
  getStageFacts = () => ({}),
} = {}) {
  const samples = []
  const events = []
  let enabled = false
  let recording = false
  let disposed = false
  let sequence = 0
  let eventSequence = 0
  let lastSampleAt = -Infinity
  let lastEmitAt = -Infinity

  function configure(next = {}) {
    if (disposed) return false
    enabled = next.enabled === true
    recording = enabled && next.recording === true
    if (!enabled) {
      samples.length = 0
      events.length = 0
      lastSampleAt = -Infinity
      lastEmitAt = -Infinity
    }
    return true
  }

  function recordEvent(value = {}) {
    if (!enabled || disposed) return false
    eventSequence += 1
    events.push(normalizeEvent({ ...value, sequence: eventSequence, at: finite(value.at, now()) }))
    while (events.length > DESKTOP_WORLD_DEVTOOLS_LIMITS.events) events.shift()
    return true
  }

  function performanceSnapshot() {
    const summary = summarizeRenderPerformance(samples, { now: Date.now() })
    const latest = summary.latest ?? {}
    return {
      enabled,
      recording,
      sampleCount: samples.length,
      currentFps: summary.currentFps,
      p95FrameMs: summary.p95FrameMs,
      avgFrameMs: summary.avgFrameMs,
      avgRenderMs: summary.avgRenderMs,
      avgUpdateMs: summary.avgUpdateMs,
      avgGpuMs: summary.avgGpuMs,
      drawCalls: latest.drawCalls,
      triangles: latest.triangles,
      geometries: latest.geometries,
      textures: latest.textures,
      programs: latest.programs,
      backingPixels: latest.backingPixels,
      state: summary.state,
    }
  }

  function snapshot(reason = 'snapshot') {
    const facts = getStageFacts() ?? {}
    sequence += 1
    return normalizeDesktopWorldDevToolsStageSnapshot({
      contract: DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
      sequence,
      status: facts.status ?? 'available',
      world: facts.world,
      resources: facts.resources,
      interactions: facts.interactions,
      performance: performanceSnapshot(),
      events,
      lastError: facts.lastError,
      reason,
    })
  }

  function emitSnapshot(reason = 'snapshot', at = now()) {
    if (!enabled || disposed) return false
    emit(snapshot(reason))
    lastEmitAt = at
    return true
  }

  function sampleFrame(value = {}) {
    if (!enabled || disposed) return false
    const at = finite(value.renderEndedAt, now())
    const sampleInterval = recording ? 0 : 500
    if (at - lastSampleAt >= sampleInterval) {
      appendRenderSample(samples, {
        ts: Date.now(),
        frameMs: finite(value.frameMs),
        renderMs: finite(value.renderMs),
        updateMs: finite(value.updateMs),
        gpuMs: finite(value.gpuMs),
        targetFps: value.targetFps,
        drawCalls: value.drawCalls,
        triangles: value.triangles,
        geometries: value.geometries,
        textures: value.textures,
        programs: value.programs,
        backingPixels: value.backingPixels,
      }, { limit: DESKTOP_WORLD_DEVTOOLS_LIMITS.performanceSamples, now: Date.now(), source: 'desktop-world' })
      lastSampleAt = at
    }
    if (at - lastEmitAt >= 500) emitSnapshot('frame', at)
    return true
  }

  return Object.freeze({
    configure,
    dispose() {
      if (disposed) return false
      disposed = true
      samples.length = 0
      events.length = 0
      return true
    },
    emitSnapshot,
    isEnabled() { return enabled && !disposed },
    isRecording() { return enabled && recording && !disposed },
    recordEvent,
    sampleFrame,
    snapshot,
    state() {
      return Object.freeze({
        disposed,
        enabled,
        recording,
        eventCount: events.length,
        sampleCount: samples.length,
        hasOwnFrameLoop: false,
      })
    },
  })
}
