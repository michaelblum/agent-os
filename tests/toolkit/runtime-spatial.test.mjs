import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  clampPointToDisplays,
  computeDesktopWorldBounds,
  computeNativeDesktopBounds,
  computeVisibleDesktopWorldBounds,
  desktopWorldToNativePoint,
  findDisplayForPoint,
  globalToCanvasLocalPoint,
  globalToDisplayLocalPoint,
  globalToUnionLocalPoint,
  nativeToDesktopWorldPoint,
  normalizeDisplays,
} from '../../packages/toolkit/runtime/spatial.js'

test('computeDesktopWorldBounds uses the full arranged union while visible space stays separate', () => {
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
    computeDesktopWorldBounds(displays),
    { x: 0, y: 0, w: 3432, h: 1200, minX: 0, minY: 0, maxX: 3432, maxY: 1200 },
  )
  assert.deepEqual(
    computeVisibleDesktopWorldBounds(displays),
    { x: 0, y: 0, w: 3432, h: 1160, minX: 0, minY: 0, maxX: 3432, maxY: 1160 },
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

  assert.equal(findDisplayForPoint(displays, 2000, 120)?.id, 'main')
  assert.equal(findDisplayForPoint(displays, -20, 200)?.id, 'extended')
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

  assert.deepEqual(clampPointToDisplays(displays, 4000, 2000), { x: 3431, y: 943 })
  assert.deepEqual(clampPointToDisplays(displays, -500, -50), { x: 0, y: 0 })
})

test('native/DesktopWorld conversion is stable when macOS main display flips', () => {
  const mainLeft = normalizeDisplays([
    {
      id: 'left',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'right',
      is_main: false,
      bounds: { x: 1512, y: 0, w: 1920, h: 1080 },
      visible_bounds: { x: 1512, y: 0, w: 1920, h: 1040 },
    },
  ])
  const mainRight = normalizeDisplays([
    {
      id: 'left',
      is_main: false,
      bounds: { x: -1512, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: -1512, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'right',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1920, h: 1080 },
      visible_bounds: { x: 0, y: 0, w: 1920, h: 1040 },
    },
  ])

  assert.deepEqual(mainLeft.map((display) => display.bounds), mainRight.map((display) => display.bounds))
  assert.deepEqual(computeDesktopWorldBounds(mainLeft), computeDesktopWorldBounds(mainRight))
  assert.deepEqual(
    nativeToDesktopWorldPoint({ x: 1632, y: 200 }, mainLeft),
    nativeToDesktopWorldPoint({ x: 120, y: 200 }, mainRight),
  )
})

test('globalToUnionLocalPoint becomes a DesktopWorld-local shim once the world is re-anchored', () => {
  assert.deepEqual(
    globalToUnionLocalPoint(
      { x: 291, y: 540 },
      { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0 },
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

test('native/DesktopWorld point conversion round-trips through the native boundary', () => {
  const displays = normalizeDisplays([
    {
      id: 'main',
      is_main: true,
      bounds: { x: -191, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: -191, y: 25, w: 1512, h: 919 },
    },
    {
      id: 'ext',
      bounds: { x: 1321, y: 0, w: 1920, h: 1080 },
      visible_bounds: { x: 1321, y: 0, w: 1920, h: 1040 },
    },
  ])
  const worldPoint = nativeToDesktopWorldPoint({ x: 1450, y: 300 }, displays)
  assert.deepEqual(worldPoint, { x: 1641, y: 300 })
  assert.deepEqual(desktopWorldToNativePoint(worldPoint, displays), { x: 1450, y: 300 })
  assert.deepEqual(computeNativeDesktopBounds(displays), { x: -191, y: 0, w: 3432, h: 1080, minX: -191, minY: 0, maxX: 3241, maxY: 1080 })
})
