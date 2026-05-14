import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  annotationReticleReleaseDisposition,
  buildAnnotationReticleOverlayModel,
  chooseAnnotationTravelPlacement,
  createAnnotationReticleAcquisitionState,
  createSigilAnnotationReticleController,
  reticleOuterMarginExit,
  SIGIL_ANNOTATION_ENTRY_SOURCE,
} from '../../apps/sigil/renderer/live-modules/annotation-reticle.js'
import {
  radialItemPointerMetrics,
  resolveRadialGestureItems,
} from '../../packages/toolkit/runtime/radial-gesture.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const display = {
  id: 'main',
  display_id: 'main',
  visibleBounds: { x: 0, y: 0, w: 400, h: 300 },
}

function radialSnapshotForPointer(pointer, phase = 'radial') {
  const config = {
    radiusBasis: 100,
    itemRadius: 1,
    itemHitRadius: 0.25,
    itemVisualRadius: 0.2,
    handoffRadius: 1.8,
    startAngle: 0,
    spreadDegrees: 0,
  }
  const origin = { x: 0, y: 0 }
  const items = resolveRadialGestureItems([{ id: 'annotation-mode', label: 'Annotate' }], config, { origin, triggerAngle: 0 })
  return {
    phase,
    origin,
    pointer,
    activeItemId: phase === 'radial' && Math.hypot(pointer.x - items[0].center.x, pointer.y - items[0].center.y) <= items[0].hitRadius
      ? 'annotation-mode'
      : null,
    radii: {
      handoff: 180,
    },
    items,
  }
}

function reticleMetrics(radial) {
  return radialItemPointerMetrics(radial, radial.items[0])
}

test('annotation reticle session enters with sigil radial source and commits bounded display target', () => {
  let now = Date.parse('2026-05-13T12:00:00.000Z')
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [display],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
    getAvatarHitRadius: () => 20,
    now: () => now,
  })

  const entered = controller.enter({ x: 120, y: 120, valid: true })
  assert.equal(entered.active, true)
  assert.equal(entered.entry_source, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.equal(entered.session.active, true)
  assert.equal(entered.session.root.source_metadata.entry_source, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.equal(entered.camera_available, false)

  now += 1000
  controller.updatePreview({ x: 220, y: 140, valid: true })
  const committed = controller.commitRelease({ x: 220, y: 140, valid: true })

  assert.equal(committed.type, 'sigil.annotation_reticle.commit')
  assert.equal(committed.entry_source, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.deepEqual(committed.release_point, { x: 220, y: 140, valid: true })
  assert.equal(committed.target_limitation, 'display_under_release_pointer_v0')
  assert.notDeepEqual(committed.placement.point, committed.release_point)
  assert.equal(committed.session.active, false)
  assert.ok(committed.session.anchors.length >= 1)

  const snapshot = controller.snapshot()
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.camera_available, true)
  assert.equal(snapshot.live_anchor_count, committed.session.anchors.length)
  assert.equal(snapshot.last_committed_event.placement.placement_status, committed.placement.placement_status)
})

test('annotation reticle stays unresolved instead of crashing when displays are absent', () => {
  let now = Date.parse('2026-05-13T12:00:00.000Z')
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
    getAvatarHitRadius: () => 20,
    now: () => now,
  })

  const entered = controller.enter({ x: 120, y: 120, valid: true })
  assert.equal(entered.active, true)
  assert.equal(entered.root_evidence.display, 'display:unknown')
  assert.equal(entered.session.root.projection.current_render_status, 'blocked')
  assert.equal(entered.session.root.projection.can_project_display_overlay, false)
  assert.equal(entered.session.root.projection.display_space_rect, null)
  assert.equal(entered.session.root.projection.visible_display_rect, null)
  assert.equal(entered.session.root.projection.blocker_reason, 'display_bounds_missing')

  now += 1000
  const updated = controller.updatePreview({ x: 220, y: 140, valid: true })
  assert.equal(updated.preview_target.projection.current_render_status, 'blocked')
  assert.equal(updated.preview_target.projection.blocker_reason, 'display_bounds_missing')

  now += 1000
  const committed = controller.commitRelease({ x: 220, y: 140, valid: true })
  assert.equal(committed.preview_target.projection.current_render_status, 'blocked')
  assert.equal(committed.preview_target.projection.blocker_reason, 'display_bounds_missing')
  assert.equal(committed.placement.placement_status, 'unresolved')
  assert.deepEqual(committed.placement.point, { x: 220, y: 140, valid: true })
  assert.equal(committed.session.anchors.every((anchor) => anchor.status === 'blocked'), true)
})

