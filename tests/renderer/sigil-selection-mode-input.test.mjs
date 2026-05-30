import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAvatarDoubleClickTracker,
  resolveSelectionModeInputRoute,
} from '../../apps/sigil/renderer/live-modules/selection-mode-input.js'

test('Selection Mode entry release guard does not immediately exit active mode', () => {
  let now = 0
  const tracker = createAvatarDoubleClickTracker({
    now: () => now,
    isOnAvatar: (x, y) => Math.hypot(x - 100, y - 100) <= 20,
    getAvatarHitRadius: () => 20,
  })
  let selectionModeActive = false

  function markSelectionModeEntered() {
    selectionModeActive = true
    tracker.resetAvatarDoubleClick()
    tracker.markSelectionModeEntryReleasePending()
  }

  function routeSelectionModeInput(type) {
    if (type === 'left_mouse_down') return
    if (tracker.consumeSelectionModeEntryRelease({ type, x: 100, y: 100 })) return
    if (tracker.consumeAvatarDoubleClick(100, 100)) selectionModeActive = false
  }

  now = 220
  markSelectionModeEntered()
  routeSelectionModeInput('left_mouse_up')
  assert.equal(selectionModeActive, true)

  now = 900
  routeSelectionModeInput('left_mouse_down')
  routeSelectionModeInput('left_mouse_up')
  assert.equal(selectionModeActive, true)

  now = 1020
  routeSelectionModeInput('left_mouse_down')
  routeSelectionModeInput('left_mouse_up')
  assert.equal(selectionModeActive, false)
})

test('Selection Mode routing resolves local key bindings to UX command gestures', () => {
  const cases = [
    [{ type: 'key_down', key: 'Enter' }, 'commit', 'key.enter'],
    [{ type: 'key_down', key: 'Return' }, 'commit', 'key.enter'],
    [{ type: 'key_down', key: 'Tab' }, 'tabPreviousTarget', 'key.tab'],
    [{ type: 'key_down', key: 'ArrowUp' }, 'arrowUpPreviousTarget', 'key.arrow_up'],
    [{ type: 'key_down', key: 'ArrowDown' }, 'arrowDownNextTarget', 'key.arrow_down'],
  ]

  for (const [msg, command, gesture] of cases) {
    const route = resolveSelectionModeInputRoute(msg)
    assert.equal(route.handled, true, gesture)
    assert.equal(route.command, command, gesture)
    assert.equal(route.gesture, gesture)
  }
})

test('Selection Mode routing preserves left mouse entry-release and avatar exit guards', () => {
  const calls = []
  const guards = {
    consumeSelectionModeEntryRelease(msg) {
      calls.push(['entry_release', msg.type])
      return true
    },
    isOnAvatar() {
      calls.push(['is_on_avatar'])
      return true
    },
    consumeAvatarDoubleClick() {
      calls.push(['double_click'])
      return true
    },
  }

  const suppressed = resolveSelectionModeInputRoute({ type: 'left_mouse_up', x: 5, y: 8 }, guards)
  assert.equal(suppressed.handled, true)
  assert.equal(suppressed.direct, 'entry_release')
  assert.deepEqual(calls, [['entry_release', 'left_mouse_up']])

  calls.length = 0
  const avatarExit = resolveSelectionModeInputRoute({ type: 'left_mouse_up', x: 5, y: 8 }, {
    ...guards,
    consumeSelectionModeEntryRelease() {
      calls.push(['entry_release'])
      return false
    },
  })
  assert.equal(avatarExit.handled, true)
  assert.equal(avatarExit.direct, 'avatar_double_click_exit')
  assert.deepEqual(calls, [['entry_release'], ['is_on_avatar'], ['double_click']])
})

test('Selection Mode routing resolves non-avatar left mouse up to acquire with pointer context', () => {
  const route = resolveSelectionModeInputRoute({ type: 'left_mouse_up', x: 11, y: 22 }, {
    consumeSelectionModeEntryRelease: () => false,
    isOnAvatar: () => false,
  })

  assert.equal(route.handled, true)
  assert.equal(route.command, 'acquire')
  assert.equal(route.gesture, 'pointer.left.click')
  assert.deepEqual(route.pointer, { x: 11, y: 22, valid: true })
})

test('Selection Mode routing resolves lineage item hits before reacquisition', () => {
  const route = resolveSelectionModeInputRoute({ type: 'left_mouse_up', x: 11, y: 22 }, {
    consumeSelectionModeEntryRelease: () => false,
    isOnAvatar: () => false,
    hitTestLineageItem: (point) => (
      point.x === 11 && point.y === 22
        ? { id: 'selection-mode-lineage:ancestor', nodeId: 'node:ancestor' }
        : null
    ),
  })

  assert.equal(route.handled, true)
  assert.equal(route.command, 'selectLineageNode')
  assert.equal(route.gesture, 'pointer.lineage.click')
  assert.equal(route.nodeId, 'node:ancestor')
  assert.equal(route.lineageItemId, 'selection-mode-lineage:ancestor')
  assert.deepEqual(route.pointer, { x: 11, y: 22, valid: true })
})

test('Selection Mode routing consumes lineage bar chrome gaps before reacquisition', () => {
  const route = resolveSelectionModeInputRoute({ type: 'left_mouse_up', x: 11, y: 22 }, {
    consumeSelectionModeEntryRelease: () => false,
    isOnAvatar: () => false,
    hitTestLineageItem: () => null,
    hitTestLineageBar: (point) => (
      point.x === 11 && point.y === 22
        ? { kind: 'bar', id: 'selection-mode-lineage-bar' }
        : null
    ),
  })

  assert.equal(route.handled, true)
  assert.equal(route.direct, 'lineage_bar_chrome')
})
