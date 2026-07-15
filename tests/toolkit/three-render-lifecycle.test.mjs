import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createThreeRenderLifecycle,
  disposeThreeObjectTree,
  resolveThreeRenderMetrics,
} from '../../packages/toolkit/runtime/three-render-lifecycle.js'

class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

test('resolveThreeRenderMetrics caps DPR, dimensions, pixels, and invalid measurements', () => {
  assert.deepEqual(resolveThreeRenderMetrics({ width: 0, height: 400 }), null)
  assert.deepEqual(resolveThreeRenderMetrics({ width: 400, height: Number.NaN }), null)

  const normal = resolveThreeRenderMetrics({
    width: 800,
    height: 600,
    devicePixelRatio: 3,
  })
  assert.equal(normal.effectiveDevicePixelRatio, 2)
  assert.equal(normal.backingWidth, 1600)
  assert.equal(normal.backingHeight, 1200)
  assert.equal(normal.constrained, true)

  const bounded = resolveThreeRenderMetrics({
    width: 3000,
    height: 3000,
    devicePixelRatio: 2,
  })
  assert.ok(bounded.effectiveDevicePixelRatio < 1)
  assert.ok(bounded.backingWidth <= 4096)
  assert.ok(bounded.backingHeight <= 4096)
  assert.ok(bounded.backingPixels <= 4_194_304)
})

test('createThreeRenderLifecycle owns resize, visibility, context, and frame suspension', () => {
  const canvas = new FakeEventTarget()
  const documentObject = new FakeEventTarget()
  documentObject.hidden = false
  documentObject.visibilityState = 'visible'
  const windowObject = new FakeEventTarget()
  windowObject.devicePixelRatio = 3
  const container = { width: 400, height: 300 }
  const resizeObservers = []
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.observed = null
      this.disconnected = false
      resizeObservers.push(this)
    }

    observe(target) {
      this.observed = target
    }

    disconnect() {
      this.disconnected = true
    }
  }
  let nextFrameId = 1
  const frameCallbacks = new Map()
  const canceledFrames = []
  const requestAnimationFrame = (callback) => {
    const id = nextFrameId
    nextFrameId += 1
    frameCallbacks.set(id, callback)
    return id
  }
  const cancelAnimationFrame = (id) => {
    canceledFrames.push(id)
    frameCallbacks.delete(id)
  }
  const renderer = {
    pixelRatios: [],
    sizes: [],
    getContext: () => ({ isContextLost: () => false }),
    setPixelRatio(value) { this.pixelRatios.push(value) },
    setSize(...value) { this.sizes.push(value) },
  }
  const camera = {
    isPerspectiveCamera: true,
    aspect: 0,
    projectionUpdates: 0,
    updateProjectionMatrix() { this.projectionUpdates += 1 },
  }
  const frames = []
  const lost = []
  const restored = []
  const lifecycle = createThreeRenderLifecycle({
    renderer,
    camera,
    canvas,
    container,
    document: documentObject,
    window: windowObject,
    ResizeObserver: FakeResizeObserver,
    requestAnimationFrame,
    cancelAnimationFrame,
    measure: () => ({ width: container.width, height: container.height }),
    onFrame: (frame) => frames.push(frame),
    onContextLost: (snapshot) => lost.push(snapshot),
    onContextRestored: (snapshot) => restored.push(snapshot),
  })

  const started = lifecycle.start()
  assert.equal(started.started, true)
  assert.equal(started.frameScheduled, true)
  assert.deepEqual(renderer.sizes.at(-1), [400, 300, false])
  assert.equal(renderer.pixelRatios.at(-1), 2)
  assert.equal(camera.aspect, 4 / 3)
  assert.equal(resizeObservers[0].observed, container)

  const firstFrameId = lifecycle.snapshot().frameScheduled && [...frameCallbacks.keys()][0]
  const firstFrame = frameCallbacks.get(firstFrameId)
  frameCallbacks.delete(firstFrameId)
  firstFrame(100)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].deltaMs, 0)
  assert.equal(lifecycle.snapshot().frameScheduled, true)

  documentObject.hidden = true
  documentObject.visibilityState = 'hidden'
  documentObject.emit('visibilitychange')
  assert.equal(lifecycle.snapshot().hidden, true)
  assert.equal(lifecycle.snapshot().frameScheduled, false)
  assert.ok(canceledFrames.length >= 1)

  container.width = 900
  container.height = 500
  resizeObservers[0].callback()
  assert.deepEqual(renderer.sizes.at(-1), [400, 300, false])

  documentObject.hidden = false
  documentObject.visibilityState = 'visible'
  documentObject.emit('visibilitychange')
  assert.deepEqual(renderer.sizes.at(-1), [900, 500, false])
  assert.equal(lifecycle.snapshot().frameScheduled, true)

  let prevented = false
  canvas.emit('webglcontextlost', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  assert.equal(lifecycle.snapshot().contextLost, true)
  assert.equal(lifecycle.snapshot().frameScheduled, false)
  assert.equal(lost.length, 1)

  container.width = 640
  container.height = 360
  canvas.emit('webglcontextrestored')
  assert.equal(lifecycle.snapshot().contextLost, false)
  assert.deepEqual(renderer.sizes.at(-1), [640, 360, false])
  assert.equal(restored.length, 1)
  assert.equal(lifecycle.snapshot().frameScheduled, true)

  lifecycle.suspend()
  assert.equal(lifecycle.snapshot().suspended, true)
  assert.equal(lifecycle.snapshot().frameScheduled, false)
  lifecycle.resume()
  assert.equal(lifecycle.snapshot().suspended, false)
  assert.equal(lifecycle.snapshot().frameScheduled, true)

  resizeObservers[0].callback()
  assert.deepEqual(renderer.sizes.at(-1), [640, 360, false])
  lifecycle.stop()
  assert.equal(lifecycle.snapshot().started, false)
  assert.equal(resizeObservers[0].disconnected, true)
  assert.equal(documentObject.listeners.get('visibilitychange').size, 0)
  assert.equal(canvas.listeners.get('webglcontextlost').size, 0)
})

