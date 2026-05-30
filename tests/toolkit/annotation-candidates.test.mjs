import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBrowserTabAnnotationCandidate,
  buildNativeAxElementAnnotationCandidate,
  buildNativeWindowAnnotationCandidate,
  chooseAnnotationCandidateForScope,
  chooseAnnotationCandidate,
  explainAnnotationCandidateChoice,
  filterAnnotationCandidatesForScope,
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
    settable_attributes: [],
    ancestor_chain: [
      { role: 'AXWindow', title: 'Privacy & Security' },
      { role: 'AXButton', title: 'Allow', label: 'Allow' },
    ],
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
  assert.equal(ax.source_metadata.ancestor_chain[1].role, 'AXButton')
})

test('native browser tab candidate labels by compact URL site and rejects pane-sized content rects', () => {
  const tab = buildBrowserTabAnnotationCandidate({
    window_id: 111,
    app: 'Comet',
    pid: 87924,
    bundle_id: 'ai.perplexity.comet',
    bounds: { x: 0, y: 44, width: 1512, height: 938 },
    browser_context: {
      browser_app: true,
      pointer: { x: 1000, y: 320 },
      text_candidates: [
        { value: 'https://notebooklm.google.com/notebook/example', source_attribute: 'AXURL', role: 'AXWebArea' },
        { value: 'OpenAI Agent Builder Complete Course', source_attribute: 'AXTitle', role: 'AXButton', selected: true },
      ],
      web_area_bounds: [
        { bounds: { x: 1378, y: 206, width: 586, height: 1069 }, title: 'Studio pane' },
        { bounds: { x: 0, y: 158, width: 1512, height: 824 }, title: 'NotebookLM page' },
      ],
      window_bounds: { x: 0, y: 44, width: 1512, height: 938 },
    },
  })

  assert.equal(tab.adapter_id, 'browser-content-seam')
  assert.equal(tab.role, 'browser_tab')
  assert.equal(tab.label, 'notebooklm')
  assert.equal(tab.title, 'OpenAI Agent Builder Complete Course')
  assert.equal(tab.source_metadata.browser_site_label, 'notebooklm')
  assert.equal(tab.source_metadata.active_url, 'https://notebooklm.google.com/notebook/example')
  assert.deepEqual(tab.display_space_rect, { x: 0, y: 158, w: 1512, h: 824 })
  assert.deepEqual(tab.source_metadata.browser_context.selected_content_bounds_candidate.bounds, { x: 0, y: 158, w: 1512, h: 824 })
  assert.equal(tab.source_metadata.browser_context.url_candidates[0].source_attribute, 'AXURL')
})

test('native AX element candidate labels derive from raw ancestor chain before generic AX role', () => {
  const root = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'System Settings',
    pid: 1234,
    bounds: { x: 40, y: 80, width: 900, height: 680 },
  })
  const ax = buildNativeAxElementAnnotationCandidate({
    role: 'AXGroup',
    title: '',
    label: 'AXGroup',
    value: '',
    bounds: { x: 100, y: 120, width: 300, height: 200 },
    ancestor_chain: [
      { role: 'AXWindow', title: 'Privacy & Security' },
      { role: 'AXGroup', title: '', label: 'AXGroup' },
      { role: 'AXGroup', title: 'Camera' },
    ],
  }, {
    selected_root: root,
    window: { window_id: 918, app: 'System Settings', pid: 1234, bounds: { x: 40, y: 80, width: 900, height: 680 } },
  })

  assert.equal(ax.label, 'Camera')
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
    ancestor_chain: [
      { role: 'AXWindow', title: 'Privacy & Security' },
      { role: 'AXGroup', title: 'Sidebar' },
    ],
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

test('scoped annotation candidate selection rejects outside siblings and prefers direct children', () => {
  const windowScope = node('native-window:1:Browser', ['native_window', 'native-window:1:Browser'], {
    adapter_id: 'macos-ax',
    root_id: 'native-window:1:Browser',
    root_kind: 'native_window',
    subject_kind: 'native_window',
  })
  windowScope.projection.visible_display_rect = { x: 100, y: 100, w: 500, h: 400 }

  const child = node('ax-child', ['native_window', 'native-window:1:Browser', 'ax_element', 'ax-child'], {
    adapter_id: 'macos-ax',
    root_id: 'native-window:1:Browser',
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Inside',
    capabilities: ['press'],
  })
  child.projection.visible_display_rect = { x: 180, y: 180, w: 90, h: 32 }

  const outside = node('other-window-button', ['native_window', 'native-window:2:Other', 'ax_element', 'other-window-button'], {
    adapter_id: 'macos-ax',
    root_id: 'native-window:2:Other',
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Outside but smaller',
    capabilities: ['press'],
  })
  outside.projection.visible_display_rect = { x: 190, y: 190, w: 20, h: 20 }

  const scoped = filterAnnotationCandidatesForScope([windowScope, outside, child], windowScope, { x: 195, y: 195 }, { include_rejections: true })
  assert.deepEqual(scoped.candidates.map((candidate) => candidate.id), ['ax-child'])
  assert.equal(scoped.rejected.some((entry) => entry.id === 'other-window-button' && entry.reason === 'native_ax_root_mismatch'), true)
  assert.equal(chooseAnnotationCandidateForScope([windowScope, outside, child], windowScope, { x: 195, y: 195 }).id, 'ax-child')
})

