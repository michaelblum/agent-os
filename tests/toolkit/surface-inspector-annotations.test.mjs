import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addSurfaceInspectorComment,
  applySurfaceInspectorRevealResult,
  buildSurfaceInspectorAnnotationSnapshotArtifact,
  buildSurfaceInspectorAnnotationTreeRows,
  buildSurfaceInspectorFrameAddress,
  buildSurfaceInspectorSnapshotPayload,
  clearSurfaceInspectorAnnotationScope,
  computeSurfaceInspectorActiveEdge,
  computeSurfaceInspectorOpacityLadder,
  createSurfaceInspectorAnnotationState,
  deleteSurfaceInspectorComment,
  jumpSurfaceInspectorAnnotationScope,
  hasSurfaceInspectorAnnotations,
  markSurfaceInspectorAnnotationProjectionsStale,
  pinSurfaceInspectorFrame,
  popSurfaceInspectorAnnotationScope,
  refreshSurfaceInspectorAnnotationProjectionsFromEvidence,
  recordSurfaceInspectorAnnotationSnapshotSuccess,
  refreshSurfaceInspectorPinProjection,
  selectSurfaceInspectorAnnotationFrame,
  setSurfaceInspectorAnnotationMode,
  setSurfaceInspectorHoverCandidate,
  surfaceInspectorAnnotationStateToSession,
  surfaceInspectorPinToAnnotationAnchor,
  unpinSurfaceInspectorFrame,
  updateSurfaceInspectorComment,
} from '../../packages/toolkit/workbench/surface-inspector-annotations.js'
import { buildAnnotationOverlayRenderPlan } from '../../packages/toolkit/workbench/annotation-overlay-renderer.js'
import { buildNativeWindowAnnotationCandidate } from '../../packages/toolkit/workbench/annotation-candidates.js'

const node = (id, path = ['main', id], extra = {}) => ({
  id,
  subject_id: id,
  subject_path: path,
  root_id: extra.root_id || 'main',
  root_label: extra.root_label || 'main',
  adapter_id: extra.adapter_id || 'aos-canvas-window',
  ...extra,
  projection: extra.projection || {
    status: 'projectable',
    projectable: true,
    visible_display_rect: { x: 10, y: 20, w: 100, h: 80 },
  },
})

test('Surface Inspector annotation state normalizes mode, capabilities, and snapshot payload', () => {
  const state = createSurfaceInspectorAnnotationState({ annotation_mode: { active: true } })
  assert.equal(state.schema, 'surface_inspector_annotation_state')
  assert.equal(state.annotation_mode.active, true)
  assert.ok(state.projection_capabilities.find((item) => item.adapter_id === 'aos-canvas-window').display_overlay)
  assert.equal(state.projection_capabilities.find((item) => item.adapter_id === 'macos-ax').status, 'unsupported')

  const snapshot = buildSurfaceInspectorSnapshotPayload(state)
  assert.equal(snapshot.schema, 'surface_inspector_annotation_state')
  assert.deepEqual(snapshot.pins, [])
})

