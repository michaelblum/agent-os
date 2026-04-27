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

test('wormhole travel previews visible motion across the full path', () => {
  const liveJs = {
    avatarPos: { x: 0, y: 0, valid: true },
    displays: [],
    fastTravelEvents: [],
  }
  const controller = createFastTravelController({
    host: {},
    state: { transitionFastTravelEffect: 'wormhole', appScale: 1 },
    liveJs,
    projectStagePoint: (point) => point,
    getExcludedCanvasIds: () => [],
  })

  const now = performance.now()
  liveJs.travel = {
    effect: 'wormhole',
    phase: 'entry',
    fromX: 0,
    fromY: 0,
    toX: 100,
    toY: 0,
    from: { x: 0, y: 0, valid: true },
    to: { x: 100, y: 0, valid: true },
    startMs: now - 550,
    durationMs: 1200,
    entryMs: 400,
    transitMs: 400,
    exitMs: 400,
    captureRadius: 96,
    entryCurve: { x: 20, y: 0, amount: 20 },
    exitCurve: { x: -20, y: 0, amount: 20 },
  }

  const transit = controller.preview()
  assert.equal(transit.effect, 'wormhole')
  assert.equal(transit.phase, 'transit')
  assert(transit.avatarPos.x > 25 && transit.avatarPos.x < 75, transit.avatarPos)
  assert(transit.appScale > 0.2, transit)

  liveJs.travel.startMs = now - 850
  const exit = controller.preview()
  assert.equal(exit.phase, 'exit')
  assert(exit.avatarPos.x > 70 && exit.avatarPos.x < 100, exit.avatarPos)
  assert(exit.appScale > 0.2, exit)
})
