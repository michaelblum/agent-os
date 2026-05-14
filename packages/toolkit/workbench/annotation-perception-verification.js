import { buildAnnotationProjectionResult } from './annotation-projection.js'

export const ANNOTATION_PERCEPTION_VERIFICATION_SCHEMA = 'annotation_perception_verification'
export const ANNOTATION_PERCEPTION_VERIFICATION_VERSION = '0.1.0'

export const VERIFICATION_STATUSES = new Set(['passed', 'failed', 'blocked', 'adapter_fixture_only'])

const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z'
const DEFAULT_OVERLAP_THRESHOLD = 0.75

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback
  return JSON.parse(JSON.stringify(value))
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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

function firstRect(value) {
  if (Array.isArray(value)) return normalizeRect(value[0])
  return normalizeRect(value)
}

function targetBounds(target = {}) {
  return normalizeRect(
    target.perceived_bounds
      ?? target.bounds?.viewport_local
      ?? target.bounds?.parent_local
      ?? target.bounds?.desktop_world
      ?? target.bounds,
  )
}

export function boundsOverlapRatio(a, b) {
  const left = normalizeRect(a)
  const right = normalizeRect(b)
  if (!left || !right) return 0
  const x1 = Math.max(left.x, right.x)
  const y1 = Math.max(left.y, right.y)
  const x2 = Math.min(left.x + left.width, right.x + right.width)
  const y2 = Math.min(left.y + left.height, right.y + right.height)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = (left.width * left.height) + (right.width * right.height) - intersection
  return union > 0 ? intersection / union : 0
}

function normalizeTarget(target = {}) {
  const bounds = targetBounds(target)
  return {
    id: text(target.id ?? target.target_id ?? target.path, 'unknown-target'),
    path: text(target.path ?? target.target_path ?? target.id, 'unknown-target'),
    kind: text(target.kind, 'region'),
    label: text(target.label ?? target.name, 'Target'),
    source_ids: {
      canvas_id: text(target.source_ids?.canvas_id ?? target.canvas_id) || null,
      surface_id: text(target.source_ids?.surface_id ?? target.surface_id ?? target.surface) || null,
      window_id: text(target.source_ids?.window_id ?? target.window_id) || null,
      display_id: text(target.source_ids?.display_id ?? target.display_id) || null,
      subject_id: text(target.source_ids?.subject_id ?? target.subject_id ?? target.id) || null,
      adapter_subject_id: text(target.source_ids?.adapter_subject_id ?? target.ref ?? target.do_target) || null,
    },
    perceived_bounds: bounds,
    role: text(target.role) || null,
    capabilities: cloneJson(target.capabilities, {}),
    metadata: cloneJson(target.metadata, {}),
  }
}

function coordinateSpaceForSurface(surfaceClass) {
  if (surfaceClass === 'mac_window_topology') return 'desktop_world'
  if (surfaceClass === 'markdown_workbench_text_range') return 'document'
  if (surfaceClass === 'pdf_image') return 'image'
  return 'viewport'
}

function kindForTarget(target) {
  if (target.kind === 'text_range') return 'selection_comment'
  if (target.kind === 'point') return 'point_comment'
  if (target.kind === 'region' || target.kind === 'image_region') return 'region_comment'
  return 'element_selection'
}

export function createAnnotationIntentFromTarget({
  case_id,
  surface_class,
  surface_binding = {},
  target,
  ordinal = 1,
  note = 'Verification annotation.',
  created_at = DEFAULT_CREATED_AT,
} = {}) {
  const normalizedTarget = normalizeTarget(target)
  const sourcePath = text(surface_binding.source_path ?? target?.source_path, 'structured-fixture')
  const annotation = {
    id: `ann-${text(case_id, normalizedTarget.id)}`,
    ordinal,
    kind: kindForTarget(normalizedTarget),
    surface_id: text(surface_binding.surface_id, normalizedTarget.source_ids.surface_id ?? 'structured-surface'),
    source_path: sourcePath,
    coordinate_space: coordinateSpaceForSurface(surface_class),
    bounds: normalizedTarget.perceived_bounds,
    viewport_bounds: coordinateSpaceForSurface(surface_class) === 'viewport' ? normalizedTarget.perceived_bounds : null,
    selector_candidates: Array.isArray(target?.selector_candidates) ? target.selector_candidates.map(String) : [],
    text_excerpt: text(target?.text_excerpt ?? normalizedTarget.label),
    text_range: target?.text_range ?? null,
    role: normalizedTarget.role ?? '',
    label: normalizedTarget.label,
    ancestor_chain: Array.isArray(target?.ancestor_chain) ? target.ancestor_chain.map(String) : [],
    note,
    actor: { role: 'system', id: 'annotation-perception-verifier' },
    status: 'committed',
    lifecycle: {
      clearable: true,
      committed_at: created_at,
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
      verification_case_id: case_id,
      target_path: normalizedTarget.path,
      target_kind: normalizedTarget.kind,
    },
  }
  if (coordinateSpaceForSurface(surface_class) === 'desktop_world') annotation.viewport_bounds = null
  return annotation
}

