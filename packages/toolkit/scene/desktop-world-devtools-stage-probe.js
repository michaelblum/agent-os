import {
  appendRenderSample,
  summarizeRenderPerformance,
} from '../components/render-performance/model.js'

export function createDesktopWorldDevToolsStageProbeLifecycle({
  now = () => performance.now(),
  emit = () => {},
  getPerformanceDisplay = () => null,
  getStageIdentity = () => ({}),
  getStageFacts = () => ({}),
} = {}, {
  authoritativeDisplayId,
  boundedInteger,
  limits,
  normalizeEvent,
  normalizeStageSnapshot,
  stageContractId,
}) {
  const samples = []
  const events = []
  let enabled = false
  let recording = false
  let disposed = false
  let sequence = 0
  let eventSequence = 0
  let lastSampleAt = -Infinity
  let lastEmitAt = -Infinity
  let sampleIdentity = null
  let readyIdentity = null

  function normalizeSampleIdentity(stage = {}, display = {}) {
    const canvasGeneration = boundedInteger(stage.canvasGeneration, 0)
    const topologyGeneration = boundedInteger(stage.topologyGeneration, 0)
    const displayId = authoritativeDisplayId(display.displayId)
    const displayIndex = boundedInteger(display.displayIndex, -1, -1, 31)
    if (canvasGeneration < 1 || topologyGeneration < 1 || !displayId || displayIndex < 0) return null
    return { canvasGeneration, topologyGeneration, displayId, displayIndex }
  }

  function readSampleIdentity() {
    const current = normalizeSampleIdentity(
      getStageIdentity() ?? {},
      getPerformanceDisplay() ?? {},
    )
    return sameSampleIdentity(readyIdentity, current) ? current : null
  }

  function sameSampleIdentity(left, right) {
    return left?.canvasGeneration === right?.canvasGeneration
      && left?.topologyGeneration === right?.topologyGeneration
      && left?.displayId === right?.displayId
      && left?.displayIndex === right?.displayIndex
  }

  function synchronizeSampleIdentity() {
    const next = readSampleIdentity()
    if (!sameSampleIdentity(sampleIdentity, next)) {
      samples.length = 0
      lastSampleAt = -Infinity
      lastEmitAt = -Infinity
      sampleIdentity = next
    }
    return next
  }

  function configure(next = {}) {
    if (disposed) return false
    enabled = next.enabled === true
    recording = enabled && next.recording === true
    if (!enabled) {
      samples.length = 0
      events.length = 0
      lastSampleAt = -Infinity
      lastEmitAt = -Infinity
      sampleIdentity = null
    }
    return true
  }

  function recordEvent(value = {}) {
    if (!enabled || disposed || !synchronizeSampleIdentity()) return false
    eventSequence += 1
    events.push(normalizeEvent({ ...value, sequence: eventSequence, at: finite(value.at, now()) }))
    while (events.length > limits.events) events.shift()
    return true
  }

  function performanceSnapshot() {
    const summary = summarizeRenderPerformance(samples, { now: Date.now() })
    const latest = summary.latest ?? {}
    return {
      enabled,
      recording,
      sampleCount: samples.length,
      targetFps: summary.targetFps,
      budgetMs: summary.budgetMs,
      currentFps: summary.currentFps,
      p95FrameMs: summary.p95FrameMs,
      maxFrameMs: summary.maxFrameMs,
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
      backingWidth: latest.backingWidth,
      backingHeight: latest.backingHeight,
      damagedPixelPercentage: latest.damagedPixelPercentage,
      avgDamagedPixelPercentage: summary.avgDamagedPixelPercentage,
      effectiveDevicePixelRatio: latest.effectiveDevicePixelRatio,
      estimatedBackingBytes: latest.estimatedBackingBytes,
      msaaSamples: latest.msaaSamples,
      requestedDevicePixelRatio: latest.requestedDevicePixelRatio,
      state: summary.state,
    }
  }

  function snapshot(reason = 'snapshot') {
    const identity = synchronizeSampleIdentity()
    const facts = getStageFacts() ?? {}
    const stagePerformance = performanceSnapshot()
    sequence += 1
    return normalizeStageSnapshot({
      contract: stageContractId,
      canvasGeneration: identity?.canvasGeneration,
      topologyGeneration: identity?.topologyGeneration,
      sequence,
      status: facts.status ?? 'available',
      world: facts.world,
      resources: facts.resources,
      interactions: facts.interactions,
      displayPerformance: identity
        ? [{
            displayId: identity.displayId,
            displayIndex: identity.displayIndex,
            scope: 'stage-segment',
            performance: stagePerformance,
          }]
        : [],
      events,
      lastError: facts.lastError,
      reason,
    })
  }

  function emitSnapshot(reason = 'snapshot', at = now(), metadata = {}) {
    if (!enabled || disposed || !synchronizeSampleIdentity()) return false
    emit(snapshot(reason), metadata)
    lastEmitAt = at
    return true
  }

  function sampleFrame(value = {}) {
    if (!enabled || disposed) return false
    const identity = synchronizeSampleIdentity()
    if (!identity) return false
    const at = finite(value.renderEndedAt, now())
    const sampleInterval = recording ? 0 : 500
    if (identity && at - lastSampleAt >= sampleInterval) {
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
        backingWidth: value.backingWidth,
        backingHeight: value.backingHeight,
        damagedPixelPercentage: value.damagedPixelPercentage,
        effectiveDevicePixelRatio: value.effectiveDevicePixelRatio,
        estimatedBackingBytes: value.estimatedBackingBytes,
        msaaSamples: value.msaaSamples,
        requestedDevicePixelRatio: value.requestedDevicePixelRatio,
      }, { limit: limits.performanceSamples, now: Date.now(), source: 'desktop-world' })
      lastSampleAt = at
    }
    if (at - lastEmitAt >= 500) emitSnapshot('frame', at)
    return true
  }

  function finite(value, fallback = null, min = -1e9, max = 1e9) {
    if (value == null || value === '') return fallback
    const number = Number(value)
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  }

  return Object.freeze({
    configure,
    dispose() {
      if (disposed) return false
      disposed = true
      samples.length = 0
      events.length = 0
      sampleIdentity = null
      return true
    },
    emitSnapshot,
    isEnabled() { return enabled && !disposed },
    isRecording() { return enabled && recording && !disposed },
    recordEvent,
    sampleFrame,
    setIdentityReady(nextIdentity) {
      if (disposed) return false
      readyIdentity = nextIdentity && typeof nextIdentity === 'object'
        ? normalizeSampleIdentity(nextIdentity, nextIdentity)
        : null
      synchronizeSampleIdentity()
      return nextIdentity == null || nextIdentity === false || readyIdentity !== null
    },
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
