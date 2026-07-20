import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  projectDesktopWorldDevToolsTopology,
  projectSceneEventTopology,
} from '../packages/toolkit/components/desktop-world-stage/topology.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('daemon routes bounded stage snapshots and every revisioned session action', () => {
  const unified = read('src/daemon/unified.swift')
  const controller = read('src/daemon/desktop-world-devtools-controller.swift')
  const session = read('src/daemon/desktop-world-devtools-session.swift')

  assert.match(unified, /case "desktop_world_stage\.devtools\.snapshot":\s*if canvasID == self\.sceneStageCanvasID/)
  for (const action of ['devtools_open', 'devtools_status', 'devtools_update', 'devtools_transfer', 'devtools_close', 'devtools_monitor']) {
    assert.match(unified, new RegExp(`case \\(\\"scene\\", \\"${action}\\"\\)`))
  }
  assert.match(unified, /AOSDesktopWorldDevToolsController/)
  assert.doesNotMatch(unified, /mutateDesktopWorldDevToolsCanvas|transferDesktopWorldDevToolsHost|String\?\?/)
  assert.match(controller, /final class AOSDesktopWorldDevToolsController/)
  assert.match(controller, /guard !Thread\.isMainThread, ensureSceneStage\(\) else \{ return false \}/)
  assert.match(controller, /aos:\/\/toolkit\/components\/desktop-world-devtools\/index\.html/)
  assert.match(controller, /closeSessionHosts/)
  assert.match(controller, /state\.ownedPanelIDs where panelID != state\.host\?\.id/)
  assert.match(controller, /payload\["headless"\] as\? Bool == true/)
  assert.match(controller, /let enabled = configuration\.enabled \|\| hasSceneMonitor\(\)/)
  assert.match(session, /enum AOSDesktopWorldDevToolsFieldPatch<Value>/)
  assert.match(session, /struct AOSDesktopWorldDevToolsUpdateRequest/)
  assert.doesNotMatch(session, /String\?\?/)
  assert.match(unified, /let hadSceneMonitor = subscribers\[connectionID\]\?\.sceneMonitorResource != nil/)
  assert.match(unified, /guard connection\.sceneMonitorReady/)
  assert.match(unified, /event: "monitor"/)
})

test('stock panel closes before first telemetry and declares no status-item owner', () => {
  const panel = read('packages/toolkit/components/desktop-world-devtools/index.js')
  const session = read('src/daemon/desktop-world-devtools-session.swift')

  assert.match(panel, /view\?\.request\('close'\) !== true/)
  assert.match(panel, /host\.command', \{ action: 'close' \}/)
  assert.doesNotMatch(session, /NSStatusItem|status[_ -]?item/i)
})

test('stage probe is configured inside the existing DesktopWorld render lifecycle', () => {
  const stage = read('packages/toolkit/components/desktop-world-stage/index.js')
  const outlet = read('packages/toolkit/components/desktop-world-stage/scene-outlet.js')
  const probe = read('packages/toolkit/scene/desktop-world-devtools.js')

  assert.match(stage, /sceneOutlet\.setDevToolsProbe\(devtoolsProbe\)/)
  assert.match(stage, /displays: devtoolsTopologySnapshot\(\)\.displays/)
  assert.match(outlet, /devtoolsProbe\.sampleFrame/)
  assert.match(stage, /desktop_world_stage\.devtools\.configure/)
  assert.doesNotMatch(probe, /requestAnimationFrame|setInterval|setTimeout/)
})

test('stage topology keeps native geometry in DevTools and out of strict scene events', () => {
  const segments = [
    { display_id: 1, index: 0, dw_bounds: [0, 200, 1440, 900], native_bounds: [-1440, 0, 1440, 900] },
    { display_id: 2, index: 1, dw_bounds: [1440, 0, 1920, 1080], native_bounds: [0, -200, 1920, 1080] },
  ]
  const scene = projectSceneEventTopology(segments)
  const devtools = projectDesktopWorldDevToolsTopology(segments)

  assert.deepEqual(scene.displays, [
    { displayId: 1, index: 0, bounds: [0, 200, 1440, 900] },
    { displayId: 2, index: 1, bounds: [1440, 0, 1920, 1080] },
  ])
  assert.deepEqual(devtools.displays, [
    { displayId: 1, index: 0, bounds: [0, 200, 1440, 900], nativeBounds: [-1440, 0, 1440, 900] },
    { displayId: 2, index: 1, bounds: [1440, 0, 1920, 1080], nativeBounds: [0, -200, 1920, 1080] },
  ])
  assert.equal(scene.displays.some((display) => Object.hasOwn(display, 'nativeBounds')), false)
})
