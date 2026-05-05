import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDragController } from '../../packages/toolkit/panel/chrome.js'
import {
  computePanelTransfer,
  createPanelTransferController,
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

test('createDragController applies transfer release frame before fallback clamp', () => {
  let frame = [100, 80, 500, 360]
  const updates = []
  const states = []
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
  controller.end()

  assert.deepEqual(updates.at(-1), [1440, 20, 500, 360])
  assert.deepEqual(frame, [1440, 20, 500, 360])
  assert.equal(states.find((state) => state.phase === 'move')?.transferActive, true)
  assert.equal(states.at(-1)?.transferActive, false)
})
