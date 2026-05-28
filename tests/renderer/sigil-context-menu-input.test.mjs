import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contextMenuOpenCommandOpened,
  resolveContextMenuRightClickRoute,
} from '../../apps/sigil/renderer/live-modules/context-menu-input.js'

test('context menu right-click routing suppresses duplicate open echoes before toggle', () => {
  const calls = []
  const route = resolveContextMenuRightClickRoute({ type: 'right_mouse_down', x: 10, y: 20 }, {
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

test('context menu right-click routing chooses toggle for non-duplicate open menus', () => {
  const route = resolveContextMenuRightClickRoute({ type: 'right_mouse_down', x: 12, y: 24 }, {
    isOpen: true,
    isDuplicateOpenClick: () => false,
  })

  assert.equal(route.handled, true)
  assert.equal(route.command, 'toggle')
  assert.equal(route.input.nodeId, 'sigil.avatar.context_menu')
  assert.equal(route.input.mode, 'global')
  assert.equal(route.input.gesture, 'pointer.right.click')
  assert.deepEqual(route.pointer, { x: 12, y: 24, valid: true })
})

test('context menu right-click routing chooses open only with numeric coordinates and closed menu', () => {
  const open = resolveContextMenuRightClickRoute({ type: 'right_mouse_down', x: 1, y: 2 }, {
    isOpen: false,
  })
  const missingCoordinates = resolveContextMenuRightClickRoute({ type: 'right_mouse_down', x: '1', y: 2 }, {
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

test('context menu right-click routing exposes rejected open commands as not opened', () => {
  assert.equal(contextMenuOpenCommandOpened({
    executed: true,
    handler_result: true,
  }), true)
  assert.equal(contextMenuOpenCommandOpened({
    executed: true,
    handler_result: false,
  }), false)
  assert.equal(contextMenuOpenCommandOpened({
    executed: false,
    reason: 'handler_not_registered',
  }), false)
})
