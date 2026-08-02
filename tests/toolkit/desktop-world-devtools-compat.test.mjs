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
    contract: 'aos.desktop-world.devtools.snapshot.v2',
    schemaVersion: 2,
    session: {
      id: 'devtools-example', revision: 2, activeTab: 'world', selectedResource: null,
      filters: { query: '', eventKinds: [], errorsOnly: false }, recording: false,
      host: { kind: 'compatibility', id: 'surface-inspector', state: 'active' },
    },
    stage: {
      contract: 'aos.desktop-world.devtools.stage.v2',
      canvasGeneration: 3,
      topologyGeneration: 4,
      sequence: 7,
      status: 'available',
      world: {
        displays: [
          { id: 'main', index: 0, bounds: [207, 0, 1512, 982], nativeBounds: [0, 0, 1512, 982], scaleFactor: 2 },
          { id: 'lower', index: 1, bounds: [0, 982, 1920, 1080], nativeBounds: [-207, 982, 1920, 1080], scaleFactor: 1 },
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
      displayPerformance: [{
        displayId: 'main', displayIndex: 0, scope: 'stage-segment', performance: {
        enabled: true, recording: false, sampleCount: 4, currentFps: 50,
        avgFrameMs: 20, avgRenderMs: 6, avgUpdateMs: 2, avgGpuMs: 3,
        drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0,
        backingWidth: 3024, backingHeight: 1964, backingPixels: 5939136,
        requestedDevicePixelRatio: 2, effectiveDevicePixelRatio: 2, state: 'stable',
        },
      }, {
        displayId: 'lower', displayIndex: 1, scope: 'stage-segment', performance: {
        enabled: true, recording: false, sampleCount: 4, currentFps: 60,
        avgFrameMs: 16, avgRenderMs: 4, avgUpdateMs: 1, avgGpuMs: 2,
        drawCalls: 8, triangles: 240, geometries: 2, textures: 1, programs: 2,
        backingWidth: 1920, backingHeight: 1080, backingPixels: 2073600,
        requestedDevicePixelRatio: 1, effectiveDevicePixelRatio: 1, state: 'stable',
        },
      }],
      counters: {},
      events: [],
      lastError: null,
    },
  }
}

test('focused compatibility projections consume the canonical DesktopWorld snapshot', () => {
  const performance = projectDesktopWorldDevToolsPerformance(snapshot(), { now: 1234 })
  assert.equal(performance.sequence, 7)
  assert.deepEqual(performance.displays.map((entry) => ({
    displayId: entry.displayId,
    source: entry.sample.source,
    drawCalls: entry.sample.drawCalls,
    backingWidth: entry.sample.backingWidth,
    backingHeight: entry.sample.backingHeight,
    effectiveDevicePixelRatio: entry.sample.effectiveDevicePixelRatio,
    requestedDevicePixelRatio: entry.sample.requestedDevicePixelRatio,
    displayScaleFactor: entry.sample.displayScaleFactor,
    label: entry.sample.label,
  })), [{
    displayId: 'main',
    source: 'desktop-world:0:main',
    drawCalls: 0,
    backingWidth: 3024,
    backingHeight: 1964,
    effectiveDevicePixelRatio: 2,
    requestedDevicePixelRatio: 2,
    displayScaleFactor: 2,
    label: 'DesktopWorld display main (0)',
  }, {
    displayId: 'lower',
    source: 'desktop-world:1:lower',
    drawCalls: 8,
    backingWidth: 1920,
    backingHeight: 1080,
    effectiveDevicePixelRatio: 1,
    requestedDevicePixelRatio: 1,
    displayScaleFactor: 1,
    label: 'DesktopWorld display lower (1)',
  }])

  const spatial = projectDesktopWorldDevToolsSpatial(snapshot())
  assert.equal(spatial.displays.length, 2)
  assert.deepEqual(spatial.displays[0].native_bounds, { x: 0, y: 0, w: 1512, h: 982 })
  assert.deepEqual(spatial.displays[0].desktop_world_bounds, { x: 207, y: 0, w: 1512, h: 982 })
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
