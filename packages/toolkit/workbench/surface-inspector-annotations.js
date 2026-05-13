export const SURFACE_INSPECTOR_ANNOTATION_SCHEMA = 'surface_inspector_annotation_state'
export const SURFACE_INSPECTOR_ANNOTATION_VERSION = '0.1.0'

const FRAME_PIN_KIND = 'frame_pin'
const COMMENT_KIND = 'comment'
const DEFAULT_ACTOR = Object.freeze({ role: 'operator', id: 'human' })
const RENDER_STATUSES = new Set(['visible', 'clipped', 'offscreen_scrollable', 'virtualized', 'hidden', 'absent', 'stale', 'unsupported'])
const REVEAL_STATUSES = new Set(['already_visible', 'revealed', 'blocked', 'virtualized', 'unsupported', 'target_absent', 'adapter_error'])
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

function isoNow(now = Date.now()) {
  if (typeof now === 'string') return now
  const date = now instanceof Date ? now : new Date(now)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
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

function normalizeActor(actor = DEFAULT_ACTOR) {
  return {
    role: text(actor.role, DEFAULT_ACTOR.role),
    id: text(actor.id, DEFAULT_ACTOR.id),
  }
}

function normalizeRectLike(rect = null) {
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const w = Number(rect.w ?? rect.width)
  const h = Number(rect.h ?? rect.height)
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

function normalizeNativeWindowPayload(input = {}) {
  if (!input || typeof input !== 'object') return null
  const payload = input.data && typeof input.data === 'object' ? input.data : input
  const windowId = text(payload.window_id || payload.windowID || payload.id)
  const pid = payload.pid ?? payload.app_pid ?? payload.owner_pid
  const appName = text(payload.app || payload.app_name || payload.owner_name || payload.name)
  const bounds = normalizeRectLike(payload.bounds || payload.frame || payload.rect)
  if (!windowId && !pid && !appName) return null
  return {
    window_id: windowId,
    app_name: appName,
    pid: Number.isFinite(Number(pid)) ? Number(pid) : null,
    bundle_id: text(payload.bundle_id || payload.bundleID),
    title: text(payload.title || payload.window_title),
    bounds,
  }
}

function nativeWindowRootId(window = {}) {
  return stableId('native-window', [window.window_id || window.pid, window.app_name])
}

export function buildNativeWindowSurfaceInspectorCandidate(input = {}, options = {}) {
  const window = normalizeNativeWindowPayload(input)
  if (!window) return null
  const rect = window.bounds
  const rootId = text(options.root_id, nativeWindowRootId(window))
  const rootLabel = text(options.root_label || window.title || window.app_name || rootId, rootId)
  const projection = rect
    ? {
        adapter_id: 'macos-ax',
        root_id: rootId,
        subject_id: rootId,
        subject_kind: 'native_window',
        status: 'visible',
        projectable: true,
        can_project_display_overlay: true,
        can_reveal: false,
        reveal_blocker_reason: 'bounded_ax_reveal_unavailable',
        display_space_rect: rect,
        visible_display_rect: rect,
        coordinate_space: 'native_display',
        refreshed_at: text(options.refreshed_at || input.ts, new Date(0).toISOString()),
      }
    : {
        adapter_id: 'macos-ax',
        root_id: rootId,
        subject_id: rootId,
        subject_kind: 'native_window',
        status: 'unsupported',
        projectable: false,
        can_project_display_overlay: false,
        can_reveal: false,
        reveal_blocker_reason: 'bounded_ax_reveal_unavailable',
        blocker_reason: 'native_window_bounds_unavailable',
        refreshed_at: text(options.refreshed_at || input.ts, new Date(0).toISOString()),
      }
  return normalizeSurfaceInspectorAnnotationCandidate({
    id: rootId,
    adapter_id: 'macos-ax',
    root_id: rootId,
    root_label: rootLabel,
    root_kind: 'native_window',
    subject_id: rootId,
    subject_path: ['native_window', rootId],
    subject_kind: 'native_window',
    role: 'native_window',
    label: rootLabel,
    display_space_rect: rect,
    projection,
    blocker_reason: projection.blocker_reason,
    source_metadata: {
      adapter_scope: 'current_cursor_window',
      window_id: window.window_id,
      app_name: window.app_name,
      pid: window.pid,
      bundle_id: window.bundle_id,
      title: window.title,
      bounds: rect,
      source_event_id: text(input.ref || input.id || options.source_event_id),
      reveal_blocker_reason: 'bounded_ax_reveal_unavailable',
    },
  })
}

function selectedNativeRootEvidence(root = {}) {
  const rawMetadata = root.source_metadata || root.source_tree_node_metadata || root.metadata || {}
  const metadata = rawMetadata.source_metadata || rawMetadata.source_tree_node_metadata?.source_metadata || rawMetadata
  return {
    root_id: text(root.root_id || root.subject_id || root.id),
    subject_id: text(root.subject_id || root.id),
    window_id: text(metadata.window_id || root.window_id),
    pid: Number.isFinite(Number(metadata.pid ?? root.pid)) ? Number(metadata.pid ?? root.pid) : null,
    app_name: text(metadata.app_name || metadata.app || root.app_name || root.app),
    bundle_id: text(metadata.bundle_id || root.bundle_id),
  }
}

function nativeRootMatchesWindow(rootEvidence = {}, window = null) {
  if (!window) return { ok: false, reason: 'native_ax_stale_cursor_context' }
  if (rootEvidence.window_id && window.window_id && rootEvidence.window_id !== window.window_id) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }
  if (rootEvidence.pid !== null && window.pid !== null && rootEvidence.pid !== window.pid) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }
  if (rootEvidence.bundle_id && window.bundle_id && rootEvidence.bundle_id !== window.bundle_id) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }
  if (rootEvidence.app_name && window.app_name && rootEvidence.app_name !== window.app_name) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }
  return { ok: true, reason: '' }
}

