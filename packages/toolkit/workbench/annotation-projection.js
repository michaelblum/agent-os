export const ANNOTATION_PROJECTION_SCHEMA = 'annotation_projection';
export const ANNOTATION_PROJECTION_VERSION = '0.1.0';

export const SURFACE_TYPES = new Set([
  'markdown_workbench',
  'browser_page',
  'mermaid_svg',
  'three_scene',
  'pdf_page',
  'image',
  'generic_canvas',
]);

export const PROJECTION_STATUSES = new Set([
  'resolved',
  'unresolved',
  'stale',
  'out_of_viewport',
  'unsupported',
]);

export const ENTITY_RENDER_STATUSES = new Set([
  'visible',
  'clipped',
  'offscreen_scrollable',
  'virtualized',
  'hidden',
  'absent',
  'stale',
  'unsupported',
]);

export const REVEAL_RESULT_STATUSES = new Set([
  'already_visible',
  'revealed',
  'blocked',
  'virtualized',
  'unsupported',
  'target_absent',
  'adapter_error',
]);

const DECORATOR_MODES = new Set(['ordinal_badge', 'compact', 'hidden']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : fallback;
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeRect(rect = null) {
  if (!rect || typeof rect !== 'object') return null;
  const x = numberOrNull(rect.x ?? rect.left);
  const y = numberOrNull(rect.y ?? rect.top);
  const width = numberOrNull(rect.width ?? rect.w);
  const height = numberOrNull(rect.height ?? rect.h);
  if ([x, y, width, height].some((value) => value === null)) return null;
  return { x, y, width, height };
}

function normalizeRects(rects = []) {
  return (Array.isArray(rects) ? rects : [rects]).map(normalizeRect).filter(Boolean);
}

function normalizeViewport(viewport = {}) {
  return {
    width: Math.max(0, numberOrNull(viewport.width) ?? 0),
    height: Math.max(0, numberOrNull(viewport.height) ?? 0),
    scroll_x: numberOrNull(viewport.scroll_x ?? viewport.scrollX) ?? 0,
    scroll_y: numberOrNull(viewport.scroll_y ?? viewport.scrollY) ?? 0,
    zoom: numberOrNull(viewport.zoom) ?? 1,
    scale: numberOrNull(viewport.scale) ?? 1,
    device_pixel_ratio: numberOrNull(viewport.device_pixel_ratio ?? viewport.devicePixelRatio) ?? 1,
    view_mode: text(viewport.view_mode ?? viewport.viewMode, 'unknown'),
  };
}

export function normalizeAnnotationProjectionRequest(request = {}) {
  const binding = request.surface_binding || {};
  const surfaceType = SURFACE_TYPES.has(binding.surface_type) ? binding.surface_type : 'generic_canvas';
  const layer = request.layer || {};
  return {
    surface_binding: {
      surface_id: text(binding.surface_id, 'unknown-surface'),
      surface_type: surfaceType,
      source_path: text(binding.source_path) || null,
      source_url: text(binding.source_url) || null,
      subject_id: text(binding.subject_id) || null,
      canvas_id: text(binding.canvas_id) || null,
      window_id: text(binding.window_id) || null,
      tab_id: text(binding.tab_id) || null,
    },
    viewport: normalizeViewport(request.viewport),
    annotations: Array.isArray(request.annotations) ? request.annotations : [],
    adapter_projections: Array.isArray(request.adapter_projections) ? request.adapter_projections : [],
    layer: {
      visible: layer.visible !== false,
      dismissed: Boolean(layer.dismissed),
      decorator_mode: DECORATOR_MODES.has(layer.decorator_mode) ? layer.decorator_mode : 'ordinal_badge',
      expanded_annotation_ids: Array.isArray(layer.expanded_annotation_ids)
        ? [...new Set(layer.expanded_annotation_ids.map((id) => text(id)).filter(Boolean))]
        : [],
      capture: {
        prepare: cloneJson(layer.capture?.prepare, {}),
        restore: cloneJson(layer.capture?.restore, {}),
      },
    },
  };
}

function annotationAnchorType(annotation = {}) {
  if (annotation.text_range) return 'text_range';
  if (annotation.selector_candidates?.length) return 'selector_candidates';
  if (annotation.bounds || annotation.viewport_bounds || annotation.page_bounds) return 'region';
  if (annotation.point) return 'point';
  return text(annotation.kind, 'unknown');
}

function annotationSourceAnchor(annotation = {}) {
  return {
    source_path: text(annotation.source_path) || null,
    source_url: text(annotation.source_url) || null,
    text_excerpt: text(annotation.text_excerpt),
    text_range: annotation.text_range && typeof annotation.text_range === 'object'
      ? cloneJson(annotation.text_range, null)
      : null,
    selector_candidates: Array.isArray(annotation.selector_candidates)
      ? annotation.selector_candidates.map((value) => text(value)).filter(Boolean)
      : [],
    semantic: {
      role: text(annotation.role),
      label: text(annotation.label),
      ancestor_chain: Array.isArray(annotation.ancestor_chain)
        ? annotation.ancestor_chain.map((value) => text(value)).filter(Boolean)
        : [],
    },
  };
}

function rectInViewport(rect, viewport) {
  if (!rect) return false;
  return rect.x + rect.width >= 0
    && rect.y + rect.height >= 0
    && rect.x <= viewport.width
    && rect.y <= viewport.height;
}

function normalizeAdapterProjection(output = {}, annotation, viewport) {
  const rects = normalizeRects(output.rects || output.resolved_rects || output.rect);
  const declaredStatus = PROJECTION_STATUSES.has(output.status) ? output.status : '';
  let status = declaredStatus || (rects.length ? 'resolved' : 'unresolved');
  if (status === 'resolved' && rects.length && !rects.some((rect) => rectInViewport(rect, viewport))) {
    status = 'out_of_viewport';
  }

  return {
    annotation_id: text(annotation.id),
    ordinal: integer(annotation.ordinal, 0),
    anchor_type: text(output.anchor_type, annotationAnchorType(annotation)),
    status,
    rects,
    decorator: {
      placement: text(output.decorator?.placement || output.placement, rects.length ? 'start-outside' : 'none'),
      x: numberOrNull(output.decorator?.x ?? output.x),
      y: numberOrNull(output.decorator?.y ?? output.y),
      avoid_covering_anchor: output.decorator?.avoid_covering_anchor !== false,
      detail_preference: text(output.decorator?.detail_preference, 'hover_click_focus'),
    },
    confidence: numberOrNull(output.confidence) ?? (status === 'resolved' ? 0.8 : 0),
    reason: text(output.reason),
    precision: text(output.precision, rects.length ? 'surface_adapter' : 'none'),
    source_anchor: annotationSourceAnchor(annotation),
  };
}

function normalizeChain(chain = []) {
  return (Array.isArray(chain) ? chain : [chain])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: text(item.id || item.subject_id || item.ref, `ancestor-${index + 1}`),
      kind: text(item.kind || item.role || item.type, 'unknown'),
      rect: normalizeRect(item.rect || item.bounds || item.display_space_rect),
      overflow: text(item.overflow || item.clip || item.scroll, ''),
      scroll: {
        x: numberOrNull(item.scroll?.x ?? item.scroll_x ?? item.scrollLeft),
        y: numberOrNull(item.scroll?.y ?? item.scroll_y ?? item.scrollTop),
        max_x: numberOrNull(item.scroll?.max_x ?? item.scroll_max_x ?? item.scrollWidth),
        max_y: numberOrNull(item.scroll?.max_y ?? item.scroll_max_y ?? item.scrollHeight),
      },
    }));
}