test('annotation reticle treats malformed display topology as missing geometry', () => {
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [null, 'main', { id: 'bad', visibleBounds: { x: 0, y: 0, w: 0, h: 0 } }],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
  })

  const entered = controller.enter()
  assert.equal(entered.session.root.root.id, 'bad')
  assert.equal(entered.session.root.projection.current_render_status, 'blocked')
  assert.equal(entered.session.root.projection.blocker_reason, 'display_bounds_missing')
})

test('annotation reticle treats null display topology as unavailable', () => {
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => null,
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
  })

  const entered = controller.enter()
  assert.equal(entered.root_evidence.display, 'display:unknown')
  assert.equal(entered.session.root.projection.current_render_status, 'blocked')
  assert.equal(entered.session.root.projection.blocker_reason, 'display_bounds_missing')
})

test('annotation travel placement uses inside corners for display roots and avoids raw cursor release', () => {
  const placement = chooseAnnotationTravelPlacement({
    targetRect: { x: 0, y: 0, w: 400, h: 300 },
    displayRect: { x: 0, y: 0, w: 400, h: 300 },
    releasePoint: { x: 390, y: 290 },
    avatarHitRadius: 20,
    margin: 10,
  })

  assert.equal(placement.placement_status, 'inside_corner')
  assert.deepEqual(placement.point, { x: 370, y: 270, valid: true })
  assert.notDeepEqual(placement.point, { x: 390, y: 290, valid: true })
  assert.equal(placement.candidates_considered[0], 'outside_bottom_right')
})

test('annotation travel placement falls back to constrained center when avatar cannot fit', () => {
  const placement = chooseAnnotationTravelPlacement({
    targetRect: { x: 0, y: 0, w: 40, h: 40 },
    displayRect: { x: 0, y: 0, w: 40, h: 40 },
    releasePoint: { x: 38, y: 38 },
    avatarHitRadius: 30,
    margin: 8,
  })

  assert.equal(placement.placement_status, 'constrained')
  assert.deepEqual(placement.point, { x: 20, y: 20, valid: true })
})

test('annotation reticle item-click releases are bounded exits, not sticky active mode', () => {
  const disposition = annotationReticleReleaseDisposition({
    committed: {
      type: 'item',
      itemId: 'annotation-mode',
    },
  })

  assert.deepEqual(disposition, {
    exit: true,
    reason: 'annotation-reticle-item-click',
  })
  assert.equal(annotationReticleReleaseDisposition({ committed: { type: 'item', itemId: 'wiki-graph' } }).exit, false)
  assert.equal(annotationReticleReleaseDisposition({ committed: { type: 'fastTravel' } }).exit, false)
})

test('reticle acquisition requires crossing the item before an outward overlapping exit', () => {
  const tracker = createAnnotationReticleAcquisitionState()

  const radialMiss = radialSnapshotForPointer({ x: 180, y: 0 }, 'fastTravel')
  assert.equal(tracker.update(radialMiss, reticleMetrics(radialMiss)).acquire, false)

  const inside = radialSnapshotForPointer({ x: 100, y: 0 }, 'radial')
  assert.equal(tracker.update(inside, reticleMetrics(inside)).acquire, false)
  assert.deepEqual(tracker.snapshot(), { candidateItemId: 'annotation-mode' })

  const sideways = radialSnapshotForPointer({ x: 130, y: 34 }, 'fastTravel')
  assert.equal(reticleOuterMarginExit(reticleMetrics(sideways), sideways), false)
  assert.equal(tracker.update(sideways, reticleMetrics(sideways)).acquire, false)
  assert.deepEqual(tracker.snapshot(), { candidateItemId: null })

  const outward = radialSnapshotForPointer({ x: 180, y: 0 }, 'fastTravel')
  assert.equal(reticleOuterMarginExit(reticleMetrics(outward), outward), true)
  assert.equal(tracker.update(outward, reticleMetrics(outward)).acquire, false)

  tracker.update(inside, reticleMetrics(inside))
  assert.equal(tracker.update(outward, reticleMetrics(outward)).acquire, true)
})

test('reticle acquisition keeps candidate while exiting outward before handoff', () => {
  const tracker = createAnnotationReticleAcquisitionState()
  const inside = radialSnapshotForPointer({ x: 100, y: 0 }, 'radial')
  const radialOutward = radialSnapshotForPointer({ x: 150, y: 0 }, 'radial')
  const fastTravelOutward = radialSnapshotForPointer({ x: 180, y: 0 }, 'fastTravel')

  tracker.update(inside, reticleMetrics(inside))
  assert.equal(tracker.update(radialOutward, reticleMetrics(radialOutward)).acquire, false)
  assert.deepEqual(tracker.snapshot(), { candidateItemId: 'annotation-mode' })
  assert.equal(tracker.update(fastTravelOutward, reticleMetrics(fastTravelOutward)).acquire, true)
})