test('Surface Inspector annotation snapshot artifact exposes stable bundle contract', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, {
    ...node('semantic-cta', ['main', 'semantic', 'cta']),
    root_kind: 'aos_canvas',
    role: 'button',
    label: 'Apply',
    text_excerpt: 'Apply now',
    source_metadata: {
      data_aos_ref: 'html-workbench-expression:apply',
    },
  }, {
    id: 'pin-semantic-cta',
    adapter_id: 'aos-toolkit-semantic-target',
    created_at: '2026-05-13T03:39:00.000Z',
    updated_at: '2026-05-13T03:39:30.000Z',
    projection: {
      status: 'visible',
      can_reveal: true,
      visible_display_rect: { x: 10, y: 20, w: 100, h: 80 },
      local_space_rect: { x: 5, y: 10, w: 100, h: 80 },
      refreshed_at: '2026-05-13T03:39:30.000Z',
    },
  })
  state = addSurfaceInspectorComment(state, 'pin-semantic-cta', 'CTA note', {
    id: 'comment-cta',
    created_at: '2026-05-13T03:40:00.000Z',
    updated_at: '2026-05-13T03:40:00.000Z',
  })

  const artifact = buildSurfaceInspectorAnnotationSnapshotArtifact(state, {
    captured_at: '2026-05-13T03:41:00.000Z',
    trigger: 'test',
    source_canvas_id: 'surface-inspector',
    surface_inspector_frame: [1020, 40, 360, 520],
    assets: { capture_image: 'capture.png' },
  })

  assert.equal(artifact.schema, 'surface_inspector_annotation_snapshot')
  assert.equal(artifact.version, '0.1.0')
  assert.equal(artifact.capture.trigger, 'test')
  assert.equal(artifact.session.schema, 'aos_annotation_session')
  assert.equal(artifact.session.entry_source, 'surface_inspector')
  assert.equal(artifact.session.root.address, 'subject:aos-toolkit-semantic-target:main:main:semantic:cta:semantic-cta')
  assert.deepEqual(artifact.session.committed_scope_stack.map((subject) => subject.address), [
    'subject:aos-toolkit-semantic-target:main:main:semantic:cta:semantic-cta',
  ])
  assert.deepEqual(artifact.session.preview_scope_stack.map((subject) => subject.address), [
    'subject:aos-toolkit-semantic-target:main:main:semantic:cta:semantic-cta',
  ])
  assert.equal(artifact.session.anchors[0].comment_text, 'CTA note')
  assert.equal(artifact.session.anchors[0].projection.current_render_status, 'visible')
  assert.equal(artifact.session.snapshot_count, 0)
  assert.equal(artifact.empty_state, false)
  assert.equal(artifact.selection.active_frame_id, 'pin-semantic-cta')
  assert.equal(artifact.active_context.current_scope_id, 'semantic-cta')
  assert.equal(artifact.pins[0].subject.id, 'semantic-cta')
  assert.equal(artifact.pins[0].projection.can_project_display_overlay, true)
  assert.equal(artifact.comments[0].text, 'CTA note')
  assert.equal(artifact.adapter_capability_summary.find((item) => item.adapter_id === 'aos-toolkit-semantic-target').can_reveal, true)
  assert.deepEqual(artifact.capture.assets, { capture_image: 'capture.png' })
})

test('Surface Inspector annotation snapshot artifact preserves preview-only hover and successful snapshot count', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('window', ['main', 'window']), { id: 'pin-window' })
  state = setSurfaceInspectorHoverCandidate(state, node('hover-child', ['main', 'window', 'hover-child']))
  state = recordSurfaceInspectorAnnotationSnapshotSuccess(state, {
    trigger: 'manual',
    bundle_path: '/tmp/aos-bundle',
    captured_at: '2026-05-13T03:50:00.000Z',
  })

  const artifact = buildSurfaceInspectorAnnotationSnapshotArtifact(state, {
    captured_at: '2026-05-13T03:51:00.000Z',
  })

  assert.equal(artifact.session.snapshot_count, 1)
  assert.equal(artifact.source_state.snapshot_count, 1)
  assert.equal(artifact.session.hover_candidate.subject.id, 'hover-child')
  assert.deepEqual(artifact.session.preview_scope_stack.map((subject) => subject.subject.id), ['window', 'hover-child'])
  assert.deepEqual(artifact.session.anchors.map((anchor) => anchor.subject.subject.id), ['window'])
})

test('Surface Inspector annotation snapshot artifact records stale evidence without live display rect truth', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('target'), { id: 'pin-target' })
  state = markSurfaceInspectorAnnotationProjectionsStale(state, 'display_geometry_changed', {
    now: '2026-05-13T04:00:00.000Z',
  })

  const artifact = buildSurfaceInspectorAnnotationSnapshotArtifact(state)
  assert.equal(artifact.session.anchors[0].status, 'stale')
  assert.equal(artifact.session.anchors[0].projection.current_render_status, 'stale')
  assert.equal(artifact.session.anchors[0].projection.display_space_rect, null)
  assert.equal(artifact.blockers.unsupported_stale_absent[0].blocker_reason, 'display_geometry_changed')
})

