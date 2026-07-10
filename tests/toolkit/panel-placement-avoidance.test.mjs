import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  avoidAnchorPanelOverlap,
  rectOverlapArea,
} from '../../packages/toolkit/panel/placement.js'

test('avoidAnchorPanelOverlap moves an anchor outside an overlapping panel', () => {
  const next = avoidAnchorPanelOverlap({
    anchorRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: { x: 1180, y: 442, w: 332, h: 540 },
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
    margin: 12,
  })

  assert.deepEqual(next, {
    x: 1128,
    y: 818,
    side: 'left',
    overlap: 0,
  })
})

test('avoidAnchorPanelOverlap returns null for non-overlapping or incomplete geometry', () => {
  assert.equal(avoidAnchorPanelOverlap({
    anchorRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: { x: 200, y: 120, w: 332, h: 540 },
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
  }), null)
  assert.equal(avoidAnchorPanelOverlap({
    anchorRect: { x: 1220, y: 778, w: 80, h: 80 },
    panelRect: null,
    viewport: { x: 0, y: 0, w: 1512, h: 982 },
  }), null)
})

test('rectOverlapArea returns overlap in square pixels', () => {
  assert.equal(rectOverlapArea(
    { x: 0, y: 0, w: 20, h: 20 },
    { x: 10, y: 5, w: 20, h: 20 },
  ), 150)
  assert.equal(rectOverlapArea(
    { x: 0, y: 0, w: 20, h: 20 },
    { x: 30, y: 30, w: 20, h: 20 },
  ), 0)
})
