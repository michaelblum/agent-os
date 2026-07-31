import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldRenderDamageTracker,
} from '../../packages/toolkit/components/desktop-world-stage/scene-render-damage.js'

function resource(bounds, padding = 0) {
  return {
    projection: {
      renderDamage: () => ({ kind: 'bounded', padding, regions: [bounds] }),
    },
    suspended: false,
  }
}

test('damage unions previous and current bounds to erase a moving resource', () => {
  const tracker = createDesktopWorldRenderDamageTracker()
  tracker.updateSegment({ dw_bounds: [0, 0, 1_000, 800] })
  let bounds = [100, 100, 80, 60]
  const mounted = resource(bounds, 10)
  mounted.projection.renderDamage = () => ({ kind: 'bounded', padding: 10, regions: [bounds] })
  const resources = new Map([['companion/main', mounted]])

  assert.equal(tracker.frame(resources).kind, 'full_stage')
  bounds = [300, 250, 80, 60]
  assert.deepEqual(tracker.frame(resources), {
    damagedPixelPercentage: 8.625,
    globalBounds: [90, 90, 300, 230],
    kind: 'bounded',
    localBounds: [90, 90, 300, 230],
  })
})

test('each display intersects one global damage region without changing coordinates', () => {
  const left = createDesktopWorldRenderDamageTracker()
  const right = createDesktopWorldRenderDamageTracker()
  left.updateSegment({ dw_bounds: [0, 0, 1_000, 800] })
  right.updateSegment({ dw_bounds: [1_000, -100, 1_200, 900] })
  const resources = new Map([['travel/main', resource([900, 200, 300, 120])]])
  left.frame(resources)
  right.frame(resources)

  assert.deepEqual(left.frame(resources).localBounds, [900, 200, 100, 120])
  assert.deepEqual(right.frame(resources).localBounds, [0, 300, 200, 120])
})

test('removed and suspended resources receive one bounded cleanup frame', () => {
  const tracker = createDesktopWorldRenderDamageTracker()
  tracker.updateSegment({ dw_bounds: [0, 0, 1_000, 800] })
  const resources = new Map([['companion/main', resource([100, 100, 80, 60], 10)]])
  tracker.frame(resources)
  tracker.frame(resources)

  resources.clear()
  assert.equal(tracker.hasPendingCleanup(resources), true)
  assert.deepEqual(tracker.frame(resources).localBounds, [90, 90, 100, 80])
  assert.equal(tracker.hasPendingCleanup(resources), false)

  resources.set('companion/main', resource([300, 300, 80, 60]))
  tracker.frame(resources)
  tracker.frame(resources)
  resources.get('companion/main').suspended = true
  assert.equal(tracker.hasPendingCleanup(resources), true)
  assert.deepEqual(tracker.frame(resources).localBounds, [300, 300, 80, 60])
})

test('missing or invalid damage declarations preserve correctness with a full-stage render', () => {
  const tracker = createDesktopWorldRenderDamageTracker()
  tracker.updateSegment({ dw_bounds: [0, 0, 1_000, 800] })
  tracker.frame(new Map())

  const missing = new Map([['generic/main', { projection: {}, suspended: false }]])
  assert.equal(tracker.frame(missing).kind, 'full_stage')

  const invalid = new Map([['invalid/main', resource([0, 0, -1, 10])]])
  assert.equal(tracker.frame(invalid).kind, 'full_stage')
})
