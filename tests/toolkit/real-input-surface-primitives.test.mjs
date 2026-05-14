import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  desktopWorldPointToNative,
  desktopWorldFigureEightPath,
  nativeRectIntersectsVisibleDisplay,
  normalizeDisplayTopology,
  oppositeVisibleDisplayPoint,
  rectIntersectsVisibleDisplay,
} from '../lib/real-input-surface-primitives.mjs'

const displays = [
  {
    id: 'main',
    is_main: true,
    native_bounds: { x: -1512, y: 0, w: 1512, h: 982 },
    native_visible_bounds: { x: -1512, y: 25, w: 1512, h: 919 },
  },
  {
    id: 'extended',
    is_main: false,
    native_bounds: { x: 0, y: 0, w: 1920, h: 1080 },
    native_visible_bounds: { x: 0, y: 0, w: 1920, h: 1040 },
  },
]

const stackedDisplays = [
  {
    id: 'main',
    is_main: true,
    native_bounds: { x: 0, y: 0, w: 1728, h: 982 },
    native_visible_bounds: { x: 0, y: 0, w: 1728, h: 982 },
  },
  {
    id: 'extended',
    is_main: false,
    native_bounds: { x: 0, y: 982, w: 1728, h: 1117 },
    native_visible_bounds: { x: 0, y: 982, w: 1728, h: 1117 },
  },
]

test('normalizes display topology through toolkit DesktopWorld semantics', () => {
  const normalized = normalizeDisplayTopology(displays)
  assert.deepEqual(normalized.map((display) => display.bounds), [
    { x: 0, y: 0, w: 1512, h: 982 },
    { x: 1512, y: 0, w: 1920, h: 1080 },
  ])
  assert.deepEqual(normalized.map((display) => display.label), ['main', 'extended:extended'])
})

test('converts DesktopWorld points to native only at the real-input boundary', () => {
  assert.deepEqual(desktopWorldPointToNative({ x: 1612, y: 200 }, displays), { x: 100, y: 200 })
})

test('builds a centered DesktopWorld figure-eight path with radial menu padding', () => {
  const path = desktopWorldFigureEightPath(displays, { radialMenuRadius: 160, minSpan: 400 })
  assert.equal(path.skipped, false)
  assert.deepEqual(path.bounds, { x: 0, y: 0, w: 3432, h: 1040, minX: 0, minY: 0, maxX: 3432, maxY: 1040 })
  assert.deepEqual(path.insetBounds, { x: 160, y: 160, w: 3112, h: 720 })
  assert.deepEqual(path.points.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 'north-west', x: 160, y: 160 },
    { id: 'south-east', x: 3272, y: 880 },
    { id: 'north-east', x: 3272, y: 160 },
    { id: 'south-west', x: 160, y: 880 },
    { id: 'north-west-return', x: 160, y: 160 },
  ])
})

test('keeps the figure-eight path topology-neutral for stacked displays', () => {
  const path = desktopWorldFigureEightPath(stackedDisplays, { radialMenuRadius: 260, minSpan: 400 })
  assert.equal(path.skipped, false)
  assert.deepEqual(path.points.map(({ id, x, y }) => ({ id, x, y })), [
    { id: 'north-west', x: 260, y: 260 },
    { id: 'south-east', x: 1468, y: 1839 },
    { id: 'north-east', x: 1468, y: 260 },
    { id: 'south-west', x: 260, y: 1839 },
    { id: 'north-west-return', x: 260, y: 260 },
  ])
})

test('returns precise skip reasons when visible bounds cannot fit padded traversal', () => {
  const path = desktopWorldFigureEightPath([{ native_bounds: { x: 0, y: 0, w: 320, h: 240 } }], {
    radialMenuRadius: 160,
    minSpan: 80,
  })
  assert.equal(path.skipped, true)
  assert.match(path.reason, /visible DesktopWorld bounds too small/)
})

test('checks visible-display intersection and opposite-display travel points', () => {
  assert.equal(rectIntersectsVisibleDisplay({ x: 1510, y: 100, w: 100, h: 100 }, displays), true)
  assert.equal(nativeRectIntersectsVisibleDisplay({ x: -10, y: 100, w: 100, h: 100 }, displays), true)
  assert.equal(nativeRectIntersectsVisibleDisplay([-10, 100, 100, 100], displays), true)
  assert.deepEqual(oppositeVisibleDisplayPoint({ x: 100, y: 200 }, displays, { pad: 80 }), { x: 1432, y: 200 })
})
