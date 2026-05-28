import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAvatarDoubleClickTracker } from '../../apps/sigil/renderer/live-modules/selection-mode-input.js'

test('avatar double-click entry release does not immediately exit Selection Mode', () => {
  let now = 0
  const tracker = createAvatarDoubleClickTracker({
    now: () => now,
    isOnAvatar: (x, y) => Math.hypot(x - 100, y - 100) <= 20,
    getAvatarHitRadius: () => 20,
  })
  let selectionModeActive = false

  function routeGotoLeftMouseDown() {
    if (!tracker.consumeAvatarDoubleClick(100, 100)) return
    selectionModeActive = true
    tracker.resetAvatarDoubleClick()
    tracker.markSelectionModeEntryReleasePending()
  }

  function routeSelectionModeInput(type) {
    if (type === 'left_mouse_down') return
    if (tracker.consumeSelectionModeEntryRelease({ type, x: 100, y: 100 })) return
    if (tracker.consumeAvatarDoubleClick(100, 100)) selectionModeActive = false
  }

  now = 100
  assert.equal(tracker.consumeAvatarDoubleClick(100, 100), false)

  now = 220
  routeGotoLeftMouseDown()
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