test('Surface Inspector pin records can become neutral session anchors', () => {
  const anchor = surfaceInspectorPinToAnnotationAnchor({
    id: 'pin-save',
    root_id: 'display:1',
    root_label: 'Built-in Display',
    root_kind: 'display',
    adapter_id: 'aos-canvas-window',
    subject_id: 'save',
    subject_path: ['display:1', 'window', 'save'],
    source_tree_node_metadata: { source: 'surface-inspector' },
    projection: {
      current_render_status: 'visible',
      visible_display_rect: { x: 1, y: 2, w: 3, h: 4 },
    },
    created_at: '2026-05-13T00:00:00.000Z',
  })

  assert.equal(anchor.id, 'anchor:pin-save')
  assert.equal(anchor.address, 'subject:aos-canvas-window:display:1:display:1:window:save:save')
  assert.equal(anchor.comment_text, '')
  assert.equal(anchor.status, 'live')
  assert.equal(anchor.subject.source_metadata.source, 'surface-inspector')
})

test('Surface Inspector compatibility adapter maps pins comments and hover into a session', () => {
  let state = createSurfaceInspectorAnnotationState()
  state = setSurfaceInspectorAnnotationMode(state, true, { confirmed: true })
  state = pinSurfaceInspectorFrame(state, node('canvas-a', ['canvas-a'], {
    adapter_id: 'aos-canvas-window',
    root_id: 'main',
    source_metadata: { id: 'canvas-a' },
  }), {
    id: 'pin-canvas-a',
  })
  state = addSurfaceInspectorComment(state, 'pin-canvas-a', 'Keep this frame visible', {
    id: 'comment-1',
  })
  state = setSurfaceInspectorHoverCandidate(state, node('child', ['canvas-a', 'child']))

  const session = surfaceInspectorAnnotationStateToSession(state, {
    updated_at: '2026-05-13T00:00:00.000Z',
  })
  const plan = buildAnnotationOverlayRenderPlan(session)
  const commentGroup = plan.groups.find((item) => item.target.id === 'canvas-a')
  const hoverGroup = plan.groups.find((item) => item.hover_candidate)

  assert.equal(session.entry_source, 'surface_inspector')
  assert.equal(session.anchors.length, 1)
  assert.equal(session.anchors[0].comment_text, 'Keep this frame visible')
  assert.equal(session.hover_candidate.subject.id, 'child')
  assert.ok(commentGroup)
  assert.equal(commentGroup.comment_chips.length, 1)
  assert.ok(hoverGroup)
  assert.equal(hoverGroup.hover_candidate.layer, 'hover')
})

test('Surface Inspector annotation snapshot artifact keeps empty state explicit and rejects embedded images', () => {
  const artifact = buildSurfaceInspectorAnnotationSnapshotArtifact(createSurfaceInspectorAnnotationState(), {
    captured_at: '2026-05-13T03:41:00.000Z',
    trigger: 'empty-test',
  })
  assert.equal(artifact.empty_state, true)
  assert.deepEqual(artifact.pins, [])
  assert.deepEqual(artifact.comments, [])

  assert.throws(() => buildSurfaceInspectorAnnotationSnapshotArtifact(createSurfaceInspectorAnnotationState(), {
    assets: { image_data: 'data:image/png;base64,abc' },
  }), /external assets/)

  assert.throws(() => buildSurfaceInspectorAnnotationSnapshotArtifact(createSurfaceInspectorAnnotationState(), {
    assets: { capture_image: 'data:image/png;base64,abc' },
  }), /external assets/)
})

test('Surface Inspector annotation snapshot artifact accepts long base64-like user text', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('target'), { id: 'pin-target' })
  state = addSurfaceInspectorComment(state, 'pin-target', 'A'.repeat(121), { id: 'comment-long' })

  const artifact = buildSurfaceInspectorAnnotationSnapshotArtifact(state)
  assert.equal(artifact.comments[0].text, 'A'.repeat(121))
})

test('annotation mode entry clears stale or implicit root hover candidates', () => {
  const stale = createSurfaceInspectorAnnotationState({
    annotation_mode: { active: false },
    last_hover_candidate: node('avatar-main', ['desktop-world', 'avatar-main']),
  })

  const active = setSurfaceInspectorAnnotationMode(stale, true)
  assert.equal(active.annotation_mode.active, true)
  assert.equal(active.last_hover_candidate, null)

  const implicit = setSurfaceInspectorHoverCandidate(active, node('avatar-main', ['desktop-world', 'avatar-main']))
  assert.equal(implicit.last_hover_candidate, null)

  const stage = setSurfaceInspectorHoverCandidate(active, node('aos-desktop-world-stage', ['desktop-world', 'stage']))
  assert.equal(stage.last_hover_candidate, null)
})

