import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createDesktopWorldHitRegionController,
  desktopWorldHitRegionFrame,
  resolveDesktopWorldHitRegionOwnerCanvasId,
} from '../../packages/toolkit/runtime/desktop-world-hit-region.js'

function fakeRuntime(calls = []) {
  return {
    canvasCreate(payload) {
      calls.push(['create', payload])
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      calls.push(['update', payload])
    },
    canvasRemove(payload) {
      calls.push(['remove', payload])
      return Promise.resolve()
    },
    post(type, payload) {
      calls.push(['post', type, payload])
    },
  }
}

test('DesktopWorldHitRegion owner id selection honors canvas, surface, and fallback ids', () => {
  assert.equal(resolveDesktopWorldHitRegionOwnerCanvasId({
    globalObject: { __aosCanvasId: 'canvas-owner', __aosSurfaceCanvasId: 'surface-owner' },
    fallbackOwnerCanvasId: 'fallback-owner',
  }), 'canvas-owner')
  assert.equal(resolveDesktopWorldHitRegionOwnerCanvasId({
    globalObject: { __aosSurfaceCanvasId: 'surface-owner' },
    fallbackOwnerCanvasId: 'fallback-owner',
  }), 'surface-owner')
  assert.equal(resolveDesktopWorldHitRegionOwnerCanvasId({
    globalObject: {},
    fallbackOwnerCanvasId: 'fallback-owner',
  }), 'fallback-owner')
  assert.equal(resolveDesktopWorldHitRegionOwnerCanvasId({
    ownerCanvasId: 'explicit-owner',
    globalObject: { __aosCanvasId: 'canvas-owner' },
  }), 'explicit-owner')
})

test('DesktopWorldHitRegion converts DesktopWorld rects to native frames', () => {
  assert.deepEqual(desktopWorldHitRegionFrame({ x: 20.4, y: 30.6, w: 100, h: 40 }, []), [20, 31, 100, 40])
  assert.deepEqual(desktopWorldHitRegionFrame(
    { x: 20, y: 30, w: 100, h: 40 },
    [{ nativeBounds: { x: -1920, y: 0, w: 3840, h: 1080 } }],
  ), [-1900, 30, 100, 40])
  assert.equal(desktopWorldHitRegionFrame({ x: 0, y: 0, w: 0, h: 10 }, []), null)
})

test('DesktopWorldHitRegion creates offscreen then syncs native frame, interactivity, and payload', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-a',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-a',
    initialSize: [12, 8],
    messageType: 'test.hit_region.update',
  })

  assert.equal(await controller.ensureCreated(), 'hit-region-a')
  assert.deepEqual(calls[0], ['create', {
    id: 'hit-region-a',
    url: 'aos://toolkit/hit-region.html?parent=owner-a&id=hit-region-a',
    parent: 'owner-a',
    frame: [-10000, -10000, 12, 8],
    interactive: false,
    window_level: 'screen_saver',
    cascade: true,
  }])

  assert.equal(controller.sync({
    worldRect: { x: 50, y: 60, w: 90, h: 30 },
    displays: [],
    payload: { bounds: { x: 0, y: 0, w: 90, h: 30 }, regions: [{ id: 'one' }] },
  }), true)

  assert.deepEqual(calls[1], ['update', {
    id: 'hit-region-a',
    frame: [50, 60, 90, 30],
    interactive: true,
  }])
  assert.deepEqual(calls[2], ['post', 'canvas.send', {
    target: 'hit-region-a',
    message: {
      type: 'test.hit_region.update',
      payload: { bounds: { x: 0, y: 0, w: 90, h: 30 }, regions: [{ id: 'one' }] },
    },
  }])
  assert.equal(controller.snapshot().interactive, true)
})

test('DesktopWorldHitRegion skips redundant frame and payload updates', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-b',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-b',
  })

  await controller.ensureCreated()
  assert.equal(controller.sync({
    worldRect: { x: 10, y: 20, w: 30, h: 40 },
    payload: { regions: [{ id: 'one' }] },
  }), true)
  assert.equal(controller.sync({
    worldRect: { x: 10, y: 20, w: 30, h: 40 },
    payload: { regions: [{ id: 'one' }] },
  }), false)

  assert.equal(calls.filter((call) => call[0] === 'update').length, 1)
  assert.equal(calls.filter((call) => call[0] === 'post').length, 1)
})

