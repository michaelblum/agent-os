import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInteractionSurface } from '../../packages/toolkit/runtime/interaction-surface.js'

test('InteractionSurface creates a lifecycle-only absorber canvas', async () => {
  const calls = []
  const runtime = {
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
  }
  const surface = createInteractionSurface({
    runtime,
    id: 'surface-a',
    url: 'aos://test/surface.html',
    parent: 'owner',
    frame: [10.2, 20.7, 80, 40],
    interactive: true,
    windowLevel: 'screen_saver',
  })

  assert.equal(await surface.ensureCreated(), 'surface-a')
  assert.deepEqual(calls[0], ['create', {
    id: 'surface-a',
    url: 'aos://test/surface.html',
    parent: 'owner',
    frame: [10, 21, 80, 40],
    interactive: true,
    window_level: 'screen_saver',
    cascade: true,
  }])
  assert.deepEqual(surface.snapshot(), {
    id: 'surface-a',
    ready: true,
    creating: false,
    removed: false,
    frame: [10, 21, 80, 40],
    interactive: true,
    windowLevel: 'screen_saver',
    parent: 'owner',
  })
})

test('InteractionSurface updates frame and interactive state atomically', async () => {
  const updates = []
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate: () => Promise.resolve({ id: 'surface-b' }),
      canvasUpdate(payload) {
        updates.push(payload)
      },
      canvasRemove: () => Promise.resolve(),
    },
    id: 'surface-b',
    url: 'aos://test/surface.html',
    frame: [0, 0, 10, 10],
    interactive: false,
  })

  await surface.ensureCreated()
  assert.equal(surface.setPlacement([50.4, 60.6, 20, 30], true), true)
  assert.deepEqual(updates, [{
    id: 'surface-b',
    frame: [50, 61, 20, 30],
    interactive: true,
  }])
  assert.equal(surface.setPlacement([50, 61, 20, 30], true), false)
})

test('InteractionSurface disable moves offscreen and clears interactivity in one update', async () => {
  const updates = []
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate: () => Promise.resolve({ id: 'surface-c' }),
      canvasUpdate(payload) {
        updates.push(payload)
      },
      canvasRemove: () => Promise.resolve(),
    },
    id: 'surface-c',
    url: 'aos://test/surface.html',
    frame: [10, 10, 80, 80],
    interactive: true,
  })

  await surface.ensureCreated()
  assert.equal(surface.disable(), true)
  assert.deepEqual(updates, [{
    id: 'surface-c',
    frame: [-10000, -10000, 80, 80],
    interactive: false,
  }])
})

test('InteractionSurface duplicate create is treated as already ready', async () => {
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate() {
        return Promise.reject(new Error('DUPLICATE: exists'))
      },
      canvasUpdate() {},
      canvasRemove: () => Promise.resolve(),
    },
    id: 'surface-d',
    url: 'aos://test/surface.html',
  })

  assert.equal(await surface.ensureCreated(), 'surface-d')
  assert.equal(surface.snapshot().ready, true)
})

test('InteractionSurface remove resets local lifecycle state', async () => {
  const calls = []
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate: () => Promise.resolve({ id: 'surface-e' }),
      canvasUpdate() {},
      canvasRemove(payload) {
        calls.push(payload)
        return Promise.resolve()
      },
    },
    id: 'surface-e',
    url: 'aos://test/surface.html',
    interactive: true,
  })

  await surface.ensureCreated()
  await surface.remove()
  assert.deepEqual(calls, [{ id: 'surface-e' }])
  assert.equal(surface.snapshot().ready, false)
  assert.equal(surface.snapshot().interactive, false)
})
