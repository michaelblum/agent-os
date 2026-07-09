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

test('InteractionSurface reconciles ready state from daemon lifecycle events', () => {
  const updates = []
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate: () => Promise.resolve({ id: 'surface-lifecycle' }),
      canvasUpdate(payload) {
        updates.push(payload)
      },
    },
    id: 'surface-lifecycle',
    url: 'aos://test/surface.html',
    frame: [-10000, -10000, 10, 10],
  })

  assert.equal(surface.handleLifecycle({
    canvas_id: 'surface-lifecycle',
    canvas: {
      at: [12, 24, 32, 48],
      interactive: true,
      windowLevel: 'floating',
    },
  }), true)
  assert.deepEqual(surface.snapshot(), {
    id: 'surface-lifecycle',
    ready: true,
    creating: false,
    removed: false,
    frame: [12, 24, 32, 48],
    interactive: true,
    windowLevel: 'floating',
    parent: null,
  })

  assert.equal(surface.setPlacement([30, 40, 32, 48], true), true)
  assert.deepEqual(updates, [{ id: 'surface-lifecycle', frame: [30, 40, 32, 48] }])

  assert.equal(surface.handleLifecycle({ canvas_id: 'other', action: 'removed' }), false)
  assert.equal(surface.handleLifecycle({ canvas_id: 'surface-lifecycle', action: 'removed' }), true)
  assert.equal(surface.snapshot().ready, false)
  assert.equal(surface.snapshot().removed, true)
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

test('InteractionSurface duplicate create is treated as already ready and reconciles placement', async () => {
  const updates = []
  let resolveUpdate
  const updatePromise = new Promise((resolve) => {
    resolveUpdate = resolve
  })
  const surface = createInteractionSurface({
    runtime: {
      canvasCreate() {
        return Promise.reject(new Error('DUPLICATE: exists'))
      },
      canvasUpdate(payload) {
        updates.push(payload)
        return updatePromise
      },
      canvasRemove: () => Promise.resolve(),
    },
    id: 'surface-d',
    url: 'aos://test/surface.html',
    frame: [10, 20, 80, 40],
    interactive: false,
    windowLevel: 'screen_saver',
  })

  let ensureResolved = false
  const ensurePromise = surface.ensureCreated().then((id) => {
    ensureResolved = true
    return id
  })

  await Promise.resolve()
  assert.equal(ensureResolved, false)
  resolveUpdate()
  assert.equal(await ensurePromise, 'surface-d')
  assert.equal(surface.snapshot().ready, true)
  assert.deepEqual(updates, [{
    id: 'surface-d',
    frame: [10, 20, 80, 40],
    interactive: false,
    window_level: 'screen_saver',
  }])
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
