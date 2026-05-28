import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSelectionModeContextSession,
  selectionModeContextArtifact,
} from '../../packages/toolkit/workbench/selection-mode.js'

const projection = (id, rect, extra = {}) => ({
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  root_id: extra.root_id || 'display-1',
  subject_id: id,
  subject_kind: extra.subject_kind || extra.kind || 'frame',
  current_render_status: extra.status || 'visible',
  can_project_display_overlay: extra.can_project_display_overlay ?? true,
  display_space_rect: rect,
  visible_display_rect: rect,
  blocker_reason: extra.blocker_reason || '',
})

const candidate = (id, path, rect, extra = {}) => ({
  id,
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  root_id: extra.root_id || 'display-1',
  root_kind: extra.root_kind || 'display',
  root_label: extra.root_label || 'Built-in Display',
  subject_id: id,
  subject_path: path,
  subject_kind: extra.subject_kind || extra.kind || 'region',
  kind: extra.kind || extra.subject_kind || 'region',
  role: extra.role || extra.kind || '',
  label: extra.label || id,
  projection: projection(id, rect, extra),
  comments: extra.comments || [],
  source_metadata: extra.source_metadata || {},
})

const display = candidate('display-root', ['display-1'], { x: 0, y: 0, w: 1440, h: 900 }, {
  kind: 'display',
  role: 'display',
  label: 'Built-in Display',
})
const windowNode = candidate('settings-window', ['display-1', 'settings-window'], { x: 80, y: 60, w: 900, h: 660 }, {
  kind: 'window',
  role: 'AXWindow',
  label: 'Settings',
  comments: [{
    id: 'comment:window-scope',
    text: 'Use the whole window.',
    created_at: '2026-05-28T12:10:01.000Z',
    updated_at: '2026-05-28T12:10:01.000Z',
  }],
})
const group = candidate('network-section', ['display-1', 'settings-window', 'network-section'], { x: 120, y: 120, w: 760, h: 440 }, {
  kind: 'group',
  role: 'AXGroup',
  label: 'Network',
})
const toggle = candidate('wifi-toggle', ['display-1', 'settings-window', 'network-section', 'wifi-toggle'], { x: 520, y: 340, w: 44, h: 28 }, {
  kind: 'switch',
  role: 'AXCheckBox',
  label: 'Wi-Fi',
})

test('Selection Mode context session preserves clicked leaf while selecting an ancestor', () => {
  const session = createSelectionModeContextSession({
    id: 'context-session:selection-ancestor',
    updated_at: '2026-05-28T12:10:01.000Z',
    pointer: { x: 542, y: 354, coordinate_space: 'desktop_world' },
    clicked_leaf_candidate: toggle,
    path_candidates: [display, windowNode, group, toggle],
    selected_target_id: 'settings-window',
    ambiguous_candidates: [
      candidate('settings-window-alt', ['display-1', 'settings-window-alt'], { x: 82, y: 62, w: 900, h: 660 }),
    ],
    skipped_ancestors: [{ id: 'visual-wrapper', reason: 'visual_equivalent_to_child' }],
    adapter_blockers: [{ adapter_id: 'browser-dom', reason: 'not_browser_window' }],
  })

  assert.equal(session.schema, 'aos_context_session')
  assert.equal(session.entry_source, 'selection_mode')
  assert.equal(session.artifacts.length, 1)

  const artifact = session.artifacts[0]
  assert.deepEqual(
    artifact.path.map((node) => node.subject.subject.id),
    ['display-root', 'settings-window', 'network-section', 'wifi-toggle'],
  )
  assert.equal(artifact.active_target_node_id, artifact.path[1].id)
  assert.equal(artifact.acquisition.mode, 'selection_mode')
  assert.equal(artifact.acquisition.leaf_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.selected_node_id, artifact.path[1].id)
  assert.equal(artifact.acquisition.candidate_report.ambiguous_candidates[0].id, 'settings-window-alt')
  assert.equal(artifact.acquisition.candidate_report.skipped_ancestors[0].reason, 'visual_equivalent_to_child')
  assert.equal(artifact.acquisition.candidate_report.adapter_blockers[0].reason, 'not_browser_window')
  assert.equal(artifact.path[1].comments[0].text, 'Use the whole window.')
  assert.equal(artifact.anchors.find((anchor) => anchor.node_id === artifact.path[1].id).comments[0], 'comment:window-scope')
})

test('Selection Mode can select the clicked leaf and append the leaf when ancestors omit it', () => {
  const session = createSelectionModeContextSession({
    id: 'context-session:selection-leaf',
    updated_at: '2026-05-28T12:11:01.000Z',
    click_evidence: {
      event_id: 'pointer-up-42',
      pointer: { x: 542, y: 354, coordinate_space: 'desktop_world' },
    },
    clicked_leaf_candidate: toggle,
    ancestor_candidates: [display, windowNode, group],
    selected_target_id: 'wifi-toggle',
    candidate_report: { source: 'surface_hit_test_inspect' },
  })
  const artifact = session.artifacts[0]

  assert.equal(artifact.active_target_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.leaf_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.selected_node_id, artifact.path.at(-1).id)
  assert.deepEqual(
    artifact.path.map((node) => node.subject.subject.id),
    ['display-root', 'settings-window', 'network-section', 'wifi-toggle'],
  )
  assert.equal(artifact.acquisition.pointer.x, 542)
  assert.equal(artifact.acquisition.candidate_report.source, 'surface_hit_test_inspect')
})

test('selectionModeContextArtifact returns compatible context artifact shape', () => {
  const artifact = selectionModeContextArtifact({
    updated_at: '2026-05-28T12:12:01.000Z',
    pointer: { x: 542, y: 354, coordinate_space: 'desktop_world' },
    clicked_leaf_candidate: toggle,
    path_candidates: [display, windowNode, group, toggle],
    selected_target_id: 'wifi-toggle',
  })

  assert.equal(artifact.schema, 'aos_context_artifact')
  assert.equal(artifact.kind, 'selection')
  assert.equal(artifact.acquisition.mode, 'selection_mode')
  assert.equal(artifact.anchors.some((anchor) => anchor.node_id === artifact.active_target_node_id), true)
})