test('native browser window scope accepts DOM candidates with matching window and content evidence', () => {
  const windowScope = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'Google Chrome',
    pid: 1234,
    bundle_id: 'com.google.Chrome',
    title: 'Example',
    bounds: { x: 100, y: 100, width: 900, height: 700 },
  })

  const dom = node('dom-save', ['browser_page', 'browser-page:https://example.test', 'element', 'dom-save'], {
    adapter_id: 'aos-browser-dom-element-picker',
    root_id: 'browser-page:https://example.test',
    root_kind: 'browser_page',
    subject_kind: 'button',
    label: 'Save',
    capabilities: ['press'],
    source_metadata: {
      browser_session_id: 'chrome-local',
      browser_window_id: '918',
      browser_pid: 1234,
      source_url: 'https://example.test/',
      browser_content_rect: { x: 112, y: 156, w: 860, h: 600 },
    },
  })
  dom.projection.visible_display_rect = { x: 180, y: 200, w: 80, h: 32 }
  dom.projection.source_tree_node_metadata = {
    browser_content_rect: { x: 112, y: 156, w: 860, h: 600 },
  }

  const scoped = filterAnnotationCandidatesForScope([windowScope, dom], windowScope, { x: 190, y: 210 }, { include_rejections: true })
  assert.deepEqual(scoped.candidates.map((candidate) => candidate.id), ['dom-save'])
  assert.equal(scoped.candidates[0].source_metadata.scope_filter_reason, 'scoped_native_browser_dom_child')
  assert.equal(scoped.rejected.some((entry) => entry.id === 'dom-save'), false)
})

test('native browser window scope blocks DOM candidates with mismatched or missing browser evidence', () => {
  const windowScope = buildNativeWindowAnnotationCandidate({
    window_id: 918,
    app: 'Google Chrome',
    pid: 1234,
    bounds: { x: 100, y: 100, width: 900, height: 700 },
  })

  const mismatched = node('foreign-dom', ['browser_page', 'foreign', 'element', 'foreign-dom'], {
    adapter_id: 'aos-browser-dom-element-picker',
    root_id: 'browser-page:https://foreign.test',
    root_kind: 'browser_page',
    subject_kind: 'button',
    label: 'Foreign',
    source_metadata: {
      browser_session_id: 'chrome-foreign',
      browser_window_id: '777',
      source_url: 'https://foreign.test/',
      browser_content_rect: { x: 112, y: 156, w: 860, h: 600 },
    },
  })
  mismatched.projection.visible_display_rect = { x: 180, y: 200, w: 80, h: 32 }

  const missingContent = node('unresolved-dom', ['browser_page', 'local', 'element', 'unresolved-dom'], {
    adapter_id: 'aos-browser-dom-element-picker',
    root_id: 'browser-page:https://example.test',
    root_kind: 'browser_page',
    subject_kind: 'button',
    label: 'Unresolved',
    source_metadata: {
      browser_session_id: 'chrome-local',
      browser_window_id: '918',
      source_url: 'https://example.test/',
    },
  })
  missingContent.projection.visible_display_rect = { x: 190, y: 220, w: 80, h: 32 }

  const scoped = filterAnnotationCandidatesForScope([mismatched, missingContent], windowScope, { x: 195, y: 225 }, { include_rejections: true })
  assert.deepEqual(scoped.candidates, [])
  assert.equal(scoped.rejected.some((entry) => entry.id === 'foreign-dom' && entry.reason === 'native_ax_root_mismatch'), true)
  assert.equal(scoped.rejected.some((entry) => entry.id === 'unresolved-dom' && entry.reason === 'browser_content_inset_unresolved'), true)
})

