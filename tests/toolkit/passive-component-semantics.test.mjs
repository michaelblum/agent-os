import { test } from 'node:test'
import assert from 'node:assert/strict'

import InspectorPanel from '../../packages/toolkit/components/inspector-panel/index.js'
import LogConsole from '../../packages/toolkit/components/log-console/index.js'
import ObjectTransformPanel from '../../packages/toolkit/components/object-transform-panel/index.js'
import RenderPerformance from '../../packages/toolkit/components/render-performance/index.js'
import SpatialTelemetry from '../../packages/toolkit/components/spatial-telemetry/index.js'
import { canonicalRawPointerInput } from '../lib/input-event-fixtures.mjs'

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

function desktopWorldPerformanceSnapshot({
  canvasGeneration,
  displays,
  sequence,
  stageSnapshotRevision = 1,
  status = 'available',
  topologyGeneration,
}) {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v2',
    schemaVersion: 2,
    stageSnapshotRevision,
    session: {},
    stage: {
      contract: 'aos.desktop-world.devtools.stage.v2',
      canvasGeneration,
      topologyGeneration,
      sequence,
      status,
      world: {
        displays: displays.map(({ id, index }) => ({
          id, index, bounds: [index * 100, 0, 100, 100], scaleFactor: 1,
        })),
        nodes: [], hitRegions: [], affordances: [], gestures: [], routes: [],
      },
      resources: [],
      interactions: [],
      displayPerformance: displays.map(({ fps = 60, id, index }) => ({
        displayId: id,
        displayIndex: index,
        scope: 'stage-segment',
        performance: { enabled: true, recording: false, currentFps: fps, avgFrameMs: 1000 / fps },
      })),
      counters: {},
      events: [],
      lastError: null,
    },
  }
}

function restoreThenRetireDesktopWorld(state, stageSnapshotRevision = 21) {
  const restored = RenderPerformance()
  restored.render(fakeHost())
  restored.restore(state)
  restored.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision,
      status: 'unavailable',
      displays: [],
    }),
  })
  return restored.serialize()
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

test('RenderPerformance reserves canonical DesktopWorld source IDs from generic ingress', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  for (const [displayIndex, type] of ['sample', 'frame', 'metrics'].entries()) {
    perf.onMessage({
      type,
      payload: { source: `desktop-world:${displayIndex}:${type}`, fps: 12 },
    })
  }
  window.__renderPerformanceDebug.sample({ source: 'desktop-world:3:debug', fps: 12 })

  assert.deepEqual(
    Object.keys(perf.serialize().sources).filter((source) => source.startsWith('desktop-world:')),
    [],
  )

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 1,
      topologyGeneration: 1,
      sequence: 1,
      stageSnapshotRevision: 1,
      displays: [{ id: 'sample', index: 0, fps: 60 }],
    }),
  })
  assert.equal(perf.serialize().sources['desktop-world:0:sample'].samples.length, 1)

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 2,
      status: 'unavailable',
      displays: [],
    }),
  })
  assert.equal(perf.serialize().sources['desktop-world:0:sample'], undefined)
})

test('RenderPerformance keeps noncanonical DesktopWorld-prefixed generic sources unowned', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'sample',
    payload: { source: 'desktop-world:user-owned', fps: 30 },
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 1,
      topologyGeneration: 1,
      sequence: 1,
      stageSnapshotRevision: 1,
      displays: [{ id: 'main', index: 0 }],
    }),
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 2,
      status: 'unavailable',
      displays: [],
    }),
  })

  assert.equal(perf.serialize().sources['desktop-world:user-owned'].samples.at(-1).fps, 30)
})

test('RenderPerformance never claims or retires a restored unowned canonical collision', (t) => {
  withFakeBrowser(t)

  const ownedSource = 'desktop-world:1:owned'
  const source = 'desktop-world:0:legacy'
  const original = RenderPerformance()
  original.render(fakeHost())
  original.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 2,
      topologyGeneration: 2,
      sequence: 9,
      stageSnapshotRevision: 19,
      displays: [{ id: 'owned', index: 1, fps: 45 }],
    }),
  })
  const restoredState = original.serialize()
  restoredState.sources[source] = {
    samples: [{ source, ts: Date.now(), fps: 30, frameMs: 1000 / 30 }],
  }

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.restore(restoredState)
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'legacy', index: 0, fps: 60 }],
    }),
  })

  let state = perf.serialize()
  assert.equal(state.desktopWorld.publication.stageSnapshotRevision, 19)
  assert.equal(state.sources[ownedSource].samples.at(-1).fps, 45)
  assert.deepEqual(state.sources[source].samples.map((sample) => sample.fps), [30])

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 21,
      status: 'unavailable',
      displays: [],
    }),
  })
  state = perf.serialize()
  assert.equal(state.sources[ownedSource], undefined)
  assert.ok(state.sources[source])
  assert.deepEqual(state.desktopWorld.bindings, [])

  perf.onMessage({ type: 'reset' })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'legacy', index: 0, fps: 60 }],
    }),
  })
  state = perf.serialize()
  assert.deepEqual(state.desktopWorld.bindings, [
    { source, displayId: 'legacy', displayIndex: 0 },
  ])
  assert.deepEqual(state.sources[source].samples.map((sample) => sample.fps), [60])

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 21,
      status: 'unavailable',
      displays: [],
    }),
  })
  assert.equal(perf.serialize().sources[source], undefined)
})

