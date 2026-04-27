import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  angleDegrees,
  createRadialGestureModel,
  normalizeDegrees,
  pointAtAngle,
  resolveRadialGestureItems,
  shortestAngleDelta,
} from '../../packages/toolkit/runtime/radial-gesture.js'

const items = [
  { id: 'context-menu' },
  { id: 'wiki-graph' },
]

function model(options = {}) {
  return createRadialGestureModel({
    radiusBasis: 100,
    startAngle: -90,
    spreadDegrees: 90,
    itemRadius: 1,
    itemHitRadius: 0.25,
    itemVisualRadius: 0.2,
    menuRadius: 1.2,
    handoffRadius: 1.8,
    reentryRadius: 1.45,
    deadZoneRadius: 0.3,
    items,
    ...options,
  })
}

test('radial geometry uses browser-coordinate angles', () => {
  assert.equal(normalizeDegrees(-90), 270)
  assert.equal(shortestAngleDelta(350, 10), -20)
  assert.equal(angleDegrees({ x: 0, y: 0 }, { x: 0, y: -10 }), 270)
  assert.deepEqual(pointAtAngle({ x: 10, y: 10 }, 0, 20), { x: 30, y: 10 })
})

test('resolveRadialGestureItems spreads fixed item slots around start angle', () => {
  const resolved = resolveRadialGestureItems(items, {
    radiusBasis: 100,
    startAngle: -90,
    spreadDegrees: 90,
    itemRadius: 1,
    itemHitRadius: 0.25,
    itemVisualRadius: 0.2,
  }, {
    origin: { x: 200, y: 200 },
  })

  assert.equal(resolved[0].id, 'context-menu')
  assert.equal(resolved[0].angle, 225)
  assert.equal(resolved[1].angle, 315)
  assert.equal(Math.round(resolved[0].center.x), 129)
  assert.equal(Math.round(resolved[1].center.x), 271)
  assert.equal(resolved[0].hitRadius, 25)
  assert.equal(resolved[0].visualRadius, 20)
})

test('model starts in radial phase and reports menu growth progress', () => {
  const gesture = model()
  const started = gesture.start({ x: 100, y: 100 })
  assert.equal(started.phase, 'radial')
  assert.equal(started.menuProgress, 0)
  assert.equal(started.items.length, 2)

  const moved = gesture.move({ x: 160, y: 100 })
  assert.equal(moved.phase, 'radial')
  assert.equal(moved.menuProgress, 0.5)
  assert.equal(moved.handoffProgress, 1 / 3)
})

test('release over a radial item commits that item', () => {
  const gesture = model()
  const started = gesture.start({ x: 200, y: 200 })
  const target = started.items.find((item) => item.id === 'context-menu').center

  const hovered = gesture.move(target)
  assert.equal(hovered.phase, 'radial')
  assert.equal(hovered.activeItemId, 'context-menu')

  const released = gesture.release(target)
  assert.equal(released.phase, 'committed')
  assert.deepEqual(
    { type: released.committed.type, itemId: released.committed.itemId },
    { type: 'item', itemId: 'context-menu' }
  )
  assert.equal(released.lastTransition, 'commit_item')
})

test('dragging past handoff radius enters fast travel and release commits destination', () => {
  const gesture = model()
  gesture.start({ x: 0, y: 0 })

  const preview = gesture.move({ x: 190, y: 0 })
  assert.equal(preview.phase, 'fastTravel')
  assert.equal(preview.activeItemId, null)
  assert.equal(preview.lastTransition, 'handoff_fast_travel')

  const released = gesture.release({ x: 220, y: 25 })
  assert.equal(released.phase, 'committed')
  assert.deepEqual(released.committed, {
    type: 'fastTravel',
    origin: { x: 0, y: 0 },
    destination: { x: 220, y: 25 },
  })
})

test('fast travel handoff has reentry hysteresis', () => {
  const gesture = model()
  gesture.start({ x: 0, y: 0 })
  assert.equal(gesture.move({ x: 181, y: 0 }).phase, 'fastTravel')
  assert.equal(gesture.move({ x: 160, y: 0 }).phase, 'fastTravel')

  const reentered = gesture.move({ x: 140, y: 0 })
  assert.equal(reentered.phase, 'radial')
  assert.equal(reentered.lastTransition, 'reenter_radial')
})

test('release without a selected item cancels radial gesture', () => {
  const gesture = model()
  gesture.start({ x: 0, y: 0 })

  const released = gesture.release({ x: 20, y: 0 })
  assert.equal(released.phase, 'cancelled')
  assert.equal(released.cancelReason, 'release_without_selection')
})

test('explicit cancel records the reason and clears committed action', () => {
  const gesture = model()
  gesture.start({ x: 0, y: 0 })
  gesture.move({ x: 190, y: 0 })

  const cancelled = gesture.cancel('escape_key')
  assert.equal(cancelled.phase, 'cancelled')
  assert.equal(cancelled.cancelReason, 'escape_key')
  assert.equal(cancelled.committed, null)
})
