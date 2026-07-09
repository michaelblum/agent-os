import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  createSigilAvatarParkingController,
  nativePointFromMessageOrigin,
  statusCollapseFrameFromOrigin,
  terminalParkingPointFromFrame,
} from '../../apps/sigil/renderer/live-modules/avatar-parking.js'

function createControllerState() {
  return {
    liveState: {
      avatarPos: { x: 40, y: 50, valid: true },
      avatarVisible: true,
      avatarParking: null,
    },
    renderState: {
      appScale: 1.4,
    },
    events: [],
  }
}

test('Sigil avatar parking resolves native origin and frame geometry', () => {
  assert.deepEqual(nativePointFromMessageOrigin({ origin_x: '20', origin_y: 30 }), { x: 20, y: 30 })
  assert.deepEqual(nativePointFromMessageOrigin({ payload: { origin_x: 7, origin_y: '8' } }), { x: 7, y: 8 })
  assert.equal(nativePointFromMessageOrigin({ origin_x: 'nope', origin_y: 8 }), null)
  assert.deepEqual(terminalParkingPointFromFrame([100, 200, 600, 400]), { x: 123, y: 221 })
  assert.deepEqual(statusCollapseFrameFromOrigin({ x: 50, y: 80 }), [36, 66, 28, 28])
})

test('Sigil avatar parking controller parks terminal avatar and stores restore state once', () => {
  const state = createControllerState()
  const controller = createSigilAvatarParkingController({
    ...state,
    terminalScale: 0.24,
    nativePointToDesktop: (point) => ({ x: point.x + 1000, y: point.y + 2000 }),
    setAvatarVisibility: (visible) => state.events.push(['visible', visible]),
    setAvatarHover: (hover) => state.events.push(['hover', hover]),
    emitAvatarMark: () => state.events.push(['mark']),
  })

  assert.equal(controller.parkInTerminal([10, 20, 300, 400]), true)
  assert.deepEqual(state.liveState.avatarParking, {
    mode: 'terminal',
    nativePoint: { x: 33, y: 41 },
    scale: 0.24,
  })
  assert.deepEqual(state.liveState.avatarPos, { x: 1033, y: 2041, valid: true })
  assert.equal(state.renderState.appScale, 0.24)
  assert.deepEqual(state.liveState._avatarParkingRestore, {
    pos: { x: 40, y: 50, valid: true },
    scale: 1.4,
    visible: true,
  })
  assert.deepEqual(state.events, [['visible', true], ['hover', false], ['mark']])

  state.renderState.appScale = 0.5
  assert.equal(controller.parkAtStatusMessage({ origin_x: 9, origin_y: 11 }), true)
  assert.equal(state.liveState._avatarParkingRestore.scale, 1.4)
  assert.equal(controller.isParkedAtStatus(), true)
})

test('Sigil avatar parking controller clears and restores previous avatar state', () => {
  const state = createControllerState()
  const controller = createSigilAvatarParkingController({
    ...state,
    animateVisibility: (visible) => state.events.push(['animate', visible]),
  })

  controller.parkAtStatusMessage({ origin_x: 9, origin_y: 11 })
  const result = controller.clear({ restoreVisible: true })

  assert.deepEqual(result, { restoredPosition: true, restoreVisible: true })
  assert.equal(state.liveState.avatarParking, null)
  assert.equal(state.liveState._avatarParkingRestore, null)
  assert.deepEqual(state.liveState.avatarPos, { x: 40, y: 50, valid: true })
  assert.equal(state.renderState.appScale, 1.4)
  assert.deepEqual(state.events, [['animate', true]])

  controller.parkAtStatusMessage({ origin_x: 9, origin_y: 11 })
  controller.clear({ restoreVisible: false })
  assert.deepEqual(state.events.at(-1), ['animate', false])
})

test('Sigil main delegates avatar parking math and restore bookkeeping', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /createSigilAvatarParkingController/)
  assert.match(source, /avatarParking\.parkInTerminal/)
  assert.match(source, /statusCollapseFrameFromOrigin/)
  assert.doesNotMatch(source, /function nativePointToDesktop/)
  assert.doesNotMatch(source, /function parkAvatarAtNativePoint/)
})
