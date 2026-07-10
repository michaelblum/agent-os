import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  RENDER_PERFORMANCE_CANVAS_ID,
  createSigilRenderPerformanceSampler,
  finiteOrNull,
} from '../../apps/sigil/renderer/live-modules/render-performance-telemetry.js'

function createLiveState() {
  return {
    renderPerformanceTelemetry: { attempted: 0, sent: 0, skipped: null, lastError: null },
  }
}

test('finiteOrNull returns only finite numeric values', () => {
  assert.equal(finiteOrNull(12), 12)
  assert.equal(finiteOrNull('3.5'), 3.5)
  assert.equal(finiteOrNull(Number.NaN), null)
  assert.equal(finiteOrNull(undefined), null)
})

test('Sigil render-performance sampler skips hidden, invalid, and throttled frames', () => {
  const liveState = createLiveState()
  let visible = false
  const sampler = createSigilRenderPerformanceSampler({
    liveState,
    isPrimarySurfaceSegment: () => true,
    isPanelVisible: () => visible,
  })

  assert.deepEqual(
    sampler.postSample({ frameStartedAt: 0, renderStartedAt: 5, renderEndedAt: 10 }),
    { posted: false, skipped: 'panel-hidden' },
  )
  visible = true
  assert.deepEqual(
    sampler.postSample({ frameStartedAt: 100, renderStartedAt: 110, renderEndedAt: 620 }),
    { posted: false, skipped: 'invalid-frame' },
  )
  assert.equal(sampler.postSample({ frameStartedAt: 700, renderStartedAt: 710, renderEndedAt: 1220 }).posted, true)
  assert.deepEqual(
    sampler.postSample({ frameStartedAt: 780, renderStartedAt: 790, renderEndedAt: 1300 }),
    { posted: false, skipped: 'throttled' },
  )
})

test('Sigil render-performance sampler delegates sampling mechanics to toolkit', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/render-performance-telemetry.js', import.meta.url), 'utf8')

  assert.match(source, /createRenderPerformanceSampler/)
  assert.doesNotMatch(source, /let lastFrameAt/)
  assert.doesNotMatch(source, /let lastSampleAt/)
})

test('Sigil render-performance sampler posts payloads and updates telemetry', () => {
  const liveState = createLiveState()
  const posts = []
  const sampler = createSigilRenderPerformanceSampler({
    liveState,
    isPrimarySurfaceSegment: () => true,
    isPanelVisible: () => true,
    getRenderLoopWork: () => ({ visualOnly: true }),
    getRendererInfo: () => ({
      render: { calls: 4, triangles: 10, points: 2, lines: 1 },
      memory: { geometries: 3, textures: 5 },
    }),
    post: (message) => posts.push(message),
  })

  sampler.postSample({ frameStartedAt: 100, renderStartedAt: 110, renderEndedAt: 620 })
  const result = sampler.postSample({ frameStartedAt: 700, renderStartedAt: 710, renderEndedAt: 1220 })

  assert.equal(result.posted, true)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].target, RENDER_PERFORMANCE_CANVAS_ID)
  assert.deepEqual(posts[0].message.payload, {
    source: 'sigil-avatar',
    targetFps: 30,
    frameMs: 600,
    updateMs: 10,
    renderMs: 510,
    drawCalls: 4,
    triangles: 10,
    points: 2,
    lines: 1,
    geometries: 3,
    textures: 5,
  })
  assert.equal(liveState.renderPerformanceTelemetry.attempted, 2)
  assert.equal(liveState.renderPerformanceTelemetry.sent, 1)
  assert.equal(liveState.renderPerformanceTelemetry.skipped, null)
})

test('Sigil render-performance sampler records post errors without throwing', () => {
  const liveState = createLiveState()
  const warnings = []
  const sampler = createSigilRenderPerformanceSampler({
    liveState,
    isPrimarySurfaceSegment: () => true,
    isPanelVisible: () => true,
    post() {
      throw new Error('send failed')
    },
    warn: (...args) => warnings.push(args),
  })

  sampler.postSample({ frameStartedAt: 100, renderStartedAt: 110, renderEndedAt: 620 })
  const result = sampler.postSample({ frameStartedAt: 700, renderStartedAt: 710, renderEndedAt: 1220 })

  assert.equal(result.posted, false)
  assert.equal(liveState.renderPerformanceTelemetry.lastError, 'send failed')
  assert.equal(warnings.length, 1)
})

test('Sigil main delegates render-performance sampling to telemetry module', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /createSigilRenderPerformanceSampler/)
  assert.match(source, /renderPerformanceSampler\.postSample\(/)
  assert.doesNotMatch(source, /function postRenderPerformanceSample/)
  assert.doesNotMatch(source, /lastRenderPerformanceFrameAt/)
})