test('RenderPerformance accepts a higher daemon revision with a replacement lifecycle and retires disappeared displays', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 1,
      topologyGeneration: 1,
      sequence: 10,
      stageSnapshotRevision: 10,
      displays: [{ id: 'old-a', index: 0 }, { id: 'old-b', index: 1 }],
    }),
  })
  assert.deepEqual(
    Object.keys(perf.serialize().sources).filter((source) => source.startsWith('desktop-world:')).sort(),
    ['desktop-world:0:old-a', 'desktop-world:1:old-b'],
  )

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 2,
      topologyGeneration: 2,
      sequence: 1,
      stageSnapshotRevision: 11,
      displays: [{ id: 'new-a', index: 0 }],
    }),
  })
  assert.deepEqual(
    Object.keys(perf.serialize().sources).filter((source) => source.startsWith('desktop-world:')),
    ['desktop-world:0:new-a'],
  )
})

test('RenderPerformance rejects a stale daemon revision from a different lifecycle', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 3,
      sequence: 1,
      stageSnapshotRevision: 10,
      displays: [{ id: 'current', index: 0, fps: 60 }],
    }),
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 2,
      topologyGeneration: 2,
      sequence: 99,
      stageSnapshotRevision: 9,
      displays: [{ id: 'stale', index: 0, fps: 15 }],
    }),
  })

  const state = perf.serialize()
  assert.deepEqual(state.desktopWorld.publication, {
    canvasGeneration: 3,
    topologyGeneration: 3,
    sequence: 1,
    stageSnapshotRevision: 10,
  })
  assert.ok(state.sources['desktop-world:0:current'])
  assert.equal(state.sources['desktop-world:0:stale'], undefined)
})

test('RenderPerformance rejects an equal daemon revision from a different lifecycle', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 3,
      sequence: 1,
      stageSnapshotRevision: 10,
      displays: [{ id: 'current', index: 0, fps: 60 }],
    }),
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 4,
      topologyGeneration: 4,
      sequence: 1,
      stageSnapshotRevision: 10,
      displays: [{ id: 'duplicate', index: 0, fps: 15 }],
    }),
  })

  const state = perf.serialize()
  assert.deepEqual(state.desktopWorld.publication, {
    canvasGeneration: 3,
    topologyGeneration: 3,
    sequence: 1,
    stageSnapshotRevision: 10,
  })
  assert.ok(state.sources['desktop-world:0:current'])
  assert.equal(state.sources['desktop-world:0:duplicate'], undefined)
})

test('RenderPerformance debug reset clears DesktopWorld ownership and admits equal revision replay', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  const snapshot = desktopWorldPerformanceSnapshot({
    canvasGeneration: 3,
    topologyGeneration: 3,
    sequence: 1,
    stageSnapshotRevision: 10,
    displays: [{ id: 'current', index: 0, fps: 60 }],
  })
  perf.onMessage({ type: 'desktop_world_devtools.snapshot', payload: snapshot })
  perf.onMessage({ type: 'mark', payload: { type: 'before-reset', text: 'event' } })

  window.__renderPerformanceDebug.reset()
  let state = perf.serialize()
  assert.equal(state.desktopWorld, null)
  assert.deepEqual(state.events, [])
  assert.equal(state.sources['desktop-world:0:current'], undefined)

  perf.onMessage({ type: 'desktop_world_devtools.snapshot', payload: snapshot })
  state = perf.serialize()
  assert.equal(state.desktopWorld.publication.stageSnapshotRevision, 10)
  assert.deepEqual(state.desktopWorld.bindings, [
    { source: 'desktop-world:0:current', displayId: 'current', displayIndex: 0 },
  ])
  assert.equal(state.sources['desktop-world:0:current'].samples.at(-1).fps, 60)
})

