import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAnnotationProjectionResultShape,
  buildAdapterCapabilitySummary,
  buildAnnotationProjectionResult,
  buildBrowserContentSeamAdapterResult,
  buildConservativeAdapterSlotResult,
  buildSemanticTargetProjectionAdapterResult,
  clipAnnotationDisplayRectToVisibleChain,
  normalizeAnnotationProjectionAdapterResult,
  normalizeAnnotationProjectionEvidence,
  normalizeAnnotationProjectionRequest,
  normalizeAnnotationProjectionStatus,
  normalizeRevealResult,
} from '../../packages/toolkit/workbench/annotation-projection.js';

const annotation = {
  id: 'ann-line-1',
  ordinal: 1,
  kind: 'selection_comment',
  surface_id: 'markdown-workbench',
  source_path: 'docs/example.md',
  coordinate_space: 'document',
  text_range: { start_line: 4, end_line: 4 },
  text_excerpt: 'Initial text.',
  selector_candidates: ['p:nth-of-type(1)'],
  note: 'Clarify.',
  actor: { role: 'human', id: 'operator' },
  status: 'committed',
};

test('annotation projection normalizes surface binding, viewport, and layer state', () => {
  const request = normalizeAnnotationProjectionRequest({
    surface_binding: {
      surface_id: 'markdown-workbench',
      surface_type: 'markdown_workbench',
      source_path: 'docs/example.md',
    },
    viewport: {
      width: 640,
      height: 480,
      scrollY: 42,
      viewMode: 'source',
    },
    annotations: [annotation],
    layer: {
      visible: false,
      expanded_annotation_ids: ['ann-line-1', 'ann-line-1'],
    },
  });

  assert.equal(request.surface_binding.surface_type, 'markdown_workbench');
  assert.equal(request.viewport.scroll_y, 42);
  assert.equal(request.viewport.view_mode, 'source');
  assert.equal(request.layer.visible, false);
  assert.equal(request.layer.dismissed, false);
  assert.deepEqual(request.layer.expanded_annotation_ids, ['ann-line-1']);
});

test('annotation projection distinguishes resolved, out-of-viewport, and unsupported anchors', () => {
  const result = buildAnnotationProjectionResult({
    surface_binding: {
      surface_id: 'markdown-workbench',
      surface_type: 'markdown_workbench',
      source_path: 'docs/example.md',
    },
    viewport: {
      width: 320,
      height: 180,
      view_mode: 'source',
    },
    annotations: [
      annotation,
      { ...annotation, id: 'ann-line-2', ordinal: 2, text_range: { start_line: 40, end_line: 40 } },
      { ...annotation, id: 'ann-line-3', ordinal: 3, text_range: { start_line: 90, end_line: 90 } },
    ],
    adapter_projections: [
      {
        annotation_id: 'ann-line-1',
        status: 'resolved',
        anchor_type: 'text_range',
        rects: [{ x: 24, y: 60, width: 260, height: 18 }],
        decorator: { x: 10, y: 69, placement: 'start-outside' },
        precision: 'editor_line',
        confidence: 0.9,
      },
      {
        annotation_id: 'ann-line-2',
        status: 'resolved',
        anchor_type: 'text_range',
        rects: [{ x: 24, y: 420, width: 260, height: 18 }],
        decorator: { x: 10, y: 179, placement: 'start-outside' },
        precision: 'editor_line',
      },
    ],
  });

  assertAnnotationProjectionResultShape(result);
  assert.equal(result.schema, 'annotation_projection');
  assert.equal(result.projections[0].status, 'resolved');
  assert.equal(result.projections[0].source_anchor.text_excerpt, 'Initial text.');
  assert.equal(result.projections[0].decorator.avoid_covering_anchor, true);
  assert.equal(result.projections[1].status, 'out_of_viewport');
  assert.equal(result.projections[2].status, 'unsupported');
  assert.equal(result.projections[2].reason, 'surface adapter did not return geometry for this anchor');
});

test('projection adapter contract normalizes reachability and reveal capability states', () => {
  const result = normalizeAnnotationProjectionAdapterResult({
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: 'primary-cta',
    subject_path: ['canvas', 'workbench', 'semantic', 'primary-cta'],
    root_id: 'workbench',
    subject_kind: 'button',
    current_render_status: 'offscreen_scrollable',
    local_space_rect: { x: 16, y: 920, w: 120, h: 32 },
    scrollable_ancestor_chain: [{ id: 'preview-scroll', kind: 'scroll_region', scroll_y: 400 }],
    can_reveal: true,
    blocker_reason: 'below_current_viewport',
    refreshed_at: '2026-05-10T00:00:00.000Z',
    provenance_source_payload_id: 'see-capture-1',
  });

  assert.equal(result.current_render_status, 'offscreen_scrollable');
  assert.equal(result.can_project_display_overlay, false);
  assert.equal(result.can_reveal, true);
  assert.equal(result.scrollable_ancestor_chain[0].id, 'preview-scroll');
  assert.equal(result.blocker_reason, 'below_current_viewport');
});

