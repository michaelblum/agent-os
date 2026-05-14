import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDragController } from '../../packages/toolkit/panel/chrome.js'
import {
  computePanelTransfer,
  createPanelTransferController,
  ensureDesktopWorldStage,
} from '../../packages/toolkit/panel/drag-transfer.js'

const displays = [
  {
    id: 'main',
    native_bounds: { x: 0, y: 0, w: 1440, h: 900 },
    native_visible_bounds: { x: 0, y: 24, w: 1440, h: 876 },
    desktop_world_bounds: { x: 0, y: 0, w: 1440, h: 900 },
    visible_desktop_world_bounds: { x: 0, y: 24, w: 1440, h: 876 },
    is_main: true,
  },
  {
    id: 'extended',
    native_bounds: { x: 1440, y: 0, w: 1280, h: 900 },
    native_visible_bounds: { x: 1440, y: 0, w: 1280, h: 900 },
    desktop_world_bounds: { x: 1440, y: 0, w: 1280, h: 900 },
    visible_desktop_world_bounds: { x: 1440, y: 0, w: 1280, h: 900 },
  },
]

const stackedDisplays = [
  {
    id: 'extended-bottom',
    native_bounds: { x: -207, y: 982, w: 1920, h: 1080 },
    native_visible_bounds: { x: -207, y: 1012, w: 1920, h: 976 },
  },
  {
    id: 'main-top',
    native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
    native_visible_bounds: { x: 0, y: 33, w: 1512, h: 949 },
    is_main: true,
  },
]

test('computePanelTransfer returns a destination-display outline in DesktopWorld coordinates', () => {
  const transfer = computePanelTransfer(displays, {
    frame: [100, 80, 500, 360],
    pointer: { screenX: 1500, screenY: 40 },
    offsetX: 80,
    offsetY: 20,
    originDisplayId: 'main',
    layerId: 'test-outline',
  })

  assert.equal(transfer.targetDisplayId, 'extended')
  assert.deepEqual(transfer.nativeFrame, [1440, 20, 500, 360])
  assert.deepEqual(transfer.frame, [1440, 20, 500, 360])
  assert.equal(transfer.layer.id, 'test-outline')
  assert.equal(transfer.layer.kind, 'outline')
})

test('computePanelTransfer is inactive while pointer remains on the origin display', () => {
  assert.equal(computePanelTransfer(displays, {
    frame: [100, 80, 500, 360],
    pointer: { screenX: 300, screenY: 120 },
    offsetX: 80,
    offsetY: 20,
    originDisplayId: 'main',
  }), null)
})

test('computePanelTransfer is inactive once the whole panel fits on the destination display', () => {
  assert.equal(computePanelTransfer(displays, {
    frame: [100, 80, 500, 360],
    pointer: { screenX: 1600, screenY: 80 },
    offsetX: 80,
    offsetY: 20,
    originDisplayId: 'main',
  }), null)
})

test('createPanelTransferController upserts outline layers and returns release frame', () => {
  const sent = []
  const controller = createPanelTransferController({
    enabled: true,
    layerId: 'outline',
    getDisplays: () => displays,
    sendStageMessage(message) {
      sent.push(message)
    },
  })

  controller.start({ frame: [100, 80, 500, 360] })
  const active = controller.move({
    frame: [100, 80, 500, 360],
    pointer: { screenX: 1500, screenY: 40 },
    offsetX: 80,
    offsetY: 20,
  })
  const release = controller.end()

  assert.deepEqual(active.nativeFrame, [1440, 20, 500, 360])
  assert.deepEqual(release.nativeFrame, [1440, 20, 500, 360])
  assert.deepEqual(sent.map((message) => message.type), [
    'desktop_world_stage.layer.upsert',
    'desktop_world_stage.layer.remove',
  ])
})

test('ensureDesktopWorldStage creates the shared non-interactive desktop-world stage', async () => {
  const created = []
  const result = await ensureDesktopWorldStage({
    id: 'stage-test',
    url: 'aos://toolkit-preview/components/desktop-world-stage/index.html',
    createStage(payload) {
      created.push(payload)
      return Promise.resolve({ id: payload.id })
    },
    waitForStage(id, options) {
      created.push({ ready: id, options })
      return Promise.resolve({ id, ready: true })
    },
  })

  assert.deepEqual(result, {
    ok: true,
    status: 'created',
    id: 'stage-test',
    url: 'aos://toolkit-preview/components/desktop-world-stage/index.html',
    created: true,
  })
  assert.deepEqual(created, [{
    id: 'stage-test',
    url: 'aos://toolkit-preview/components/desktop-world-stage/index.html',
    surface: 'desktop-world',
    scope: 'global',
    interactive: false,
    focus: false,
    cascade: false,
  }, {
    ready: 'stage-test',
    options: { timeoutMs: 3000, intervalMs: 50, infoTimeoutMs: 500, requireManifest: true, manifestName: 'desktop-world-stage' },
  }])
})

