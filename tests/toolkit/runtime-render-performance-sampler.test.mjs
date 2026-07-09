import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createRenderPerformanceSampler,
  finiteOrNull,
} from '../../packages/toolkit/runtime/render-performance-sampler.js'

function createTelemetry() {
  const state = { attempted: 0, sent: 0, skipped: null, lastError: null }
  return {
    state,
    telemetry: () => state,
  }
}

test('finiteOrNull keeps finite numbers only', () => {
  assert.equal(finiteOrNull(4), 4)
  assert.equal(finiteOrNull('4.5'), 4.5)
  assert.equal(finiteOrNull(Number.POSITIVE_INFINITY), null)
  assert.equal(finiteOrNull(undefined), null)
})

test('RenderPerformanceSampler skips disabled, hidden, invalid, and throttled samples', () => {
  const { state, telemetry } = createTelemetry()
  let enabled = false
  let visible = true
  const sampler = createRenderPerformanceSampler({
    telemetry,
    targetId: 'perf-panel',
    isEnabled: () => enabled,
    isVisible: () => visible,
  })

  assert.deepEqual(sampler.postSample({ frameStartedAt: 0, renderStartedAt: 5, renderEndedAt: 10 }), {
    posted: false,
    skipped: 'disabled',
  })
  enabled = true
  visible = false
  assert.deepEqual(sampler.postSample({ frameStartedAt: 100, renderStartedAt: 105, renderEndedAt: 120 }), {
    posted: false,
    skipped: 'hidden',
  })
  visible = true
  assert.deepEqual(sampler.postSample({ frameStartedAt: 200, renderStartedAt: 205, renderEndedAt: 620 }), {
    posted: false,
    skipped: 'invalid-frame',
  })
  assert.equal(sampler.postSample({ frameStartedAt: 800, renderStartedAt: 805, renderEndedAt: 1240 }).posted, true)
  assert.deepEqual(sampler.postSample({ frameStartedAt: 820, renderStartedAt: 825, renderEndedAt: 1260 }), {
    posted: false,
    skipped: 'throttled',
  })
  assert.equal(state.attempted, 5)
  assert.equal(state.sent, 1)
})

test('RenderPerformanceSampler posts renderer stats and records send errors', () => {
  const { state, telemetry } = createTelemetry()
  const posts = []
  const warnings = []
  const sampler = createRenderPerformanceSampler({
    telemetry,
    source: 'fixture-renderer',
    targetId: 'perf-panel',
    getRenderLoopWork: () => ({ visualOnly: true }),
    getRendererInfo: () => ({
      render: { calls: 2, triangles: 3, points: 4, lines: 5 },
      memory: { geometries: 6, textures: 7 },
    }),
    post: (message) => posts.push(message),
    warn: (...args) => warnings.push(args),
  })

  sampler.postSample({ frameStartedAt: 0, renderStartedAt: 5, renderEndedAt: 600 })
  const posted = sampler.postSample({ frameStartedAt: 650, renderStartedAt: 660, renderEndedAt: 1200 })
  assert.equal(posted.posted, true)
  assert.deepEqual(posts[0].message.payload, {
    source: 'fixture-renderer',
    targetFps: 30,
    frameMs: 600,
    updateMs: 10,
    renderMs: 540,
    drawCalls: 2,
    triangles: 3,
    points: 4,
    lines: 5,
    geometries: 6,
    textures: 7,
  })

  const failing = createRenderPerformanceSampler({
    telemetry,
    targetId: 'perf-panel',
    post() {
      throw new Error('send failed')
    },
    warn: (...args) => warnings.push(args),
  })
  failing.postSample({ frameStartedAt: 0, renderStartedAt: 1, renderEndedAt: 600 })
  const failed = failing.postSample({ frameStartedAt: 700, renderStartedAt: 710, renderEndedAt: 1200 })

  assert.equal(failed.posted, false)
  assert.equal(state.lastError, 'send failed')
  assert.equal(warnings.length, 1)
})
