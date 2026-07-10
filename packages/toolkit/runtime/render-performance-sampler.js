export function finiteOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function createRenderPerformanceSampler({
  telemetry,
  source = 'render-surface',
  targetId,
  isEnabled = () => true,
  isVisible = () => true,
  getRendererInfo = () => null,
  getRenderLoopWork = () => null,
  post = () => {},
  warn = () => {},
  throttleMs = 500,
} = {}) {
  if (typeof telemetry !== 'function') {
    throw new TypeError('createRenderPerformanceSampler requires telemetry')
  }
  let lastFrameAt = null
  let lastSampleAt = 0

  function postSample({ frameStartedAt, renderStartedAt, renderEndedAt } = {}) {
    const state = telemetry()
    state.attempted += 1
    if (!isEnabled()) {
      state.skipped = 'disabled'
      return { posted: false, skipped: state.skipped }
    }
    if (!isVisible()) {
      state.skipped = 'hidden'
      lastFrameAt = null
      return { posted: false, skipped: state.skipped }
    }
    const now = renderEndedAt
    const frameMs = lastFrameAt == null ? null : now - lastFrameAt
    lastFrameAt = now
    if (now - lastSampleAt < throttleMs) {
      state.skipped = 'throttled'
      return { posted: false, skipped: state.skipped }
    }
    if (!Number.isFinite(frameMs) || frameMs <= 0) {
      state.skipped = 'invalid-frame'
      return { posted: false, skipped: state.skipped }
    }
    lastSampleAt = now
    const info = getRendererInfo() || {}
    const work = getRenderLoopWork() || {}
    const message = {
      target: targetId,
      message: {
        type: 'render-performance/sample',
        payload: {
          source,
          targetFps: work.visualOnly ? 30 : 60,
          frameMs,
          updateMs: renderStartedAt - frameStartedAt,
          renderMs: renderEndedAt - renderStartedAt,
          drawCalls: finiteOrNull(info?.render?.calls),
          triangles: finiteOrNull(info?.render?.triangles),
          points: finiteOrNull(info?.render?.points),
          lines: finiteOrNull(info?.render?.lines),
          geometries: finiteOrNull(info?.memory?.geometries),
          textures: finiteOrNull(info?.memory?.textures),
        },
      },
    }
    try {
      post(message)
      state.sent += 1
      state.skipped = null
      state.lastError = null
      return { posted: true, message }
    } catch (error) {
      state.lastError = String(error?.message || error)
      warn('[toolkit] render-performance sample failed:', error)
      return { posted: false, error }
    }
  }

  return Object.freeze({
    postSample,
    reset() {
      lastFrameAt = null
      lastSampleAt = 0
    },
  })
}
