import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNativeAxElementAnnotationCandidate,
  buildNativeWindowAnnotationCandidate,
  chooseAnnotationCandidate,
  normalizeAnnotationCandidate,
} from '../../packages/toolkit/workbench/annotation-candidates.js'

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

  assert.equal(chooseAnnotationCandidate([root], { x: 150, y: 150 }), null)
  assert.equal(chooseAnnotationCandidate([root, workbench], { x: 150, y: 150 }).id, 'html-workbench-expression')
  assert.equal(chooseAnnotationCandidate([root, workbench, semantic], { x: 230, y: 250 }).id, 'cta-button')
})

test('annotation candidates normalize shared adapter fields, capabilities, and source metadata', () => {
  const candidate = normalizeAnnotationCandidate({
    id: 'native-ok',
    adapter_id: 'macos-ax',
    root_id: 'window-1',
    root_label: 'Settings',
    root_kind: 'native_window',
    role: 'AXButton',
    title: 'OK',
    value: 'OK button value',
    action_names: ['AXPress'],
    state_id: 'see_123',
    confidence: 0.88,
    rect: { x: 40, y: 50, width: 80, height: 28 },
    local_space_rect: { x: 4, y: 5, width: 80, height: 28 },
    source_tree_node_metadata: { pid: 123, context_path: ['Settings', 'OK'] },
  })

  assert.equal(candidate.adapter_id, 'macos-ax')
  assert.equal(candidate.root_id, 'window-1')
  assert.equal(candidate.root_label, 'Settings')
  assert.equal(candidate.root_kind, 'native_window')
  assert.equal(candidate.subject_id, 'native-ok')
  assert.equal(candidate.subject_kind, 'AXButton')
  assert.equal(candidate.label, 'OK')
  assert.equal(candidate.display_space_rect.w, 80)
  assert.equal(candidate.local_space_rect.h, 28)
  assert.deepEqual(candidate.action_names, ['AXPress'])
  assert.deepEqual(candidate.capabilities, ['press'])
  assert.equal(candidate.state_id, 'see_123')
  assert.equal(candidate.confidence, 0.88)
  assert.deepEqual(candidate.source_metadata.context_path, ['Settings', 'OK'])
  assert.deepEqual(normalizeAnnotationCandidate(candidate), candidate)
})

test('native window payload becomes a bounded macOS AX root candidate', () => {
  assert.equal(buildNativeWindowAnnotationCandidate(null), null)

  const candidate = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'System Settings',
    pid: 1234,
    bundle_id: 'com.apple.systempreferences',
    title: 'Privacy & Security',
    bounds: { x: 40, y: 80, width: 900, height: 680 },
  }, {
    refreshed_at: '2026-05-13T00:00:00.000Z',
  })

  assert.equal(candidate.adapter_id, 'macos-ax')
  assert.equal(candidate.root_kind, 'native_window')
  assert.equal(candidate.subject_kind, 'native_window')
  assert.equal(candidate.root_label, 'Privacy & Security')
  assert.equal(candidate.projection.can_project_display_overlay, true)
  assert.equal(candidate.projection.can_reveal, false)
  assert.equal(candidate.display_space_rect.w, 900)
  assert.equal(candidate.source_metadata.reveal_blocker_reason, 'bounded_ax_reveal_unavailable')
  assert.equal(candidate.source_metadata.window_id, '918')
  assert.equal(candidate.source_metadata.pid, 1234)
  assert.equal(candidate.source_metadata.bundle_id, 'com.apple.systempreferences')
})