function intersectRects(a, b) {
  if (!a || !b) return null;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function clipAnnotationDisplayRectToVisibleChain(rect = null, chain = []) {
  let clipped = normalizeRect(rect);
  if (!clipped) return null;
  for (const item of normalizeChain(chain)) {
    if (!item.rect) continue;
    clipped = intersectRects(clipped, item.rect);
    if (!clipped) return null;
  }
  return clipped;
}

function normalizeSourceTreeNodeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return {};
  return cloneJson(metadata, {});
}

export function normalizeAnnotationProjectionAdapterResult(input = {}) {
  const statusInput = input.current_render_status || input.render_status || input.status;
  const displayRect = normalizeRect(input.display_space_rect || input.display_rect || input.visible_display_rect);
  const localRect = normalizeRect(input.local_space_rect || input.local_rect || input.bounds);
  const currentRenderStatus = ENTITY_RENDER_STATUSES.has(statusInput)
    ? statusInput
    : (displayRect ? 'visible' : 'unsupported');
  const canProject = Boolean(input.can_project_display_overlay ?? (currentRenderStatus === 'visible' && displayRect));
  const canReveal = Boolean(input.can_reveal);
  const blockerReason = text(input.blocker_reason || input.reason || input.blocker?.reason);
  const refreshedAt = input.refreshed_at || new Date(0).toISOString();

  return {
    adapter_id: text(input.adapter_id || input.adapter || input.id, 'unsupported-adapter'),
    subject_id: text(input.subject_id || input.id || input.ref, 'unknown-subject'),
    subject_path: Array.isArray(input.subject_path)
      ? input.subject_path.map((part) => text(part)).filter(Boolean)
      : text(input.subject_path || input.path, '').split('/').filter(Boolean),
    root_id: text(input.root_id || input.canvas_id || input.window_id || input.root, 'unknown-root'),
    root_path: Array.isArray(input.root_path)
      ? input.root_path.map((part) => text(part)).filter(Boolean)
      : text(input.root_path, '').split('/').filter(Boolean),
    subject_kind: text(input.subject_kind || input.kind || input.role, 'unknown'),
    source_tree_node_metadata: normalizeSourceTreeNodeMetadata(input.source_tree_node_metadata || input.node || input.metadata),
    current_render_status: currentRenderStatus,
    can_project_display_overlay: canProject && currentRenderStatus === 'visible',
    can_reveal: canReveal,
    display_space_rect: currentRenderStatus === 'visible' ? displayRect : null,
    coordinate_space: text(input.coordinate_space || input.rect_coordinate_space || input.display_rect_coordinate_space, 'native_display'),
    local_space_rect: localRect,
    ancestor_viewport_clip_chain: normalizeChain(input.ancestor_viewport_clip_chain || input.clip_chain),
    scrollable_ancestor_chain: normalizeChain(input.scrollable_ancestor_chain || input.scroll_chain),
    z_order_evidence: cloneJson(input.z_order_evidence || input.hit_priority_evidence, null),
    blocker_reason: blockerReason,
    refreshed_at: text(refreshedAt, new Date(0).toISOString()),
    provenance_source_payload_id: text(input.provenance_source_payload_id || input.payload_id || input.source_payload_id),
  };
}