function buildProjection({
  surface_binding,
  viewport,
  annotation,
  adapter_projection,
  layer,
} = {}) {
  return buildAnnotationProjectionResult({
    surface_binding,
    viewport,
    annotations: [annotation],
    adapter_projections: [
      adapter_projection ?? {
        annotation_id: annotation.id,
        status: 'resolved',
        anchor_type: annotation.kind,
        rects: [annotation.bounds].filter(Boolean),
        decorator: annotation.bounds
          ? { x: annotation.bounds.x - 18, y: annotation.bounds.y, placement: 'start-outside' }
          : { x: null, y: null, placement: 'none' },
        precision: 'structured_perception_target',
        confidence: 0.9,
      },
    ],
    layer,
  })
}

function normalizeReperception({ target, annotation, projection, reperception = {} }) {
  const projectionRecord = projection.projections?.[0] ?? {}
  const reperceivedTarget = normalizeTarget(reperception.target ?? target)
  return {
    source: text(reperception.source, 'structured_state'),
    target: reperceivedTarget,
    decorators: Array.isArray(reperception.decorators)
      ? cloneJson(reperception.decorators, [])
      : [{
          annotation_id: annotation.id,
          ordinal: annotation.ordinal,
          bounds: firstRect(projectionRecord.rects),
          discoverable: projectionRecord.status === 'resolved',
        }],
    layer: {
      visible: reperception.layer?.visible !== false,
      hidden_state: text(reperception.layer?.hidden_state, 'hidden'),
      shown_state: text(reperception.layer?.shown_state, 'visible'),
      content_mutated: Boolean(reperception.layer?.content_mutated),
    },
    content_before: reperception.content_before ?? null,
    content_after: reperception.content_after ?? null,
    raw: cloneJson(reperception.raw, {}),
  }
}

function assertion(name, passed, details = {}) {
  return {
    name,
    status: passed ? 'passed' : 'failed',
    ...details,
  }
}

function optionalAssertion(name, available, passed, details = {}) {
  if (!available) return { name, status: 'not_applicable', ...details }
  return assertion(name, passed, details)
}

function compareCase({
  target,
  annotation,
  projection,
  reperception,
  overlap_threshold = DEFAULT_OVERLAP_THRESHOLD,
  require_layer_probe = false,
  require_content_guard = false,
} = {}) {
  const projectionRecord = projection.projections?.[0] ?? {}
  const projectedBounds = firstRect(projectionRecord.rects)
  const perceivedBounds = targetBounds(reperception.target)
  const overlapRatio = boundsOverlapRatio(projectedBounds, perceivedBounds)
  const targetIdentityMatched = (
    target.path === reperception.target.path
    || target.id === reperception.target.id
    || annotation.metadata?.target_path === reperception.target.path
  )
  const decorator = reperception.decorators.find((item) => item.annotation_id === annotation.id)
  const layerProbeAvailable = Boolean(reperception.layer?.hidden_state && reperception.layer?.shown_state)
  const contentGuardAvailable = reperception.content_before != null || reperception.content_after != null

  return [
    assertion('target_identity_path_match', targetIdentityMatched, {
      expected: target.path,
      actual: reperception.target.path,
    }),
    assertion('bounds_overlap_ratio', overlapRatio >= overlap_threshold, {
      ratio: Number(overlapRatio.toFixed(4)),
      threshold: overlap_threshold,
      projected_bounds: projectedBounds,
      perceived_bounds: perceivedBounds,
    }),
    optionalAssertion('ordinal_decorator_discoverability', Boolean(decorator), Boolean(decorator?.discoverable), {
      annotation_id: annotation.id,
      ordinal: annotation.ordinal,
    }),
    optionalAssertion(
      'hide_show_layer_state',
      layerProbeAvailable || require_layer_probe,
      reperception.layer.hidden_state === 'hidden' && reperception.layer.shown_state === 'visible',
      { hidden_state: reperception.layer.hidden_state, shown_state: reperception.layer.shown_state },
    ),
    optionalAssertion(
      'content_mutation_guard',
      contentGuardAvailable || require_content_guard,
      reperception.content_before === reperception.content_after && reperception.layer.content_mutated === false,
      { content_mutated: reperception.layer.content_mutated },
    ),
  ]
}

function statusForCase({ adapter_fixture_only, blockers = [], assertions = [] }) {
  if (assertions.some((item) => item.status === 'failed')) return 'failed'
  if (adapter_fixture_only) return 'adapter_fixture_only'
  if (blockers.length > 0 || assertions.some((item) => item.status === 'blocked')) return 'blocked'
  return 'passed'
}