export function buildNativeAxElementSurfaceInspectorCandidate(input = {}, options = {}) {
  if (!input || typeof input !== 'object') return null
  const payload = input.data && typeof input.data === 'object' ? input.data : input
  const selectedRoot = options.selected_root || options.scope || null
  const rootEvidence = selectedNativeRootEvidence(selectedRoot || {})
  const window = normalizeNativeWindowPayload(options.window || options.cursor_window || payload.window || {})
  const rootMatch = nativeRootMatchesWindow(rootEvidence, window)
  const bounds = normalizeRectLike(payload.bounds || payload.frame || payload.rect)
  const role = text(payload.role || payload.ax_role || payload.kind, 'ax_element')
  const label = text(payload.label || payload.title || payload.value || role, role)
  const contextPath = Array.isArray(payload.context_path) ? payload.context_path.map((part) => text(part)).filter(Boolean) : []
  const subjectId = text(payload.subject_id || payload.id, stableId('ax-element', [
    rootEvidence.root_id || rootEvidence.subject_id || window?.window_id,
    role,
    label,
    ...contextPath,
  ]))
  const blockerReason = !rootMatch.ok
    ? rootMatch.reason
    : (!bounds ? 'bounded_ax_projection_unavailable' : text(payload.blocker_reason || payload.reason))
  const status = !rootMatch.ok ? 'stale' : (blockerReason ? 'unsupported' : 'visible')
  const projection = {
    adapter_id: 'macos-ax',
    root_id: rootEvidence.root_id || rootEvidence.subject_id || nativeWindowRootId(window || {}),
    subject_id: subjectId,
    subject_kind: role,
    status,
    projectable: status === 'visible' && Boolean(bounds),
    can_project_display_overlay: status === 'visible' && Boolean(bounds),
    can_reveal: false,
    reveal_blocker_reason: 'bounded_ax_reveal_unavailable',
    display_space_rect: status === 'visible' ? bounds : null,
    visible_display_rect: status === 'visible' ? bounds : null,
    coordinate_space: 'native_display',
    blocker_reason: blockerReason,
    refreshed_at: text(options.refreshed_at || input.ts, new Date(0).toISOString()),
  }
  return normalizeSurfaceInspectorAnnotationCandidate({
    id: subjectId,
    adapter_id: 'macos-ax',
    root_id: projection.root_id,
    root_label: text(selectedRoot?.root_label || selectedRoot?.label || window?.title || window?.app_name || projection.root_id, projection.root_id),
    root_kind: 'native_window',
    subject_id: subjectId,
    subject_path: ['native_window', projection.root_id, 'ax_element', ...contextPath, subjectId],
    subject_kind: role,
    role,
    title: payload.title,
    label,
    value: payload.value,
    enabled: payload.enabled,
    display_space_rect: status === 'visible' ? bounds : null,
    local_space_rect: normalizeRectLike(payload.local_space_rect),
    action_names: payload.action_names || payload.actions || payload.ax_actions || [],
    capabilities: payload.capabilities || payload.normalized_capabilities || [],
    projection,
    blocker_reason: blockerReason,
    source_metadata: {
      adapter_scope: 'current_cursor_ax_element',
      role,
      title: text(payload.title),
      label: text(payload.label),
      value: text(payload.value),
      enabled: payload.enabled,
      bounds,
      context_path: contextPath,
      action_names: Array.isArray(payload.action_names) ? [...payload.action_names] : [],
      capabilities: Array.isArray(payload.capabilities) ? [...payload.capabilities] : [],
      window_id: window?.window_id || '',
      app_name: window?.app_name || '',
      pid: window?.pid ?? null,
      bundle_id: window?.bundle_id || '',
      source_event_id: text(input.ref || input.id || options.source_event_id),
      reveal_blocker_reason: 'bounded_ax_reveal_unavailable',
    },
  })
}