test('semantic scope selection allows visually distinct scoped descendants', () => {
  const scope = node('section', ['canvas', 'doc', 'semantic', 'section'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'section',
  })
  scope.projection.visible_display_rect = { x: 0, y: 0, w: 400, h: 400 }

  const direct = node('row', ['canvas', 'doc', 'semantic', 'section', 'row'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'row',
  })
  direct.projection.visible_display_rect = { x: 20, y: 20, w: 300, h: 80 }

  const grandchild = node('button', ['canvas', 'doc', 'semantic', 'section', 'row', 'button'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'button',
    capabilities: ['press'],
  })
  grandchild.projection.visible_display_rect = { x: 40, y: 30, w: 80, h: 32 }

  const scoped = filterAnnotationCandidatesForScope([grandchild, direct], scope, { x: 50, y: 40 }, { include_rejections: true })
  assert.deepEqual(scoped.candidates.map((candidate) => candidate.id), ['button', 'row'])
  assert.equal(chooseAnnotationCandidateForScope([grandchild, direct], scope, { x: 50, y: 40 }).id, 'button')
})

test('native extended-display scope explains child panel selection over active window and siblings', () => {
  const windowScope = buildNativeWindowAnnotationCandidate({
    window_id: 51,
    app: 'Visual Studio Code',
    pid: 4242,
    bundle_id: 'com.microsoft.VSCode',
    title: 'agent-os',
    bounds: { x: 1920, y: 0, width: 1440, height: 900 },
  })

  const panel = node('vscode-panel', ['native_window', windowScope.root_id, 'ax_element', 'vscode-panel'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXGroup',
    role: 'AXGroup',
    label: 'Explorer',
  })
  panel.projection.visible_display_rect = { x: 1980, y: 80, w: 340, h: 760 }

  const sibling = node('other-panel', ['native_window', 'native-window:99:Other', 'ax_element', 'other-panel'], {
    adapter_id: 'macos-ax',
    root_id: 'native-window:99:Other',
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Other',
    capabilities: ['press'],
  })
  sibling.projection.visible_display_rect = { x: 2000, y: 120, w: 40, h: 40 }

  const report = explainAnnotationCandidateChoice([windowScope, sibling, panel], windowScope, { x: 2010, y: 130 })
  assert.equal(report.selected.id, 'vscode-panel')
  assert.equal(report.raw_candidate_count, 3)
  assert.equal(report.scoped_candidate_count, 1)
  assert.equal(report.rejected.some((entry) => entry.id === windowScope.id && entry.reason === 'candidate_is_active_scope'), true)
  assert.equal(report.rejected.some((entry) => entry.id === 'other-panel' && entry.reason === 'native_ax_root_mismatch'), true)
  assert.equal(chooseAnnotationCandidateForScope([windowScope, sibling, panel], windowScope, { x: 2010, y: 130 }).id, 'vscode-panel')
})

test('native extended-display scope allows visually distinct descendant controls', () => {
  const windowScope = buildNativeWindowAnnotationCandidate({
    window_id: 51,
    app: 'Visual Studio Code',
    pid: 4242,
    bounds: { x: 1920, y: 0, width: 1440, height: 900 },
  })

  const baseProjection = {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    status: 'visible',
    current_render_status: 'visible',
    projectable: true,
    can_project_display_overlay: true,
    coordinate_space: 'desktop_world',
  }
  const panel = node('panel', ['native_window', windowScope.root_id, 'ax_element', 'panel'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXGroup',
    role: 'AXGroup',
    label: 'Explorer',
    projection: {
      ...baseProjection,
      subject_id: 'panel',
      subject_kind: 'AXGroup',
      visible_display_rect: { x: 1980, y: 80, w: 340, h: 760 },
      display_space_rect: { x: 1980, y: 80, w: 340, h: 760 },
    },
  })
  const button = node('button', ['native_window', windowScope.root_id, 'ax_element', 'panel', 'button'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'New File',
    capabilities: ['press'],
    projection: {
      ...baseProjection,
      subject_id: 'button',
      subject_kind: 'AXButton',
      visible_display_rect: { x: 2000, y: 120, w: 80, h: 28 },
      display_space_rect: { x: 2000, y: 120, w: 80, h: 28 },
    },
  })

  const report = explainAnnotationCandidateChoice([windowScope, panel, button], windowScope, { x: 2010, y: 130 })
  assert.equal(report.selected.id, 'button')
  assert.equal(report.rejected.some((entry) => entry.id === windowScope.id && entry.reason === 'candidate_is_active_scope'), true)
  assert.equal(chooseAnnotationCandidateForScope([windowScope, panel, button], windowScope, { x: 2010, y: 130 }).id, 'button')
})

