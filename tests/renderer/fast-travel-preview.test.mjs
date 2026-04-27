import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFastTravelController } from '../../apps/sigil/renderer/live-modules/fast-travel.js'
import state from '../../apps/sigil/renderer/state.js'

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

test('line travel inter-dimensional trail is controlled by travel setting and restored', () => {
  const previousLine = state.fastTravelLineInterDimensional
  const previousOmega = state.omegaInterDimensional
  const previousOmegaEnabled = state.isOmegaEnabled
  const previousCount = state.omegaGhostCount
  const previousDuration = state.omegaGhostDuration
  const previousMode = state.omegaGhostMode
  const previousLag = state.omegaLagFactor
  const previousScale = state.omegaScale
  try {
    state.fastTravelLineInterDimensional = false
    state.omegaInterDimensional = true
    state.isOmegaEnabled = false
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

    const travel = controller.start(20, 0)
    travel.startMs = performance.now() - travel.durationMs - 1
    assert.equal(state.omegaInterDimensional, false)
    controller.tick(0.016)
    assert.equal(state.omegaInterDimensional, true)
  } finally {
    state.fastTravelLineInterDimensional = previousLine
    state.omegaInterDimensional = previousOmega
    state.isOmegaEnabled = previousOmegaEnabled
    state.omegaGhostCount = previousCount
    state.omegaGhostDuration = previousDuration
    state.omegaGhostMode = previousMode
    state.omegaLagFactor = previousLag
    state.omegaScale = previousScale
  }
})

test('line travel timing and repeated object trail are configurable', () => {
  const prior = {
    line: state.fastTravelLineInterDimensional,
    duration: state.fastTravelLineDuration,
    delay: state.fastTravelLineDelay,
    count: state.fastTravelLineRepeatCount,
    repeatDuration: state.fastTravelLineRepeatDuration,
    mode: state.fastTravelLineTrailMode,
    lag: state.fastTravelLineLag,
    scale: state.fastTravelLineScale,
    omegaEnabled: state.isOmegaEnabled,
    omegaInterDimensional: state.omegaInterDimensional,
    omegaCount: state.omegaGhostCount,
    omegaDuration: state.omegaGhostDuration,
    omegaMode: state.omegaGhostMode,
    omegaLag: state.omegaLagFactor,
    omegaScale: state.omegaScale,
  }
  try {
    state.fastTravelLineInterDimensional = true
    state.fastTravelLineDuration = 0.4
    state.fastTravelLineDelay = 0.1
    state.fastTravelLineRepeatCount = 23
    state.fastTravelLineRepeatDuration = 1.7
    state.fastTravelLineTrailMode = 'vertexDissolve'
    state.fastTravelLineLag = 0.12
    state.fastTravelLineScale = 2.2
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

    const travel = controller.start(100, 0)
    assert.equal(travel.durationMs, 500)
    assert.equal(travel.delayMs, 100)
    assert.equal(state.omegaGhostCount, 23)
    assert.equal(state.omegaGhostDuration, 1.7)
    assert.equal(state.omegaGhostMode, 'vertexDissolve')
    assert.equal(state.omegaLagFactor, 0.12)
    assert.equal(state.omegaScale, 2.2)

    liveJs.travel.startMs = performance.now() - 50
    assert.equal(controller.preview().avatarPos.x, 0)
    liveJs.travel.startMs = performance.now() - 300
    const midpoint = controller.preview()
    assert(midpoint.avatarPos.x > 0 && midpoint.avatarPos.x < 100)
  } finally {
    state.fastTravelLineInterDimensional = prior.line
    state.fastTravelLineDuration = prior.duration
    state.fastTravelLineDelay = prior.delay
    state.fastTravelLineRepeatCount = prior.count
    state.fastTravelLineRepeatDuration = prior.repeatDuration
    state.fastTravelLineTrailMode = prior.mode
    state.fastTravelLineLag = prior.lag
    state.fastTravelLineScale = prior.scale
    state.isOmegaEnabled = prior.omegaEnabled
    state.omegaInterDimensional = prior.omegaInterDimensional
    state.omegaGhostCount = prior.omegaCount
    state.omegaGhostDuration = prior.omegaDuration
    state.omegaGhostMode = prior.omegaMode
    state.omegaLagFactor = prior.omegaLag
    state.omegaScale = prior.omegaScale
  }
})

test('wormhole captures every display at mouse down', async () => {
  const calls = []
  const liveJs = {
    avatarPos: { x: 10, y: 20, valid: true },
    displays: [
      {
        id: 1,
        display_id: 1,
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        visibleBounds: { x: 0, y: 0, w: 100, h: 100 },
        nativeBounds: { x: -20, y: 0, w: 100, h: 100 },
      },
      {
        id: 2,
        display_id: 2,
        bounds: { x: 100, y: 0, w: 120, h: 100 },
        visibleBounds: { x: 100, y: 0, w: 120, h: 100 },
        nativeBounds: { x: 80, y: 0, w: 120, h: 100 },
      },
    ],
    fastTravelEvents: [],
  }
  const controller = createFastTravelController({
    host: {
      captureRegion(region) {
        calls.push(region)
        return Promise.reject(new Error('skip image load'))
      },
    },
    state: { transitionFastTravelEffect: 'wormhole', appScale: 1 },
    liveJs,
    projectStagePoint: (point) => point,
    getExcludedCanvasIds: () => [],
  })

  controller.beginGesture({ x: 10, y: 20, valid: true })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(calls, [
    { x: -20, y: 0, width: 100, height: 100 },
    { x: 80, y: 0, width: 120, height: 100 },
  ])
})

