import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFastTravelController } from '../../apps/sigil/renderer/live-modules/fast-travel.js'

test('follower preview advances line travel from replicated logical state', () => {
  const liveJs = {
    avatarPos: { x: 0, y: 0, valid: true },
    displays: [],
    fastTravelEvents: [],
  }
  const controller = createFastTravelController({
    host: {},
    state: { transitionFastTravelEffect: 'line' },
    liveJs,
    projectStagePoint: (point) => point,
    getExcludedCanvasIds: () => [],
  })

  liveJs.travel = {
    effect: 'line',
    phase: 'line',
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 50,
    from: { x: 0, y: 0, valid: true },
    to: { x: 100, y: 50, valid: true },
    startMs: performance.now() - 50,
    durationMs: 100,
  }

  const preview = controller.preview()

  assert.equal(preview.effect, 'line')
  assert.equal(preview.phase, 'line')
  assert.equal(preview.active, true)
  assert(preview.avatarPos.x > 0 && preview.avatarPos.x < 100)
  assert(preview.avatarPos.y > 0 && preview.avatarPos.y < 50)
  assert.deepEqual(liveJs.avatarPos, { x: 0, y: 0, valid: true })
})

test('line travel records canonical from/to points for segmented followers', () => {
  const liveJs = {
    avatarPos: { x: 10, y: 20, valid: true },
    displays: [],
    fastTravelEvents: [],
  }
  const controller = createFastTravelController({
    host: {},
    state: { transitionFastTravelEffect: 'line' },
    liveJs,
    projectStagePoint: (point) => point,
    getExcludedCanvasIds: () => [],
  })

  const travel = controller.start(110, 220)

  assert.deepEqual(travel.from, { x: 10, y: 20, valid: true })
  assert.deepEqual(travel.to, { x: 110, y: 220, valid: true })
})
