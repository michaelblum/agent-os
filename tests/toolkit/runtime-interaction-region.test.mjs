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
  assert.equal(pointerPhase('right_mouse_down'), 'down')
  assert.equal(pointerPhase('middle_mouse_dragged'), 'drag')
  assert.equal(pointerPhase('other_mouse_up'), 'up')
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

test('router preserves right, middle, and other button capture metadata', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'palette',
    contains: rectContains({ x: 10, y: 10, w: 100, h: 100 }),
    onPointer(event) {
      events.push({
        phase: event.phase,
        type: event.type,
        button: event.button,
        captureId: event.captureId,
        captured: event.captured,
      })
    },
  })

  router.route({
    type: 'right_mouse_down',
    x: 20,
    y: 20,
    button: 'right',
    sequence: { source: 'daemon', value: 50 },
  })
  router.route({ type: 'right_mouse_up', x: 30, y: 30, button: 'right' })

  router.route({
    type: 'middle_mouse_down',
    x: 20,
    y: 20,
    button: 'middle',
    captureId: 'cap-middle',
  })
  router.route({ type: 'middle_mouse_dragged', x: 40, y: 40, button: 'middle' })
  router.route({ type: 'middle_mouse_up', x: 40, y: 40, button: 'middle' })

  router.route({
    type: 'other_mouse_down',
    x: 20,
    y: 20,
    button: 'other:4',
    gestureId: 'g-other',
  })
  router.route({ type: 'other_mouse_up', x: 20, y: 20, button: 'other:4' })

  assert.deepEqual(events, [
    { phase: 'down', type: 'right_mouse_down', button: 'right', captureId: 'daemon:50:palette', captured: true },
    { phase: 'up', type: 'right_mouse_up', button: 'right', captureId: 'daemon:50:palette', captured: true },
    { phase: 'down', type: 'middle_mouse_down', button: 'middle', captureId: 'cap-middle', captured: true },
    { phase: 'drag', type: 'middle_mouse_dragged', button: 'middle', captureId: 'cap-middle', captured: true },
    { phase: 'up', type: 'middle_mouse_up', button: 'middle', captureId: 'cap-middle', captured: true },
    { phase: 'down', type: 'other_mouse_down', button: 'other:4', captureId: 'g-other:palette', captured: true },
    { phase: 'up', type: 'other_mouse_up', button: 'other:4', captureId: 'g-other:palette', captured: true },
  ])
})

test('router injects cancel when a captured region is unregistered', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'drag-handle',
    contains: rectContains({ x: 0, y: 0, w: 40, h: 40 }),
    onPointer(event) {
      events.push({
        phase: event.phase,
        type: event.type,
        captureId: event.captureId,
        cancelReason: event.cancelReason,
      })
    },
  })

  router.route({ type: 'left_mouse_down', x: 10, y: 10, gesture_id: 'g-1' })
  router.unregisterRegion('drag-handle')

  assert.deepEqual(events, [
    { phase: 'down', type: 'left_mouse_down', captureId: 'g-1:drag-handle', cancelReason: undefined },
    { phase: 'cancel', type: 'pointer_cancel', captureId: 'g-1:drag-handle', cancelReason: 'region_unregistered' },
  ])
  assert.equal(router.snapshot().capturedRegionId, null)
})

test('router exposes explicit capture release with cancel reason', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'slider',
    contains: rectContains({ x: 0, y: 0, w: 100, h: 20 }),
    onPointer(event) {
      events.push([event.phase, event.captureId, event.cancel_reason])
    },
  })

  router.route({ type: 'left_mouse_down', x: 10, y: 10, captureId: 'cap-slider' })
  assert.equal(router.releaseCapture('cap-slider', 'surface_disabled'), true)
  assert.deepEqual(events, [
    ['down', 'cap-slider', undefined],
    ['cancel', 'cap-slider', 'surface_disabled'],
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

test('router synthesizes enter, hover, and leave for rectangular regions', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'avatar-footprint',
    contains: rectContains({ x: 10, y: 10, w: 40, h: 40 }),
    onPointer(event) {
      events.push([event.phase, event.point?.x])
    },
  })

  assert.equal(router.route({ type: 'mouse_moved', x: 5, y: 5 }), false)
  assert.equal(router.route({ type: 'mouse_moved', x: 20, y: 20 }), true)
  assert.equal(router.route({ type: 'mouse_moved', x: 30, y: 30 }), true)
  assert.equal(router.route({ type: 'mouse_moved', x: 80, y: 30 }), true)

  assert.deepEqual(events, [
    ['enter', 20],
    ['hover', 20],
    ['hover', 30],
    ['leave', 80],
  ])
  assert.deepEqual(router.snapshot().hoveredRegions, [])
})

test('router emits hover-cancel when a hovered region is unregistered', () => {
  const events = []
  const router = createDesktopWorldInteractionRouter()
  router.registerRegion({
    id: 'avatar-footprint',
    contains: rectContains({ x: 10, y: 10, w: 40, h: 40 }),
    onPointer(event) {
      events.push([event.phase, event.cancel_reason])
    },
  })

  router.route({ type: 'mouse_moved', x: 20, y: 20 }, { source: 'global' })
  router.unregisterRegion('avatar-footprint')

  assert.deepEqual(events, [
    ['enter', undefined],
    ['hover', undefined],
    ['hover_cancel', 'region_unregistered'],
  ])
  assert.deepEqual(router.snapshot().hoveredRegions, [])
})
