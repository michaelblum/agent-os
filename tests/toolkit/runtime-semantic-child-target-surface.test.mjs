import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSemanticChildTargetSurface,
  semanticChildNativeFrameRect,
  semanticChildSurfaceOffscreenFrame,
  semanticChildTargetsWorldRect,
  semanticChildWorldRectForCenter,
} from '../../packages/toolkit/runtime/semantic-child-target-surface.js'

function fakeRuntime(calls = []) {
  return {
    canvasCreate(payload) {
      calls.push(['create', payload])
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      calls.push(['update', payload])
    },
    canvasRemove(payload) {
      calls.push(['remove', payload])
      return Promise.resolve()
    },
    post(type, payload) {
      calls.push(['post', type, payload])
    },
  }
}

test('semantic child helpers normalize frames, centers, and target bounds', () => {
  assert.deepEqual(semanticChildSurfaceOffscreenFrame([20, 30]), [-10000, -10000, 20, 30])
  assert.deepEqual(semanticChildWorldRectForCenter({ x: 100, y: 80, valid: true }, 40), {
    x: 80,
    y: 60,
    w: 40,
    h: 40,
  })
  assert.deepEqual(semanticChildNativeFrameRect([1, 2, 30, 40]), { x: 1, y: 2, w: 30, h: 40 })
  assert.deepEqual(semanticChildTargetsWorldRect([
    { center: { x: 100, y: 80 }, radius: 10 },
    { center: { x: 160, y: 90 }, radius: 20 },
  ], { padding: 5 }), {
    x: 85,
    y: 65,
    w: 100,
    h: 50,
  })
})

test('SemanticChildTargetSurface creates a child surface and projects target payloads', async () => {
  const calls = []
  const surface = createSemanticChildTargetSurface({
    runtime: fakeRuntime(calls),
    id: 'semantic-surface-a',
    url: 'aos://toolkit/semantic-child.html',
    fallbackOwnerCanvasId: 'parent-a',
    initialSize: [8, 8],
    messageType: 'fixture.semantic.update',
    resolveTargets(snapshot) {
      return snapshot.items.map((item) => ({
        id: item.id,
        label: item.label,
        center: item.center,
        size: 20,
        radius: 10,
      }))
    },
    resolveWorldRect: (targets) => semanticChildTargetsWorldRect(targets, { padding: 4 }),
    buildPayload: ({ input, targets, worldRect }) => ({
      phase: input.phase,
      bounds: worldRect,
      items: targets,
    }),
  })

  await surface.ensureCreated()
  assert.deepEqual(calls[0], ['create', {
    id: 'semantic-surface-a',
    url: 'aos://toolkit/semantic-child.html?parent=parent-a&id=semantic-surface-a',
    parent: 'parent-a',
    frame: [-10000, -10000, 8, 8],
    interactive: false,
    window_level: 'screen_saver',
    cascade: true,
  }])

  assert.equal(surface.sync({
    phase: 'active',
    items: [
      { id: 'one', label: 'One', center: { x: 100, y: 100 } },
      { id: 'two', label: 'Two', center: { x: 150, y: 110 } },
    ],
  }), true)

  assert.deepEqual(calls[1], ['update', {
    id: 'semantic-surface-a',
    frame: [86, 86, 78, 38],
    interactive: true,
  }])
  assert.deepEqual(calls[2], ['post', 'canvas.send', {
    target: 'semantic-surface-a',
    message: {
      type: 'fixture.semantic.update',
      payload: {
        phase: 'active',
        bounds: { x: 86, y: 86, w: 78, h: 38 },
        items: [
          { id: 'one', label: 'One', center: { x: 100, y: 100 }, size: 20, radius: 10, x: 14, y: 14 },
          { id: 'two', label: 'Two', center: { x: 150, y: 110 }, size: 20, radius: 10, x: 64, y: 24 },
        ],
      },
    },
  }])
  assert.equal(surface.snapshot().interactive, true)
})

test('SemanticChildTargetSurface disables offscreen and refreshes payloads', async () => {
  const calls = []
  const surface = createSemanticChildTargetSurface({
    runtime: fakeRuntime(calls),
    id: 'semantic-surface-b',
    url: 'aos://toolkit/semantic-child.html',
    fallbackOwnerCanvasId: 'parent-b',
    resolveTargets(snapshot) {
      return snapshot?.items || []
    },
    buildDisabledPayload: (snapshot) => ({
      phase: snapshot?.phase || 'idle',
      items: [],
    }),
  })

  await surface.ensureCreated()
  surface.sync({
    phase: 'active',
    items: [{ id: 'one', center: { x: 20, y: 30 }, radius: 5, size: 10 }],
  })
  assert.equal(surface.refreshPayload(), true)
  assert.equal(calls.filter((call) => call[0] === 'post').length, 2)

  assert.equal(surface.sync({ phase: 'idle', items: [] }), true)
  assert.deepEqual(calls.filter((call) => call[0] === 'update').at(-1), ['update', {
    id: 'semantic-surface-b',
    frame: [-10000, -10000, 10, 10],
    interactive: false,
  }])
  assert.equal(surface.snapshot().interactive, false)
})

test('SemanticChildTargetSurface can sync direct world rects without target payloads', async () => {
  const calls = []
  const surface = createSemanticChildTargetSurface({
    runtime: fakeRuntime(calls),
    id: 'semantic-surface-c',
    url: 'aos://toolkit/semantic-child.html',
    fallbackOwnerCanvasId: 'parent-c',
  })

  await surface.ensureCreated()
  assert.equal(surface.syncWorldRect({ x: 10, y: 20, w: 30, h: 40 }, { interactive: true }), true)
  assert.deepEqual(calls.at(-1), ['update', {
    id: 'semantic-surface-c',
    frame: [10, 20, 30, 40],
    interactive: true,
  }])
})