test('Three disposal releases owned resources exactly once and is idempotent', () => {
  const calls = { texture: 0, geometry: 0, material: 0, clear: 0 }
  const texture = { isTexture: true, dispose: () => { calls.texture += 1 } }
  const uniformTexture = { isTexture: true, dispose: () => { calls.texture += 1 } }
  const geometry = { dispose: () => { calls.geometry += 1 } }
  const material = {
    map: texture,
    uniforms: { shared: { value: uniformTexture } },
    dispose: () => { calls.material += 1 },
  }
  const child = { geometry, material, children: [] }
  const scene = {
    children: [child, { geometry, material, children: [] }],
    clear: () => { calls.clear += 1 },
  }

  assert.deepEqual(disposeThreeObjectTree(scene), {
    objects: 3,
    geometries: 1,
    materials: 1,
    textures: 2,
  })
  assert.deepEqual(calls, { texture: 2, geometry: 1, material: 1, clear: 1 })

  const canvas = new FakeEventTarget()
  const rendererCalls = { dispose: 0, force: 0, lists: 0, additional: 0 }
  const renderer = {
    domElement: canvas,
    setSize() {},
    setAnimationLoop(value) { assert.equal(value, null) },
    renderLists: { dispose: () => { rendererCalls.lists += 1 } },
    dispose: () => { rendererCalls.dispose += 1 },
    forceContextLoss: () => { rendererCalls.force += 1 },
  }
  const lifecycle = createThreeRenderLifecycle({
    renderer,
    canvas,
    container: { getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    document: new FakeEventTarget(),
    window: new FakeEventTarget(),
    ResizeObserver: null,
    additionalDisposables: (() => {
      const resource = { dispose: () => { rendererCalls.additional += 1 } }
      return [resource, resource]
    })(),
  })
  lifecycle.start()
  const first = lifecycle.dispose()
  const second = lifecycle.dispose()
  assert.equal(first, second)
  assert.deepEqual(rendererCalls, { dispose: 1, force: 1, lists: 1, additional: 1 })
  assert.throws(() => lifecycle.start(), /disposed/)
  assert.throws(() => lifecycle.resume(), /disposed/)
})
