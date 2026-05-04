import { test } from 'node:test'
import assert from 'node:assert/strict'

import InspectorPanel from '../../packages/toolkit/components/inspector-panel/index.js'
import LogConsole from '../../packages/toolkit/components/log-console/index.js'
import ObjectTransformPanel from '../../packages/toolkit/components/object-transform-panel/index.js'
import RenderPerformance from '../../packages/toolkit/components/render-performance/index.js'
import SpatialTelemetry from '../../packages/toolkit/components/spatial-telemetry/index.js'

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.attributes = {}
    this.children = []
    this.style = {}
    this._innerHTML = ''
    this._textContent = ''
    this.id = ''
    this.className = ''
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  getAttribute(name) {
    return this.attributes[name] ?? null
  }

  appendChild(child) {
    this.children.push(child)
    return child
  }

  removeChild(child) {
    this.children = this.children.filter((candidate) => candidate !== child)
    return child
  }

  get firstChild() {
    return this.children[0] || null
  }

  get childElementCount() {
    return this.children.length
  }

  get innerHTML() {
    return this._innerHTML
  }

  set innerHTML(value) {
    this._innerHTML = String(value)
    this.children = []
  }

  get textContent() {
    return this._textContent
  }

  set textContent(value) {
    this._textContent = String(value)
  }

  addEventListener() {}
  querySelectorAll() { return [] }
}

function withFakeBrowser(t) {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    performance: globalThis.performance,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    navigator: globalThis.navigator,
  }

  globalThis.document = {
    visibilityState: 'visible',
    createElement(tagName) {
      return new FakeElement(tagName)
    },
    addEventListener() {},
  }
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
  }
  globalThis.performance = {
    now: () => 0,
    memory: null,
  }
  globalThis.requestAnimationFrame = () => 1
  globalThis.cancelAnimationFrame = () => {}
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { hardwareConcurrency: 8 },
  })

  t.after(() => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.performance = previous.performance
    globalThis.requestAnimationFrame = previous.requestAnimationFrame
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previous.navigator,
    })
  })
}

function fakeHost() {
  const titles = []
  return {
    contentEl: new FakeElement('div'),
    titles,
    setTitle(title) {
      titles.push(title)
    },
  }
}

test('InspectorPanel exposes a passive AX region', (t) => {
  withFakeBrowser(t)

  const panel = InspectorPanel()
  const root = panel.render(fakeHost())

  assert.equal(root.getAttribute('role'), 'region')
  assert.equal(root.getAttribute('aria-label'), 'AX Inspector')
})

test('LogConsole exposes entries as an aria-live log', (t) => {
  withFakeBrowser(t)

  const log = LogConsole()
  const root = log.render(fakeHost())

  assert.equal(root.getAttribute('role'), 'log')
  assert.equal(root.getAttribute('aria-label'), 'Log entries')
  assert.equal(root.getAttribute('aria-live'), 'polite')
  assert.equal(root.getAttribute('aria-relevant'), 'additions text')
})

test('RenderPerformance exposes root region and sparkline image semantics', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  const root = perf.render(fakeHost())

  assert.equal(root.getAttribute('role'), 'region')
  assert.equal(root.getAttribute('aria-label'), 'Render Performance')

  window.__renderPerformanceDebug.sample({ source: 'debug', frameMs: 16, fps: 62 })
  assert.match(root.innerHTML, /class="perf-sparkline" role="img" aria-label="Frame-time sparkline"/)
})

test('SpatialTelemetry exposes root region, labeled tables, and log semantics', (t) => {
  withFakeBrowser(t)

  const telemetry = SpatialTelemetry()
  const root = telemetry.render(fakeHost())

  assert.equal(root.getAttribute('role'), 'region')
  assert.equal(root.getAttribute('aria-label'), 'Spatial Telemetry')

  telemetry.onMessage({
    type: 'bootstrap',
    payload: {
      displays: [{
        id: 1,
        is_main: true,
        bounds: { x: 0, y: 0, w: 800, h: 600 },
        visible_bounds: { x: 0, y: 0, w: 800, h: 560 },
        native_bounds: { x: 0, y: 0, w: 800, h: 600 },
        native_visible_bounds: { x: 0, y: 0, w: 800, h: 560 },
        scale_factor: 1,
      }],
      canvases: [{ id: 'demo', at: [10, 20, 100, 80], interactive: true }],
      cursor: { x: 30, y: 40 },
    },
  })

  assert.match(root.innerHTML, /<table class="telemetry-table" aria-label="Display geometry">/)
  assert.match(root.innerHTML, /<table class="telemetry-table" aria-label="Canvas geometry">/)
  assert.match(root.innerHTML, /<table class="telemetry-table" aria-label="Cursor position">/)
  assert.match(root.innerHTML, /class="event-log" role="log" aria-label="Telemetry events" aria-live="polite"/)
})

test('ObjectTransformPanel exposes root region, object list, and triplet fields', (t) => {
  withFakeBrowser(t)

  const panel = ObjectTransformPanel()
  const root = panel.render(fakeHost())

  assert.equal(root.getAttribute('role'), 'region')
  assert.equal(root.getAttribute('aria-label'), 'Object Transform')

  panel.onMessage({
    type: 'canvas_object.registry',
    schema_version: '2026-05-03',
    canvas_id: 'avatar-main',
    objects: [{
      object_id: 'radial.wiki-brain.tree',
      name: 'Wiki Brain Tree',
      kind: 'three.object3d',
      capabilities: ['transform.read', 'transform.patch'],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1.32, y: 1.42, z: 1.2 },
        rotation_degrees: { x: -11.5, y: 0, z: 0 },
      },
      units: {
        position: 'scene',
        scale: 'multiplier',
        rotation: 'degrees',
      },
    }],
  })

  assert.match(root.innerHTML, /role="listbox" aria-label="Addressable objects"/)
  assert.match(root.innerHTML, /data-aos-action="select_object"/)
  assert.match(root.innerHTML, /data-aos-action="edit_transform"/)
  assert.match(root.innerHTML, /data-aos-action="toggle_visibility"/)
  assert.match(root.innerHTML, /aria-checked="true"/)
  assert.match(root.innerHTML, /data-aos-control="number-field"/)
  assert.match(root.innerHTML, /aria-label="scale x for Wiki Brain Tree"/)
})