test('native AX active element scope rejects overlapping non-descendant subject paths', () => {
  const windowScope = buildNativeWindowAnnotationCandidate({
    window_id: 51,
    app: 'Visual Studio Code',
    pid: 4242,
    bounds: { x: 0, y: 0, width: 1000, height: 800 },
  })
  const baseProjection = {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    status: 'visible',
    current_render_status: 'visible',
    projectable: true,
    can_project_display_overlay: true,
    coordinate_space: 'desktop_world',
  }
  const panel = node('panel', ['native_window', windowScope.root_id, 'ax_element', 'panel'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXGroup',
    role: 'AXGroup',
    label: 'Explorer',
    projection: {
      ...baseProjection,
      subject_id: 'panel',
      subject_kind: 'AXGroup',
      visible_display_rect: { x: 100, y: 100, w: 500, h: 500 },
      display_space_rect: { x: 100, y: 100, w: 500, h: 500 },
    },
  })
  const child = node('child', ['native_window', windowScope.root_id, 'ax_element', 'panel', 'child'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Child',
    capabilities: ['press'],
    projection: {
      ...baseProjection,
      subject_id: 'child',
      subject_kind: 'AXButton',
      visible_display_rect: { x: 120, y: 120, w: 80, h: 32 },
      display_space_rect: { x: 120, y: 120, w: 80, h: 32 },
    },
  })
  const overlappingNonDescendant = node('other-child', ['native_window', windowScope.root_id, 'ax_element', 'other-panel', 'other-child'], {
    adapter_id: 'macos-ax',
    root_id: windowScope.root_id,
    root_kind: 'native_window',
    subject_kind: 'AXButton',
    role: 'AXButton',
    label: 'Other',
    capabilities: ['press'],
    projection: {
      ...baseProjection,
      subject_id: 'other-child',
      subject_kind: 'AXButton',
      visible_display_rect: { x: 130, y: 130, w: 40, h: 20 },
      display_space_rect: { x: 130, y: 130, w: 40, h: 20 },
    },
  })

  const point = { x: 140, y: 140 }
  const report = explainAnnotationCandidateChoice([panel, child, overlappingNonDescendant], panel, point)

  assert.equal(report.selected.id, 'child')
  assert.equal(report.scoped_candidate_count, 1)
  assert.equal(report.rejected.some((entry) => entry.id === 'panel' && entry.reason === 'candidate_is_active_scope'), true)
  assert.equal(report.rejected.some((entry) => entry.id === 'other-child' && entry.reason === 'candidate_not_in_active_scope'), true)
  assert.equal(chooseAnnotationCandidateForScope([panel, child, overlappingNonDescendant], panel, point).id, 'child')
})

test('scoped selection collapses visually equivalent ancestor and descendant layers', () => {
  const scope = node('section', ['canvas', 'doc', 'semantic', 'section'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'section',
  })
  scope.projection.visible_display_rect = { x: 0, y: 0, w: 400, h: 400 }

  const row = node('row', ['canvas', 'doc', 'semantic', 'section', 'row'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'row',
  })
  row.projection.visible_display_rect = { x: 40, y: 30, w: 80, h: 32 }

  const button = node('button', ['canvas', 'doc', 'semantic', 'section', 'row', 'button'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'button',
    capabilities: ['press'],
  })
  button.projection.visible_display_rect = { x: 40.5, y: 30, w: 79.5, h: 32 }

  const report = explainAnnotationCandidateChoice([scope, row, button], scope, { x: 50, y: 40 })
  assert.equal(report.selected.id, 'button')
  assert.equal(report.scoped_candidate_count, 1)
  assert.equal(report.rejected.some((entry) => entry.id === 'row' && entry.reason === 'candidate_visual_equivalent'), true)
})

test('scoped decision report exposes no-distinct-descendant fallback reason', () => {
  const scope = node('section', ['canvas', 'doc', 'semantic', 'section'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'section',
  })
  scope.projection.visible_display_rect = { x: 0, y: 0, w: 400, h: 400 }

  const grandchild = node('button', ['canvas', 'doc', 'semantic', 'section', 'row', 'button'], {
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'doc',
    subject_kind: 'button',
    capabilities: ['press'],
  })
  grandchild.projection.visible_display_rect = { x: 0, y: 0, w: 400, h: 400 }

  const report = explainAnnotationCandidateChoice([scope, grandchild], scope, { x: 50, y: 40 })
  assert.equal(report.selected, null)
  assert.equal(report.fallback_reason, 'active_scope_no_distinct_descendant_under_pointer')
  assert.equal(report.rejected.some((entry) => entry.id === 'section' && entry.reason === 'candidate_is_active_scope'), true)
  assert.equal(report.rejected.some((entry) => entry.id === 'button' && entry.reason === 'candidate_visual_equivalent_to_active_scope'), true)
})
