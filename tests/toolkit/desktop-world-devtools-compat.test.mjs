import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  projectDesktopWorldDevToolsPerformance,
  projectDesktopWorldDevToolsSpatial,
  projectDesktopWorldDevToolsSurfaceResources,
} from '../../packages/toolkit/components/desktop-world-devtools/compat.js'
import {
  applyDesktopWorldDevToolsSnapshot,
  buildSurfaceResourceSnapshot,
  createSurfaceResourceState,
  removeSurfaceResourcesForCanvas,
} from '../../packages/toolkit/components/surface-inspector/surface-resources.js'

function snapshot() {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v1',
    schemaVersion: 1,
    session: {
      id: 'devtools-example', revision: 2, activeTab: 'world', selectedResource: null,
      filters: { query: '', eventKinds: [], errorsOnly: false }, recording: false,
      host: { kind: 'compatibility', id: 'surface-inspector', state: 'active' },
    },
    stage: {
      contract: 'aos.desktop-world.devtools.stage.v1',
      sequence: 7,
      status: 'available',
      world: {
        displays: [
          { id: 'main', index: 0, bounds: [200, 0, 1440, 900], nativeBounds: [0, 0, 1440, 900] },
          { id: 'lower', index: 1, bounds: [0, 900, 1920, 1080], nativeBounds: [-200, 900, 1920, 1080] },
        ],
        nodes: [{
          id: 'body', resourceId: 'companion/main', parentId: null, kind: 'mesh',
          implementation: 'aos.scene.geometry.primitive', position: [320, 240, 0], visible: true,
        }],
        hitRegions: [{
          id: 'body-hit', resourceId: 'companion/main', affordanceId: 'body-drag',
          frame: [280, 200, 80, 80], registered: true,
        }],
        affordances: [{
          id: 'body-drag', resourceId: 'companion/main', objectId: 'body', enabled: true, priority: 100,
        }],
        gestures: [],
        routes: [],
      },
      resources: [],
      interactions: [],
      performance: {
        enabled: true, recording: false, sampleCount: 4, currentFps: 50,
        avgFrameMs: 20, avgRenderMs: 6, avgUpdateMs: 2, avgGpuMs: 3,
        drawCalls: 8, triangles: 240, geometries: 2, textures: 1, programs: 2,
        backingPixels: 1296000, state: 'warn',
      },
      counters: {},
      events: [],
      lastError: null,
    },
  }
}

test('focused compatibility projections consume the canonical DesktopWorld snapshot', () => {
  const performance = projectDesktopWorldDevToolsPerformance(snapshot(), { now: 1234 })
  assert.equal(performance.sequence, 7)
  assert.equal(performance.sample.source, 'desktop-world')
  assert.equal(performance.sample.frameMs, 20)
  assert.equal(performance.sample.drawCalls, 8)

  const spatial = projectDesktopWorldDevToolsSpatial(snapshot())
  assert.equal(spatial.displays.length, 2)
  assert.deepEqual(spatial.displays[0].native_bounds, { x: 0, y: 0, w: 1440, h: 900 })
  assert.deepEqual(spatial.displays[0].desktop_world_bounds, { x: 200, y: 0, w: 1440, h: 900 })
  assert.deepEqual(spatial.canvases[0].atResolved, [280, 200, 80, 80])
  assert.deepEqual(spatial.marksByCanvas.get('scene-resource:companion/main').marks[0], {
    id: 'body', name: 'aos.scene.geometry.primitive', x: 320, y: 240,
  })

  const resources = projectDesktopWorldDevToolsSurfaceResources(snapshot())
  assert.equal(resources.stageLayers[0].affordanceId, 'body-drag')
  assert.equal(resources.inputRegions[0].affordanceId, 'body-drag')
  assert.deepEqual(resources.inputRegions[0].frame, [280, 200, 80, 80])
})

test('compatibility projection does not fabricate native geometry for legacy snapshots', () => {
  const legacy = snapshot()
  legacy.stage.world.displays = [{ id: 'main', index: 0, bounds: [200, 0, 1440, 900] }]

  const spatial = projectDesktopWorldDevToolsSpatial(legacy)

  assert.deepEqual(spatial.displays, [])
  assert.equal(spatial.canvases.length, 1)
})

test('Surface Inspector compatibility state activates and clears atomically', () => {
  const state = createSurfaceResourceState()
  assert.equal(applyDesktopWorldDevToolsSnapshot(state, {
    type: 'desktop_world_devtools.snapshot',
    payload: snapshot(),
  }), true)
  const active = buildSurfaceResourceSnapshot(state, {
    canvases: [{ id: 'aos-desktop-world-stage' }],
  })
  assert.deepEqual(active.counts, {
    stageLayers: 1, inputRegions: 1, affordances: 1, staleOrSuspicious: 0,
  })
  assert.equal(removeSurfaceResourcesForCanvas(state, 'aos-desktop-world-stage'), true)
  assert.equal(buildSurfaceResourceSnapshot(state).counts.stageLayers, 0)
})

test('compatibility projections fail closed on a foreign snapshot contract', () => {
  assert.throws(
    () => projectDesktopWorldDevToolsSpatial({ ...snapshot(), contract: 'foreign' }),
    /Invalid DesktopWorld DevTools snapshot contract/,
  )
})
