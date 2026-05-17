const RENDER_STATUSES = new Set(['visible', 'clipped', 'offscreen_scrollable', 'virtualized', 'hidden', 'absent', 'stale', 'blocked', 'unsupported'])
const CANDIDATE_ADAPTER_PRIORITY = new Map([
  ['aos-toolkit-semantic-target', 80],
  ['aos-browser-dom-element-picker', 72],
  ['aos-canvas-window', 60],
  ['macos-ax', 50],
  ['chrome-seam', 30],
])
const ACTIONABLE_CAPABILITIES = new Set(['press', 'focus', 'set_value', 'scroll', 'increment', 'decrement'])
const NOISY_SUBJECT_KINDS = new Set(['group', 'container', 'region', 'main', 'section', 'generic', 'div'])
const IMPLICIT_ROOT_ID_PATTERNS = [
  /^desktop[-_]world$/i,
  /^aos-desktop-world-stage$/i,
  /^desktop-world:/i,
  /^display[-_:]/i,
  /^avatar-main$/i,
  /^root$/i,
]

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function stableId(prefix, parts = []) {
  const body = parts
    .map((part) => text(part).trim())
    .filter(Boolean)
    .join(':')
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return body ? `${prefix}:${body}` : `${prefix}:${Math.random().toString(36).slice(2)}`
}

function subjectPathFromNode(node = {}) {
  if (Array.isArray(node.subject_path)) return node.subject_path.map((part) => text(part)).filter(Boolean)
  if (Array.isArray(node.path)) return node.path.map((part) => text(part)).filter(Boolean)
  if (node.subject_path) return text(node.subject_path).split('/').filter(Boolean)
  if (node.path) return text(node.path).split('/').filter(Boolean)
  return [text(node.id || node.subject_id || node.label, 'unknown')]
}

