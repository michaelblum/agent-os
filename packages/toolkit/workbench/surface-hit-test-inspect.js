import { buildAnnotationPerceptionVerificationCase } from './annotation-perception-verification.js'

export const SURFACE_HIT_TEST_INSPECT_SCHEMA = 'surface_hit_test_inspect'
export const SURFACE_HIT_TEST_INSPECT_VERSION = '0.1.0'

const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z'

const HIT_TEST_STATUSES = new Set(['hit', 'miss', 'blocked', 'unsupported', 'ambiguous'])

const SURFACE_TYPE_BY_CLASS = {
  aos_canvas_semantic_target: 'generic_canvas',
  markdown_workbench_text_range: 'markdown_workbench',
  browser_page_local_html: 'browser_page',
  mac_window_topology: 'generic_canvas',
  generic_ax_element: 'generic_canvas',
  mermaid_svg: 'mermaid_svg',
  three_scene: 'three_scene',
  pdf_image: 'image',
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function integer(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : fallback
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback
  return JSON.parse(JSON.stringify(value))
}

function normalizePoint(point = {}) {
  const x = numberOrNull(point.x)
  const y = numberOrNull(point.y)
  if (x == null || y == null) return { x: 0, y: 0, coordinate_space: text(point.coordinate_space, 'viewport') }
  return { x, y, coordinate_space: text(point.coordinate_space, 'viewport') }
}

function normalizeRect(rect = null) {
  if (!rect || typeof rect !== 'object') return null
  const x = numberOrNull(rect.x)
  const y = numberOrNull(rect.y)
  const width = numberOrNull(rect.width ?? rect.w)
  const height = numberOrNull(rect.height ?? rect.h)
  if ([x, y, width, height].some((part) => part == null)) return null
  return { x, y, width, height }
}

function normalizeBounds(bounds = {}) {
  const out = {}
  for (const [inKey, outKey] of [
    ['viewport', 'viewport'],
    ['viewport_local', 'viewport'],
    ['document', 'document'],
    ['page', 'page'],
    ['desktop_world', 'desktop_world'],
    ['parent_local', 'parent_local'],
    ['image', 'image'],
    ['image_local', 'image'],
    ['lcs', 'lcs'],
    ['lcs_local', 'lcs'],
    ['screen_projected', 'screen_projected'],
  ]) {
    const rect = normalizeRect(bounds[inKey])
    if (rect) out[outKey] = rect
  }
  const direct = normalizeRect(bounds)
  if (direct && Object.keys(out).length === 0) out.viewport = direct
  return out
}

function boundsForPoint(bounds, coordinateSpace) {
  return bounds[coordinateSpace]
    ?? bounds.viewport
    ?? bounds.parent_local
    ?? bounds.document
    ?? bounds.page
    ?? bounds.desktop_world
    ?? bounds.image
    ?? bounds.lcs
    ?? null
}

function containsPoint(rect, point) {
  if (!rect) return false
  return point.x >= rect.x
    && point.y >= rect.y
    && point.x <= rect.x + rect.width
    && point.y <= rect.y + rect.height
}

function rectArea(rect) {
  return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : Number.POSITIVE_INFINITY
}

function sourceIds(input = {}) {
  return {
    canvas_id: text(input.canvas_id ?? input.source_ids?.canvas_id ?? input.source?.canvas_id) || null,
    surface_id: text(input.surface_id ?? input.source_ids?.surface_id ?? input.source?.surface_id) || null,
    window_id: text(input.window_id ?? input.source_ids?.window_id ?? input.source?.window_id) || null,
    display_id: text(input.display_id ?? input.source_ids?.display_id ?? input.source?.display_id) || null,
    subject_id: text(input.subject_id ?? input.source_ids?.subject_id ?? input.source?.subject_id ?? input.id) || null,
    adapter_subject_id: text(input.adapter_subject_id ?? input.source_ids?.adapter_subject_id ?? input.source?.adapter_subject_id) || null,
  }
}

function annotationKindForCandidate(candidate) {
  if (candidate.kind === 'text_range') return 'selection_comment'
  if (candidate.kind === 'point') return 'point_comment'
  if (candidate.kind === 'window' || candidate.kind === 'region' || candidate.kind === 'image_region' || candidate.kind === 'pdf_page') {
    return 'region_comment'
  }
  return 'element_selection'
}

function annotationCoordinateSpace(surfaceClass, point) {
  if (surfaceClass === 'mac_window_topology') return 'desktop_world'
  if (surfaceClass === 'markdown_workbench_text_range') return 'document'
  if (surfaceClass === 'pdf_image') return 'image'
  if (point.coordinate_space === 'desktop_world') return 'desktop_world'
  if (point.coordinate_space === 'page') return 'page'
  if (point.coordinate_space === 'document') return 'document'
  if (point.coordinate_space === 'image') return 'image'
  return 'viewport'
}

function targetBoundsForVerification(candidate, coordinateSpace) {
  return boundsForPoint(candidate.bounds, coordinateSpace)
    ?? boundsForPoint(candidate.bounds, candidate.request_coordinate_space)
    ?? null
}

export function normalizeInspectRequest(request = {}) {
  const surfaceBinding = request.surface_binding ?? {}
  const point = normalizePoint(request.point ?? request.pointer ?? {})
  return {
    surface_binding: {
      surface_id: text(surfaceBinding.surface_id, 'unknown-surface'),
      surface_type: text(surfaceBinding.surface_type, 'generic_canvas'),
      source_path: text(surfaceBinding.source_path) || null,
      source_url: text(surfaceBinding.source_url) || null,
      subject_id: text(surfaceBinding.subject_id) || null,
      canvas_id: text(surfaceBinding.canvas_id) || null,
      window_id: text(surfaceBinding.window_id) || null,
      tab_id: text(surfaceBinding.tab_id) || null,
    },
    point,
    active_surface_path: text(request.active_surface_path) || null,
    selected_surface_id: text(request.selected_surface_id) || null,
    requested_adapter_type: text(request.requested_adapter_type, 'fixture'),
    allowed_target_kinds: Array.isArray(request.allowed_target_kinds)
      ? request.allowed_target_kinds.map((kind) => text(kind)).filter(Boolean)
      : [],
  }
}

export function normalizeHitTestCandidate(candidate = {}, request = {}) {
  const point = request.point ?? normalizePoint()
  const bounds = normalizeBounds(candidate.bounds ?? candidate.perceived_bounds ?? {})
  const rect = boundsForPoint(bounds, point.coordinate_space)
  const explicitStatus = text(candidate.hit_test_status ?? candidate.status)
  const contained = containsPoint(rect, point)
  const status = HIT_TEST_STATUSES.has(explicitStatus)
    ? explicitStatus
    : contained ? 'hit' : 'miss'
  const candidatePath = text(candidate.path ?? candidate.target_path ?? candidate.id, 'unknown-target')
  return {
    id: text(candidate.id ?? candidate.target_id ?? candidatePath, 'unknown-target'),
    path: candidatePath,
    kind: text(candidate.kind, 'region'),
    label: text(candidate.label ?? candidate.name, candidatePath),
    depth: integer(candidate.depth ?? candidatePath.split('/').filter(Boolean).length - 1, 0),
    ancestor_chain: Array.isArray(candidate.ancestor_chain)
      ? candidate.ancestor_chain.map((item) => text(item)).filter(Boolean)
      : candidatePath.split('/').slice(0, -1),
    role: text(candidate.role) || null,
    text: text(candidate.text ?? candidate.text_excerpt) || null,
    source_ids: sourceIds(candidate),
    source_metadata: cloneJson(candidate.source_metadata ?? candidate.metadata, {}),
    bounds,
    hit_test_status: status,
    adapter: {
      id: text(candidate.adapter?.id ?? candidate.adapter_id, 'fixture-adapter'),
      type: text(candidate.adapter?.type ?? candidate.adapter_type, request.requested_adapter_type ?? 'fixture'),
      metadata: cloneJson(candidate.adapter?.metadata, {}),
    },
    confidence: numberOrNull(candidate.confidence ?? candidate.adapter?.confidence) ?? 0,
    child_discovery: text(candidate.child_discovery ?? candidate.adapter?.child_discovery, 'unknown'),
    capabilities: cloneJson(candidate.capabilities, {}),
    blockers: Array.isArray(candidate.blockers) ? candidate.blockers.map(String) : [],
    reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map(String) : [],
    selector_candidates: Array.isArray(candidate.selector_candidates) ? candidate.selector_candidates.map(String) : [],
    text_range: candidate.text_range && typeof candidate.text_range === 'object' ? cloneJson(candidate.text_range, null) : null,
    request_coordinate_space: point.coordinate_space,
  }
}

export function chooseInspectCandidate(candidates = [], request = {}) {
  const point = request.point ?? normalizePoint()
  const hits = candidates
    .filter((candidate) => candidate.hit_test_status === 'hit' || candidate.hit_test_status === 'ambiguous')
    .filter((candidate) => containsPoint(boundsForPoint(candidate.bounds, point.coordinate_space), point))

  if (hits.length === 0) return { selected_candidate: null, ambiguous_candidates: [] }

  const sorted = [...hits].sort((a, b) => {
    const depthDelta = b.depth - a.depth
    if (depthDelta !== 0) return depthDelta
    const confidenceDelta = b.confidence - a.confidence
    if (confidenceDelta !== 0) return confidenceDelta
    const areaDelta = rectArea(boundsForPoint(a.bounds, point.coordinate_space)) - rectArea(boundsForPoint(b.bounds, point.coordinate_space))
    if (areaDelta !== 0) return areaDelta
    return a.path.localeCompare(b.path)
  })
  const selected = sorted[0]
  const selectedArea = rectArea(boundsForPoint(selected.bounds, point.coordinate_space))
  const ambiguous = hits.filter((candidate) => (
    candidate.path !== selected.path
    && candidate.depth === selected.depth
    && candidate.confidence === selected.confidence
    && rectArea(boundsForPoint(candidate.bounds, point.coordinate_space)) === selectedArea
  ))

  return { selected_candidate: selected, ambiguous_candidates: ambiguous }
}

export function annotationDraftFromCandidate({
  case_id,
  surface_class,
  request,
  candidate,
  created_at = DEFAULT_CREATED_AT,
  note = 'Inspect-selected annotation draft.',
} = {}) {
  if (!candidate) return null
  const coordinateSpace = annotationCoordinateSpace(surface_class, request.point)
  const bounds = targetBoundsForVerification(candidate, coordinateSpace)
  return {
    id: `draft-${text(case_id, candidate.id)}`,
    ordinal: 1,
    kind: annotationKindForCandidate(candidate),
    surface_id: request.surface_binding.surface_id,
    source_path: request.surface_binding.source_path,
    source_url: request.surface_binding.source_url,
    coordinate_space: coordinateSpace,
    point: null,
    bounds,
    viewport_bounds: coordinateSpace === 'viewport' ? bounds : null,
    page_bounds: coordinateSpace === 'page' ? bounds : null,
    selector_candidates: candidate.selector_candidates,
    text_excerpt: text(candidate.text, candidate.label),
    text_range: candidate.text_range,
    role: text(candidate.role) || '',
    label: candidate.label,
    ancestor_chain: candidate.ancestor_chain,
    note,
    actor: { role: 'system', id: 'surface-hit-test-inspect' },
    status: 'draft',
    lifecycle: {
      clearable: true,
      committed_at: null,
      resolved_at: null,
      rejected_at: null,
      recovered_from: null,
    },
    capture: {
      prepare: { annotation_layer_visible: false, target_content_mutated: false },
      restore: { annotation_layer_visible: true },
    },
    created_at,
    updated_at: created_at,
    metadata: {
      inspect_case_id: case_id,
      target_path: candidate.path,
      target_kind: candidate.kind,
      adapter_id: candidate.adapter.id,
      adapter_type: candidate.adapter.type,
    },
  }
}

export function verificationSeedFromInspectResult(result = {}) {
  const candidate = result.selected_candidate
  if (!candidate || !result.annotation_draft) return null
  const coordinateSpace = result.annotation_draft.coordinate_space
  const targetBounds = targetBoundsForVerification(candidate, coordinateSpace)
  return {
    case_id: result.case_id,
    surface_class: result.surface_class,
    perception_source: result.surface?.adapter?.type ?? result.request.requested_adapter_type,
    adapter_fixture_only: Boolean(result.surface?.adapter_fixture_only),
    surface_binding: result.request.surface_binding,
    target: {
      id: candidate.id,
      path: candidate.path,
      kind: candidate.kind,
      label: candidate.label,
      role: candidate.role,
      source_ids: candidate.source_ids,
      perceived_bounds: targetBounds,
      selector_candidates: candidate.selector_candidates,
      text_excerpt: candidate.text,
      text_range: candidate.text_range,
      capabilities: candidate.capabilities,
      metadata: candidate.source_metadata,
    },
    annotation: result.annotation_draft,
    viewport: result.surface.viewport,
    adapter_projection: {
      annotation_id: result.annotation_draft.id,
      status: targetBounds ? 'resolved' : 'unsupported',
      anchor_type: result.annotation_draft.kind,
      rects: targetBounds ? [targetBounds] : [],
      decorator: targetBounds
        ? { x: targetBounds.x - 18, y: targetBounds.y, placement: 'start-outside' }
        : { x: null, y: null, placement: 'none' },
      precision: 'surface_hit_test_inspect_structured_seed',
      confidence: candidate.confidence,
    },
    reperception: {
      source: 'surface_hit_test_inspect_structured_seed',
      target: {
        id: candidate.id,
        path: candidate.path,
        kind: candidate.kind,
        label: candidate.label,
        role: candidate.role,
        source_ids: candidate.source_ids,
        perceived_bounds: targetBounds,
        capabilities: candidate.capabilities,
        metadata: candidate.source_metadata,
      },
      layer: { hidden_state: 'hidden', shown_state: 'visible', content_mutated: false },
      content_before: result.surface?.content_fingerprint ?? null,
      content_after: result.surface?.content_fingerprint ?? null,
      raw: { inspect_case_id: result.case_id, selected_path: candidate.path },
    },
    blockers: result.blockers,
    notes: result.notes,
  }
}

export function buildSurfaceHitTestInspectResult(input = {}) {
  const request = normalizeInspectRequest(input.request)
  const rawCandidates = Array.isArray(input.adapter_response?.candidates)
    ? input.adapter_response.candidates
    : Array.isArray(input.candidates) ? input.candidates : []
  const allowed = new Set(request.allowed_target_kinds)
  const candidates = rawCandidates
    .map((candidate) => normalizeHitTestCandidate(candidate, request))
    .filter((candidate) => allowed.size === 0 || allowed.has(candidate.kind))
  const { selected_candidate: selectedCandidate, ambiguous_candidates: ambiguousCandidates } = chooseInspectCandidate(candidates, request)
  const annotationDraft = annotationDraftFromCandidate({
    case_id: input.case_id,
    surface_class: input.surface_class,
    request,
    candidate: selectedCandidate,
    created_at: input.created_at,
    note: input.note,
  })
  const blockers = [
    ...(Array.isArray(input.blockers) ? input.blockers.map(String) : []),
    ...(selectedCandidate?.blockers ?? []),
  ]
  const surface = {
    selected_surface_path: text(input.surface?.selected_surface_path ?? request.active_surface_path) || null,
    surface_id: text(input.surface?.surface_id ?? request.surface_binding.surface_id, request.surface_binding.surface_id),
    surface_type: text(input.surface?.surface_type ?? request.surface_binding.surface_type, request.surface_binding.surface_type),
    source_ids: sourceIds({ ...request.surface_binding, source_ids: input.surface?.source_ids }),
    viewport: {
      width: numberOrNull(input.surface?.viewport?.width) ?? 0,
      height: numberOrNull(input.surface?.viewport?.height) ?? 0,
      scroll_x: numberOrNull(input.surface?.viewport?.scroll_x) ?? 0,
      scroll_y: numberOrNull(input.surface?.viewport?.scroll_y) ?? 0,
      zoom: numberOrNull(input.surface?.viewport?.zoom) ?? 1,
      scale: numberOrNull(input.surface?.viewport?.scale) ?? 1,
      view_mode: text(input.surface?.viewport?.view_mode, input.surface_class),
    },
    bounds: normalizeBounds(input.surface?.bounds ?? {}),
    adapter: {
      id: text(input.adapter_response?.adapter?.id ?? input.surface?.adapter?.id, request.requested_adapter_type),
      type: text(input.adapter_response?.adapter?.type ?? input.surface?.adapter?.type, request.requested_adapter_type),
      fixture_only: Boolean(input.adapter_response?.adapter?.fixture_only ?? input.surface?.adapter_fixture_only),
    },
    adapter_fixture_only: Boolean(input.adapter_response?.adapter?.fixture_only ?? input.surface?.adapter_fixture_only),
    content_fingerprint: input.surface?.content_fingerprint ?? null,
  }
  const result = {
    schema: SURFACE_HIT_TEST_INSPECT_SCHEMA,
    version: SURFACE_HIT_TEST_INSPECT_VERSION,
    created_at: input.created_at ?? DEFAULT_CREATED_AT,
    case_id: text(input.case_id, 'surface-hit-test-inspect'),
    surface_class: text(input.surface_class, 'generic_surface'),
    request,
    surface,
    candidates,
    selected_candidate: selectedCandidate,
    annotation_draft: annotationDraft,
    verification_seed: null,
    summary: {
      status: selectedCandidate ? 'passed' : blockers.length > 0 ? 'blocked' : 'failed',
      candidate_count: candidates.length,
      hit_count: candidates.filter((candidate) => candidate.hit_test_status === 'hit' || candidate.hit_test_status === 'ambiguous').length,
      selected_path: selectedCandidate?.path ?? null,
      ambiguous: ambiguousCandidates.length > 0,
      ambiguous_candidate_paths: ambiguousCandidates.map((candidate) => candidate.path),
      blockers,
    },
    blockers,
    notes: Array.isArray(input.notes) ? input.notes.map(String) : [],
  }
  result.verification_seed = verificationSeedFromInspectResult(result)
  return result
}

export function candidatesFromSpatialSubjectTree(tree = {}, {
  include_kinds = [],
  coordinate_space = 'desktop_world',
} = {}) {
  const include = new Set(include_kinds)
  return (Array.isArray(tree.nodes) ? tree.nodes : [])
    .filter((node) => include.size === 0 || include.has(node.kind))
    .map((node) => ({
      id: node.id,
      path: node.path,
      kind: node.kind,
      label: node.label,
      depth: node.path.split('/').length - 1,
      ancestor_chain: node.path.split('/').slice(0, -1),
      role: node.metadata?.role ?? node.kind,
      source_ids: sourceIds(node),
      bounds: {
        [coordinate_space]: node.bounds?.[coordinate_space],
        parent_local: node.bounds?.parent_local,
        viewport: node.bounds?.viewport_local ?? node.bounds?.parent_local,
      },
      adapter: node.adapter,
      confidence: node.adapter?.confidence,
      child_discovery: node.adapter?.child_discovery,
      capabilities: node.capabilities,
      metadata: node.metadata,
    }))
}

export function buildSurfaceHitTestInspectReport({ cases = [], created_at = DEFAULT_CREATED_AT } = {}) {
  const normalizedCases = cases.map((item) => buildSurfaceHitTestInspectResult({ ...item, created_at: item.created_at ?? created_at }))
  const verificationCases = normalizedCases
    .map((item) => item.verification_seed)
    .filter(Boolean)
    .map((seed) => buildAnnotationPerceptionVerificationCase(seed))
  const totals = {
    passed: normalizedCases.filter((item) => item.summary.status === 'passed' && !item.surface.adapter_fixture_only).length,
    failed: normalizedCases.filter((item) => item.summary.status === 'failed').length,
    blocked: normalizedCases.filter((item) => item.summary.status === 'blocked').length,
    adapter_fixture_only: normalizedCases.filter((item) => item.surface.adapter_fixture_only).length,
  }
  return {
    schema: SURFACE_HIT_TEST_INSPECT_SCHEMA,
    version: SURFACE_HIT_TEST_INSPECT_VERSION,
    created_at,
    summary: {
      status: totals.failed > 0 ? 'failed' : totals.blocked > 0 ? 'blocked' : 'passed',
      total_cases: normalizedCases.length,
      ...totals,
      verification_seed_count: normalizedCases.filter((item) => item.verification_seed).length,
      verification_passed: verificationCases.filter((item) => item.status === 'passed' || item.status === 'adapter_fixture_only').length,
      verification_failed: verificationCases.filter((item) => item.status === 'failed').length,
    },
    cases: normalizedCases,
  }
}

export function assertSurfaceHitTestInspectReportShape(report = {}) {
  if (report.schema !== SURFACE_HIT_TEST_INSPECT_SCHEMA) throw new TypeError('expected surface_hit_test_inspect schema')
  if (!/^\d+\.\d+\.\d+$/.test(String(report.version ?? ''))) throw new TypeError('expected semver inspect version')
  if (!Array.isArray(report.cases) || report.cases.length === 0) throw new TypeError('inspect report requires cases')
  for (const item of report.cases) {
    if (!item.case_id) throw new TypeError('case requires case_id')
    if (!item.request?.surface_binding?.surface_id) throw new TypeError(`${item.case_id} requires request.surface_binding.surface_id`)
    if (!item.request?.point?.coordinate_space) throw new TypeError(`${item.case_id} requires point coordinate space`)
    if (!Array.isArray(item.candidates)) throw new TypeError(`${item.case_id} requires candidates`)
    if (item.summary.status === 'passed' && !item.selected_candidate) throw new TypeError(`${item.case_id} requires selected candidate`)
    if (item.selected_candidate && !item.annotation_draft) throw new TypeError(`${item.case_id} requires annotation draft`)
    if (item.annotation_draft && !item.verification_seed) throw new TypeError(`${item.case_id} requires verification seed`)
  }
  return true
}

export function surfaceTypeForClass(surfaceClass) {
  return SURFACE_TYPE_BY_CLASS[surfaceClass] ?? 'generic_canvas'
}
