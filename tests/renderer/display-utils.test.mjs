import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  computeDisplayNonant,
  computeWorkbenchFrame,
  globalToUnionLocalPoint,
  normalizeDisplays,
} from '../../apps/sigil/renderer/live-modules/display-utils.js'

test('globalToUnionLocalPoint is re-exported through Sigil display-utils', () => {
  assert.deepEqual(
    globalToUnionLocalPoint(
      { x: 291, y: 540 },
      { x: 0, y: 0, w: 1920, h: 2062, minX: 0, minY: 0 },
    ),
    { x: 291, y: 540 },
  )
})

test('computeWorkbenchFrame anchors the workbench to the active display visible bounds', () => {
  const displays = normalizeDisplays([
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
  ])

  assert.deepEqual(
    computeWorkbenchFrame(displays, { x: 400, y: 200 }),
    [515, 53, 965, 863],
  )
})

test('computeDisplayNonant resolves points inside the containing visible display', () => {
  const displays = normalizeDisplays([
    {
      id: 'extended',
      bounds: { x: -1920, y: 0, w: 1920, h: 1200 },
      visible_bounds: { x: -1920, y: 0, w: 1920, h: 1160 },
    },
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
  ])

  assert.deepEqual(
    computeDisplayNonant(displays, { x: 400, y: 500 }, 'bottom-right'),
    { x: 1600, y: 966.6666666666667 },
  )
})