test('pinning a native window root preserves root kind for scoped native AX candidates', () => {
  const root = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'System Settings',
    pid: 1234,
    bundle_id: 'com.apple.systempreferences',
    title: 'Privacy & Security',
    bounds: { x: 40, y: 80, width: 900, height: 680 },
  })
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, root, { id: 'pin-native-root' })

  assert.equal(state.pins[0].adapter_id, 'macos-ax')
  assert.equal(state.pins[0].root_kind, 'native_window')
  assert.equal(state.pins[0].source_tree_node_metadata.root_kind, 'native_window')
  assert.equal(state.annotation_scope_stack.at(-1).adapter_id, 'macos-ax')
  assert.equal(state.annotation_scope_stack.at(-1).root_kind, 'native_window')

})

test('browser-class adapter capability keeps live page DOM/CDP deferred explicitly', () => {
  const state = createSurfaceInspectorAnnotationState()
  const chrome = state.projection_capabilities.find((item) => item.adapter_id === 'chrome-seam')
  assert.equal(chrome.status, 'unsupported')
  assert.equal(chrome.display_overlay, false)
  assert.equal(chrome.can_reveal, false)
  assert.equal(chrome.blocker_reason, 'browser_dom_cdp_deferred')
})

test('pin creation, comment creation, edit, delete, and snapshot version are data operations', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('canvas-a'), { created_at: '2026-05-10T00:00:00.000Z' })
  assert.equal(state.pins.length, 1)
  assert.equal(state.pins[0].kind, 'frame_pin')
  assert.equal(state.active_frame_id, state.pins[0].id)
  assert.equal(hasSurfaceInspectorAnnotations(state), true)

  state = addSurfaceInspectorComment(state, state.active_frame_id, 'Check this label', { id: 'comment-1' })
  assert.equal(state.comments.length, 1)
  assert.equal(state.comments[0].kind, 'comment')
  assert.equal(state.comments[0].status, 'open')

  state = updateSurfaceInspectorComment(state, 'comment-1', 'Updated label')
  assert.equal(state.comments[0].text, 'Updated label')

  state = deleteSurfaceInspectorComment(state, 'comment-1')
  assert.equal(state.comments[0].status, 'removed')
  assert.ok(state.snapshot_version >= 5)
})

test('annotation scope stack pushes pins, pops with Back, jumps breadcrumbs, and clears on mode off', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('window', ['main', 'window']), { id: 'pin-window' })
  state = pinSurfaceInspectorFrame(state, node('panel', ['main', 'window', 'panel']), { id: 'pin-panel' })

  assert.deepEqual(state.annotation_scope_stack.map((frame) => frame.subject_id), ['window', 'panel'])
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).current_scope_id, 'panel')

  state = popSurfaceInspectorAnnotationScope(state)
  assert.deepEqual(state.annotation_scope_stack.map((frame) => frame.subject_id), ['window'])
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).current_scope_id, 'window')

  state = jumpSurfaceInspectorAnnotationScope(state, '')
  assert.deepEqual(state.annotation_scope_stack, [])
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).current_scope_id, 'root')

  state = jumpSurfaceInspectorAnnotationScope(state, 'pin-panel')
  assert.deepEqual(state.annotation_scope_stack.map((frame) => frame.subject_id), ['window', 'panel'])

  state = clearSurfaceInspectorAnnotationScope(state)
  assert.deepEqual(state.annotation_scope_stack, [])

  state = setSurfaceInspectorAnnotationMode(state, false, { confirmed: true })
  assert.deepEqual(state.annotation_scope_stack, [])
})

