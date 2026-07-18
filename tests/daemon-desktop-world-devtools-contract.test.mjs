import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

test('daemon routes bounded stage snapshots and every revisioned session action', () => {
  const unified = read('src/daemon/unified.swift')

  assert.match(unified, /case "desktop_world_stage\.devtools\.snapshot":\s*if canvasID == self\.sceneStageCanvasID/)
  for (const action of ['devtools_open', 'devtools_status', 'devtools_update', 'devtools_transfer', 'devtools_close']) {
    assert.match(unified, new RegExp(`case \\(\\"scene\\", \\"${action}\\"\\)`))
  }
  assert.match(unified, /mutateDesktopWorldDevToolsCanvas[\s\S]*canvasManager\.hasCanvas\(self\.sceneStageCanvasID\)/)
  assert.match(unified, /guard !Thread\.isMainThread, ensureSceneStage\(\) else \{ return false \}/)
  assert.match(unified, /aos:\/\/toolkit\/components\/desktop-world-devtools\/index\.html/)
  assert.match(unified, /closeDesktopWorldDevToolsSessionHosts/)
  assert.match(unified, /state\.ownedPanelIDs where panelID != state\.host\?\.id/)
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
  assert.match(outlet, /devtoolsProbe\.sampleFrame/)
  assert.match(stage, /desktop_world_stage\.devtools\.configure/)
  assert.doesNotMatch(probe, /requestAnimationFrame|setInterval|setTimeout/)
})
