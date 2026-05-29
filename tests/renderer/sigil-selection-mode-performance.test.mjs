import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyRenderLoopWork,
  renderLoopContinuationReasons,
} from '../../apps/sigil/renderer/live-modules/render-loop.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

test('Selection Mode visual frames do not request structural or publication work when unchanged', () => {
  const reasons = renderLoopContinuationReasons({
    currentState: 'IDLE',
    avatarMotionActive: true,
    selectionModeActive: true,
    selectionModeEffectActive: false,
    rendererSuspended: false,
  })
  const work = classifyRenderLoopWork({
    continuationReasons: reasons,
    structuralDirty: false,
  })

  assert.deepEqual(reasons, ['selection-mode', 'avatar-motion'])
  assert.equal(work.visualOnly, true)
  assert.equal(work.structural, false)
  assert.equal(work.overlay, false)
  assert.equal(work.publishState, false)
})

test('Selection Mode dirty frames still request lifecycle work while effect frames stay overlay-only', () => {
  assert.equal(classifyRenderLoopWork({
    continuationReasons: ['selection-mode', 'avatar-motion'],
    structuralDirty: true,
  }).structural, true)

  const exitEffect = classifyRenderLoopWork({
    continuationReasons: ['selection-mode-effect', 'avatar-motion'],
    structuralDirty: false,
  })
  assert.equal(exitEffect.visualOnly, false)
  assert.equal(exitEffect.structural, false)
  assert.equal(exitEffect.overlay, true)
  assert.equal(exitEffect.publishState, false)
})

test('Sigil debug snapshot reads cached Selection Mode cursor model state', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const refreshStart = source.indexOf('function refreshSelectionModeCursorModelSnapshot')
  const refreshEnd = source.indexOf('function annotationReticleItemMetrics', refreshStart)
  const refreshBlock = source.slice(refreshStart, refreshEnd)
  const debugStart = source.indexOf('window.__sigilDebug = {')
  const refreshDebugStart = source.indexOf('refreshSelectionModeCursorModel()', debugStart)
  const snapshotBlock = source.slice(debugStart, refreshDebugStart)

  assert.match(refreshBlock, /selectionModeCursorModelRenderer\?\.update\(overlay \|\| null/)
  assert.doesNotMatch(refreshBlock, /buildProjectedOverlay|buildProjectedSelectionModeOverlay/)
  assert.match(snapshotBlock, /selectionModeCursorModel: readSelectionModeCursorModelSnapshot\(\)/)
  assert.doesNotMatch(snapshotBlock, /refreshSelectionModeCursorModelSnapshot\(|selectionModeCursorModelRenderer\?\.update|buildProjectedOverlay/)
})

test('Sigil visual cursor refresh uses owned overlay cache instead of rebuilding projection', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const animateStart = source.indexOf('function animate()')
  const radialUpdateStart = source.indexOf('if (work.structural || activeRadialActivationTransition)', animateStart)
  const cursorRefreshBlock = source.slice(animateStart, radialUpdateStart)

  assert.match(cursorRefreshBlock, /refreshSelectionModeCursorModelSnapshot\(liveJs\.selectionModeOverlay \|\| null\)/)
  assert.doesNotMatch(cursorRefreshBlock, /selectionModeRuntime\.buildProjectedOverlay\(\)/)
})

test('Selection Mode render-only input schedules visual-only frames', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/selection-mode-runtime.js'), 'utf8')
  const renderOnlyStart = source.indexOf("if (route.direct === 'render_only')")
  const renderOnlyEnd = source.indexOf("if (route.direct === 'avatar_double_click_exit')", renderOnlyStart)
  const renderOnlyBlock = source.slice(renderOnlyStart, renderOnlyEnd)

  assert.match(renderOnlyBlock, /scheduleRenderFrame\(\{\s*structural:\s*false\s*\}\)/)
  assert.doesNotMatch(renderOnlyBlock, /scheduleRenderFrame\(\);/)
})

test('hidden Sigil cleanup clears overlay canvases and cursor model before publishing hidden state', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const clearStart = source.indexOf('function clearHiddenFrame')
  const clearEnd = source.indexOf('function animate()', clearStart)
  const clearBlock = source.slice(clearStart, clearEnd)

  assert.match(clearBlock, /overlay\.clear\(\)/)
  assert.match(clearBlock, /refreshSelectionModeCursorModelSnapshot\(null\)/)
  assert.match(clearBlock, /visibilityTransition\.clear\(\)/)
  assert.match(clearBlock, /fastTravel\.clear\?\.\(\)/)
  assert.match(clearBlock, /state\.renderer\.clear\(true,\s*true,\s*true\)/)
  assert.ok(clearBlock.indexOf('overlay.clear()') < clearBlock.indexOf('state.renderer.clear(true, true, true)'))
})