export function buildAnnotationPerceptionVerificationCase(input = {}) {
  const surfaceClass = text(input.surface_class, 'generic_surface')
  const target = normalizeTarget(input.target)
  const annotation = input.annotation ?? createAnnotationIntentFromTarget({
    case_id: input.case_id,
    surface_class: surfaceClass,
    surface_binding: input.surface_binding,
    target: input.target,
    ordinal: input.ordinal ?? 1,
    note: input.note,
    created_at: input.created_at,
  })
  const surfaceBinding = {
    surface_id: text(input.surface_binding?.surface_id, target.source_ids.surface_id ?? 'structured-surface'),
    surface_type: text(input.surface_binding?.surface_type, 'generic_canvas'),
    source_path: text(input.surface_binding?.source_path, 'structured-fixture'),
    source_url: input.surface_binding?.source_url ?? null,
    subject_id: input.surface_binding?.subject_id ?? target.source_ids.subject_id,
    canvas_id: input.surface_binding?.canvas_id ?? target.source_ids.canvas_id,
    window_id: input.surface_binding?.window_id ?? target.source_ids.window_id,
    tab_id: input.surface_binding?.tab_id ?? null,
  }
  const projection = input.projection ?? buildProjection({
    surface_binding: surfaceBinding,
    viewport: input.viewport ?? { width: 1024, height: 768, view_mode: surfaceClass },
    annotation,
    adapter_projection: input.adapter_projection,
    layer: input.layer,
  })
  const reperception = normalizeReperception({
    target: input.reperception?.target ?? target,
    annotation,
    projection,
    reperception: input.reperception,
  })
  const assertions = compareCase({
    target,
    annotation,
    projection,
    reperception,
    overlap_threshold: input.overlap_threshold ?? DEFAULT_OVERLAP_THRESHOLD,
    require_layer_probe: Boolean(input.require_layer_probe),
    require_content_guard: Boolean(input.require_content_guard),
  })
  const blockers = Array.isArray(input.blockers) ? input.blockers.map(String) : []
  const status = statusForCase({
    adapter_fixture_only: Boolean(input.adapter_fixture_only),
    blockers,
    assertions,
  })

  return {
    case_id: text(input.case_id, target.id),
    surface_class: surfaceClass,
    surface_binding: surfaceBinding,
    perception_source: text(input.perception_source, 'structured_fixture'),
    target,
    annotation,
    projection,
    reperception,
    assertions,
    status,
    blockers,
    notes: Array.isArray(input.notes) ? input.notes.map(String) : [],
  }
}

export function buildAnnotationPerceptionVerificationReport(input = {}) {
  const cases = (Array.isArray(input.cases) ? input.cases : []).map(buildAnnotationPerceptionVerificationCase)
  const totals = {
    passed: cases.filter((item) => item.status === 'passed').length,
    failed: cases.filter((item) => item.status === 'failed').length,
    blocked: cases.filter((item) => item.status === 'blocked').length,
    adapter_fixture_only: cases.filter((item) => item.status === 'adapter_fixture_only').length,
  }
  return {
    schema: ANNOTATION_PERCEPTION_VERIFICATION_SCHEMA,
    version: ANNOTATION_PERCEPTION_VERIFICATION_VERSION,
    created_at: input.created_at ?? DEFAULT_CREATED_AT,
    summary: {
      status: totals.failed > 0 ? 'failed' : totals.blocked > 0 ? 'blocked' : 'passed',
      total_cases: cases.length,
      ...totals,
    },
    cases,
  }
}

export function assertAnnotationPerceptionVerificationReportShape(report = {}) {
  if (report.schema !== ANNOTATION_PERCEPTION_VERIFICATION_SCHEMA) {
    throw new TypeError('expected annotation_perception_verification schema')
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(report.version ?? ''))) {
    throw new TypeError('expected semver report version')
  }
  if (!Array.isArray(report.cases) || report.cases.length === 0) {
    throw new TypeError('verification report requires cases')
  }
  for (const item of report.cases) {
    if (!item.case_id) throw new TypeError('case requires case_id')
    if (!item.surface_class) throw new TypeError(`${item.case_id} requires surface_class`)
    if (!item.target?.path) throw new TypeError(`${item.case_id} requires target.path`)
    if (!item.annotation?.id) throw new TypeError(`${item.case_id} requires annotation.id`)
    if (!item.projection?.projections?.length) throw new TypeError(`${item.case_id} requires projection result`)
    if (!Array.isArray(item.assertions)) throw new TypeError(`${item.case_id} requires assertions`)
    if (!VERIFICATION_STATUSES.has(item.status)) throw new TypeError(`${item.case_id} has unknown status`)
  }
  return true
}
