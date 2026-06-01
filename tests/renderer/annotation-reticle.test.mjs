import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const deletedSelectionModeCursorPattern = new RegExp([
  ['selection', 'Mode', 'Cursor', 'Model'].join(''),
  ['read', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
  ['refresh', 'Selection', 'Mode', 'Cursor', 'Model', 'Snapshot'].join(''),
].join('|'))

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

test('annotation reticle imports neutral annotation candidate helpers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/annotation-reticle.js'), 'utf8')

  assert.match(source, /workbench\/annotation-candidates\.js/)
  assert.doesNotMatch(source, /workbench\/surface-inspector-annotations\.js/)
  assert.match(source, /chooseAnnotationCandidateForScope/)
  assert.match(source, /normalizeAnnotationCandidate/)
})

test('Sigil main imports native reticle candidate builders from neutral workbench module', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /workbench\/annotation-candidates\.js/)
  assert.doesNotMatch(source, /buildNative(Window|AxElement)SurfaceInspectorCandidate/)
  assert.doesNotMatch(source, /workbench\/surface-inspector-annotations\.js/)
  assert.match(source, /buildNativeWindowAnnotationCandidate/)
  assert.match(source, /buildNativeAxElementAnnotationCandidate/)
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

test('Sigil clears stale semantic reticle candidates before replacement or empty payloads', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const semanticStart = source.indexOf('function annotationReticleHandleSemanticTargets')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', semanticStart)
  const semanticBlock = source.slice(semanticStart, nativeStart)
  const removeStart = source.indexOf('function annotationReticleRemoveCandidate')
  const listStart = source.indexOf('function annotationReticleCandidateList', removeStart)
  const removeBlock = source.slice(removeStart, listStart)

  assert.match(removeBlock, /clearAnnotationReticleSemanticCandidatesForCanvas\(liveJs\.annotationReticleTargetEvidence, id\)/)
  assert.match(semanticBlock, /clearAnnotationReticleSemanticCandidatesForCanvas\(liveJs\.annotationReticleTargetEvidence, canvasId\)[\s\S]*if \(!targets\.length\) return/)
  assert.match(semanticBlock, /recordAnnotationReticleSemanticCandidateIds\(liveJs\.annotationReticleTargetEvidence, canvasId, candidateIds\)/)
})

test('Sigil reticle candidates are projected through canonical DesktopWorld helpers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /nativeToDesktopWorldRect/)
  assert.match(source, /normalizeCanvasFrameToDesktopWorld/)
  assert.match(source, /canvasLocalRectToDesktopWorld/)
  assert.match(source, /function annotationReticleCandidateInDesktopWorld/)
  assert.match(source, /function annotationReticleSemanticTargetForDesktopWorld/)
  assert.match(source, /normalizeCanvasFrameToDesktopWorld\(canvas, liveJs\.displays\)/)
  assert.match(source, /canvasLocalRectToDesktopWorld\(/)
  assert.match(source, /coordinate_space: 'desktop_world'/)
  assert.match(source, /source_coordinate_space: frame\?\.source_coordinate_space/)
  assert.match(source, /annotationReticleSemanticTargetForDesktopWorld\(canvasId, target\)/)
})

test('Sigil reticle preserves browser DOM element target adapter identity', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const semanticStart = source.indexOf('function annotationReticleHandleSemanticTargets')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', semanticStart)
  const semanticBlock = source.slice(semanticStart, nativeStart)

  assert.match(source, /workbench\/browser-dom-element-picker\.js/)
  assert.match(source, /buildBrowserDomElementAnnotationCandidate/)
  assert.match(source, /BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID/)
  assert.match(semanticBlock, /annotationReticleIsBrowserDomElementTarget\(target\)/)
  assert.match(semanticBlock, /content_rect: annotationReticleBrowserContentRect\(canvasId, payload, target\)/)
  assert.match(semanticBlock, /browser_attachment: target\.browser_attachment \|\| payload\.browser_attachment \|\| 'explicit_local_page'/)
})