test('ensureDesktopWorldStage treats an existing shared stage as ready', async () => {
  const readiness = []
  const result = await ensureDesktopWorldStage({
    id: 'stage-existing-test',
    url: 'aos://toolkit-preview/components/desktop-world-stage/index.html',
    createStage() {
      return Promise.reject(new Error('canvas already exists'))
    },
    waitForStage(id, options) {
      readiness.push({ id, options })
      return Promise.resolve({ id, ready: true })
    },
  })

  assert.deepEqual(result, {
    ok: true,
    status: 'already_exists',
    id: 'stage-existing-test',
    url: 'aos://toolkit-preview/components/desktop-world-stage/index.html',
    created: false,
  })
  assert.deepEqual(readiness, [{
    id: 'stage-existing-test',
    options: { timeoutMs: 3000, intervalMs: 50, infoTimeoutMs: 500, requireManifest: true, manifestName: 'desktop-world-stage' },
  }])
})

test('createPanelTransferController can ensure the shared transfer stage on drag start', async () => {
  const created = []
  const controller = createPanelTransferController({
    enabled: true,
    stageCanvasId: 'stage-start-test',
    stageUrl: 'aos://toolkit/components/desktop-world-stage/index.html',
    ensureStage: true,
    createStage(payload) {
      created.push(payload)
      return Promise.resolve({ id: payload.id })
    },
    waitForStage(id) {
      created.push({ ready: id })
      return Promise.resolve({ id, ready: true })
    },
    getDisplays: () => displays,
    sendStageMessage() {},
  })

  controller.start({ frame: [100, 80, 500, 360] })
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(created.length, 2)
  assert.equal(created[0].id, 'stage-start-test')
  assert.equal(created[0].surface, 'desktop-world')
  assert.deepEqual(created[1], { ready: 'stage-start-test' })
})

test('createDragController applies transfer release frame before fallback clamp', () => {
  let frame = [100, 80, 500, 360]
  const updates = []
  const states = []
  const moves = []
  const transferController = createPanelTransferController({
    enabled: true,
    layerId: 'outline',
    getDisplays: () => displays,
    sendStageMessage() {},
  })
  const controller = createDragController({
    getFrame: () => frame,
    getWorkArea: () => [0, 24, 1440, 876],
    updateFrame(nextFrame) {
      frame = nextFrame
      updates.push(nextFrame)
    },
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY })
      frame = [screenX - offsetX, screenY - offsetY, frame[2], frame[3]]
    },
    clampOnEnd: true,
    transferController,
    onStateChange(state) {
      states.push(state)
    },
  })

  controller.start({ pointerId: 1, clientX: 80, clientY: 20 })
  controller.move({ pointerId: 1, screenX: 1500, screenY: 40 })
  assert.deepEqual(moves, [])
  controller.end()

  assert.deepEqual(updates.at(-1), [1440, 20, 500, 360])
  assert.deepEqual(frame, [1440, 20, 500, 360])
  assert.equal(states.find((state) => state.phase === 'move')?.transferActive, true)
  assert.equal(states.at(-1)?.transferActive, false)
})

test('createDragController starts transfer ownership from the frame, not stale DOM pointer coordinates', () => {
  let frame = [1300, 1550, 360, 230]
  const transferController = createPanelTransferController({
    enabled: true,
    layerId: 'outline',
    getDisplays: () => stackedDisplays,
    sendStageMessage() {},
  })
  const controller = createDragController({
    getFrame: () => frame,
    move() {},
    transferController,
  })

  controller.start({ pointerId: 1, clientX: 60, clientY: 20, screenX: 1360, screenY: 80 })

  assert.equal(transferController.getState().originDisplayId, 'extended-bottom')
})

test('createDragController resumes direct drag once the destination display can contain the panel', () => {
  let frame = [100, 80, 500, 360]
  const moves = []
  const transferController = createPanelTransferController({
    enabled: true,
    layerId: 'outline',
    getDisplays: () => displays,
    sendStageMessage() {},
  })
  const controller = createDragController({
    getFrame: () => frame,
    getWorkArea: () => [1440, 0, 1280, 900],
    updateFrame(nextFrame) {
      frame = nextFrame
    },
    move(screenX, screenY, offsetX, offsetY) {
      moves.push({ screenX, screenY, offsetX, offsetY })
      frame = [screenX - offsetX, screenY - offsetY, frame[2], frame[3]]
    },
    clampOnEnd: true,
    transferController,
  })

  controller.start({ pointerId: 1, clientX: 80, clientY: 20 })
  controller.move({ pointerId: 1, screenX: 1600, screenY: 80 })
  controller.end()

  assert.deepEqual(moves, [{ screenX: 1600, screenY: 80, offsetX: 80, offsetY: 20 }])
  assert.deepEqual(frame, [1520, 60, 500, 360])
})