test('wormhole follower snapshots do not start all-display capture batches', async () => {
  const liveJs = {
    avatarPos: { x: 10, y: 20, valid: true },
    displays: [
      {
        id: 1,
        display_id: 1,
        bounds: { x: 0, y: 0, w: 100, h: 100 },
        visibleBounds: { x: 0, y: 0, w: 100, h: 100 },
        nativeBounds: { x: 0, y: 0, w: 100, h: 100 },
      },
    ],
    fastTravelEvents: [],
  }
  const controller = createFastTravelController({
    host: {
      captureRegion() {
        throw new Error('followers must not capture displays')
      },
    },
    state: { transitionFastTravelEffect: 'wormhole', appScale: 1 },
    liveJs,
    projectStagePoint: (point) => point,
    getExcludedCanvasIds: () => [],
    canCaptureDisplayImages: () => false,
  })

  controller.applySnapshot({
    travel: {
      effect: 'wormhole',
      phase: 'transit',
      from: { x: 10, y: 20, valid: true },
      to: { x: 80, y: 20, valid: true },
      elapsedMs: 100,
      durationMs: 1200,
      entryMs: 0,
      transitMs: 1000,
      exitMs: 200,
      captureRadius: 96,
    },
  })
  controller.draw()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(liveJs.travel.captureAllAttempted, undefined)
})

test('wormhole draw falls back to 2D tunnel when shader cannot render', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const calls = []
  const noop = () => {}
  const gradient = { addColorStop: noop }
  const context = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return (...args) => {
          calls.push([prop, ...args])
          return gradient
        }
      }
      if (prop === 'measureText') return () => ({ width: 0 })
      return (...args) => {
        calls.push([prop, ...args])
      }
    },
    set() {
      return true
    },
  })
  const makeCanvas = () => ({
    style: {},
    width: 0,
    height: 0,
    getContext(type) {
      if (type === 'webgl') return null
      return context
    },
    remove: noop,
  })

  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: noop,
    removeEventListener: noop,
  }
  globalThis.document = {
    body: { appendChild: noop },
    createElement: () => makeCanvas(),
  }

  try {
    const liveJs = {
      avatarPos: { x: 0, y: 0, valid: true },
      displays: [],
      fastTravelEvents: [],
      travel: {
        effect: 'wormhole',
        phase: 'transit',
        from: { x: 100, y: 100, valid: true },
        to: { x: 300, y: 100, valid: true },
        startMs: performance.now() - 100,
        durationMs: 1200,
        entryMs: 0,
        transitMs: 1000,
        exitMs: 200,
        captureRadius: 96,
        captures: {},
        captureErrors: {},
        captureRequests: {},
        captureAllAttempted: true,
      },
    }
    const controller = createFastTravelController({
      host: {},
      state: { transitionFastTravelEffect: 'wormhole', appScale: 1, wormholeCaptureEnabled: false },
      liveJs,
      projectStagePoint: (point) => point,
      getExcludedCanvasIds: () => [],
    })

    controller.mount()
    controller.draw()
    controller.destroy()

    assert(calls.some(([name]) => name === 'arc'), 'expected procedural tunnel drawing after shader fallback')
  } finally {
    globalThis.document = previousDocument
    globalThis.window = previousWindow
  }
})

test('wormhole travel preview uses entry/hidden/exit phases instead of line motion', () => {
  const previousOmegaEnabled = state.isOmegaEnabled
  const previousOmegaInterDimensional = state.omegaInterDimensional
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

  try {
    state.isOmegaEnabled = false
    state.omegaInterDimensional = true
    const started = controller.start(100, 0)
    assert.equal(started.effect, 'wormhole')
    assert.equal(state.isOmegaEnabled, false)
    assert.equal(state.omegaInterDimensional, false)

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
      startMs: now - 150,
      durationMs: 2200,
      entryMs: 0,
      transitMs: 1000,
      exitMs: 1200,
      captureRadius: 96,
      entryCurve: { x: 20, y: 0, amount: 20 },
      exitCurve: { x: -20, y: 0, amount: 20 },
    }

    const entry = controller.preview()
    assert.equal(entry.effect, 'wormhole')
    assert.equal(entry.phase, 'transit')
    assert(entry.avatarPos.x >= 0 && entry.avatarPos.x < 5, entry.avatarPos)
    assert(entry.appScale > 0 && entry.appScale < 1, entry)

    liveJs.travel.startMs = now - 500
    const hidden = controller.preview()
    assert.equal(hidden.phase, 'transit')
    assert.equal(hidden.appScale, 0)
    assert(hidden.avatarPos.x > 79 && hidden.avatarPos.x < 81, hidden.avatarPos)

    liveJs.travel.startMs = now - 850
    const exitMaterialize = controller.preview()
    assert.equal(exitMaterialize.phase, 'transit')
    assert(exitMaterialize.avatarPos.x > 90 && exitMaterialize.avatarPos.x <= 100, exitMaterialize.avatarPos)
    assert(exitMaterialize.appScale > 0 && exitMaterialize.appScale < 1, exitMaterialize)

    liveJs.travel.startMs = now - 1400
    const closing = controller.preview()
    assert.equal(closing.phase, 'exit')
    assert.equal(closing.avatarPos.x, 100)
    assert.equal(closing.appScale, 1)
  } finally {
    state.isOmegaEnabled = previousOmegaEnabled
    state.omegaInterDimensional = previousOmegaInterDimensional
  }
})