test('reticle acquisition resets on radial interior return', () => {
  const tracker = createAnnotationReticleAcquisitionState()
  const inside = radialSnapshotForPointer({ x: 100, y: 0 }, 'radial')
  const inward = radialSnapshotForPointer({ x: 60, y: 0 }, 'radial')
  const outward = radialSnapshotForPointer({ x: 180, y: 0 }, 'fastTravel')

  tracker.update(inside, reticleMetrics(inside))
  assert.deepEqual(tracker.snapshot(), { candidateItemId: 'annotation-mode' })
  tracker.update(inward, reticleMetrics(inward))
  assert.deepEqual(tracker.snapshot(), { candidateItemId: null })
  assert.equal(tracker.update(outward, reticleMetrics(outward)).acquire, false)
})

test('Sigil applies annotation item-click lifecycle guard to avatar and target-surface releases', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const uses = source.match(/annotationReticleReleaseDisposition\(result\)/g) || []

  assert.equal(uses.length, 2)
  assert.match(source, /function handleRadialTargetSurfaceEvent[\s\S]*annotationReticleReleaseDisposition\(result\)[\s\S]*exitAnnotationReticle\(annotationDisposition\.reason\)/)
  assert.match(source, /case 'RADIAL': \{[\s\S]*annotationReticleReleaseDisposition\(result\)[\s\S]*exitAnnotationReticle\(annotationDisposition\.reason\)/)
})

test('Sigil defers Canvas Inspector opening out of the radial drag reticle entry path', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const enterStart = source.indexOf('function enterAnnotationReticle')
  const updateStart = source.indexOf('function updateAnnotationReticlePreview', enterStart)
  const enterBlock = source.slice(enterStart, updateStart)

  assert.match(source, /createAnnotationReticleAcquisitionState/)
  assert.match(source, /requestAnimationFrame\(flushAnnotationReticlePreview\)/)
  assert.doesNotMatch(enterBlock, /ensureUtilityCanvasVisible/)
  assert.doesNotMatch(enterBlock, /requestCanvasInspectorAnnotationToggle/)
})

test('Sigil records and recovers delayed radial camera target-surface clicks', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /type: event\.type/)
  assert.match(source, /radialTargetSurfaceReceiptEvidence/)
  assert.match(source, /applyRadialTargetSurfaceDragPayload/)
  assert.match(source, /payload\.kind === 'radial_item_pointer_move' \|\| payload\.kind === 'radial_surface_pointer_move'/)
  assert.match(source, /handleLeftMouseUp\(receipt\.worldPoint\.x, receipt\.worldPoint\.y\)/)
  assert.match(source, /payload\.itemId === SIGIL_ANNOTATION_CAMERA_ITEM_ID \|\| payload\.itemAction === 'annotationSnapshot'/)
  assert.match(source, /requestAnnotationSnapshot\('radial-camera-target-surface-recovery'\)/)
  assert.match(source, /host\.post\('canvas_inspector\.capture_bundle', \{[\s\S]*trigger: 'sigil_radial_camera'/)
  assert.match(source, /reason: 'camera-click-after-radial-cleanup'/)
  assert.match(source, /radialTargetSurfaceActive: radialTargetSurface\.snapshot\(\)\.interactive/)
  assert.match(source, /pointerInsideRadialTargetSurface: pointInRadialTargetSurface/)
})

test('annotation reticle overlay model exposes current scope hover and live anchors', () => {
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [display],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
    getAvatarHitRadius: () => 20,
  })

  controller.enter({ x: 120, y: 120, valid: true })
  controller.updatePreview({ x: 220, y: 140, valid: true })
  const activeOverlay = buildAnnotationReticleOverlayModel(controller.snapshot())

  assert.equal(activeOverlay.visible, true)
  assert.equal(activeOverlay.frames.length, 2)
  assert.equal(activeOverlay.frames[0].kind, 'scope')
  assert.equal(activeOverlay.frames[1].kind, 'current_scope')
  assert.deepEqual(activeOverlay.frames[0].rect, { x: 0, y: 0, width: 400, height: 300 })
  assert.deepEqual(activeOverlay.frames[1].rect, { x: 0, y: 0, width: 400, height: 300 })
  assert.equal(activeOverlay.hover.kind, 'hover_candidate')
  assert.deepEqual(activeOverlay.hover.rect, { x: 0, y: 0, width: 400, height: 300 })

  controller.commitRelease({ x: 220, y: 140, valid: true })
  const committedOverlay = buildAnnotationReticleOverlayModel(controller.snapshot())
  assert.equal(committedOverlay.visible, true)
  assert.equal(committedOverlay.anchors.length >= 1, true)
  assert.equal(committedOverlay.anchors[0].kind, 'live_anchor')
})
