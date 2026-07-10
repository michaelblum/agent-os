import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  avatarNativeFrame,
  nativeVisibleViewportForRect,
  panelFrameToAvatarControlsBounds,
  panelNativeFrameFromLifecycle,
  resolveAvatarPanelLifecycleAvoidance,
} from '../../apps/sigil/renderer/live-modules/avatar-panel-geometry.js'
import {
  resolveAvatarPanelAvoidancePosition,
} from '../../apps/sigil/avatar-controls/panel-avoidance.js'

const displays = [{
  nativeVisibleBounds: { x: 0, y: 0, w: 1512, h: 982 },
  visibleBounds: { x: 0, y: 0, w: 1512, h: 982 },
}]

test('panelNativeFrameFromLifecycle prefers settled lifecycle placement', () => {
  assert.deepEqual(panelNativeFrameFromLifecycle({
    canvas: {
      placement: {
        final_settled_frame: [10, 20, 300, 400],
        policy_adjusted_frame: [40, 50, 300, 400],
      },
      at: [70, 80, 300, 400],
    },
  }), { x: 10, y: 20, w: 300, h: 400 })

  assert.deepEqual(panelNativeFrameFromLifecycle({ at: [70, 80, 300, 400] }), { x: 70, y: 80, w: 300, h: 400 })
})

test('avatarNativeFrame uses injected DesktopWorld to native conversion', () => {
  const frame = avatarNativeFrame({
    avatarPos: { x: 1260, y: 818, valid: true },
    avatarHitRadius: 40,
    displays,
    desktopWorldToNativePoint(point) {
      return { x: point.x + 2, y: point.y + 4 }
    },
  })

  assert.deepEqual(frame, [1222, 782, 80, 80])
})

test('nativeVisibleViewportForRect chooses containing or centered viewport', () => {
  assert.deepEqual(
    nativeVisibleViewportForRect(displays, { x: 100, y: 100, w: 20, h: 20 }),
    { x: 0, y: 0, w: 1512, h: 982 },
  )
  assert.deepEqual(
    nativeVisibleViewportForRect(displays, { x: -10, y: -10, w: 40, h: 40 }),
    { x: 0, y: 0, w: 1512, h: 982 },
  )
})

test('panelFrameToAvatarControlsBounds projects native frame through injected converter', () => {
  const bounds = panelFrameToAvatarControlsBounds([10, 20, 30, 40], {
    displays,
    nativeToDesktopWorldRect(rect) {
      return { x: rect.x + 1, y: rect.y + 2, w: rect.w, h: rect.h }
    },
  })

  assert.deepEqual(bounds, { x: 11, y: 22, w: 30, h: 40 })
})

test('resolveAvatarPanelLifecycleAvoidance returns move proof payload for orchestration', () => {
  const resolved = resolveAvatarPanelLifecycleAvoidance({
    canvas: {
      placement: {
        final_settled_frame: [1180, 442, 332, 540],
      },
    },
  }, {
    avatarControlsOpen: true,
    avatarVisible: true,
    avatarPos: { x: 1260, y: 818, valid: true },
    avatarHitRadius: 40,
    displays,
    desktopWorldToNativePoint: (point) => point,
    nativeToDesktopWorldPoint: (point) => ({ x: point.x + 1, y: point.y + 2 }),
    resolveAvatarPanelAvoidancePosition,
  })

  assert.deepEqual(resolved.next, {
    x: 1128,
    y: 818,
    side: 'left',
    overlap: 0,
  })
  assert.deepEqual(resolved.desktopPoint, { x: 1129, y: 820 })
  assert.equal(resolveAvatarPanelLifecycleAvoidance({}, {
    avatarControlsOpen: false,
    avatarVisible: true,
    avatarPos: { x: 1, y: 1, valid: true },
    resolveAvatarPanelAvoidancePosition,
  }), null)
})