test('canonical projection evidence preserves shared rect, blocker, reveal, provenance, and source metadata', () => {
  const evidence = normalizeAnnotationProjectionEvidence({
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'workbench',
    subject_id: 'primary-cta',
    subject_kind: 'button',
    current_render_status: 'offscreen_scrollable',
    visible_display_rect: { x: 10, y: 900, width: 30, height: 40 },
    local_space_rect: { x: 5, y: 800, w: 30, h: 40 },
    can_reveal: true,
    blocker: { reason: 'target_below_viewport' },
    coordinate_space: 'native_display',
    scrollable_ancestor_chain: [{ id: 'scroll', kind: 'region', scroll_y: 100 }],
    z_order_evidence: { occluded_by: ['toolbar'] },
    provenance_source_payload_id: 'payload-1',
    source_tree_node_metadata: { role: 'button', label: 'Apply' },
    refreshed_at: '2026-05-10T00:00:00.000Z',
  });

  assert.equal(evidence.current_render_status, 'offscreen_scrollable');
  assert.equal(evidence.can_project_display_overlay, false);
  assert.equal(evidence.can_reveal, true);
  assert.deepEqual(evidence.visible_display_rect, { x: 10, y: 900, w: 30, h: 40 });
  assert.equal(evidence.display_space_rect, null);
  assert.deepEqual(evidence.local_space_rect, { x: 5, y: 800, w: 30, h: 40 });
  assert.equal(evidence.blocker_reason, 'target_below_viewport');
  assert.deepEqual(evidence.scrollable_ancestor_chain[0].scroll, { x: null, y: 100, max_x: null, max_y: null });
  assert.deepEqual(evidence.z_order_evidence, { occluded_by: ['toolbar'] });
  assert.equal(evidence.provenance_source_payload_id, 'payload-1');
  assert.deepEqual(evidence.source_metadata, { role: 'button', label: 'Apply' });
});

test('projection adapter contract keeps sparse adapter results unsupported', () => {
  const result = normalizeAnnotationProjectionAdapterResult({
    adapter_id: 'aos-toolkit-semantic-target',
    root_id: 'workbench',
    subject_id: 'sparse-target',
  });

  assert.equal(result.current_render_status, 'unsupported');
  assert.equal(result.can_project_display_overlay, false);
  assert.equal(result.display_space_rect, null);
});

test('canonical projection status normalizes legacy aliases and preserves blocker evidence', () => {
  const projectable = normalizeAnnotationProjectionStatus({
    status: 'projectable',
    projectable: true,
    visible_display_rect: { left: 10, top: 20, width: 30, height: 40 },
    local_space_rect: { x: 1, y: 2, width: 3, height: 4 },
    coordinate_space: 'native_display',
    provenance_source_payload_id: 'payload-1',
  });

  assert.equal(projectable.current_render_status, 'visible');
  assert.equal(projectable.can_project_display_overlay, true);
  assert.deepEqual(projectable.visible_display_rect, { x: 10, y: 20, w: 30, h: 40 });
  assert.deepEqual(projectable.display_space_rect, { x: 10, y: 20, w: 30, h: 40 });
  assert.deepEqual(projectable.local_space_rect, { x: 1, y: 2, w: 3, h: 4 });
  assert.equal(projectable.provenance_source_payload_id, 'payload-1');

  const offscreen = normalizeAnnotationProjectionStatus({
    status: 'resolved_offscreen',
    can_reveal: true,
    blocker: { reason: 'target_below_viewport' },
    visible_display_rect: { x: 10, y: 900, w: 30, h: 40 },
    scrollable_ancestor_chain: [{ id: 'scroll', kind: 'region', scroll_y: 100 }],
  });

  assert.equal(offscreen.current_render_status, 'offscreen_scrollable');
  assert.equal(offscreen.can_project_display_overlay, false);
  assert.equal(offscreen.can_reveal, true);
  assert.equal(offscreen.display_space_rect, null);
  assert.equal(offscreen.blocker_reason, 'target_below_viewport');
  assert.equal(offscreen.scrollable_ancestor_chain[0].id, 'scroll');
});