test('Sigil reticle requests live browser DOM target for scoped local browser windows', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')

  assert.match(source, /function annotationReticleBrowserDomBridgeEvidence\(pointer = null, anchorCandidate = null\)/)
  assert.match(source, /function annotationReticleBrowserContentRectFromAxElement\(payload = \{\}, windowPayload = \{\}\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromAxElement\(axElementEvent, scopedWindowEvent\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromAxElement\(axElementEvent, \{ \.\.\.scopedWindowEvent, bounds: anchorRect \}\)/)
  assert.match(source, /annotationReticleBrowserDomBridge: null/)
  assert.match(source, /annotationReticleBrowserDomBridge: liveJs\.annotationReticleBrowserDomBridge/)
  assert.match(source, /function recordAnnotationReticleBrowserDomBridge\(stage, evidence = \{\}\)/)
  assert.match(source, /annotationReticleBrowserSessionFromWindow\(scopedWindowEvent\)/)
  assert.match(source, /annotationReticleBrowserContentRectFromWindow\(scopedWindowEvent\)/)
  assert.match(source, /blocker_reason: 'browser_content_inset_unresolved'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_blocked'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_stale_response'/)
  assert.match(source, /blocker_reason: 'browser_dom_request_scope_mismatch'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_no_target'/)
  assert.match(source, /recordAnnotationReticleBrowserDomBridge\('browser_dom_bridge_candidate_rejected'/)
  assert.match(source, /blocker_reason: 'browser_dom_request_failed'/)
  assert.match(source, /host\.request\('browser_dom\.element_target'/)
  assert.match(source, /browser_session_id: evidence\.session_id/)
  assert.match(source, /browser_window_id: evidence\.browser_window_id/)
  assert.match(source, /buildBrowserDomElementAnnotationCandidate\(\{[\s\S]*browser_session_id: evidence\.session_id[\s\S]*browser_window_id: evidence\.browser_window_id/)
  assert.match(source, /annotationReticleRequestBrowserDomTarget\(pointer, 'preview', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /annotationReticleRequestBrowserDomTarget\(\{ x, y, valid: true \}, 'release', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /function annotationReticleNativeBrowserWindowAnchor\(candidate = null, activeScope = null\)/)
  assert.match(source, /anchor_source: evidence\.anchor_source \|\| ''/)
  assert.match(source, /anchor_candidate_id: evidence\.anchor_candidate_id \|\| ''/)
  assert.match(source, /anchor_window_id: evidence\.anchor_window_id \|\| ''/)
  assert.match(source, /annotationReticleBrowserDomBridgeEvidence\(pointer, anchorCandidate\)/)
  assert.match(source, /annotationReticleWindowEventMatchesAnchor\(windowEvent, anchor\)/)
  assert.match(source, /browser_window_id: windowId/)
  assert.match(source, /anchor_source: anchor\.source/)
  assert.match(source, /annotationReticle\.updatePreview\(pointer\)[\s\S]*annotationReticleRequestBrowserDomTarget\(pointer, 'preview', liveJs\.annotationReticle\?\.preview_target \|\| null\)/)
  assert.match(source, /annotationReticle\.updatePreview\(\{ x, y, valid: true \}\)[\s\S]*annotationReticleRequestBrowserDomTarget\(\{ x, y, valid: true \}, 'release', liveJs\.annotationReticle\?\.preview_target \|\| null\)[\s\S]*const event = annotationReticle\.commitRelease/)
})

test('Sigil reticle accepts nested native window preview target as browser anchor', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const helpersStart = source.indexOf('function annotationReticleRectFromObject')
  const helpersEnd = source.indexOf('function annotationReticleCanvasDesktopWorldRect', helpersStart)
  assert.notEqual(helpersStart, -1)
  assert.notEqual(helpersEnd, -1)

  const helperSource = source.slice(helpersStart, helpersEnd)
  const displayRootScope = {
    address: 'sigil:display:1:root',
    adapter_id: 'aos-display-root',
    root_kind: 'display',
    subject_kind: 'display_root',
  }
  const annotationReticle = {
    snapshot: () => ({
      active_scope: displayRootScope,
    }),
  }
  const liveJs = {
    annotationReticleTargetEvidence: {
      latestNativeWindowEvent: {},
      latestNativeAxElementEvent: {},
    },
    displays: [],
  }
  const {
    annotationReticleNativeBrowserWindowAnchor,
    annotationReticleBrowserDomBridgeEvidence,
  } = new Function('annotationReticle', 'liveJs', `${helperSource}; return { annotationReticleNativeBrowserWindowAnchor, annotationReticleBrowserDomBridgeEvidence };`)(annotationReticle, liveJs)
  const previewTarget = {
    id: 'native-window:195:Comet',
    subject_id: '',
    adapter_id: 'macos-ax',
    role: 'native_window',
    root: {
      id: 'native-window:195:Comet',
      kind: 'native_window',
      label: 'Comet',
    },
    subject: {
      id: 'native-window:195:Comet',
      kind: 'native_window',
      path: ['native_window', 'native-window:195:Comet'],
    },
    source_metadata: {
      window_id: '195',
      pid: 732,
      bundle_id: 'ai.perplexity.comet',
      bounds: { x: 0, y: 158, w: 1512, h: 824 },
    },
  }

  const anchor = annotationReticleNativeBrowserWindowAnchor(previewTarget, displayRootScope)
  assert.equal(anchor.source, 'selected_native_window')
  assert.equal(anchor.candidate_id, 'native-window:195:Comet')
  assert.equal(anchor.window_id, '195')
  assert.equal(anchor.pid, 732)

  const evidence = annotationReticleBrowserDomBridgeEvidence({ x: 100, y: 200, valid: true }, previewTarget)
  assert.equal(evidence.blocker_reason, 'browser_content_inset_unresolved')
  assert.notEqual(evidence.blocker_reason, 'browser_native_window_scope_required')
  assert.equal(evidence.browser_window_id, '195')
  assert.equal(evidence.anchor_source, 'selected_native_window')
  assert.equal(evidence.anchor_candidate_id, 'native-window:195:Comet')
  assert.equal(evidence.anchor_window_id, '195')
})

test('Sigil reticle maps browser DOM daemon errors to precise bridge blockers', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const mapperStart = source.indexOf('function annotationReticleBrowserDomBridgeBlockerFromError')
  const evidenceStart = source.indexOf('function annotationReticleBrowserDomBridgeEvidence', mapperStart)
  const mapperBlock = source.slice(mapperStart, evidenceStart)
  const requestStart = source.indexOf('function annotationReticleRequestBrowserDomTarget')
  const nativeStart = source.indexOf('function annotationReticleHandleNativeWindow', requestStart)
  const requestBlock = source.slice(requestStart, nativeStart)

  assert.match(mapperBlock, /BROWSER_SESSION_NOT_LOCAL'[\s\S]*browser_session_not_local/)
  assert.match(mapperBlock, /BROWSER_SESSION_UNRESOLVED'[\s\S]*browser_session_unresolved/)
  assert.match(mapperBlock, /BROWSER_DOM_POINT_UNRESOLVED'[\s\S]*browser_dom_point_unresolved/)
  assert.match(mapperBlock, /BROWSER_CONTENT_INSET_UNRESOLVED'[\s\S]*browser_content_inset_unresolved/)
  assert.match(mapperBlock, /NATIVE_AX_ROOT_MISMATCH'[\s\S]*native_ax_root_mismatch/)
  assert.match(mapperBlock, /BROWSER_DOM_TARGET_INVALID_JSON'[\s\S]*browser_dom_target_invalid_json/)
  assert.match(mapperBlock, /BROWSER_DOM_TARGET_FAILED'[\s\S]*browser_dom_target_failed/)
  assert.match(mapperBlock, /default:[\s\S]*browser_dom_request_failed/)
  assert.match(mapperBlock, /message\.match\(\/\^\(\[A-Z0-9_\]\+\):\//)
  assert.match(requestBlock, /const blocker = annotationReticleBrowserDomBridgeBlockerFromError\(error\)/)
  assert.match(requestBlock, /blocker_reason: blocker\.blocker_reason/)
  assert.match(requestBlock, /code: blocker\.code/)
  assert.match(requestBlock, /status: error\?\.status \|\| ''/)
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

test('daemon exposes bounded browser DOM element target request for Sigil reticle', () => {
  const source = readFileSync(path.join(repoRoot, 'src/daemon/unified.swift'), 'utf8')

  assert.match(source, /case "browser_dom\.element_target":/)
  assert.match(source, /handleBrowserDomElementTarget\(callerID: canvasID, payload: inner \?\? \[:\]\)/)
  assert.match(source, /BROWSER_CONTENT_INSET_UNRESOLVED/)
  assert.match(source, /findRegistryRecord\(id: sessionID\)/)
  assert.match(source, /NATIVE_AX_ROOT_MISMATCH/)
  assert.match(source, /seeCaptureBrowserDomElementTarget\(/)
  assert.match(source, /BrowserDomHitTestPoint\(x: x, y: y\)/)
  assert.match(source, /contentRect: contentRect/)
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

  assert.equal(uses.length, 3)
  assert.match(source, /function handleRadialTargetSurfaceEvent[\s\S]*annotationReticleReleaseDisposition\(result\)[\s\S]*exitAnnotationReticle\(annotationDisposition\.reason\)/)
  assert.match(source, /case 'RADIAL': \{[\s\S]*annotationReticleReleaseDisposition\(result\)[\s\S]*exitAnnotationReticle\(annotationDisposition\.reason\)/)
})

test('Sigil routes the radial reticle item to Selection Mode instead of drag-through reticle entry', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const dispatchSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/radial-item-action-dispatch.js'), 'utf8')
  const enterStart = source.indexOf('function enterAnnotationReticle')
  const updateStart = source.indexOf('function updateAnnotationReticlePreview', enterStart)
  const enterBlock = source.slice(enterStart, updateStart)

  assert.doesNotMatch(source, /drag-through-reticle/)
  assert.doesNotMatch(source, /createAnnotationReticleAcquisitionState/)
  assert.match(dispatchSource, /enterSelectionMode\(pointer, 'radial-reticle'\)/)
  assert.match(dispatchSource, /post\('sigil\.selection_mode\.enter'/)
  assert.match(source, /requestAnimationFrame\(flushAnnotationReticlePreview\)/)
  assert.doesNotMatch(enterBlock, /ensureUtilityCanvasVisible/)
  assert.doesNotMatch(enterBlock, /requestCanvasInspectorAnnotationToggle/)
})

test('Sigil records and recovers delayed radial camera target-surface clicks', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const dispatchSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/radial-item-action-dispatch.js'), 'utf8')

  assert.match(source, /type: event\.type/)
  assert.match(source, /radialTargetSurfaceReceiptEvidence/)
  assert.match(source, /applyRadialTargetSurfaceDragPayload/)
  assert.match(source, /payload\.kind === 'radial_item_pointer_move' \|\| payload\.kind === 'radial_surface_pointer_move'/)
  assert.match(source, /handleLeftMouseUp\(receipt\.worldPoint\.x, receipt\.worldPoint\.y\)/)
  assert.match(source, /payload\.itemId === SIGIL_ANNOTATION_CAMERA_ITEM_ID \|\| payload\.itemAction === 'annotationSnapshot'/)
  assert.match(source, /reason: 'radial-camera-target-surface-recovery'/)
  assert.match(dispatchSource, /requestAnnotationSnapshot\(reason\)/)
  assert.match(dispatchSource, /context\.reason === 'radial-camera-target-surface-recovery'/)
  assert.match(source, /host\.post\('canvas_inspector\.capture_bundle', \{[\s\S]*trigger: 'sigil_radial_camera'/)
  assert.match(source, /reason: 'camera-click-after-radial-cleanup'/)
  assert.match(source, /radialTargetSurfaceActive: radialTargetSurface\.snapshot\(\)\.interactive/)
  assert.match(source, /pointerInsideRadialTargetSurface: pointInRadialTargetSurface/)
})

test('Sigil radial camera bundle request carries canonical context session and keyframe', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const requestStart = source.indexOf('function requestAnnotationSnapshot')
  const requestEnd = source.indexOf('function requestCanvasInspectorAnnotationToggle', requestStart)
  const requestBlock = source.slice(requestStart, requestEnd)

  const contextRecordingRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/context-recording-runtime.js'), 'utf8')

  assert.match(contextRecordingRuntimeSource, /export const RETICLE_CONTEXT_ASSET_REFS/)
  assert.match(contextRecordingRuntimeSource, /function resolveReticleBundleContext/)
  assert.match(contextRecordingRuntimeSource, /function resolveReticleBundleContext\(\{[\s\S]*contextSession: reticleContextSession/)
  assert.match(contextRecordingRuntimeSource, /activeContext\.context_keyframe \|\| createContextKeyframeForSession/)
  assert.match(requestBlock, /host\.post\('canvas_inspector\.capture_bundle', \{[\s\S]*trigger: 'sigil_radial_camera'/)
  assert.match(requestBlock, /context_session: contextSession/)
  assert.match(requestBlock, /context_keyframe: contextKeyframe/)
  assert.match(requestBlock, /context_unavailable: contextUnavailable/)
  assert.match(contextRecordingRuntimeSource, /surface_inspector_annotation_snapshot: 'annotation-snapshot\.json'/)
})

test('Sigil wires live Selection Mode state, capture, overlay, and recording hooks', () => {
  const source = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/main.js'), 'utf8')
  const selectionRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/selection-mode-runtime.js'), 'utf8')
  const contextRecordingRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/context-recording-runtime.js'), 'utf8')
  const commandRuntimeSource = readFileSync(path.join(repoRoot, 'apps/sigil/renderer/live-modules/ux-tree-command-registry.js'), 'utf8')
  const debugStart = source.indexOf('window.__sigilDebug = {')
  const debugBlock = source.slice(debugStart)

  assert.match(selectionRuntimeSource, /createSelectionModeContextSession/)
  assert.match(selectionRuntimeSource, /function enter\(pointer = null, reason = 'selection-mode-enter'\)/)
  assert.match(selectionRuntimeSource, /function acquire\(point = null\)/)
  assert.match(selectionRuntimeSource, /function handleInput\(msg = \{\}\)/)
  assert.match(selectionRuntimeSource, /setActiveContextProvider\(\{[\s\S]*source: 'selection_mode_debug'/)
  assert.match(contextRecordingRuntimeSource, /createContextRecording/)
  assert.match(source, /selectionMode: createDefaultSelectionModeState\(\)/)
  assert.match(source, /activeContext: createDefaultActiveContextState\(\)/)
  assert.match(source, /contextRecording: createDefaultContextRecordingState\(\)/)
  assert.match(source, /function enterSelectionMode\(pointer = null, reason = 'selection-mode-enter'\)/)
  assert.match(source, /function acquireSelectionModeCandidates\(point = null\)/)
  assert.match(source, /function handleSelectionModeInput\(msg = \{\}\)/)
  assert.match(source, /if \(handleSelectionModeInput\(msg\)\) return/)
  assert.doesNotMatch(source, /sigilUxCommandRuntime\.executeSelectionModeEnter/)
  assert.match(commandRuntimeSource, /enterSelectionMode\(pointer, payload\.context\?\.reason \|\| 'radial-reticle'\)/)
  assert.match(source, /selectionModeIsActive: \(\) => liveJs\.selectionMode\?\.active === true/)
  assert.match(source, /selectionModeOverlay: liveJs\.selectionModeOverlay \|\| buildProjectedSelectionModeOverlay/)
  assert.match(source, /function createSelectionModeContextFromDebugInput\(input = \{\}\)/)
  assert.doesNotMatch(source, deletedSelectionModeCursorPattern)
  assert.match(debugBlock, /selectionMode: liveJs\.selectionMode/)
  assert.doesNotMatch(debugBlock, deletedSelectionModeCursorPattern)
  assert.match(debugBlock, /activeContext: liveJs\.activeContext/)
  assert.match(debugBlock, /contextRecording: liveJs\.contextRecording/)
  assert.match(debugBlock, /createSelectionModeContext\(input = \{\}\) \{[\s\S]*createSelectionModeContextFromDebugInput\(input\)/)
  assert.match(debugBlock, /appendActiveContextKeyframe\(options = \{\}\)/)
  assert.match(debugBlock, /exportContextRecording\(\)/)
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