function rectArea(rect = null) {
  const normalized = normalizeRectLike(rect)
  return normalized ? Math.max(0, normalized.w) * Math.max(0, normalized.h) : Infinity
}

function rectContainsPoint(rect = null, point = null) {
  const normalized = normalizeRectLike(rect)
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

export function isImplicitSurfaceInspectorRootCandidate(candidate = {}) {
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
  return normalizeRectLike(
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

export function normalizeSurfaceInspectorAnnotationCandidate(candidate = {}, options = {}) {
  if (!candidate || typeof candidate !== 'object') return null
  const projection = normalizeProjectionStatus(candidate.projection || {
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
    local_space_rect: normalizeRectLike(candidate.local_space_rect || projection.local_space_rect),
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

export function chooseSurfaceInspectorAnnotationCandidate(candidates = [], point = null) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeSurfaceInspectorAnnotationCandidate(candidate))
    .filter((candidate) => candidate && !isImplicitSurfaceInspectorRootCandidate(candidate))
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

function normalizeProjectionStatus(input = {}) {
  const rawStatus = text(input.current_render_status || input.render_status || input.status || input.projection_status, 'visible')
  const normalizedStatus = rawStatus === 'projectable'
    ? 'visible'
    : (rawStatus === 'out_of_viewport' || rawStatus === 'resolved_offscreen' ? 'offscreen_scrollable' : rawStatus)
  const status = RENDER_STATUSES.has(normalizedStatus) ? normalizedStatus : 'unsupported'
  const displayRect = normalizeRectLike(input.display_space_rect || input.display_rect || input.visible_display_rect)
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
    local_space_rect: normalizeRectLike(input.local_space_rect),
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

function normalizeRevealResult(input = null) {
  if (!input) return null
  const status = REVEAL_STATUSES.has(input.status) ? input.status : 'unsupported'
  return {
    status,
    pin_id: text(input.pin_id),
    adapter_id: text(input.adapter_id),
    subject_id: text(input.subject_id),
    requested_at: isoNow(input.requested_at || input.at || Date.now()),
    completed_at: isoNow(input.completed_at || input.at || Date.now()),
    blocker_reason: text(input.blocker_reason || input.reason || input.error),
    projection: input.projection ? normalizeProjectionStatus(input.projection) : null,
  }
}

export function createSurfaceInspectorAnnotationState(input = {}) {
  const state = {
    schema: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
    version: SURFACE_INSPECTOR_ANNOTATION_VERSION,
    annotation_mode: { active: Boolean(input.annotation_mode?.active ?? input.active) },
    active_edge_id: text(input.active_edge_id),
    active_frame_id: text(input.active_frame_id),
    pins: Array.isArray(input.pins) ? input.pins.map(normalizePinRecord) : [],
    comments: Array.isArray(input.comments) ? input.comments.map(normalizeCommentRecord) : [],
    projection_capabilities: normalizeProjectionCapabilities(input.projection_capabilities),
    adapter_capability_summary: normalizeAdapterCapabilitySummary(input.adapter_capability_summary || input.projection_capabilities),
    last_reveal_request: input.last_reveal_request ? clone(input.last_reveal_request) : null,
    last_reveal_result: normalizeRevealResult(input.last_reveal_result),
    last_hover_candidate: input.last_hover_candidate ? clone(input.last_hover_candidate) : null,
    annotation_scope_stack: Array.isArray(input.annotation_scope_stack) ? input.annotation_scope_stack.map(normalizeScopeFrame).filter(Boolean) : [],
    last_projection_blocker: input.last_projection_blocker ? clone(input.last_projection_blocker) : null,
    clear_confirmation: input.clear_confirmation ? clone(input.clear_confirmation) : null,
    editor: input.editor ? clone(input.editor) : null,
    snapshot_version: Number.isFinite(Number(input.snapshot_version)) ? Number(input.snapshot_version) : 0,
  }
  reconcileActiveFrame(state)
  return state
}

export function normalizeProjectionCapabilities(input = []) {
  const defaults = [
    { adapter_id: 'aos-canvas-window', status: 'visible', display_overlay: true, minimap: true, tree: true, can_reveal: true },
    { adapter_id: 'aos-toolkit-semantic-target', status: 'visible', display_overlay: true, minimap: true, tree: true, can_reveal: true },
    { adapter_id: 'aos-object-registry', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'object_registry_no_display_projection' },
    { adapter_id: 'macos-ax', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'bounded_ax_reveal_unavailable' },
    { adapter_id: 'chrome-seam', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'browser_dom_cdp_deferred' },
    { adapter_id: 'generic-dom', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false },
    { adapter_id: 'three-canvas', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false },
  ]
  const overrides = new Map((Array.isArray(input) ? input : []).map((item) => [text(item.adapter_id || item.id), item]))
  return defaults.map((item) => ({ ...item, ...(overrides.get(item.adapter_id) || {}) }))
}

export function normalizeAdapterCapabilitySummary(input = []) {
  return normalizeProjectionCapabilities(input).map((item) => ({
    adapter_id: text(item.adapter_id || item.id),
    status: text(item.status, 'unsupported'),
    can_project_display_overlay: Boolean(item.can_project_display_overlay ?? item.display_overlay),
    can_reveal: Boolean(item.can_reveal),
    tree: item.tree !== false,
    minimap: item.minimap !== false,
    blocker_reason: text(item.blocker_reason || item.reason),
  }))
}

export function normalizePinRecord(pin = {}) {
  const node = pin.source_node_metadata || pin.node || {}
  const subjectPath = subjectPathFromNode(pin.subject_path ? pin : node)
  const id = text(pin.id, stableId('pin', [pin.root_id, ...subjectPath]))
  const created = isoNow(pin.created_at || pin.updated_at || Date.now())
  return {
    id,
    kind: FRAME_PIN_KIND,
    root_id: text(pin.root_id || node.root_id || node.display_id || node.root_label, 'main'),
    root_label: text(pin.root_label || node.root_label || pin.root_id || 'main'),
    root_kind: text(pin.root_kind || node.root_kind || node.root_type || 'surface_root'),
    subject_id: text(pin.subject_id || node.subject_id || node.id || subjectPath.at(-1), id),
    subject_path: subjectPath,
    parent_pin_id: pin.parent_pin_id ? text(pin.parent_pin_id) : null,
    depth: Number.isFinite(Number(pin.depth)) ? Number(pin.depth) : Math.max(0, subjectPath.length - 1),
    adapter_id: text(pin.adapter_id || node.adapter_id, 'aos-canvas-window'),
    source_tree_node_metadata: clone(pin.source_tree_node_metadata || node),
    projection: normalizeProjectionStatus(pin.projection || pin),
    created_at: created,
    updated_at: isoNow(pin.updated_at || created),
    actor: normalizeActor(pin.actor),
    status: text(pin.status, 'active'),
    expanded: pin.expanded === true,
  }
}

export function normalizeCommentRecord(comment = {}) {
  const created = isoNow(comment.created_at || comment.updated_at || Date.now())
  return {
    id: text(comment.id, stableId('comment', [comment.pin_id, comment.text || created])),
    kind: COMMENT_KIND,
    pin_id: text(comment.pin_id),
    subject_id: text(comment.subject_id),
    subject_path: subjectPathFromNode(comment),
    text: text(comment.text),
    status: text(comment.status, 'open'),
    created_at: created,
    updated_at: isoNow(comment.updated_at || created),
    actor: normalizeActor(comment.actor),
  }
}

function activePins(state) {
  return state.pins.filter((pin) => pin.status !== 'removed')
}

function activeComments(state) {
  return state.comments.filter((comment) => comment.status !== 'removed')
}

function bump(state) {
  state.snapshot_version += 1
  return state
}

function reconcileActiveFrame(state) {
  const pins = activePins(state)
  if (state.active_frame_id && pins.some((pin) => pin.id === state.active_frame_id)) {
    state.active_edge_id = state.active_edge_id || `edge:${state.active_frame_id}`
    return state
  }
  const deepest = [...pins].sort((a, b) => b.depth - a.depth || a.created_at.localeCompare(b.created_at))[0]
  state.active_frame_id = deepest?.id || ''
  state.active_edge_id = deepest ? `edge:${deepest.id}` : ''
  return state
}

export function setSurfaceInspectorAnnotationMode(state, active, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const wantsActive = Boolean(active)
  if (!wantsActive && hasSurfaceInspectorAnnotations(next) && !options.confirmed) {
    next.clear_confirmation = {
      reason: text(options.reason, 'annotation_mode_off'),
      message: 'Annotations are ephemeral and will be lost.',
      requested_active: false,
      descendant_pin_id: options.descendant_pin_id || null,
    }
    return next
  }
  next.annotation_mode.active = wantsActive
  if (wantsActive) {
    next.last_hover_candidate = null
    next.last_projection_blocker = null
  }
  if (!wantsActive) {
    next.pins = []
    next.comments = []
    next.annotation_scope_stack = []
    next.active_edge_id = ''
    next.active_frame_id = ''
    next.last_hover_candidate = null
    next.last_projection_blocker = null
    next.editor = null
    next.clear_confirmation = null
    next.last_reveal_request = null
    next.last_reveal_result = null
  }
  return bump(next)
}

export function hasSurfaceInspectorAnnotations(state) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  return activePins(normalized).length > 0 || activeComments(normalized).length > 0
}

export function pinSurfaceInspectorFrame(state, node = {}, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const subjectPath = subjectPathFromNode(node)
  const parentPinId = (options.parent_pin_id ?? next.active_frame_id) || null
  const rootId = text(options.root_id || node.root_id || node.display_id || node.root_label, 'main')
  const id = text(options.id, stableId('pin', [rootId, ...subjectPath]))
  const existingIndex = next.pins.findIndex((pin) => pin.id === id)
  const pin = normalizePinRecord({
    id,
    root_id: rootId,
    root_label: options.root_label || node.root_label || rootId,
    subject_id: node.subject_id || node.id,
    subject_path: subjectPath,
    parent_pin_id: parentPinId,
    depth: Number.isFinite(Number(options.depth)) ? Number(options.depth) : Math.max(0, subjectPath.length - 1),
    adapter_id: options.adapter_id || node.adapter_id || 'aos-canvas-window',
    source_tree_node_metadata: node,
    projection: options.projection || node.projection || { status: 'projectable', projectable: true },
    actor: options.actor,
    created_at: options.created_at || Date.now(),
    updated_at: options.updated_at || Date.now(),
    status: options.status || 'active',
  })
  if (existingIndex >= 0) {
    next.pins[existingIndex] = { ...next.pins[existingIndex], ...pin, created_at: next.pins[existingIndex].created_at }
  } else {
    next.pins.push(pin)
  }
  next.active_frame_id = id
  next.active_edge_id = `edge:${id}`
  next.annotation_scope_stack = [
    ...next.annotation_scope_stack.filter((frame) => frame.pin_id !== id && frame.subject_id !== pin.subject_id),
    scopeFrameFromPin(pin),
  ]
  next.last_projection_blocker = pin.projection.can_project_display_overlay ? null : pin.projection.blocker
  return bump(next)
}

export function selectSurfaceInspectorAnnotationFrame(state, pinId, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const pin = activePins(next).find((item) => item.id === pinId)
  if (!pin) return next
  next.active_frame_id = pin.id
  next.active_edge_id = `edge:${pin.id}`
  next.annotation_scope_stack = next.annotation_scope_stack.filter((frame) => frame.pin_id !== pin.id)
  next.annotation_scope_stack.push(scopeFrameFromPin(pin))
  if (options.projection) pin.projection = normalizeProjectionStatus(options.projection)
  next.last_projection_blocker = pin.projection.can_project_display_overlay ? null : pin.projection.blocker
  return bump(next)
}

export function popSurfaceInspectorAnnotationScope(state) {
  const next = createSurfaceInspectorAnnotationState(state)
  if (next.annotation_scope_stack.length === 0) return next
  next.annotation_scope_stack = next.annotation_scope_stack.slice(0, -1)
  const top = next.annotation_scope_stack.at(-1)
  next.active_frame_id = top?.pin_id || ''
  next.active_edge_id = top?.pin_id ? `edge:${top.pin_id}` : ''
  next.last_hover_candidate = null
  next.last_projection_blocker = null
  if (!top) reconcileActiveFrame(next)
  return bump(next)
}

export function clearSurfaceInspectorAnnotationScope(state) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.annotation_scope_stack = []
  next.active_frame_id = ''
  next.active_edge_id = ''
  next.last_hover_candidate = null
  next.last_projection_blocker = null
  reconcileActiveFrame(next)
  return bump(next)
}

export function jumpSurfaceInspectorAnnotationScope(state, pinId = '') {
  const next = createSurfaceInspectorAnnotationState(state)
  const id = text(pinId)
  if (!id) {
    next.annotation_scope_stack = []
    next.last_hover_candidate = null
    next.last_projection_blocker = null
    reconcileActiveFrame(next)
    return bump(next)
  }
  const pinsById = new Map(activePins(next).map((pin) => [pin.id, pin]))
  const pin = pinsById.get(id)
  if (!pin) return next
  const stack = []
  let cursor = pin
  while (cursor) {
    stack.unshift(scopeFrameFromPin(cursor))
    cursor = cursor.parent_pin_id ? pinsById.get(cursor.parent_pin_id) : null
  }
  next.annotation_scope_stack = stack
  next.active_frame_id = pin.id
  next.active_edge_id = `edge:${pin.id}`
  next.last_hover_candidate = null
  next.last_projection_blocker = null
  return bump(next)
}

export function refreshSurfaceInspectorPinProjection(state, pinId, projection = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const pin = next.pins.find((item) => item.id === pinId)
  if (!pin) return next
  pin.projection = normalizeProjectionStatus(projection)
  pin.updated_at = isoNow(projection.refreshed_at || Date.now())
  if (pin.id === next.active_frame_id) next.last_projection_blocker = pin.projection.can_project_display_overlay ? null : pin.projection.blocker
  return bump(next)
}

export function applySurfaceInspectorRevealResult(state, pinId, result = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const pin = next.pins.find((item) => item.id === pinId)
  const reveal = normalizeRevealResult({
    ...result,
    pin_id: pinId,
    adapter_id: result.adapter_id || pin?.adapter_id,
    subject_id: result.subject_id || pin?.subject_id,
  })
  next.last_reveal_result = reveal
  next.last_reveal_request = {
    pin_id: pinId,
    adapter_id: reveal.adapter_id,
    subject_id: reveal.subject_id,
    requested_at: reveal.requested_at,
  }
  if (pin && reveal.projection) {
    pin.projection = reveal.projection
    pin.updated_at = reveal.completed_at
  }
  if (pin && (reveal.status === 'target_absent' || reveal.status === 'adapter_error')) {
    pin.projection = normalizeProjectionStatus({
      status: reveal.status === 'target_absent' ? 'absent' : 'unsupported',
      blocker_reason: reveal.blocker_reason,
      can_reveal: false,
    })
  }
  return bump(next)
}

export function addSurfaceInspectorComment(state, pinId, textValue, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const pin = next.pins.find((item) => item.id === pinId && item.status !== 'removed')
  if (!pin) throw new TypeError(`unknown pin ${pinId}`)
  const comment = normalizeCommentRecord({
    id: options.id,
    pin_id: pin.id,
    subject_id: pin.subject_id,
    subject_path: pin.subject_path,
    text: textValue,
    status: options.status || 'open',
    actor: options.actor,
    created_at: options.created_at || Date.now(),
    updated_at: options.updated_at || Date.now(),
  })
  next.comments.push(comment)
  next.active_frame_id = pin.id
  next.active_edge_id = `edge:${pin.id}`
  next.editor = null
  return bump(next)
}

export function updateSurfaceInspectorComment(state, commentId, textValue, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.comments = next.comments.map((comment) => (
    comment.id === commentId
      ? { ...comment, text: text(textValue), updated_at: isoNow(options.updated_at || Date.now()) }
      : comment
  ))
  next.editor = null
  return bump(next)
}

export function deleteSurfaceInspectorComment(state, commentId, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.comments = next.comments.map((comment) => (
    comment.id === commentId
      ? { ...comment, status: 'removed', updated_at: isoNow(options.updated_at || Date.now()) }
      : comment
  ))
  return bump(next)
}

function descendantPinIds(state, pinId) {
  const found = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const pin of activePins(state)) {
      if (pin.parent_pin_id === pinId || found.has(pin.parent_pin_id)) {
        if (!found.has(pin.id)) {
          found.add(pin.id)
          changed = true
        }
      }
    }
  }
  return found
}

export function unpinSurfaceInspectorFrame(state, pinId, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const descendants = descendantPinIds(next, pinId)
  const descendantComments = activeComments(next).filter((comment) => descendants.has(comment.pin_id) || comment.pin_id === pinId)
  if ((descendants.size > 0 || descendantComments.length > 0) && !options.confirmed) {
    next.clear_confirmation = {
      reason: 'unpin_descendants',
      message: 'Unpinning this frame will remove descendant pins and comments.',
      descendant_pin_id: pinId,
      descendant_count: descendants.size,
      comment_count: descendantComments.length,
    }
    return next
  }
  const removeIds = new Set([pinId, ...descendants])
  next.pins = next.pins.map((pin) => (
    removeIds.has(pin.id) ? { ...pin, status: 'removed', updated_at: isoNow(options.updated_at || Date.now()) } : pin
  ))
  next.comments = next.comments.map((comment) => (
    removeIds.has(comment.pin_id) ? { ...comment, status: 'removed', updated_at: isoNow(options.updated_at || Date.now()) } : comment
  ))
  const removed = state.pins?.find?.((pin) => pin.id === pinId)
  next.active_frame_id = removed?.parent_pin_id || ''
  next.clear_confirmation = null
  reconcileActiveFrame(next)
  return bump(next)
}

export function computeSurfaceInspectorActiveEdge(state) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  const pinById = new Map(activePins(normalized).map((pin) => [pin.id, pin]))
  const active = pinById.get(normalized.active_frame_id)
  if (!active) return { edge_id: '', frame_path: [], comments: [] }
  const path = []
  let cursor = active
  while (cursor) {
    path.unshift(cursor)
    cursor = cursor.parent_pin_id ? pinById.get(cursor.parent_pin_id) : null
  }
  const opacities = computeSurfaceInspectorOpacityLadder(path.length)
  return {
    edge_id: `edge:${active.id}`,
    frame_path: path.map((pin, index) => ({ ...pin, opacity: opacities[index] })),
    comments: activeComments(normalized).filter((comment) => comment.pin_id === active.id),
  }
}

export function computeSurfaceInspectorOpacityLadder(count) {
  const n = Math.max(0, Number(count) || 0)
  if (n <= 0) return []
  if (n === 1) return [1]
  const min = 0.25
  const step = (1 - min) / (n - 1)
  return Array.from({ length: n }, (_, index) => Number((1 - step * index).toFixed(4)))
}

export function buildSurfaceInspectorAnnotationTreeRows(state) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  const rows = []
  const childrenByParent = new Map()
  for (const pin of activePins(normalized)) {
    const key = pin.parent_pin_id || ''
    if (!childrenByParent.has(key)) childrenByParent.set(key, [])
    childrenByParent.get(key).push(pin)
  }
  const commentsByPin = new Map()
  for (const comment of activeComments(normalized)) {
    if (!commentsByPin.has(comment.pin_id)) commentsByPin.set(comment.pin_id, [])
    commentsByPin.get(comment.pin_id).push(comment)
  }
  const collapseAnchorChain = (pin) => {
    const chain = [pin]
    let cursor = pin
    while ((commentsByPin.get(cursor.id) || []).length === 0) {
      const children = (childrenByParent.get(cursor.id) || []).filter((child) => child.status !== 'removed').sort(pinSort)
      if (children.length !== 1) break
      cursor = children[0]
      chain.push(cursor)
    }
    return chain
  }
  const visit = (pin, depth) => {
    const chain = collapseAnchorChain(pin)
    const rowPin = chain.at(-1)
    const address = buildSurfaceInspectorFrameAddress(rowPin)
    rows.push({
      type: 'pin',
      id: rowPin.id,
      pin: rowPin,
      collapsed_pin_ids: chain.map((item) => item.id),
      depth,
      label: address.compact,
      frame_address: address,
      active: chain.some((item) => item.id === normalized.active_frame_id),
      projection_state: rowPin.projection.current_render_status,
      can_reveal: rowPin.projection.can_reveal,
      blocker_text: rowPin.projection.blocker_reason,
    })
    for (const comment of commentsByPin.get(rowPin.id) || []) {
      rows.push({
        type: 'comment',
        id: comment.id,
        comment,
        pin: rowPin,
        depth: depth + 1,
        active: rowPin.id === normalized.active_frame_id,
        projection_state: rowPin.projection.current_render_status,
        can_reveal: rowPin.projection.can_reveal,
        blocker_text: rowPin.projection.blocker_reason,
      })
    }
    for (const child of (childrenByParent.get(rowPin.id) || []).sort(pinSort)) visit(child, depth + 1)
  }
  for (const pin of (childrenByParent.get('') || []).sort(pinSort)) visit(pin, 0)
  return rows
}