test('canonical reveal result keeps pin context and normalizes projection status', () => {
  const reveal = normalizeRevealResult({
    status: 'revealed',
    pin_id: 'pin-child',
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: 'child',
    requested_at: '2026-05-10T00:00:00.000Z',
    completed_at: '2026-05-10T00:00:01.000Z',
    projection: {
      status: 'out_of_viewport',
      can_reveal: true,
      blocker_reason: 'target_below_viewport',
      visible_display_rect: { x: 10, y: 900, width: 30, height: 40 },
    },
  });

  assert.equal(reveal.status, 'revealed');
  assert.equal(reveal.pin_id, 'pin-child');
  assert.equal(reveal.adapter_id, 'aos-toolkit-semantic-target');
  assert.equal(reveal.subject_id, 'child');
  assert.equal(reveal.projection.current_render_status, 'offscreen_scrollable');
  assert.equal(reveal.projection.can_project_display_overlay, false);
  assert.equal(reveal.projection.blocker_reason, 'target_below_viewport');
});

test('canonical reveal result uses current-time fallback for live missing timestamps', () => {
  const reveal = normalizeRevealResult({
    status: 'revealed',
    pin_id: 'pin-child',
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: 'child',
  }, {
    now: '2026-05-17T12:00:00.000Z',
  });

  assert.equal(reveal.requested_at, '2026-05-17T12:00:00.000Z');
  assert.equal(reveal.completed_at, '2026-05-17T12:00:00.000Z');
});

test('semantic target adapter projects visible structured bounds and revealable scrolled targets', () => {
  const visible = buildSemanticTargetProjectionAdapterResult({
    id: 'save',
    role: 'button',
    bounds: { x: 100, y: 120, width: 80, height: 28 },
    do_target: 'save',
  }, {
    canvas_id: 'markdown-workbench',
    refreshed_at: '2026-05-10T00:00:00.000Z',
  });
  assert.equal(visible.adapter_id, 'aos-toolkit-semantic-target');
  assert.equal(visible.current_render_status, 'visible');
  assert.equal(visible.can_project_display_overlay, true);

  const offscreen = buildSemanticTargetProjectionAdapterResult({
    id: 'export',
    role: 'button',
    visible: false,
    can_scroll: true,
    bounds: { x: 100, y: 900, width: 80, height: 28 },
  }, { canvas_id: 'markdown-workbench' });
  assert.equal(offscreen.current_render_status, 'offscreen_scrollable');
  assert.equal(offscreen.can_reveal, true);
  assert.equal(offscreen.display_space_rect, null);

  const htmlTarget = buildSemanticTargetProjectionAdapterResult({
    ref: 'html-workbench-expression:goal',
    surface: 'html-workbench-expression',
    role: 'document_region',
    name: 'Goal',
    kind: 'section',
    enabled: true,
    state: { value: null, current: null, pressed: null, selected: null, checked: null, expanded: null },
    actions: [],
    extension: {
      dom_id: 'goal',
      reveal_eligible: true,
      source: {
        path: 'docs/design/work-cards/sample.md',
        line_start: 12,
        line_end: 18,
      },
    },
    provenance: {
      selector: '[data-semantic-target-id="goal"]',
      source_payload_id: 'goal',
    },
  }, { canvas_id: 'html-workbench-expression' });
  assert.equal(htmlTarget.subject_id, 'html-workbench-expression:goal');
  assert.deepEqual(htmlTarget.subject_path, ['canvas', 'html-workbench-expression', 'semantic', 'html-workbench-expression:goal']);
  assert.equal(htmlTarget.current_render_status, 'offscreen_scrollable');
  assert.equal(htmlTarget.can_reveal, true);
});

test('semantic target adapter preserves DesktopWorld semantic display rects', () => {
  const target = buildSemanticTargetProjectionAdapterResult({
    id: 'selection-mode-live-save-button',
    label: 'Save',
    role: 'button',
    kind: 'button',
    coordinate_space: 'desktop_world',
    source_coordinate_space: 'canvas_local',
    rect: { x: 24, y: 36, w: 90, h: 44 },
    display_space_rect: { x: 598, y: 209, w: 90, h: 44 },
    visible_display_rect: { x: 598, y: 209, w: 90, h: 44 },
    local_space_rect: { x: 24, y: 36, w: 90, h: 44 },
  }, {
    canvas_id: 'selection-mode-live-target',
    refreshed_at: '2026-05-29T13:11:37.956Z',
  });

  assert.equal(target.coordinate_space, 'desktop_world');
  assert.deepEqual(target.display_space_rect, { x: 598, y: 209, width: 90, height: 44 });
  assert.notEqual(target.display_space_rect.x, 805);
  assert.equal(target.source_tree_node_metadata.source_coordinate_space, 'canvas_local');
});

