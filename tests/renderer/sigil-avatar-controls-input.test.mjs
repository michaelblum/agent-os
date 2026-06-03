import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  avatarControlsOpenCommandOpened,
  resolveAvatarControlsRightClickRoute,
} from '../../apps/sigil/renderer/live-modules/avatar-controls-input.js'

test('avatar controls right-click routing suppresses duplicate open echoes before toggle', () => {
  const calls = []
  const route = resolveAvatarControlsRightClickRoute({ type: 'right_mouse_down', x: 10, y: 20 }, {
    isOpen: true,
    isDuplicateOpenClick(x, y) {
      calls.push([x, y])
      return true
    },
  })

  assert.equal(route.handled, true)
  assert.equal(route.direct, 'duplicate_open_echo')
  assert.equal(route.command, undefined)
  assert.deepEqual(route.pointer, { x: 10, y: 20, valid: true })
  assert.deepEqual(calls, [[10, 20]])
})

test('avatar controls right-click routing chooses toggle for non-duplicate open controls', () => {
  const route = resolveAvatarControlsRightClickRoute({ type: 'right_mouse_down', x: 12, y: 24 }, {
    isOpen: true,
    isDuplicateOpenClick: () => false,
  })

  assert.equal(route.handled, true)
  assert.equal(route.command, 'toggle')
  assert.equal(route.input.nodeId, 'sigil.avatar.controls')
  assert.equal(route.input.mode, 'global')
  assert.equal(route.input.gesture, 'pointer.right.click')
  assert.deepEqual(route.pointer, { x: 12, y: 24, valid: true })
})

test('avatar controls right-click routing repositions when an open panel is clicked from the avatar', () => {
  const route = resolveAvatarControlsRightClickRoute({ type: 'right_mouse_down', x: 32, y: 44 }, {
    isOpen: true,
    isDuplicateOpenClick: () => false,
    isAvatarPointer: () => true,
  })

  assert.equal(route.handled, true)
  assert.equal(route.command, 'open')
  assert.equal(route.reason, 'reposition_existing_panel')
  assert.equal(route.input.nodeId, 'sigil.avatar.body')
  assert.deepEqual(route.pointer, { x: 32, y: 44, valid: true })
})

test('avatar controls right-click routing chooses open only with numeric coordinates and closed controls', () => {
  const open = resolveAvatarControlsRightClickRoute({ type: 'right_mouse_down', x: 1, y: 2 }, {
    isOpen: false,
  })
  const missingCoordinates = resolveAvatarControlsRightClickRoute({ type: 'right_mouse_down', x: '1', y: 2 }, {
    isOpen: false,
  })

  assert.equal(open.command, 'open')
  assert.equal(open.input.nodeId, 'sigil.avatar.body')
  assert.equal(open.input.mode, 'idle')
  assert.equal(open.input.gesture, 'pointer.right.click')
  assert.deepEqual(open.pointer, { x: 1, y: 2, valid: true })
  assert.equal(missingCoordinates.direct, 'right_click_away')
  assert.equal(missingCoordinates.command, undefined)
})

test('avatar controls right-click routing exposes rejected open commands as not opened', () => {
  assert.equal(avatarControlsOpenCommandOpened({
    executed: true,
    handler_result: true,
  }), true)
  assert.equal(avatarControlsOpenCommandOpened({
    executed: true,
    handler_result: false,
  }), false)
  assert.equal(avatarControlsOpenCommandOpened({
    executed: false,
    reason: 'handler_not_registered',
  }), false)
})
