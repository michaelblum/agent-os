import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addSurfaceInspectorComment,
  applySurfaceInspectorRevealResult,
  buildSurfaceInspectorAnnotationTreeRows,
  buildSurfaceInspectorFrameAddress,
  buildSurfaceInspectorSnapshotPayload,
  chooseSurfaceInspectorAnnotationCandidate,
  clearSurfaceInspectorAnnotationScope,
  computeSurfaceInspectorActiveEdge,
  computeSurfaceInspectorOpacityLadder,
  createSurfaceInspectorAnnotationState,
  deleteSurfaceInspectorComment,
  jumpSurfaceInspectorAnnotationScope,
  hasSurfaceInspectorAnnotations,
  pinSurfaceInspectorFrame,
  popSurfaceInspectorAnnotationScope,
  refreshSurfaceInspectorPinProjection,
  selectSurfaceInspectorAnnotationFrame,
  setSurfaceInspectorAnnotationMode,
  setSurfaceInspectorHoverCandidate,
  unpinSurfaceInspectorFrame,
  updateSurfaceInspectorComment,
} from '../../packages/toolkit/workbench/surface-inspector-annotations.js'

const node = (id, path = ['main', id]) => ({
  id,
  subject_id: id,
  subject_path: path,
  root_id: 'main',
  root_label: 'main',
  adapter_id: 'aos-canvas-window',
  projection: {
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
})

test('annotation candidate selection prefers specific visible child frames and semantic targets over roots', () => {
  const root = node('avatar-main', ['desktop-world', 'avatar-main'])
  root.projection.visible_display_rect = { x: 0, y: 0, w: 1200, h: 900 }

  const workbench = node('html-workbench-expression', ['canvas', 'html-workbench-expression'])
  workbench.projection.visible_display_rect = { x: 100, y: 120, w: 600, h: 420 }

  const semantic = {
    ...node('cta-button', ['canvas', 'html-workbench-expression', 'semantic', 'cta-button']),
    adapter_id: 'aos-toolkit-semantic-target',
  }
  semantic.projection.visible_display_rect = { x: 220, y: 240, w: 80, h: 32 }

  assert.equal(chooseSurfaceInspectorAnnotationCandidate([root], { x: 150, y: 150 }), null)
  assert.equal(chooseSurfaceInspectorAnnotationCandidate([root, workbench], { x: 150, y: 150 }).id, 'html-workbench-expression')
  assert.equal(chooseSurfaceInspectorAnnotationCandidate([root, workbench, semantic], { x: 230, y: 250 }).id, 'cta-button')
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
