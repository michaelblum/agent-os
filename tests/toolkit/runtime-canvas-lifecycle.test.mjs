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
      windowNumbers: [1001, 1002],
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
    windowNumbers: [1001, 1002],
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

test('mergeCanvasLifecycleCanvas preserves top-level native window numbers', () => {
  const merged = mergeCanvasLifecycleCanvas(null, {
    canvas_id: 'agent-panel',
    action: 'created',
    at: [10, 20, 300, 200],
    interactive: true,
    windowNumbers: [4242],
  })

  assert.deepEqual(merged.windowNumbers, [4242])
})

test('mergeCanvasLifecycleCanvas preserves owner metadata', () => {
  const owner = {
    consumer_id: 'codex-thread-123',
    harness: 'codex',
    pid: 4242,
    cwd: '/worktrees/agent-a',
    worktree_root: '/worktrees/agent-a',
    runtime_mode: 'repo',
  }

  const merged = mergeCanvasLifecycleCanvas(null, {
    canvas_id: 'agent-panel',
    action: 'created',
    at: [10, 20, 300, 200],
    interactive: true,
    owner,
  })

  assert.deepEqual(merged.owner, owner)
})

test('mergeCanvasLifecycleCanvas preserves DesktopWorld surface segments', () => {
  const segments = [
    { display_id: 1, index: 0, dw_bounds: [0, 0, 100, 100], native_bounds: [0, 0, 100, 100] },
  ]

  const merged = mergeCanvasLifecycleCanvas(null, {
    event: 'canvas_topology_settled',
    canvas_id: 'avatar-main',
    segments,
  })

  assert.deepEqual(merged.segments, segments)
})
