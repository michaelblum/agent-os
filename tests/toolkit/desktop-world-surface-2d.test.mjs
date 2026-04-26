import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DesktopWorldSurface2D } from '../../packages/toolkit/runtime/desktop-world-surface-2d.js'

test('worldOrigin translates by negative segment DesktopWorld bounds', () => {
  const adapter = new DesktopWorldSurface2D({ canvasId: 'avatar' })
  adapter.segment = { dw_bounds: [1920, 40, 1920, 1080] }

  assert.deepEqual(adapter.worldOrigin(), { x: -1920, y: -40 })
})

test('applyWorldTransform writes a segment-local transform', () => {
  const adapter = new DesktopWorldSurface2D({ canvasId: 'avatar' })
  adapter.segment = { dw_bounds: [1920, 40, 1920, 1080] }
  const node = { style: {} }

  adapter.applyWorldTransform(node)

  assert.equal(node.style.transform, 'translate(-1920px, -40px)')
  assert.equal(node.style.transformOrigin, '0 0')
})