test('destructive clear confirmation preserves annotations until confirmed', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('canvas-a'))
  const pending = setSurfaceInspectorAnnotationMode(state, false)

  assert.equal(pending.annotation_mode.active, true)
  assert.equal(pending.pins.length, 1)
  assert.equal(pending.clear_confirmation.reason, 'annotation_mode_off')

  const cleared = setSurfaceInspectorAnnotationMode(pending, false, { confirmed: true })
  assert.equal(cleared.annotation_mode.active, false)
  assert.equal(cleared.pins.length, 0)
  assert.equal(cleared.comments.length, 0)
})

test('active edge selection computes frame path and opacity ladder', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('root', ['main', 'root']), { id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('child', ['main', 'root', 'child']), { id: 'pin-child', parent_pin_id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('leaf', ['main', 'root', 'child', 'leaf']), { id: 'pin-leaf', parent_pin_id: 'pin-child' })
  state = addSurfaceInspectorComment(state, 'pin-leaf', 'Leaf note', { id: 'comment-leaf' })

  assert.deepEqual(computeSurfaceInspectorOpacityLadder(3), [1, 0.625, 0.25])
  const edge = computeSurfaceInspectorActiveEdge(state)
  assert.equal(edge.edge_id, 'edge:pin-leaf')
  assert.deepEqual(edge.frame_path.map((pin) => pin.id), ['pin-root', 'pin-child', 'pin-leaf'])
  assert.deepEqual(edge.frame_path.map((pin) => pin.opacity), [1, 0.625, 0.25])
  assert.deepEqual(edge.comments.map((comment) => comment.id), ['comment-leaf'])
})

test('unpin/prune requires confirmation when descendants or comments exist', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('root'), { id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('child'), { id: 'pin-child', parent_pin_id: 'pin-root' })
  state = addSurfaceInspectorComment(state, 'pin-child', 'Child note', { id: 'comment-child' })

  const pending = unpinSurfaceInspectorFrame(state, 'pin-root')
  assert.equal(pending.clear_confirmation.reason, 'unpin_descendants')
  assert.equal(pending.pins.filter((pin) => pin.status !== 'removed').length, 2)

  const pruned = unpinSurfaceInspectorFrame(pending, 'pin-root', { confirmed: true })
  assert.equal(pruned.pins.every((pin) => pin.status === 'removed'), true)
  assert.equal(pruned.comments[0].status, 'removed')
})

test('annotation tree emits rows only for frame anchors and comment leaves', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('a', ['main', 'a']), { id: 'pin-a' })
  state = addSurfaceInspectorComment(state, 'pin-a', 'A note', { id: 'comment-a' })
  state = pinSurfaceInspectorFrame(state, node('b', ['main', 'a', 'b']), { id: 'pin-b', parent_pin_id: 'pin-a' })
  state = {
    ...state,
    last_hover_candidate: node('hover-only', ['main', 'hover-only']),
  }

  const rows = buildSurfaceInspectorAnnotationTreeRows(state)
  assert.deepEqual(rows.map((row) => row.type), ['pin', 'comment', 'pin'])
  assert.equal(rows[0].frame_address.full, 'main / a')
  assert.equal(rows[1].comment.text, 'A note')
  assert.equal(rows.some((row) => row.id.includes('hover-only')), false)
})

test('consecutive empty frame anchors collapse into one compact frame address row', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('root', ['main', 'display', 'window']), { id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('canvas', ['main', 'display', 'window', 'canvas']), { id: 'pin-canvas', parent_pin_id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('button', ['main', 'display', 'window', 'canvas', 'button']), { id: 'pin-button', parent_pin_id: 'pin-canvas' })

  const rows = buildSurfaceInspectorAnnotationTreeRows(state)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].collapsed_pin_ids, ['pin-root', 'pin-canvas', 'pin-button'])
  assert.equal(rows[0].frame_address.full, 'main / display / window / canvas / button')
  assert.equal(rows[0].label, 'main / 5 fragments')
})

test('comment leaves preserve local hierarchy between collapsed frame anchors', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('canvas', ['main', 'display', 'window', 'canvas']), { id: 'pin-canvas' })
  state = addSurfaceInspectorComment(state, 'pin-canvas', 'Needs review', { id: 'comment-canvas' })
  state = pinSurfaceInspectorFrame(state, node('button', ['main', 'display', 'window', 'canvas', 'panel', 'button']), { id: 'pin-button', parent_pin_id: 'pin-canvas' })

  const rows = buildSurfaceInspectorAnnotationTreeRows(state)
  assert.deepEqual(rows.map((row) => row.type), ['pin', 'comment', 'pin'])
  assert.equal(rows[0].id, 'pin-canvas')
  assert.equal(rows[2].id, 'pin-button')
  assert.equal(rows[2].depth, 1)
})