test('native AX element candidate is scoped to the selected native window root', () => {
  assert.equal(buildNativeAxElementAnnotationCandidate(null), null)

  const root = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'System Settings',
    pid: 1234,
    bundle_id: 'com.apple.systempreferences',
    title: 'Privacy & Security',
    bounds: { x: 40, y: 80, width: 900, height: 680 },
  })
  const ax = buildNativeAxElementAnnotationCandidate({
    role: 'AXButton',
    title: 'Allow',
    label: 'Allow',
    value: '',
    enabled: true,
    bounds: { x: 620, y: 700, width: 92, height: 32 },
    action_names: ['AXPress'],
    capabilities: ['press'],
    context_path: ['Privacy & Security', 'Allow'],
  }, {
    selected_root: root,
    window: {
      window_id: 918,
      app: 'System Settings',
      pid: 1234,
      bundle_id: 'com.apple.systempreferences',
      bounds: { x: 40, y: 80, width: 900, height: 680 },
    },
  })

  assert.equal(ax.adapter_id, 'macos-ax')
  assert.equal(ax.root_id, root.root_id)
  assert.equal(ax.subject_kind, 'AXButton')
  assert.equal(ax.label, 'Allow')
  assert.deepEqual(ax.action_names, ['AXPress'])
  assert.deepEqual(ax.capabilities, ['press'])
  assert.equal(ax.projection.can_project_display_overlay, true)
  assert.equal(ax.projection.can_reveal, false)
  assert.equal(ax.blocker_reason, '')
  assert.equal(ax.source_metadata.reveal_blocker_reason, 'bounded_ax_reveal_unavailable')
  assert.deepEqual(ax.source_metadata.context_path, ['Privacy & Security', 'Allow'])
})

test('native AX candidates reject stale or root-mismatched cursor context explicitly', () => {
  const root = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'System Settings',
    pid: 1234,
    bounds: { x: 40, y: 80, width: 900, height: 680 },
  })
  const mismatched = buildNativeAxElementAnnotationCandidate({
    role: 'AXButton',
    title: 'Send',
    bounds: { x: 20, y: 20, width: 60, height: 28 },
    action_names: ['AXPress'],
  }, {
    selected_root: root,
    window: { window_id: 999, app: 'Mail', pid: 8888, bounds: { x: 0, y: 0, width: 800, height: 600 } },
  })

  assert.equal(mismatched.projection.current_render_status, 'stale')
  assert.equal(mismatched.projection.can_project_display_overlay, false)
  assert.equal(mismatched.blocker_reason, 'native_ax_root_mismatch')

  const unbounded = buildNativeAxElementAnnotationCandidate({
    role: 'AXGroup',
    title: 'Sidebar',
    context_path: ['Privacy & Security', 'Sidebar'],
  }, {
    selected_root: root,
    window: { window_id: 918, app: 'System Settings', pid: 1234, bounds: { x: 40, y: 80, width: 900, height: 680 } },
  })

  assert.equal(unbounded.projection.current_render_status, 'unsupported')
  assert.equal(unbounded.projection.can_project_display_overlay, false)
  assert.equal(unbounded.blocker_reason, 'bounded_ax_projection_unavailable')
})

test('adapter-result-shaped annotation candidates preserve projection adapter id', () => {
  const candidate = normalizeAnnotationCandidate({
    id: 'ax-submit',
    projection: {
      adapter_id: 'macos-ax',
      root_id: 'native-window',
      subject_id: 'ax-submit',
      subject_kind: 'AXButton',
      status: 'visible',
      display_space_rect: { x: 12, y: 24, w: 90, h: 30 },
    },
  })

  assert.equal(candidate.adapter_id, 'macos-ax')
  assert.equal(candidate.root_id, 'native-window')
  assert.equal(candidate.subject_id, 'ax-submit')
  assert.equal(candidate.projection.can_project_display_overlay, true)
})

test('candidate ranking prefers actionable labeled targets over passive containers and blocked candidates', () => {
  const container = node('panel', ['main', 'window', 'panel'])
  container.subject_kind = 'container'
  container.label = ''
  container.projection.visible_display_rect = { x: 100, y: 100, w: 500, h: 300 }

  const blocked = node('blocked-button', ['main', 'window', 'blocked-button'])
  blocked.adapter_id = 'aos-toolkit-semantic-target'
  blocked.role = 'button'
  blocked.label = 'Blocked'
  blocked.capabilities = ['press']
  blocked.blocker_reason = 'stale'
  blocked.projection.visible_display_rect = { x: 140, y: 140, w: 80, h: 32 }

  const button = node('save-button', ['main', 'window', 'save-button'])
  button.adapter_id = 'aos-toolkit-semantic-target'
  button.role = 'button'
  button.label = 'Save changes'
  button.capabilities = ['press']
  button.projection.visible_display_rect = { x: 160, y: 150, w: 96, h: 32 }

  assert.equal(chooseAnnotationCandidate([container, blocked, button], { x: 170, y: 160 }).id, 'save-button')
})
