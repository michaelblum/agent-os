import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DesktopWorldSurfaceThree,
  deriveOrthoCamera,
} from '../../packages/toolkit/runtime/desktop-world-surface-three.js'

test('deriveOrthoCamera carves the camera to segment bounds', () => {
  const cam = deriveOrthoCamera({
    dw_bounds: [1920, 0, 1920, 1080],
  })

  assert.equal(cam.left, 1920)
  assert.equal(cam.right, 3840)
  assert.equal(cam.top, 0)
  assert.equal(cam.bottom, 1080)
})

test('refreshCamera mutates a camera-like object', () => {
  let updated = false
  const adapter = new DesktopWorldSurfaceThree({ canvasId: 'avatar' })
  adapter.segment = { dw_bounds: [10, 20, 300, 200] }
  const camera = {
    updateProjectionMatrix() { updated = true },
  }

  const frustum = adapter.refreshCamera(camera)

  assert.deepEqual(
    { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom },
    { left: 10, right: 310, top: 20, bottom: 220 },
  )
  assert.equal(frustum.width, 300)
  assert.equal(updated, true)
})

test('refreshCamera updates perspective cameras without applying orthographic bounds', () => {
  let updated = false
  const priorWindow = globalThis.window
  globalThis.window = { innerWidth: 1200, innerHeight: 800 }
  try {
    const adapter = new DesktopWorldSurfaceThree({ canvasId: 'avatar' })
    adapter.segment = { dw_bounds: [10, 20, 300, 200] }
    const camera = {
      isPerspectiveCamera: true,
      aspect: 1,
      updateProjectionMatrix() { updated = true },
    }

    const snapshot = adapter.refreshCamera(camera)

    assert.equal(camera.aspect, 1.5)
    assert.equal(camera.left, undefined)
    assert.equal(snapshot.type, 'perspective')
    assert.equal(updated, true)
  } finally {
    globalThis.window = priorWindow
  }
})