test('frame address display compacts long addresses and preserves full copy text', () => {
  const address = buildSurfaceInspectorFrameAddress({
    root_label: 'main',
    subject_path: ['main', 'display', 'window', 'canvas', 'panel', 'button'],
  })

  assert.equal(address.compact, 'main / 6 fragments')
  assert.equal(address.full, 'main / display / window / canvas / panel / button')
  assert.equal(address.fragment_count, 6)
})

test('projection state keeps offscreen annotations reachable through tree rows and snapshots', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('semantic-cta', ['main', 'semantic', 'cta']), {
    id: 'pin-semantic-cta',
    adapter_id: 'aos-toolkit-semantic-target',
    projection: {
      status: 'offscreen_scrollable',
      can_reveal: true,
      local_space_rect: { x: 40, y: 1400, w: 120, h: 30 },
      scrollable_ancestor_chain: [{ id: 'scroll-region', kind: 'div' }],
      blocker_reason: 'target_below_viewport',
    },
  })
  state = addSurfaceInspectorComment(state, 'pin-semantic-cta', 'CTA note', { id: 'comment-cta' })

  const rows = buildSurfaceInspectorAnnotationTreeRows(state)
  assert.equal(rows[0].projection_state, 'offscreen_scrollable')
  assert.equal(rows[0].can_reveal, true)
  assert.equal(rows[0].blocker_text, 'target_below_viewport')
  assert.equal(rows[1].projection_state, 'offscreen_scrollable')

  const snapshot = buildSurfaceInspectorSnapshotPayload(state)
  assert.equal(snapshot.pin_projection_results[0].projection.current_render_status, 'offscreen_scrollable')
  assert.equal(snapshot.comment_projection_status[0].projection_status, 'offscreen_scrollable')
  assert.equal(snapshot.adapter_capability_summary.find((item) => item.adapter_id === 'aos-toolkit-semantic-target').can_reveal, true)
})

test('selection refreshes active edge without implicit reveal and reveal result updates projection explicitly', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('root'), { id: 'pin-root' })
  state = pinSurfaceInspectorFrame(state, node('child'), {
    id: 'pin-child',
    parent_pin_id: 'pin-root',
    projection: { status: 'hidden', can_reveal: true, blocker_reason: 'collapsed_section' },
  })

  state = selectSurfaceInspectorAnnotationFrame(state, 'pin-child')
  assert.equal(state.active_frame_id, 'pin-child')
  assert.equal(state.last_reveal_result, null)
  assert.equal(state.last_projection_blocker.reason, 'collapsed_section')

  state = applySurfaceInspectorRevealResult(state, 'pin-child', {
    status: 'revealed',
    requested_at: '2026-05-10T00:00:00.000Z',
    completed_at: '2026-05-10T00:00:01.000Z',
    projection: {
      status: 'visible',
      can_reveal: true,
      visible_display_rect: { x: 10, y: 20, w: 50, h: 20 },
    },
  })
  assert.equal(state.last_reveal_result.status, 'revealed')
  assert.equal(state.pins.find((pin) => pin.id === 'pin-child').projection.current_render_status, 'visible')
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).last_reveal_result.status, 'revealed')
})

test('stale and absent roots clear display projection and surface blocker evidence', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('removed-canvas'), { id: 'pin-removed' })
  state = refreshSurfaceInspectorPinProjection(state, 'pin-removed', {
    status: 'absent',
    can_reveal: false,
    blocker_reason: 'root_canvas_removed',
  })

  const pin = state.pins.find((item) => item.id === 'pin-removed')
  assert.equal(pin.projection.can_project_display_overlay, false)
  assert.equal(pin.projection.visible_display_rect, null)
  const snapshot = buildSurfaceInspectorSnapshotPayload(state)
  assert.deepEqual(snapshot.unsupported_stale_absent_blockers, [
    { pin_id: 'pin-removed', status: 'absent', blocker_reason: 'root_canvas_removed' },
  ])
})

