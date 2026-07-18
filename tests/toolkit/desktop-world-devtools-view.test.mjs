import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createDesktopWorldDevToolsView } from '../../packages/toolkit/scene/desktop-world-devtools-view.js'

const viewURL = new URL('../../packages/toolkit/scene/desktop-world-devtools-view.js', import.meta.url)
const componentURL = new URL('../../packages/toolkit/components/desktop-world-devtools/index.js', import.meta.url)

function snapshot(activeTab = 'world') {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v1',
    schemaVersion: 1,
    session: {
      id: 'session', revision: 4, activeTab, selectedResource: null,
      filters: { query: '', eventKinds: [], errorsOnly: false },
      recording: false, host: { kind: 'panel', id: 'panel', state: 'active' },
    },
    stage: {
      contract: 'aos.desktop-world.devtools.stage.v1', sequence: 2, status: 'available',
      world: {
        displays: [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }],
        nodes: [{ id: 'body', resourceId: 'companion/main', parentId: null, kind: 'mesh', implementation: 'aos.scene.geometry.primitive', position: [200, 300, 0], visible: true }],
        hitRegions: [{ id: 'hit', resourceId: 'companion/main', affordanceId: 'body', frame: [160, 260, 80, 80], registered: true }],
        affordances: [{ id: 'body', resourceId: 'companion/main', objectId: 'body', enabled: true, priority: 100 }],
        gestures: [{ id: 'gesture', resourceId: 'companion/main', affordanceId: 'body', interactionId: 'move', kind: 'drag', phase: 'active', pointerSessionId: 'pointer' }],
        routes: [{ resourceId: 'companion/main', kind: 'line', active: true, progress: 0.5, origin: [200, 300], destination: [600, 700] }],
      },
      resources: [{
        id: 'companion/main', owner: 'example.consumer', sceneId: 'scene', revision: 1,
        suspended: false, objectCount: 1, descriptorCount: 2, animationCount: 1,
        signalCount: 1, interactionCount: 1, implementations: ['aos.scene.geometry.primitive'],
        allocations: { geometries: 1, materials: 1, textures: 0, programs: 1 },
        lifecycle: 'active', errorCode: null,
      }],
      interactions: [{ id: 'lease', resourceId: 'companion/main', owner: 'example.consumer', active: true, suspended: false, recognizers: ['aos.scene.gesture.drag'], regionCount: 1, errorCode: null }],
      performance: {
        enabled: true, recording: false, sampleCount: 4, currentFps: 60,
        p95FrameMs: 16, avgFrameMs: 16, avgRenderMs: 4, avgUpdateMs: 2,
        avgGpuMs: null, drawCalls: 4, triangles: 120, geometries: 1,
        textures: 0, programs: 1, backingPixels: 1296000, state: 'stable',
      },
      counters: { displays: 1, resources: 1, nodes: 1, hitRegions: 1, affordances: 1, activeGestures: 1, activeRoutes: 0, errors: 0 },
      events: [{ sequence: 1, kind: 'gesture.update', resourceId: 'companion/main', code: null, at: 100 }],
      lastError: null,
    },
  }
}

function fakeRoot() {
  return {
    hidden: false,
    innerHTML: '',
    querySelector() { return null },
    querySelectorAll() { return [] },
    replaceChildren() { this.innerHTML = '' },
  }
}

test('host-neutral DesktopWorld DevTools view renders every bounded tab without a frame loop', async () => {
  const previousDocument = globalThis.document
  globalThis.document = {
    createElement() {
      let text = ''
      return {
        set textContent(value) { text = String(value) },
        get innerHTML() {
          return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        },
      }
    },
  }
  try {
    const root = fakeRoot()
    const view = createDesktopWorldDevToolsView({ root })
    for (const tab of ['world', 'resources', 'interactions', 'performance', 'events']) {
      view.update(snapshot(tab))
      assert.match(root.innerHTML, /World/u)
      assert.match(root.innerHTML, /Resources/u)
      assert.match(root.innerHTML, /Interactions/u)
      assert.match(root.innerHTML, /Performance/u)
      assert.match(root.innerHTML, /Events/u)
    }
    assert.match(root.innerHTML, /gesture\.update/u)
    view.update(snapshot('world'))
    assert.match(root.innerHTML, /pointer/u)
    assert.match(root.innerHTML, /50%/u)
    view.update(snapshot('resources'))
    assert.match(root.innerHTML, /aos\.scene\.geometry\.primitive/u)
    assert.equal(view.dispose(), true)
    assert.equal(view.dispose(), false)
  } finally {
    globalThis.document = previousDocument
  }

  const [viewSource, componentSource] = await Promise.all([
    readFile(viewURL, 'utf8'),
    readFile(componentURL, 'utf8'),
  ])
  assert.doesNotMatch(viewSource, /requestAnimationFrame|setInterval|setTimeout/u)
  assert.doesNotMatch(componentSource, /requestAnimationFrame|setInterval|setTimeout/u)
  assert.match(componentSource, /mountChrome/u)
  assert.match(componentSource, /desktop_world_devtools\.host\.ready/u)
})