test('RenderPerformance admits newer daemon publications when a segment-local sequence repeats', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 7,
      stageSnapshotRevision: 10,
      displays: [{ id: 'main', index: 0 }, { id: 'secondary', index: 1, fps: 60 }],
    }),
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 7,
      stageSnapshotRevision: 11,
      displays: [{ id: 'main', index: 0 }, { id: 'secondary', index: 1, fps: 30 }],
    }),
  })
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 7,
      stageSnapshotRevision: 11,
      displays: [{ id: 'main', index: 0 }, { id: 'secondary', index: 1, fps: 15 }],
    }),
  })

  const desktopWorldSources = Object.entries(perf.serialize().sources)
    .filter(([source]) => source.startsWith('desktop-world:'))
  assert.deepEqual(desktopWorldSources.map(([source]) => source).sort(), [
    'desktop-world:0:main',
    'desktop-world:1:secondary',
  ])
  assert.equal(desktopWorldSources
    .find(([source]) => source === 'desktop-world:1:secondary')[1]
    .samples.at(-1).fps, 30)
})

test('RenderPerformance retains segment-sequence fallback for local snapshots', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  for (const [sequence, fps] of [[1, 60], [2, 45]]) {
    perf.onMessage({
      type: 'desktop_world_devtools.snapshot',
      payload: desktopWorldPerformanceSnapshot({
        canvasGeneration: 3,
        topologyGeneration: 4,
        sequence,
        stageSnapshotRevision: 0,
        displays: [{ id: 'main', index: 0, fps }],
      }),
    })
  }

  assert.equal(perf.serialize().sources['desktop-world:0:main'].samples.at(-1).fps, 45)
})

test('RenderPerformance consumes an unavailable lifecycle and retires every DesktopWorld source', (t) => {
  withFakeBrowser(t)

  const perf = RenderPerformance()
  perf.render(fakeHost())
  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      displays: [{ id: 'old-a', index: 0 }, { id: 'old-b', index: 1 }],
    }),
  })

  perf.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 2,
      status: 'unavailable',
      displays: [],
    }),
  })

  assert.deepEqual(
    Object.keys(perf.serialize().sources).filter((source) => source.startsWith('desktop-world:')),
    [],
  )
})

test('RenderPerformance restore preserves DesktopWorld publication ownership for retirement', (t) => {
  withFakeBrowser(t)

  const original = RenderPerformance()
  original.render(fakeHost())
  original.onMessage({
    type: 'sample',
    payload: { source: 'desktop-world:user-owned', fps: 30 },
  })
  original.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'old-a', index: 0 }, { id: 'old-b', index: 1 }],
    }),
  })

  const serialized = original.serialize()
  assert.deepEqual(serialized.desktopWorld.bindings, [
    { source: 'desktop-world:0:old-a', displayId: 'old-a', displayIndex: 0 },
    { source: 'desktop-world:1:old-b', displayId: 'old-b', displayIndex: 1 },
  ])

  const restored = RenderPerformance()
  restored.render(fakeHost())
  restored.restore(serialized)
  restored.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'old-a', index: 0, fps: 15 }, { id: 'old-b', index: 1, fps: 15 }],
    }),
  })
  assert.equal(restored.serialize().sources['desktop-world:0:old-a'].samples.at(-1).fps, 60)

  restored.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 0,
      topologyGeneration: 0,
      sequence: 0,
      stageSnapshotRevision: 21,
      status: 'unavailable',
      displays: [],
    }),
  })

  assert.deepEqual(Object.keys(restored.serialize().sources).sort(), [
    'desktop-world:user-owned',
    'panel',
  ])
})

test('RenderPerformance restored daemon revision rejects delayed lower and equal lifecycle publications', (t) => {
  withFakeBrowser(t)

  const original = RenderPerformance()
  original.render(fakeHost())
  original.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 3,
      sequence: 7,
      stageSnapshotRevision: 20,
      displays: [{ id: 'current', index: 0, fps: 60 }],
    }),
  })

  const restored = RenderPerformance()
  restored.render(fakeHost())
  restored.restore(original.serialize())
  for (const [stageSnapshotRevision, lifecycle] of [[19, 2], [20, 4]]) {
    restored.onMessage({
      type: 'desktop_world_devtools.snapshot',
      payload: desktopWorldPerformanceSnapshot({
        canvasGeneration: lifecycle,
        topologyGeneration: lifecycle,
        sequence: 99,
        stageSnapshotRevision,
        displays: [{ id: `delayed-${stageSnapshotRevision}`, index: 0, fps: 15 }],
      }),
    })
  }

  const state = restored.serialize()
  assert.deepEqual(state.desktopWorld.publication, {
    canvasGeneration: 3,
    topologyGeneration: 3,
    sequence: 7,
    stageSnapshotRevision: 20,
  })
  assert.equal(state.sources['desktop-world:0:current'].samples.at(-1).fps, 60)
  assert.equal(state.sources['desktop-world:0:delayed-19'], undefined)
  assert.equal(state.sources['desktop-world:0:delayed-20'], undefined)
})