test('settled reprojection marks anchors stale then refreshes from bounded evidence', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('workbench', ['main', 'workbench'], {
    projection: {
      status: 'visible',
      projectable: true,
      can_project_display_overlay: true,
      visible_display_rect: { x: 10, y: 20, w: 100, h: 60 },
      display_space_rect: { x: 10, y: 20, w: 100, h: 60 },
    },
  }), { id: 'pin-workbench' })
  state = setSurfaceInspectorHoverCandidate(state, node('button', ['main', 'workbench', 'button']))

  state = markSurfaceInspectorAnnotationProjectionsStale(state, 'display_geometry_changed', {
    pending_settle_reason: 'display_geometry_settled',
    now: '2026-05-14T00:00:00.000Z',
  })

  const stalePin = state.pins.find((pin) => pin.id === 'pin-workbench')
  assert.equal(stalePin.projection.current_render_status, 'stale')
  assert.equal(stalePin.projection.can_project_display_overlay, false)
  assert.equal(stalePin.projection.display_space_rect, null)
  assert.equal(state.last_hover_candidate.projection.current_render_status, 'stale')
  assert.equal(state.projection_refresh.pending_settle_reason, 'display_geometry_settled')
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).projection_refresh.stale_reason, 'display_geometry_changed')

  state = refreshSurfaceInspectorAnnotationProjectionsFromEvidence(state, [
    node('workbench', ['main', 'workbench'], {
      projection: {
        status: 'visible',
        projectable: true,
        can_project_display_overlay: true,
        visible_display_rect: { x: 30, y: 40, w: 120, h: 70 },
        display_space_rect: { x: 30, y: 40, w: 120, h: 70 },
        refreshed_at: '2026-05-14T00:00:01.000Z',
      },
    }),
    node('button', ['main', 'workbench', 'button'], {
      projection: {
        status: 'visible',
        projectable: true,
        can_project_display_overlay: true,
        visible_display_rect: { x: 50, y: 60, w: 40, h: 20 },
        display_space_rect: { x: 50, y: 60, w: 40, h: 20 },
      },
    }),
  ], {
    reason: 'display_geometry_settled',
    now: '2026-05-14T00:00:01.000Z',
  })

  const refreshedPin = state.pins.find((pin) => pin.id === 'pin-workbench')
  assert.equal(refreshedPin.projection.current_render_status, 'visible')
  assert.equal(refreshedPin.projection.display_space_rect.x, 30)
  assert.equal(state.last_hover_candidate.projection.current_render_status, 'visible')
  assert.equal(state.projection_refresh.pending_settle_reason, '')
  assert.deepEqual(state.projection_refresh.last_result.refreshed_pin_ids, ['pin-workbench'])
})

test('settled reprojection keeps identity and reports a concrete missing-source blocker', () => {
  let state = setSurfaceInspectorAnnotationMode(createSurfaceInspectorAnnotationState(), true)
  state = pinSurfaceInspectorFrame(state, node('gone', ['main', 'gone']), { id: 'pin-gone' })
  state = markSurfaceInspectorAnnotationProjectionsStale(state, 'semantic_targets_refresh_pending')
  state = refreshSurfaceInspectorAnnotationProjectionsFromEvidence(state, [], {
    reason: 'semantic_targets_refreshed',
    now: '2026-05-14T00:00:02.000Z',
  })

  const pin = state.pins.find((item) => item.id === 'pin-gone')
  assert.equal(pin.id, 'pin-gone')
  assert.deepEqual(pin.subject_path, ['main', 'gone'])
  assert.equal(pin.projection.current_render_status, 'blocked')
  assert.equal(pin.projection.can_project_display_overlay, false)
  assert.equal(pin.projection.blocker_reason, 'projection_refresh_source_missing')
  assert.deepEqual(state.projection_refresh.last_result.missing_pin_ids, ['pin-gone'])
  assert.equal(buildSurfaceInspectorSnapshotPayload(state).unsupported_stale_absent_blockers[0].blocker_reason, 'projection_refresh_source_missing')
})
