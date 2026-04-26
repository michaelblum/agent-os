import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createDesktopWorldInteractionRouter,
  pointerPhase,
} from '../../packages/toolkit/runtime/interaction-region.js'

function rectContains(rect) {
  return (point) => point
    && point.x >= rect.x
    && point.y >= rect.y
    && point.x < rect.x + rect.w
    && point.y < rect.y + rect.h
}

test('pointerPhase normalizes canvas mouse event names', () => {
  assert.equal(pointerPhase('left_mouse_down'), 'down')
  assert.equal(pointerPhase('left_mouse_dragged'), 'drag')
  assert.equal(pointerPhase('left_mouse_up'), 'up')
  assert.equal(pointerPhase('mouse_moved'), 'move')
  assert.equal(pointerPhase('unknown'), null)
})

test('router captures a region from down through up', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'menu',
    contains: rectContains({ x: 10, y: 10, w: 100, h: 100 }),
    onPointer(event) {
      events.push([event.phase, event.source, event.point.x])
    },
  })

  assert.equal(router.route({ type: 'left_mouse_down', x: 20, y: 20 }, { source: 'global' }), true)
  assert.equal(router.route({ type: 'left_mouse_dragged', x: 180, y: 20 }, { source: 'global' }), true)
  assert.equal(router.route({ type: 'left_mouse_up', x: 180, y: 20 }, { source: 'global' }), true)

  assert.deepEqual(events, [
    ['down', 'global', 20],
    ['drag', 'global', 180],
    ['up', 'global', 180],
  ])
})

test('router suppresses duplicate non-captured streams during drag', () => {
  const values = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'slider',
    contains: rectContains({ x: 100, y: 100, w: 200, h: 30 }),
    onPointer(event) {
      if (event.phase === 'down' || event.phase === 'drag') values.push(event.point.x)
    },
  })

  router.route({ type: 'left_mouse_down', x: 120, y: 110 }, { source: 'hit', assumeInside: true })
  router.route({ type: 'left_mouse_down', x: -500, y: 110 }, { source: 'global' })
  router.route({ type: 'left_mouse_dragged', x: 180, y: 110 }, { source: 'hit', assumeInside: true })
  router.route({ type: 'left_mouse_dragged', x: -500, y: 110 }, { source: 'global' })
  router.route({ type: 'left_mouse_dragged', x: 240, y: 110 }, { source: 'hit', assumeInside: true })
  router.route({ type: 'left_mouse_dragged', x: -500, y: 110 }, { source: 'global' })
  router.route({ type: 'left_mouse_up', x: 250, y: 110 }, { source: 'hit', assumeInside: true })
  router.route({ type: 'left_mouse_up', x: -500, y: 110 }, { source: 'global' })

  assert.deepEqual(values, [120, 180, 240])
  assert.equal(router.snapshot().capturedRegionId, null)
})

test('router reports outside click after outside down/up', () => {
  const outside = []
  const router = createDesktopWorldInteractionRouter({
    onOutsidePointer(event) {
      outside.push(event.phase)
    },
  })
  router.registerRegion({
    id: 'menu',
    contains: rectContains({ x: 10, y: 10, w: 100, h: 100 }),
    onPointer() {},
  })

  router.route({ type: 'left_mouse_down', x: 400, y: 400 }, { source: 'global' })
  router.route({ type: 'left_mouse_up', x: 400, y: 400 }, { source: 'global' })

  assert.deepEqual(outside, ['down', 'up'])
})
