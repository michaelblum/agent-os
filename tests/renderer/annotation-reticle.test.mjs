import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annotationReticleReleaseDisposition,
  buildAnnotationReticleOverlayModel,
  chooseAnnotationTravelPlacement,
  clearAnnotationReticleSemanticCandidatesForCanvas,
  createAnnotationReticleAcquisitionState,
  createAnnotationReticleTargetEvidenceCache,
  createSigilAnnotationReticleController,
  createSigilAnnotationReticleContextSession,
  recordAnnotationReticleSemanticCandidateIds,
  resolveSigilAnnotationReticleTarget,
  reticleOuterMarginExit,
  SIGIL_ANNOTATION_ENTRY_SOURCE,
} from '../../apps/sigil/renderer/live-modules/annotation-reticle.js'
import {
  radialItemPointerMetrics,
  resolveRadialGestureItems,
} from '../../packages/toolkit/runtime/radial-gesture.js'
import {
  createCanvasResponseError,
} from '../../apps/sigil/renderer/live-modules/host-runtime.js'

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

test('annotation reticle commit exposes canonical context session with fallback provenance', () => {
  let now = Date.parse('2026-05-13T12:00:00.000Z')
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [display],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
    getAvatarHitRadius: () => 20,
    now: () => now,
  })

  assert.equal(controller.snapshot().context_session, null)
  assert.equal(controller.requestSnapshotEvent().context_session, null)

  controller.enter({ x: 120, y: 120, valid: true })
  now += 1000
  const committed = controller.commitRelease({ x: 220, y: 140, valid: true })
  const context = committed.context_session
  const artifact = context.artifacts[0]
  const leaf = artifact.path.at(-1)

  assert.equal(context.schema, 'aos_context_session')
  assert.equal(context.entry_source, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.equal(context.source_annotation_session.schema, 'aos_annotation_session')
  assert.equal(context.source_annotation_session.entry_source, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.deepEqual(
    context.source_annotation_session.committed_scope_addresses,
    committed.session.committed_scope_stack.map((subject) => subject.address),
  )
  assert.equal(context.artifacts.length, 1)
  assert.deepEqual(
    artifact.path.map((node) => node.address),
    committed.session.committed_scope_stack.map((subject) => subject.address),
  )
  assert.equal(artifact.active_target_node_id, leaf.id)
  assert.equal(artifact.acquisition.mode, SIGIL_ANNOTATION_ENTRY_SOURCE)
  assert.deepEqual(artifact.acquisition.pointer, {
    x: 220,
    y: 140,
    coordinate_space: 'desktop_world',
    source_metadata: {},
  })
  assert.equal(artifact.acquisition.candidate_report.fallback_reason, 'annotation_candidate_cache_empty')
  assert.equal(artifact.acquisition.source_metadata.fallback, true)
  assert.equal(artifact.acquisition.source_metadata.blocker_reason, 'annotation_candidate_cache_empty')
  assert.equal(artifact.acquisition.source_metadata.root_evidence.display, 'main')
  assert.equal(artifact.acquisition.source_metadata.placement.placement_status, committed.placement.placement_status)
  assert.equal(leaf.subject.source_metadata.sigil_fallback, true)
  assert.equal(leaf.subject.source_metadata.target_source, 'display_fallback')
  assert.equal(artifact.anchors.every((anchor) => anchor.comment_text === ''), true)

  const snapshot = controller.snapshot()
  const request = controller.requestSnapshotEvent()
  assert.equal(snapshot.context_session, context)
  assert.equal(snapshot.last_committed_event.context_session, context)
  assert.equal(request.context_session, context)
  assert.equal(request.anchor_count, committed.session.anchors.length)
})

