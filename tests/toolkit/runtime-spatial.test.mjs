import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clampPointToDisplays,
  computeDisplayUnion,
  findDisplayForPoint,
  globalToCanvasLocalPoint,
  globalToDisplayLocalPoint,
  globalToUnionLocalPoint,
  normalizeDisplays,
} from '../../packages/toolkit/runtime/spatial.js'

test('computeDisplayUnion uses visible bounds for the spanning stage', () => {
  const displays = normalizeDisplays([
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'extended',
      bounds: { x: -1920, y: 0, w: 1920, h: 1200 },
      visible_bounds: { x: -1920, y: 0, w: 1920, h: 1160 },
    },
  ])

  assert.deepEqual(
    computeDisplayUnion(displays),
    { x: -1920, y: 0, w: 3432, h: 1160, minX: -1920, minY: 0, maxX: 1512, maxY: 1160 },
  )
})

test('findDisplayForPoint prefers the containing visible display and falls back to nearest', () => {
  const displays = normalizeDisplays([
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'extended',
      bounds: { x: -1920, y: 0, w: 1920, h: 1200 },
      visible_bounds: { x: -1920, y: 0, w: 1920, h: 1160 },
    },
  ])

  assert.equal(findDisplayForPoint(displays, 120, 120)?.id, 'main')
  assert.equal(findDisplayForPoint(displays, -2200, 200)?.id, 'extended')
})

test('clampPointToDisplays clamps to the nearest visible display edge', () => {
  const displays = normalizeDisplays([
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'extended',
      bounds: { x: -1920, y: 0, w: 1920, h: 1200 },
      visible_bounds: { x: -1920, y: 0, w: 1920, h: 1160 },
    },
  ])

  assert.deepEqual(clampPointToDisplays(displays, 4000, 2000), { x: 1511, y: 943 })
  assert.deepEqual(clampPointToDisplays(displays, -2500, -50), { x: -1920, y: 0 })
})

test('globalToUnionLocalPoint subtracts the union origin from desktop-global points', () => {
  assert.deepEqual(
    globalToUnionLocalPoint(
      { x: 100, y: 540 },
      { x: -191, y: 0, w: 1920, h: 2062, minX: -191, minY: 0 },
    ),
    { x: 291, y: 540 },
  )
})

test('globalToDisplayLocalPoint subtracts the display visible origin', () => {
  const display = normalizeDisplays([{
    id: 'main',
    is_main: true,
    bounds: { x: 0, y: 0, w: 1512, h: 982 },
    visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
  }])[0]

  assert.deepEqual(globalToDisplayLocalPoint({ x: 42, y: 77 }, display), { x: 42, y: 52 })
})

test('globalToCanvasLocalPoint accepts canvas records and raw rects', () => {
  assert.deepEqual(
    globalToCanvasLocalPoint({ x: 120, y: 90 }, { at: [100, 50, 300, 200] }),
    { x: 20, y: 40 },
  )
  assert.deepEqual(
    globalToCanvasLocalPoint({ x: 120, y: 90 }, { x: 100, y: 50, w: 300, h: 200 }),
    { x: 20, y: 40 },
  )
})
