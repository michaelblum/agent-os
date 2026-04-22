import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  canvasLifecycleCanvasID,
  mergeCanvasLifecycleCanvas,
} from '../../packages/toolkit/runtime/canvas-lifecycle.js'

test('canvasLifecycleCanvasID resolves top-level and nested ids', () => {
  assert.equal(canvasLifecycleCanvasID({ canvas_id: 'top-level' }), 'top-level')
  assert.equal(canvasLifecycleCanvasID({ id: 'legacy-id' }), 'legacy-id')
  assert.equal(canvasLifecycleCanvasID({ canvas: { id: 'nested-id' } }), 'nested-id')
  assert.equal(canvasLifecycleCanvasID({}), null)
})

test('mergeCanvasLifecycleCanvas preserves rich metadata from lifecycle payloads', () => {
  const existing = {
    id: 'avatar-main',
    at: [0, 0, 10, 10],
    interactive: false,
    scope: 'global',
  }

  const merged = mergeCanvasLifecycleCanvas(existing, {
    canvas_id: 'avatar-main',
    action: 'updated',
    at: [-185, 0, 1920, 2062],
    parent: null,
    track: 'union',
    interactive: false,
    scope: 'global',
    cascade: true,
    suspended: false,
    canvas: {
      id: 'avatar-main',
      at: [-185, 0, 1920, 2062],
      interactive: false,
      scope: 'global',
      track: 'union',
      cascade: true,
      suspended: false,
    },
  })

  assert.deepEqual(merged, {
    id: 'avatar-main',
    at: [-185, 0, 1920, 2062],
    interactive: false,
    scope: 'global',
    parent: null,
    track: 'union',
    ttl: null,
    cascade: true,
    suspended: false,
  })
})

test('mergeCanvasLifecycleCanvas falls back to nested canvas metadata for child canvases', () => {
  const merged = mergeCanvasLifecycleCanvas(null, {
    action: 'created',
    canvas: {
      id: 'sigil-hit',
      at: [1220, 784, 80, 80],
      interactive: false,
      scope: 'global',
      parent: 'avatar-main',
      cascade: true,
      suspended: false,
    },
  })

  assert.deepEqual(merged, {
    id: 'sigil-hit',
    at: [1220, 784, 80, 80],
    interactive: false,
    scope: 'global',
    parent: 'avatar-main',
    track: null,
    ttl: null,
    cascade: true,
    suspended: false,
  })
})