test('semantic target adapter clips display geometry to visible ancestor bounds', () => {
  const clipped = buildSemanticTargetProjectionAdapterResult({
    id: 'oversized-target',
    bounds: { x: 20, y: 30, width: 500, height: 500 },
    ancestor_viewport_clip_chain: [
      { id: 'viewport', rect: { x: 0, y: 0, width: 200, height: 160 } },
    ],
  }, { canvas_id: 'html-workbench-expression' });

  assert.equal(clipped.current_render_status, 'visible');
  assert.deepEqual(clipped.display_space_rect, { x: 20, y: 30, width: 180, height: 130 });

  const hidden = buildSemanticTargetProjectionAdapterResult({
    id: 'offscreen-target',
    bounds: { x: 420, y: 430, width: 50, height: 50 },
    ancestor_viewport_clip_chain: [
      { id: 'viewport', rect: { x: 0, y: 0, width: 200, height: 160 } },
    ],
    can_reveal: true,
  }, { canvas_id: 'html-workbench-expression' });

  assert.equal(hidden.current_render_status, 'clipped');
  assert.equal(hidden.can_project_display_overlay, false);
  assert.equal(hidden.display_space_rect, null);
  assert.equal(clipAnnotationDisplayRectToVisibleChain({ x: 1, y: 1, width: 10, height: 10 }, []).width, 10);
});

test('conservative adapter slots report explicit blockers instead of fake rectangles', () => {
  const object = buildConservativeAdapterSlotResult(
    { subject_id: 'cube-1', subject_kind: 'three_object' },
    'aos-object-registry',
    'object_registry_no_display_projection',
  );
  const ax = buildConservativeAdapterSlotResult(
    { subject_id: 'AXButton:Save', subject_kind: 'ax_element' },
    'macos-ax',
    'bounded_ax_reveal_unavailable',
  );
  const browser = buildConservativeAdapterSlotResult(
    { subject_id: 'chrome-tab-content', subject_kind: 'browser_content_seam' },
    'browser-content-seam',
    'browser_dom_cdp_deferred',
  );

  assert.equal(object.can_project_display_overlay, false);
  assert.equal(object.blocker_reason, 'object_registry_no_display_projection');
  assert.equal(ax.can_reveal, false);
  assert.equal(browser.blocker_reason, 'browser_dom_cdp_deferred');
  assert.deepEqual(buildAdapterCapabilitySummary([object, ax, browser]).map((item) => item.adapter_id), [
    'aos-object-registry',
    'macos-ax',
    'browser-content-seam',
  ]);
});

test('browser content seam adapter preserves session evidence without projecting page DOM', () => {
  const seam = buildBrowserContentSeamAdapterResult({
    id: 'local-session',
    mode: 'launched',
    headless: false,
    browser_window_id: 91234,
    active_url: 'https://example.invalid/app',
    updated_at: '2026-05-17T12:00:00.000Z',
  })

  assert.equal(seam.adapter_id, 'browser-content-seam')
  assert.equal(seam.subject_kind, 'browser_content_seam')
  assert.equal(seam.root_id, 'local-session')
  assert.equal(seam.current_render_status, 'unsupported')
  assert.equal(seam.can_project_display_overlay, false)
  assert.equal(seam.can_reveal, false)
  assert.equal(seam.display_space_rect, null)
  assert.equal(seam.source_tree_node_metadata.target, 'browser:local-session')
  assert.equal(seam.source_tree_node_metadata.browser_window_id, 91234)
  assert.equal(seam.source_tree_node_metadata.active_url, 'https://example.invalid/app')
  assert.deepEqual(seam.blocker_reasons, [
    'browser_content_inset_unresolved',
    'browser_tab_identity_unresolved',
    'browser_dom_cdp_deferred',
  ])
})

test('browser content seam adapter reports remote and controlled-fixture boundaries explicitly', () => {
  const remote = buildBrowserContentSeamAdapterResult({
    id: 'remote-cdp',
    mode: 'attach',
    attach_kind: 'cdp',
    headless: null,
    active_url: 'http://localhost:9222',
  }, {
    controlled_fixture: true,
    source: 'surface_inspector_diagnostics',
  })

  assert.equal(remote.can_project_display_overlay, false)
  assert.equal(remote.can_reveal, false)
  assert.equal(remote.blocker_reason, 'browser_session_not_local')
  assert.ok(remote.blocker_reasons.includes('browser_session_not_local'))
  assert.ok(remote.blocker_reasons.includes('browser_dom_cdp_deferred'))
  assert.equal(remote.source_tree_node_metadata.controlled_fixture_dom_support, 'accepted_via_controlled_browser_dom_surface')
  assert.equal(remote.source_tree_node_metadata.arbitrary_browser_dom_cdp, 'deferred')

  const summary = buildAdapterCapabilitySummary([remote])[0]
  assert.equal(summary.adapter_id, 'browser-content-seam')
  assert.equal(summary.can_project_display_overlay, false)
  assert.deepEqual(summary.blockers, remote.blocker_reasons)
})