export function normalizeAnnotationRectLike(rect = null) {
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const w = Number(rect.w ?? rect.width)
  const h = Number(rect.h ?? rect.height)
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

function rectArea(rect = null) {
  const normalized = normalizeAnnotationRectLike(rect)
  return normalized ? Math.max(0, normalized.w) * Math.max(0, normalized.h) : Infinity
}

function rectContainsPoint(rect = null, point = null) {
  const normalized = normalizeAnnotationRectLike(rect)
  if (!normalized || !point) return false
  const x = Number(point.x)
  const y = Number(point.y)
  return Number.isFinite(x)
    && Number.isFinite(y)
    && x >= normalized.x
    && x <= normalized.x + normalized.w
    && y >= normalized.y
    && y <= normalized.y + normalized.h
}

export function isImplicitAnnotationRootCandidate(candidate = {}) {
  const adapter = text(candidate.adapter_id || candidate.projection?.adapter_id)
  const id = text(candidate.id || candidate.subject_id)
  const kind = text(candidate.kind || candidate.subject_kind || candidate.role || candidate.type || candidate.projection?.subject_kind)
  if (candidate.implicit_root === true || candidate.is_implicit_root === true) return true
  if (adapter === 'aos-desktop-world' || adapter === 'aos-display') return true
  if (kind === 'desktop-world' || kind === 'desktop_world' || kind === 'display') return true
  if (IMPLICIT_ROOT_ID_PATTERNS.some((pattern) => pattern.test(id))) return true
  return false
}

function candidateDepth(candidate = {}) {
  if (Number.isFinite(Number(candidate.depth))) return Number(candidate.depth)
  const path = Array.isArray(candidate.subject_path) ? candidate.subject_path : candidate.projection?.subject_path
  return Array.isArray(path) ? path.length : 0
}

function candidateVisibleRect(candidate = {}) {
  return normalizeAnnotationRectLike(
    candidate.projection?.visible_display_rect
      || candidate.projection?.display_space_rect
      || candidate.visible_display_rect
      || candidate.display_space_rect
      || candidate.rect,
  )
}

function normalizeCapabilities(input = {}) {
  const raw = input.capabilities || input.normalized_capabilities || input.actions || input.action_names || input.ax_actions || []
  const values = Array.isArray(raw)
    ? raw
    : (typeof raw === 'object' ? Object.entries(raw).filter(([, enabled]) => enabled).map(([name]) => name) : [])
  const mapped = values.map((value) => {
    const name = text(value).replace(/^AX/i, '').replace(/_/g, '-').toLowerCase()
    if (name === 'press') return 'press'
    if (name === 'focus' || name === 'focused') return 'focus'
    if (name === 'setvalue' || name === 'set-value') return 'set_value'
    if (name === 'scroll') return 'scroll'
    if (name === 'increment') return 'increment'
    if (name === 'decrement') return 'decrement'
    return name.replace(/-/g, '_')
  }).filter(Boolean)
  return [...new Set(mapped)]
}

function normalizedCandidateAdapterPriority(candidate = {}) {
  const adapter = text(candidate.adapter_id || candidate.projection?.adapter_id)
  return Number(candidate.adapter_priority ?? CANDIDATE_ADAPTER_PRIORITY.get(adapter) ?? 0)
}

function candidateLabelQuality(candidate = {}) {
  const label = text(candidate.label || candidate.accessible_name || candidate.title || candidate.name || candidate.role)
  if (!label) return 0
  if (label.length < 2) return 1
  return Math.min(8, 2 + Math.floor(label.length / 12))
}

function candidateActionability(candidate = {}) {
  const capabilities = normalizeCapabilities(candidate)
  return capabilities.some((capability) => ACTIONABLE_CAPABILITIES.has(capability)) ? 12 : 0
}

function candidateKindPenalty(candidate = {}) {
  const kind = text(candidate.subject_kind || candidate.kind || candidate.role || candidate.type).toLowerCase()
  if (!kind) return 0
  return NOISY_SUBJECT_KINDS.has(kind) ? 8 : 0
}

export function normalizeAnnotationProjectionStatus(input = {}) {
  const rawStatus = text(input.current_render_status || input.render_status || input.status || input.projection_status, 'visible')
  const normalizedStatus = rawStatus === 'projectable'
    ? 'visible'
    : (rawStatus === 'out_of_viewport' || rawStatus === 'resolved_offscreen' ? 'offscreen_scrollable' : rawStatus)
  const status = RENDER_STATUSES.has(normalizedStatus) ? normalizedStatus : 'unsupported'
  const displayRect = normalizeAnnotationRectLike(input.display_space_rect || input.display_rect || input.visible_display_rect)
  const projectable = input.projectable ?? input.can_project_display_overlay ?? status === 'visible'
  const blockerReason = text(input.blocker_reason || input.blocker?.reason || input.reason)
  return {
    status,
    current_render_status: status,
    projectable: Boolean(projectable) && status === 'visible',
    can_project_display_overlay: Boolean(projectable) && status === 'visible' && Boolean(displayRect),
    can_reveal: Boolean(input.can_reveal),
    visible_display_rect: displayRect ? clone(displayRect) : null,
    display_space_rect: status === 'visible' && displayRect ? clone(displayRect) : null,
    coordinate_space: text(input.coordinate_space || input.rect_coordinate_space || input.display_rect_coordinate_space, 'native_display'),
    local_space_rect: normalizeAnnotationRectLike(input.local_space_rect),
    minimap_rect: input.minimap_rect ? clone(input.minimap_rect) : null,
    ancestor_viewport_clip_chain: Array.isArray(input.ancestor_viewport_clip_chain) ? clone(input.ancestor_viewport_clip_chain) : [],
    scrollable_ancestor_chain: Array.isArray(input.scrollable_ancestor_chain) ? clone(input.scrollable_ancestor_chain) : [],
    z_order_evidence: input.z_order_evidence ? clone(input.z_order_evidence) : null,
    blocker_reason: blockerReason,
    blocker: input.blocker ? clone(input.blocker) : (blockerReason ? { reason: blockerReason } : null),
    adapter_result: input.adapter_result ? clone(input.adapter_result) : null,
    refreshed_at: text(input.refreshed_at, new Date(0).toISOString()),
    provenance_source_payload_id: text(input.provenance_source_payload_id),
  }
}

export function normalizeAnnotationCandidate(candidate = {}, options = {}) {
  if (!candidate || typeof candidate !== 'object') return null
  const projection = normalizeAnnotationProjectionStatus(candidate.projection || {
    ...candidate,
    display_space_rect: candidate.display_space_rect || candidate.visible_display_rect || candidate.rect,
  })
  const rect = candidateVisibleRect({ ...candidate, projection }) || projection.visible_display_rect || projection.display_space_rect
  const rootId = text(candidate.root_id || candidate.projection?.root_id || candidate.canvas_id || candidate.window_id || options.root_id, 'main')
  const rootLabel = text(candidate.root_label || candidate.projection?.root_label || candidate.display_label || rootId, rootId)
  const subjectId = text(candidate.subject_id || candidate.id || candidate.projection?.subject_id, stableId('candidate', [rootId, candidate.label || candidate.role]))
  const subjectPath = subjectPathFromNode(candidate.subject_path ? candidate : (candidate.projection || candidate))
  const actionNames = [
    ...(Array.isArray(candidate.action_names) ? candidate.action_names : []),
    ...(Array.isArray(candidate.actions) ? candidate.actions : []),
    ...(Array.isArray(candidate.ax_actions) ? candidate.ax_actions : []),
  ].map((item) => text(item)).filter(Boolean)
  const capabilities = normalizeCapabilities({ ...candidate, action_names: actionNames })
  const blockerReason = text(candidate.blocker_reason || candidate.reason || projection.blocker_reason)
  return {
    ...clone(candidate),
    id: text(candidate.id, subjectId),
    adapter_id: text(candidate.adapter_id || candidate.projection?.adapter_id || projection.adapter_id, 'aos-canvas-window'),
    root_id: rootId,
    root_label: rootLabel,
    root_kind: text(candidate.root_kind || candidate.root_type || candidate.display_kind || 'surface_root'),
    subject_id: subjectId,
    subject_path: subjectPath.length ? subjectPath : [rootId, subjectId],
    subject_kind: text(candidate.subject_kind || candidate.kind || candidate.role || candidate.type || projection.subject_kind, 'surface_subject'),
    role: text(candidate.role || candidate.subject_kind || candidate.kind),
    label: text(candidate.label || candidate.accessible_name || candidate.title || candidate.name || subjectId),
    value_excerpt: text(candidate.value_excerpt || candidate.text_excerpt || candidate.value || candidate.text).slice(0, 200),
    display_space_rect: rect ? clone(rect) : null,
    local_space_rect: normalizeAnnotationRectLike(candidate.local_space_rect || projection.local_space_rect),
    projection,
    current_render_status: projection.current_render_status,
    action_names: [...new Set(actionNames)],
    capabilities,
    normalized_capabilities: capabilities,
    state_id: text(candidate.state_id || candidate.source_event_id || candidate.projection?.state_id),
    source_event_id: text(candidate.source_event_id),
    confidence: Number.isFinite(Number(candidate.confidence)) ? Number(candidate.confidence) : null,
    priority_evidence: candidate.priority_evidence ? clone(candidate.priority_evidence) : {
      adapter_priority: normalizedCandidateAdapterPriority(candidate),
      actionable: candidateActionability({ ...candidate, capabilities }) > 0,
      label_quality: candidateLabelQuality(candidate),
    },
    blocker_reason: blockerReason,
    blocker: candidate.blocker ? clone(candidate.blocker) : (blockerReason ? { reason: blockerReason } : projection.blocker),
    source_metadata: clone(candidate.source_metadata || candidate.source_tree_node_metadata || candidate.metadata || {}),
  }
}

export function chooseAnnotationCandidate(candidates = [], point = null) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeAnnotationCandidate(candidate))
    .filter((candidate) => candidate && !isImplicitAnnotationRootCandidate(candidate))
    .map((candidate) => ({ candidate, rect: candidateVisibleRect(candidate) }))
    .filter(({ candidate, rect }) => {
      if (!rect) return false
      if (candidate.projection && candidate.projection.can_project_display_overlay === false) return false
      if (candidate.blocker_reason) return false
      return point ? rectContainsPoint(rect, point) : true
    })
    .sort((a, b) => {
      const areaDelta = rectArea(a.rect) - rectArea(b.rect)
      if (areaDelta !== 0) return areaDelta
      const adapterDelta = normalizedCandidateAdapterPriority(b.candidate) - normalizedCandidateAdapterPriority(a.candidate)
      if (adapterDelta !== 0) return adapterDelta
      const actionDelta = candidateActionability(b.candidate) - candidateActionability(a.candidate)
      if (actionDelta !== 0) return actionDelta
      const labelDelta = candidateLabelQuality(b.candidate) - candidateLabelQuality(a.candidate)
      if (labelDelta !== 0) return labelDelta
      const noisyDelta = candidateKindPenalty(a.candidate) - candidateKindPenalty(b.candidate)
      if (noisyDelta !== 0) return noisyDelta
      const depthDelta = candidateDepth(b.candidate) - candidateDepth(a.candidate)
      if (depthDelta !== 0) return depthDelta
      return text(a.candidate.id).localeCompare(text(b.candidate.id))
    })
  return ranked[0]?.candidate || null
}
