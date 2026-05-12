import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inputRegionContainsRect } from '../../packages/toolkit/runtime/input-region.js'

test('inputRegionContainsRect accepts width/height and w/h rectangles', () => {
  const withWH = inputRegionContainsRect({ x: 10, y: 20, w: 30, h: 40 })
  assert.equal(withWH({ x: 10, y: 20 }), true)
  assert.equal(withWH({ x: 39.99, y: 59.99 }), true)
  assert.equal(withWH({ x: 40, y: 60 }), false)

  const withNames = inputRegionContainsRect({ x: 5, y: 5, width: 10, height: 10 })
  assert.equal(withNames({ x: 14, y: 14 }), true)
  assert.equal(withNames({ x: 15, y: 14 }), false)
})

test('inputRegionContainsRect rejects non-numeric points and rects', () => {
  assert.equal(inputRegionContainsRect({ x: 0, y: 0, w: 10, h: 10 })({ x: 'nope', y: 1 }), false)
  assert.equal(inputRegionContainsRect({ x: 0, y: 0, w: 'bad', h: 10 })({ x: 1, y: 1 }), false)
})