test('DesktopWorldHitRegion disable moves offscreen and marks non-interactive', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-c',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-c',
  })

  await controller.ensureCreated()
  controller.sync({ worldRect: { x: 10, y: 20, w: 30, h: 40 } })
  assert.equal(controller.disable(), true)

  assert.deepEqual(calls.filter((call) => call[0] === 'update').at(-1), ['update', {
    id: 'hit-region-c',
    frame: [-10000, -10000, 30, 40],
    interactive: false,
  }])
  assert.equal(controller.snapshot().interactive, false)
})

test('DesktopWorldHitRegion duplicate create reconciles stale daemon placement offscreen', async () => {
  const calls = []
  const runtime = {
    canvasCreate(payload) {
      calls.push(['create', payload])
      return Promise.reject(new Error('DUPLICATE: exists'))
    },
    canvasUpdate(payload) {
      calls.push(['update', payload])
    },
    canvasRemove(payload) {
      calls.push(['remove', payload])
      return Promise.resolve()
    },
    post(type, payload) {
      calls.push(['post', type, payload])
    },
  }
  const controller = createDesktopWorldHitRegionController({
    runtime,
    id: 'hit-region-duplicate',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-duplicate',
    initialSize: [80, 80],
  })

  assert.equal(await controller.ensureCreated(), 'hit-region-duplicate')

  assert.deepEqual(calls.at(-1), ['update', {
    id: 'hit-region-duplicate',
    frame: [-10000, -10000, 80, 80],
    interactive: false,
    window_level: 'screen_saver',
  }])
  assert.equal(controller.snapshot().interactive, false)
  assert.deepEqual(controller.snapshot().frame, [-10000, -10000, 80, 80])
})

test('DesktopWorldHitRegion remove delegates to child surface and clears state', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-d',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-d',
  })

  await controller.ensureCreated()
  controller.sync({ worldRect: { x: 10, y: 20, w: 30, h: 40 }, payload: { active: true } })
  await controller.remove()

  assert.deepEqual(calls.at(-1), ['remove', { id: 'hit-region-d' }])
  assert.equal(controller.snapshot().ready, false)
  assert.equal(controller.snapshot().interactive, false)
  assert.equal(controller.snapshot().lastPayload, null)
})

test('DesktopWorldHitRegion posts target payload only when it changes', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-e',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-e',
  })

  await controller.ensureCreated()
  controller.sync({ worldRect: { x: 10, y: 20, w: 30, h: 40 }, payload: { regions: [{ id: 'one' }] } })
  controller.sync({ worldRect: { x: 10, y: 20, w: 30, h: 40 }, payload: { regions: [{ id: 'one' }] } })
  controller.sync({ worldRect: { x: 10, y: 20, w: 30, h: 40 }, payload: { regions: [{ id: 'two' }] } })

  assert.equal(calls.filter((call) => call[0] === 'post').length, 2)
})

test('DesktopWorldHitRegion can refresh the last payload for late child readiness', async () => {
  const calls = []
  const controller = createDesktopWorldHitRegionController({
    runtime: fakeRuntime(calls),
    id: 'hit-region-f',
    url: 'aos://toolkit/hit-region.html',
    fallbackOwnerCanvasId: 'owner-f',
  })

  await controller.ensureCreated()
  assert.equal(controller.refreshPayload(), false)

  controller.sync({
    worldRect: { x: 10, y: 20, w: 30, h: 40 },
    payload: { regions: [{ id: 'one' }] },
  })
  assert.equal(controller.refreshPayload(), true)
  assert.equal(calls.filter((call) => call[0] === 'post').length, 2)
  assert.deepEqual(calls.at(-1), ['post', 'canvas.send', {
    target: 'hit-region-f',
    message: {
      type: 'desktop_world_hit_region.update',
      payload: { regions: [{ id: 'one' }] },
    },
  }])
})