export function normalizeRevealResult(input = {}) {
  const status = REVEAL_RESULT_STATUSES.has(input.status) ? input.status : 'unsupported';
  return {
    status,
    adapter_id: text(input.adapter_id || input.adapter, ''),
    subject_id: text(input.subject_id || input.id || input.ref, ''),
    requested_at: text(input.requested_at || input.at || new Date(0).toISOString()),
    completed_at: text(input.completed_at || input.at || new Date(0).toISOString()),
    blocker_reason: text(input.blocker_reason || input.reason || input.error),
    projection: input.projection ? normalizeAnnotationProjectionAdapterResult(input.projection) : null,
  };
}

export function buildAdapterCapabilitySummary(results = []) {
  const summary = new Map();
  for (const raw of Array.isArray(results) ? results : []) {
    const result = normalizeAnnotationProjectionAdapterResult(raw);
    const item = summary.get(result.adapter_id) || {
      adapter_id: result.adapter_id,
      visible: 0,
      clipped: 0,
      offscreen_scrollable: 0,
      virtualized: 0,
      hidden: 0,
      absent: 0,
      stale: 0,
      unsupported: 0,
      can_project_display_overlay: false,
      can_reveal: false,
      blockers: [],
    };
    item[result.current_render_status] += 1;
    item.can_project_display_overlay ||= result.can_project_display_overlay;
    item.can_reveal ||= result.can_reveal;
    if (result.blocker_reason && !item.blockers.includes(result.blocker_reason)) item.blockers.push(result.blocker_reason);
    summary.set(result.adapter_id, item);
  }
  return [...summary.values()];
}

