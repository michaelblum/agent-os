import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyRenderLoopWork,
  renderLoopContinuationReasons,
} from '../../apps/sigil/renderer/live-modules/render-loop.js'
import state from '../../apps/sigil/renderer/state.js'
import { hideAuraObjects } from '../../apps/sigil/renderer/aura.js'
import { hideTrailSprites } from '../../apps/sigil/renderer/particles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const deletedCursorModelPattern = new RegExp([
  ['selection', 'Mode', 'Cursor', 'Model'].join(''),
  ['read', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
  ['refresh', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
  ['create', 'Selection', 'Mode', 'Cursor', 'Model', 'Renderer'].join(''),
].join('|'))

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

test('Selection Mode rides the native pointer and does not expose the prism cursor model', () => {
  const mainSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  assert.match(mainSource, /selectionModeAvatarPositionFromPointer\(point\)/)
  assert.match(mainSource, /updateSelectionModeAvatarRide\(\{ x: msg\.x, y: msg\.y \}\)/)
  assert.match(mainSource, /liveJs\.avatarSize = liveJs\.selectionMode\?\.active \? Number\(state\.selectionModeAvatarScale \|\| 0\.5\) : 1\.0;/)
  assert.match(mainSource, /state\.polyGroup\.scale\.setScalar\(state\.baseScale \* state\.z_depth \* state\.appScale \* vitalityScale \* liveJs\.avatarSize \* \(1 \+ liveJs\.avatarHoverProgress \* 0\.055\)\);/)
  assert.doesNotMatch(mainSource, deletedCursorModelPattern)

  const overlaySource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/interaction-overlay.js'), 'utf8')
  const drawStart = overlaySource.indexOf('function drawSelectionMode(')
  const drawEnd = overlaySource.indexOf('function fastTravelLineGesture', drawStart)
  const drawBlock = overlaySource.slice(drawStart, drawEnd)
  assert.doesNotMatch(drawBlock, /drawSelectionCursorModel\(/)
})

test('display_geometry is the Selection Mode display cache boundary', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const displayGeometryStart = source.indexOf("if (msg.type === 'display_geometry')")
  const displayGeometryEnd = source.indexOf("if (msg.type === 'bootstrap')", displayGeometryStart)
  const displayGeometryBlock = source.slice(displayGeometryStart, displayGeometryEnd)

  assert.match(displayGeometryBlock, /liveJs\.displays = normalizeDisplays\(msg\.displays \|\| \[\]\)/)
  assert.match(displayGeometryBlock, /selectionModeRuntime\.refreshDisplayGeometry\('display_geometry'\)/)
  assert.match(
    displayGeometryBlock,
    /liveJs\.visibleBounds[\s\S]*selectionModeRuntime\.refreshDisplayGeometry\('display_geometry'\)[\s\S]*annotationReticleRefreshCanvasCandidates\(\)/,
  )
})

test('Selection Mode dirty frames still request lifecycle work while effect frames publish without structural work', () => {
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
  assert.equal(exitEffect.publishState, true)
})

test('Sigil debug snapshot no longer exposes cursor model refresh helpers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  assert.doesNotMatch(source, deletedCursorModelPattern)
})

test('Sigil visual selection path no longer refreshes a cursor model snapshot', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const animateStart = source.indexOf('function animate()')
  const radialUpdateStart = source.indexOf('if (work.structural || activeRadialActivationTransition)', animateStart)
  const cursorRefreshBlock = source.slice(animateStart, radialUpdateStart)

  assert.doesNotMatch(cursorRefreshBlock, deletedCursorModelPattern)
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

test('Selection Mode surface snapshots are reprojected on secondary display segments', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const surfaceApplyStart = source.indexOf('function applySurfaceRenderSnapshot')
  const surfaceApplyBlock = source.slice(surfaceApplyStart, source.indexOf('function surfaceRenderSnapshot', surfaceApplyStart))
  const surfaceSnapshotStart = source.indexOf('function surfaceRenderSnapshot')
  const surfaceSnapshotBlock = source.slice(surfaceSnapshotStart, source.indexOf('function desktopWorldToSegmentLocalPoint', surfaceSnapshotStart))

  assert.match(surfaceSnapshotBlock, /selectionMode: liveJs\.selectionMode/)
  assert.match(surfaceApplyBlock, /snapshot\.selectionMode && typeof snapshot\.selectionMode === 'object'[\s\S]*liveJs\.selectionMode = snapshot\.selectionMode[\s\S]*liveJs\.selectionModeOverlay = selectionModeRuntime\.buildProjectedOverlay\(liveJs\.selectionMode\)/)
})

test('hidden Sigil cleanup clears overlay canvases without refreshing a cursor model', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const clearStart = source.indexOf('function clearHiddenFrame')
  const clearEnd = source.indexOf('function animate()', clearStart)
  const clearBlock = source.slice(clearStart, clearEnd)

  assert.match(clearBlock, /overlay\.clear\(\)/)
  assert.match(clearBlock, /hideAuraObjects\(\)/)
  assert.match(clearBlock, /hideTrailSprites\(\)/)
  assert.doesNotMatch(clearBlock, deletedCursorModelPattern)
  assert.match(clearBlock, /visibilityTransition\.clear\(\)/)
  assert.match(clearBlock, /fastTravel\.clear\?\.\(\)/)
  assert.match(clearBlock, /state\.renderer\.clear\(true,\s*true,\s*true\)/)
  assert.ok(clearBlock.indexOf('overlay.clear()') < clearBlock.indexOf('state.renderer.clear(true, true, true)'))
})

test('hidden avatar visual cleanup hides aura and trail sprites instead of leaving zero-scale residues', () => {
  const original = {
    glowSprite: state.glowSprite,
    coreSprite: state.coreSprite,
    wobbleMeshes: state.wobbleMeshes,
    trailSprites: state.trailSprites,
    trailPositions: state.trailPositions,
  }
  const makeSprite = () => ({
    visible: true,
    material: { opacity: 0.8 },
    scale: {
      x: 1,
      y: 1,
      z: 1,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
    },
  })
  const wobble = { visible: true }
  const trail = makeSprite()
  try {
    state.glowSprite = makeSprite()
    state.coreSprite = makeSprite()
    state.wobbleMeshes = [wobble]
    state.trailSprites = [trail]
    state.trailPositions = [{ x: 1, y: 2, z: 3 }]

    hideAuraObjects()
    hideTrailSprites()

    assert.equal(state.glowSprite.visible, false)
    assert.equal(state.glowSprite.material.opacity, 0)
    assert.equal(state.glowSprite.scale.x, 0)
    assert.equal(state.coreSprite.visible, false)
    assert.equal(state.coreSprite.material.opacity, 0)
    assert.equal(wobble.visible, false)
    assert.equal(trail.visible, false)
    assert.equal(trail.material.opacity, 0)
    assert.deepEqual(state.trailPositions, [])
  } finally {
    Object.assign(state, original)
  }
})