test('annotation reticle preview and release prefer shared projectable annotation candidates', () => {
  let now = Date.parse('2026-05-13T12:00:00.000Z')
  const semanticCandidate = {
    id: 'semantic-cta',
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'html-workbench-expression',
    root_label: 'HTML Workbench',
    root_kind: 'canvas',
    subject_id: 'semantic-cta',
    subject_path: ['canvas', 'html-workbench-expression', 'semantic', 'semantic-cta'],
    subject_kind: 'button',
    role: 'button',
    label: 'Approve',
    projection: {
      adapter_id: 'aos-toolkit-semantic-target',
      root_id: 'html-workbench-expression',
      subject_id: 'semantic-cta',
      subject_kind: 'button',
      status: 'visible',
      current_render_status: 'visible',
      projectable: true,
      can_project_display_overlay: true,
      can_reveal: true,
      visible_display_rect: { x: 200, y: 120, w: 60, h: 40 },
      display_space_rect: { x: 200, y: 120, w: 60, h: 40 },
      coordinate_space: 'desktop_world',
    },
    source_metadata: {
      source: 'test_cached_semantic_targets',
    },
  }
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [display],
    getAvatarPos: () => ({ x: 80, y: 80, valid: true }),
    getAvatarHitRadius: () => 20,
    getAnnotationCandidates: () => [semanticCandidate],
    now: () => now,
  })

  controller.enter({ x: 120, y: 120, valid: true })
  now += 1000
  const preview = controller.updatePreview({ x: 220, y: 140, valid: true })
  assert.equal(preview.preview_target.adapter_id, 'aos-toolkit-semantic-target')
  assert.equal(preview.preview_target.address, 'subject:aos-toolkit-semantic-target:html-workbench-expression:canvas:html-workbench-expression:semantic:semantic-cta:semantic-cta')
  assert.equal(preview.preview_target.source_metadata.sigil_fallback, false)
  assert.equal(preview.decision_report.raw_candidate_count, 1)
  assert.equal(preview.decision_report.selected.id, 'semantic-cta')
  assert.equal(preview.decision_report.selected.source, 'aos_semantic_target')
  assert.equal(preview.preview_target.projection.can_reveal, true)

  now += 1000
  const committed = controller.commitRelease({ x: 220, y: 140, valid: true })
  assert.equal(committed.preview_target.adapter_id, 'aos-toolkit-semantic-target')
  assert.equal(committed.target_limitation, '')
  assert.equal(committed.fallback, false)
  assert.equal(committed.blocker_reason, '')
  assert.equal(committed.decision_report.selected.id, 'semantic-cta')
  assert.deepEqual(committed.placement.point, { x: 164, y: 84, valid: true })
  assert.equal(committed.session.anchors.some((anchor) => anchor.subject.adapter_id === 'aos-toolkit-semantic-target'), true)
})

