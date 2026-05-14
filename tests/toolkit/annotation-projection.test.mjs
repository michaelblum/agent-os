import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAnnotationProjectionResultShape,
  buildAdapterCapabilitySummary,
  buildAnnotationProjectionResult,
  buildConservativeAdapterSlotResult,
  buildSemanticTargetProjectionAdapterResult,
  clipAnnotationDisplayRectToVisibleChain,
  normalizeAnnotationProjectionAdapterResult,
  normalizeAnnotationProjectionRequest,
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
    target_id: 'goal',
    data_aos_ref: 'html-workbench-expression:goal',
    selector: '[data-semantic-target-id="goal"]',
    reveal_eligible: true,
  }, { canvas_id: 'html-workbench-expression' });
  assert.equal(htmlTarget.subject_id, 'goal');
  assert.deepEqual(htmlTarget.subject_path, ['canvas', 'html-workbench-expression', 'semantic', 'goal']);
  assert.equal(htmlTarget.current_render_status, 'offscreen_scrollable');
  assert.equal(htmlTarget.can_reveal, true);
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
  const chrome = buildConservativeAdapterSlotResult(
    { subject_id: 'chrome-tab-content', subject_kind: 'browser_content_seam' },
    'chrome-seam',
    'chrome_dom_piercing_deferred',
  );

  assert.equal(object.can_project_display_overlay, false);
  assert.equal(object.blocker_reason, 'object_registry_no_display_projection');
  assert.equal(ax.can_reveal, false);
  assert.equal(chrome.blocker_reason, 'chrome_dom_piercing_deferred');
  assert.deepEqual(buildAdapterCapabilitySummary([object, ax, chrome]).map((item) => item.adapter_id), [
    'aos-object-registry',
    'macos-ax',
    'chrome-seam',
  ]);
});