export function buildSurfaceInspectorFrameAddress(pin = {}, options = {}) {
  const root = text(pin.root_label || pin.root_id || pin.subject_path?.[0], 'main')
  const fragments = Array.isArray(pin.subject_path) ? pin.subject_path.map((part) => text(part)).filter(Boolean) : []
  const full = fragments.length > 0 ? fragments.join(' / ') : root
  const maxFullLength = Number.isFinite(Number(options.max_full_length)) ? Number(options.max_full_length) : 32
  const compact = full.length > maxFullLength || fragments.length > 3
    ? `${root} / ${fragments.length} fragments`
    : full
  return {
    root_label: root,
    fragment_count: fragments.length,
    full,
    compact,
  }
}

function pinSort(a, b) {
  return a.subject_path.join('/').localeCompare(b.subject_path.join('/')) || a.created_at.localeCompare(b.created_at)
}

export function buildSurfaceInspectorSnapshotPayload(state) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  return {
    schema: normalized.schema,
    version: normalized.version,
    annotation_mode: clone(normalized.annotation_mode),
    active_edge_id: normalized.active_edge_id,
    active_frame_id: normalized.active_frame_id,
    pins: normalized.pins.map(clone),
    comments: normalized.comments.map(clone),
    projection_capabilities: normalized.projection_capabilities.map(clone),
    adapter_capability_summary: normalized.adapter_capability_summary.map(clone),
    pin_projection_results: normalized.pins.map((pin) => ({
      pin_id: pin.id,
      adapter_id: pin.adapter_id,
      projection: clone(pin.projection),
    })),
    comment_projection_status: normalized.comments.map((comment) => {
      const pin = normalized.pins.find((item) => item.id === comment.pin_id)
      return {
        comment_id: comment.id,
        pin_id: comment.pin_id,
        projection_status: pin?.projection?.current_render_status || 'absent',
        can_project_display_overlay: Boolean(pin?.projection?.can_project_display_overlay),
      }
    }),
    last_reveal_request: clone(normalized.last_reveal_request),
    last_reveal_result: clone(normalized.last_reveal_result),
    unsupported_stale_absent_blockers: normalized.pins
      .filter((pin) => ['unsupported', 'stale', 'absent'].includes(pin.projection.current_render_status) || pin.projection.blocker_reason)
      .map((pin) => ({ pin_id: pin.id, status: pin.projection.current_render_status, blocker_reason: pin.projection.blocker_reason })),
    last_hover_candidate: clone(normalized.last_hover_candidate),
    annotation_scope_stack: clone(normalized.annotation_scope_stack),
    current_scope_id: normalized.annotation_scope_stack.at(-1)?.subject_id || 'root',
    last_projection_blocker: clone(normalized.last_projection_blocker),
    snapshot_version: normalized.snapshot_version,
  }
}