export function buildSemanticTargetProjectionAdapterResult(target = {}, owner = {}) {
  const targetId = text(
    target.id
      || target.target_id
      || target.semantic_target_id
      || target.ref
      || target.do_target
      || target.data_aos_ref,
    'target',
  );
  const sourceBounds = normalizeRect(target.display_space_rect || target.display_bounds || target.bounds || target.rect);
  const bounds = clipAnnotationDisplayRectToVisibleChain(sourceBounds, target.ancestor_viewport_clip_chain || target.clip_chain);
  const local = normalizeRect(target.local_space_rect || target.local_bounds || target.bounds || target.rect);
  const scrollable = Boolean(target.scrollable_ancestor_chain?.length || target.offscreen_scrollable || target.can_scroll);
  const hasStructuredReveal = target.can_reveal !== false
    && target.reveal_eligible !== false
    && Boolean(
      target.revealable
        || target.can_reveal
        || target.reveal_eligible
        || target.selector
        || target.data_aos_ref
        || target.aos_ref
        || target.target_id
        || target.semantic_target_id,
    );
  const visible = target.visible !== false && bounds;
  const current_render_status = target.current_render_status
    || target.render_status
    || (visible
      ? 'visible'
      : ((target.visible === false && (scrollable || hasStructuredReveal)) ? 'offscreen_scrollable' : (sourceBounds ? 'clipped' : ((scrollable || hasStructuredReveal) ? 'offscreen_scrollable' : 'unsupported'))));

  return normalizeAnnotationProjectionAdapterResult({
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: targetId,
    subject_path: ['canvas', owner.canvas_id || target.canvas_id || target.surface || 'unknown', 'semantic', targetId],
    root_id: owner.canvas_id || target.canvas_id || target.surface || 'unknown-canvas',
    root_path: ['canvas', owner.canvas_id || target.canvas_id || target.surface || 'unknown-canvas'],
    subject_kind: target.role || target.kind || 'semantic_target',
    source_tree_node_metadata: target,
    current_render_status,
    can_project_display_overlay: current_render_status === 'visible' && Boolean(bounds),
    can_reveal: Boolean(target.can_reveal || scrollable || target.revealable || hasStructuredReveal),
    display_space_rect: bounds,
    local_space_rect: local,
    ancestor_viewport_clip_chain: target.ancestor_viewport_clip_chain,
    scrollable_ancestor_chain: target.scrollable_ancestor_chain,
    blocker_reason: current_render_status === 'unsupported' ? 'semantic_target_no_structured_bounds_or_reveal_handler' : text(target.blocker_reason),
    refreshed_at: owner.refreshed_at || target.refreshed_at || new Date(0).toISOString(),
    provenance_source_payload_id: owner.provenance_source_payload_id || target.payload_id,
  });
}

export function buildConservativeAdapterSlotResult(input = {}, adapterId, blockerReason) {
  return normalizeAnnotationProjectionAdapterResult({
    ...input,
    adapter_id: adapterId,
    current_render_status: input.current_render_status || 'unsupported',
    can_project_display_overlay: false,
    can_reveal: false,
    blocker_reason: blockerReason || input.blocker_reason || 'unsupported_adapter_slot',
  });
}

export function buildAnnotationProjectionResult(request = {}) {
  const normalized = normalizeAnnotationProjectionRequest(request);
  const adapterById = new Map();
  for (const output of normalized.adapter_projections) {
    const id = text(output?.annotation_id || output?.id);
    if (id) adapterById.set(id, output);
  }

  return {
    schema: ANNOTATION_PROJECTION_SCHEMA,
    version: ANNOTATION_PROJECTION_VERSION,
    surface_binding: normalized.surface_binding,
    viewport: normalized.viewport,
    layer: normalized.layer,
    adapter_results: normalized.adapter_projections.map(normalizeAnnotationProjectionAdapterResult),
    adapter_capability_summary: buildAdapterCapabilitySummary(normalized.adapter_projections),
    projections: normalized.annotations.map((annotation, index) => {
      const fallback = {
        annotation_id: annotation.id,
        status: 'unsupported',
        reason: 'surface adapter did not return geometry for this anchor',
      };
      return normalizeAdapterProjection(adapterById.get(text(annotation.id)) || fallback, {
        ...annotation,
        ordinal: annotation.ordinal || index + 1,
      }, normalized.viewport);
    }),
  };
}

export function assertAnnotationProjectionResultShape(result = {}) {
  if (result.schema !== ANNOTATION_PROJECTION_SCHEMA) throw new Error('expected annotation_projection schema');
  if (!/^\d+\.\d+\.\d+$/.test(String(result.version || ''))) throw new Error('expected semver projection version');
  if (!result.surface_binding?.surface_id) throw new Error('expected surface_binding.surface_id');
  if (!SURFACE_TYPES.has(result.surface_binding?.surface_type)) throw new Error('expected known surface_binding.surface_type');
  if (!result.viewport || typeof result.viewport !== 'object') throw new Error('expected viewport object');
  if (!result.layer || typeof result.layer !== 'object') throw new Error('expected layer object');
  if (!Array.isArray(result.projections)) throw new Error('expected projections array');
  for (const projection of result.projections) {
    if (!projection.annotation_id) throw new Error('expected projection annotation_id');
    if (!PROJECTION_STATUSES.has(projection.status)) throw new Error(`unknown projection status: ${projection.status}`);
    if (!Array.isArray(projection.rects)) throw new Error('expected projection rects array');
    for (const rect of projection.rects) {
      if (!normalizeRect(rect)) throw new Error('expected viewport-local rect');
    }
  }
  return true;
}