test('annotation reticle re-enters from the last live parent scope and rejects outside siblings', () => {
  let now = Date.parse('2026-05-13T12:00:00.000Z')
  const parentWindow = {
    id: 'native-window-1',
    adapter_id: 'macos-ax',
    root_id: 'native-window-1',
    root_label: 'Browser',
    root_kind: 'native_window',
    subject_id: 'native-window-1',
    subject_path: ['native_window', 'native-window-1'],
    subject_kind: 'native_window',
    label: 'Browser',
    projection: {
      adapter_id: 'macos-ax',
      root_id: 'native-window-1',
      subject_id: 'native-window-1',
      subject_kind: 'native_window',
      status: 'visible',
      current_render_status: 'visible',
      projectable: true,
      can_project_display_overlay: true,
      visible_display_rect: { x: 80, y: 60, w: 260, h: 180 },
      display_space_rect: { x: 80, y: 60, w: 260, h: 180 },
      coordinate_space: 'desktop_world',
    },
  }
  const insideChild = {
    id: 'ax-inside',
    adapter_id: 'macos-ax',
    root_id: 'native-window-1',
    root_kind: 'native_window',
    subject_id: 'ax-inside',
    subject_path: ['native_window', 'native-window-1', 'ax_element', 'ax-inside'],
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Inside',
    projection: {
      adapter_id: 'macos-ax',
      root_id: 'native-window-1',
      subject_id: 'ax-inside',
      subject_kind: 'AXButton',
      status: 'visible',
      current_render_status: 'visible',
      projectable: true,
      can_project_display_overlay: true,
      visible_display_rect: { x: 130, y: 100, w: 80, h: 32 },
      display_space_rect: { x: 130, y: 100, w: 80, h: 32 },
      coordinate_space: 'desktop_world',
    },
  }
  const outsideSibling = {
    ...insideChild,
    id: 'ax-outside',
    root_id: 'native-window-2',
    subject_id: 'ax-outside',
    subject_path: ['native_window', 'native-window-2', 'ax_element', 'ax-outside'],
    label: 'Outside',
    projection: {
      ...insideChild.projection,
      root_id: 'native-window-2',
      subject_id: 'ax-outside',
      visible_display_rect: { x: 140, y: 108, w: 18, h: 18 },
      display_space_rect: { x: 140, y: 108, w: 18, h: 18 },
    },
  }
  let candidates = [parentWindow]
  const controller = createSigilAnnotationReticleController({
    getDisplays: () => [display],
    getAvatarPos: () => ({ x: 20, y: 20, valid: true }),
    getAnnotationCandidates: () => candidates,
    now: () => now,
  })

  controller.enter({ x: 20, y: 20, valid: true })
  now += 1000
  const firstCommit = controller.commitRelease({ x: 100, y: 80, valid: true })
  assert.equal(firstCommit.preview_target.subject_kind, 'native_window')
  const parentAddress = firstCommit.session.committed_scope_stack.at(-1).address

  candidates = [parentWindow, outsideSibling, insideChild]
  now += 1000
  const secondEnter = controller.enter({ x: 20, y: 20, valid: true })
  assert.equal(secondEnter.active_scope.address, parentAddress)
  assert.equal(secondEnter.scope_blocker_reason, '')

  now += 1000
  const preview = controller.updatePreview({ x: 150, y: 116, valid: true })
  assert.equal(preview.preview_target.subject.id, 'ax-inside')
  assert.equal(preview.preview_target.source_metadata.active_scope_address, parentAddress)
  assert.equal(preview.decision_report.raw_candidate_count, 3)
  assert.equal(preview.decision_report.scoped_candidate_count, 1)
  assert.equal(preview.decision_report.rejected.some((entry) => entry.id === 'native-window-1' && entry.reason === 'candidate_is_active_scope'), true)
  assert.equal(preview.decision_report.rejected.some((entry) => entry.id === 'ax-outside' && entry.reason === 'native_ax_root_mismatch'), true)

  now += 1000
  const secondCommit = controller.commitRelease({ x: 150, y: 116, valid: true })
  assert.equal(secondCommit.preview_target.id, 'ax-inside')
  assert.equal(secondCommit.decision_report.selected.source, 'native_ax_element')
  const childAddress = secondCommit.session.committed_scope_stack.at(-1).address
  assert.deepEqual(secondCommit.session.committed_scope_stack.map((subject) => subject.address), [
    firstCommit.session.root.address,
    parentAddress,
    childAddress,
  ])
  assert.deepEqual(secondCommit.session.anchors.at(-1).scope_path, secondCommit.session.committed_scope_stack.map((subject) => subject.address))

  const context = secondCommit.context_session
  const artifact = context.artifacts[0]
  assert.equal(context.schema, 'aos_context_session')
  assert.deepEqual(
    artifact.path.map((node) => node.address),
    secondCommit.session.committed_scope_stack.map((subject) => subject.address),
  )
  assert.deepEqual(artifact.path.map((node) => node.subject.subject.id), ['main:root', 'native-window-1', 'ax-inside'])
  assert.equal(artifact.active_target_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.selected_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.candidate_report.selected.id, 'ax-inside')
  assert.equal(artifact.acquisition.source_metadata.fallback, false)
  assert.deepEqual(
    artifact.anchors.map((anchor) => anchor.address),
    secondCommit.session.anchors.map((anchor) => anchor.address),
  )
})

test('Sigil reticle context adapter preserves compatible anchor comments', () => {
  const session = {
    active: false,
    entry_source: SIGIL_ANNOTATION_ENTRY_SOURCE,
    root: {
      adapter_id: 'sigil-display-reticle-v0',
      root_id: 'main',
      subject_id: 'main:root',
      subject_path: ['display', 'main', 'root'],
      subject_kind: 'root',
      role: 'root',
      label: 'Main display',
      projection: {
        adapter_id: 'sigil-display-reticle-v0',
        subject_id: 'main:root',
        subject_kind: 'root',
        current_render_status: 'visible',
        display_space_rect: { x: 0, y: 0, w: 400, h: 300 },
        visible_display_rect: { x: 0, y: 0, w: 400, h: 300 },
      },
    },
    committed_scope_stack: [],
    anchors: [],
    updated_at: '2026-05-13T12:00:00.000Z',
  }
  session.committed_scope_stack = [session.root]
  session.anchors = [{
    id: 'anchor:main-root',
    address: 'subject:sigil-display-reticle-v0:main:display:main:root:main:root',
    subject: session.root,
    status: 'live',
    comment_text: 'Keep this display frame.',
    projection: session.root.projection,
    updated_at: '2026-05-13T12:00:00.000Z',
  }]

  const context = createSigilAnnotationReticleContextSession({
    type: 'sigil.annotation_reticle.commit',
    committed_at: '2026-05-13T12:00:01.000Z',
    release_point: { x: 10, y: 20, valid: true },
    decision_report: { selected: { id: 'main-root' } },
    session,
  })
  const artifact = context.artifacts[0]

  assert.equal(artifact.path[0].comments[0].text, 'Keep this display frame.')
  assert.equal(artifact.anchors[0].comment_text, 'Keep this display frame.')
  assert.equal(artifact.anchors[0].source_annotation_anchor_id, 'anchor:main-root')
})