test('RenderPerformance restore rejects forged generic DesktopWorld ownership atomically', (t) => {
  withFakeBrowser(t)

  const original = RenderPerformance()
  original.render(fakeHost())
  original.onMessage({
    type: 'sample',
    payload: { source: 'desktop-world:user-owned', fps: 30 },
  })
  original.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'old-a', index: 0 }],
    }),
  })

  const serialized = original.serialize()
  serialized.desktopWorld.bindings.push({
    source: 'desktop-world:user-owned',
    displayId: 'user-owned',
    displayIndex: 1,
  })

  const retired = restoreThenRetireDesktopWorld(serialized)
  assert.ok(retired.sources['desktop-world:0:old-a'])
  assert.ok(retired.sources['desktop-world:user-owned'])
})

test('RenderPerformance restore rejects mismatched, duplicate, and oversized ownership bindings', (t) => {
  withFakeBrowser(t)

  const original = RenderPerformance()
  original.render(fakeHost())
  original.onMessage({
    type: 'sample',
    payload: { source: 'desktop-world:user-owned', fps: 30 },
  })
  original.onMessage({
    type: 'desktop_world_devtools.snapshot',
    payload: desktopWorldPerformanceSnapshot({
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
      displays: [{ id: 'old-a', index: 0 }],
    }),
  })
  const honest = original.serialize()

  const cases = [
    ['mismatched canonical source', (state) => {
      state.desktopWorld.bindings[0].displayId = 'not-old-a'
    }],
    ['duplicate source', (state) => {
      state.desktopWorld.bindings.push({ ...state.desktopWorld.bindings[0] })
    }],
    ['duplicate display index', (state) => {
      const source = 'desktop-world:0:other'
      state.sources[source] = state.sources['desktop-world:0:old-a']
      state.desktopWorld.bindings.push({ source, displayId: 'other', displayIndex: 0 })
    }],
    ['duplicate display id', (state) => {
      const source = 'desktop-world:1:old-a'
      state.sources[source] = state.sources['desktop-world:0:old-a']
      state.desktopWorld.bindings.push({ source, displayId: 'old-a', displayIndex: 1 })
    }],
    ['overlong source', (state) => {
      state.desktopWorld.bindings[0].source = 'x'.repeat(274)
    }],
    ['overlong display id', (state) => {
      state.desktopWorld.bindings[0].displayId = 'x'.repeat(257)
    }],
    ['too many bindings', (state) => {
      state.desktopWorld.bindings = Array.from({ length: 17 }, (_, index) => ({
        source: `desktop-world:${index}:display-${index}`,
        displayId: `display-${index}`,
        displayIndex: index,
      }))
    }],
  ]

  for (const [name, mutate] of cases) {
    const tampered = structuredClone(honest)
    mutate(tampered)
    const retired = restoreThenRetireDesktopWorld(tampered)
    assert.ok(retired.sources['desktop-world:0:old-a'], `${name} must not restore deletion authority`)
    assert.ok(retired.sources['desktop-world:user-owned'], `${name} must retain generic sources`)
  }
})

test('RenderPerformance restore leaves legacy and partial source ownership unattributed', (t) => {
  withFakeBrowser(t)

  const source = 'desktop-world:0:user-provided'
  const baseState = {
    targetFps: 60,
    sources: {
      [source]: { samples: [{ source, ts: Date.now(), fps: 30, frameMs: 1000 / 30 }] },
    },
    events: [],
  }
  const legacyDesktopWorld = {
    version: 1,
    publication: {
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
      stageSnapshotRevision: 20,
    },
    sources: [source],
  }
  const partialDesktopWorld = {
    version: 2,
    publication: {
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 10,
    },
    bindings: [{ source, displayId: 'user-provided', displayIndex: 0 }],
  }

  for (const desktopWorld of [undefined, legacyDesktopWorld, partialDesktopWorld]) {
    const restored = RenderPerformance()
    restored.render(fakeHost())
    restored.restore({ ...baseState, ...(desktopWorld ? { desktopWorld } : {}) })
    restored.onMessage({
      type: 'desktop_world_devtools.snapshot',
      payload: desktopWorldPerformanceSnapshot({
        canvasGeneration: 0,
        topologyGeneration: 0,
        sequence: 0,
        status: 'unavailable',
        displays: [],
      }),
    })
    assert.ok(restored.serialize().sources[source])
  }
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

  telemetry.onMessage(canonicalRawPointerInput({
    type: 'mouse_moved',
    x: 140,
    y: 170,
  }))

  assert.deepEqual(window.__spatialTelemetryState.raw.cursor, { x: 140, y: 170, valid: true })
  assert.deepEqual(window.__spatialTelemetryState.snapshot.cursorRow.worldPoint, { x: 140, y: 170 })
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
    canvas_id: 'example-root',
    objects: [{
      object_id: 'example.menu.tree',
      name: 'Tree',
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
  assert.match(root.innerHTML, /aria-label="scale x for Tree"/)
})