export function setSurfaceInspectorHoverCandidate(state, candidate = null, blocker = null) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.last_hover_candidate = candidate && !isImplicitSurfaceInspectorRootCandidate(candidate)
    ? normalizeSurfaceInspectorAnnotationCandidate(candidate)
    : null
  next.last_projection_blocker = blocker ? clone(blocker) : null
  return next
}

function normalizeScopeFrame(frame = {}) {
  const subjectId = text(frame.subject_id || frame.id)
  if (!subjectId) return null
  return {
    pin_id: text(frame.pin_id || frame.id),
    subject_id: subjectId,
    subject_path: subjectPathFromNode(frame),
    root_id: text(frame.root_id || frame.root_label, 'main'),
    root_label: text(frame.root_label || frame.root_id, 'main'),
    adapter_id: text(frame.adapter_id, 'aos-canvas-window'),
    root_kind: text(frame.root_kind || frame.root_type || 'surface_root'),
    source_metadata: clone(frame.source_metadata || frame.source_tree_node_metadata || frame.metadata || {}),
    source_tree_node_metadata: clone(frame.source_tree_node_metadata || frame.source_metadata || frame.metadata || {}),
    projection: frame.projection ? normalizeProjectionStatus(frame.projection) : null,
  }
}

function scopeFrameFromPin(pin = {}) {
  return normalizeScopeFrame({
    pin_id: pin.id,
    subject_id: pin.subject_id,
    subject_path: pin.subject_path,
    root_id: pin.root_id,
    root_label: pin.root_label,
    root_kind: pin.root_kind,
    adapter_id: pin.adapter_id,
    source_metadata: pin.source_tree_node_metadata,
    source_tree_node_metadata: pin.source_tree_node_metadata,
    projection: pin.projection,
  })
}