test('annotation reticle candidate bridge records explicit fallback blocker metadata', () => {
  const resolved = resolveSigilAnnotationReticleTarget({
    candidates: [{
      id: 'blocked',
      adapter_id: 'macos-ax',
      projection: {
        adapter_id: 'macos-ax',
        subject_id: 'blocked',
        subject_kind: 'AXButton',
        status: 'unsupported',
        can_project_display_overlay: false,
        blocker_reason: 'bounded_ax_projection_unavailable',
      },
    }],
    display,
    pointer: { x: 12, y: 18, valid: true },
    role: 'pointer-preview',
  })

  assert.equal(resolved.fallback, true)
  assert.equal(resolved.blocker_reason, 'no_projectable_candidate_under_pointer')
  assert.equal(resolved.target_limitation, 'display_under_release_pointer_v0')
  assert.equal(resolved.subject.adapter_id, 'sigil-display-reticle-v0')
  assert.equal(resolved.subject.source_metadata.sigil_fallback, true)
  assert.equal(resolved.subject.source_metadata.candidate_source_count, 1)
})

test('annotation reticle semantic target evidence clears canvas-owned flat candidates on replacement and removal', () => {
  const evidence = createAnnotationReticleTargetEvidenceCache()
  evidence.candidates.set('canvas-a', { id: 'canvas-a', adapter_id: 'aos-canvas-window' })
  evidence.candidates.set('old-primary', { id: 'old-primary', adapter_id: 'aos-toolkit-semantic-target' })
  evidence.candidates.set('old-secondary', { id: 'old-secondary', adapter_id: 'aos-toolkit-semantic-target' })
  evidence.candidates.set('foreign', { id: 'foreign', adapter_id: 'aos-toolkit-semantic-target' })
  recordAnnotationReticleSemanticCandidateIds(evidence, 'canvas-a', ['old-primary', 'old-secondary'])
  recordAnnotationReticleSemanticCandidateIds(evidence, 'canvas-b', ['foreign'])

  assert.deepEqual(
    clearAnnotationReticleSemanticCandidatesForCanvas(evidence, 'canvas-a').sort(),
    ['old-primary', 'old-secondary'],
  )
  assert.equal(evidence.candidates.has('old-primary'), false)
  assert.equal(evidence.candidates.has('old-secondary'), false)
  assert.equal(evidence.candidates.has('foreign'), true)
  assert.equal(evidence.candidates.has('canvas-a'), true)
  assert.equal(evidence.semanticTargetsByCanvas.has('canvas-a'), false)

  evidence.candidates.set('new-primary', { id: 'new-primary', adapter_id: 'aos-toolkit-semantic-target' })
  recordAnnotationReticleSemanticCandidateIds(evidence, 'canvas-a', ['new-primary'])
  assert.deepEqual(clearAnnotationReticleSemanticCandidatesForCanvas(evidence, 'canvas-a'), ['new-primary'])
  assert.equal(evidence.candidates.has('new-primary'), false)
  assert.equal(evidence.candidates.has('foreign'), true)
})

test('host runtime rejected canvas responses preserve structured error fields', () => {
  const error = createCanvasResponseError({
    status: 'error',
    code: 'BROWSER_SESSION_NOT_LOCAL',
    message: 'browser session has no local window evidence',
  })

  assert.equal(error instanceof Error, true)
  assert.equal(error.message, 'BROWSER_SESSION_NOT_LOCAL: browser session has no local window evidence')
  assert.equal(error.code, 'BROWSER_SESSION_NOT_LOCAL')
  assert.equal(error.status, 'error')
  assert.equal(error.responseMessage, 'browser session has no local window evidence')
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
