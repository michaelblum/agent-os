import {
  normalizeAnnotationProjectionStatus,
  normalizeAnnotationRectLike,
} from './annotation-projection.js'

const CANDIDATE_ADAPTER_PRIORITY = new Map([
  ['aos-toolkit-semantic-target', 80],
  ['aos-browser-dom-element-picker', 72],
  ['aos-canvas-window', 60],
  ['macos-ax', 50],
  ['browser-content-seam', 30],
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

function normalizeNativeWindowPayload(input = {}) {
  if (!input || typeof input !== 'object') return null
  const payload = input.data && typeof input.data === 'object' ? input.data : input
  const windowId = text(payload.window_id || payload.windowID || payload.id)
  const pid = payload.pid ?? payload.app_pid ?? payload.owner_pid
  const appName = text(payload.app || payload.app_name || payload.owner_name || payload.name)
  const bounds = normalizeAnnotationRectLike(payload.bounds || payload.frame || payload.rect)
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

function rectContainsRect(outer = null, inner = null, tolerance = 0.5) {
  const a = normalizeAnnotationRectLike(outer)
  const b = normalizeAnnotationRectLike(inner)
  if (!a || !b) return false
  const t = Math.max(0, Number(tolerance) || 0)
  return b.x >= a.x - t
    && b.y >= a.y - t
    && b.x + b.w <= a.x + a.w + t
    && b.y + b.h <= a.y + a.h + t
}

function browserDomCandidateMatchesNativeWindowScope(candidate = {}, scope = null) {
  const adapter = text(candidate.adapter_id || candidate.projection?.adapter_id)
  if (adapter !== 'aos-browser-dom-element-picker' || !scope) return { ok: false, reason: 'native_ax_root_mismatch' }

  const metadata = {
    ...(candidate.projection?.source_tree_node_metadata || {}),
    ...(candidate.source_metadata || {}),
  }
  const scopeMetadata = scope.candidate?.source_metadata || {}
  const contentRect = normalizeAnnotationRectLike(
    metadata.browser_content_rect
      || candidate.browser_content_rect
      || candidate.content_rect,
  )
  const windowRect = normalizeAnnotationRectLike(scope.rect || scope.display_space_rect || scopeMetadata.bounds)
  if (!contentRect || !windowRect || !rectContainsRect(windowRect, contentRect, 1)) {
    return { ok: false, reason: 'browser_content_inset_unresolved' }
  }

  const candidateWindowId = text(metadata.browser_window_id || metadata.window_id)
  const scopeWindowId = text(scopeMetadata.window_id || scope.candidate?.window_id)
  if (candidateWindowId && scopeWindowId && candidateWindowId !== scopeWindowId) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }

  const candidatePid = Number.isFinite(Number(metadata.browser_pid ?? metadata.pid)) ? Number(metadata.browser_pid ?? metadata.pid) : null
  const scopePid = Number.isFinite(Number(scopeMetadata.pid ?? scope.candidate?.pid)) ? Number(scopeMetadata.pid ?? scope.candidate?.pid) : null
  if (candidatePid !== null && scopePid !== null && candidatePid !== scopePid) {
    return { ok: false, reason: 'native_ax_root_mismatch' }
  }

  const sourceUrl = text(metadata.source_url || candidate.source_url)
  const sessionId = text(metadata.browser_session_id || metadata.session_id)
  if (!sourceUrl && !sessionId) return { ok: false, reason: 'native_ax_root_mismatch' }
  return { ok: true, reason: 'scoped_native_browser_dom_child' }
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

function candidateAddress(candidate = {}) {
  const adapter = text(candidate.adapter_id || candidate.projection?.adapter_id, 'unknown-adapter')
  const root = text(candidate.root_id || candidate.projection?.root_id || candidate.canvas_id || candidate.window_id, 'main')
  const subject = text(candidate.subject_id || candidate.id || candidate.projection?.subject_id)
  const path = subjectPathFromNode(candidate)
  return text(candidate.address || candidate.subject_address, `subject:${adapter}:${root}:${[...path, subject].filter(Boolean).join(':')}`)
}

function scopeSubjectEvidence(scope = null) {
  if (!scope || typeof scope !== 'object') return null
  const normalized = scope.subject && scope.root
    ? {
        ...scope,
        id: text(scope.subject.id || scope.subject_id || scope.id),
        adapter_id: text(scope.adapter_id || scope.projection?.adapter_id),
        root_id: text(scope.root.id || scope.root_id || scope.projection?.root_id),
        root_kind: text(scope.root.kind || scope.root_kind),
        root_label: text(scope.root.label || scope.root_label),
        subject_id: text(scope.subject.id || scope.subject_id || scope.id),
        subject_kind: text(scope.subject.kind || scope.subject_kind || scope.kind),
        subject_path: Array.isArray(scope.subject.path) ? scope.subject.path : subjectPathFromNode(scope),
        display_space_rect: candidateVisibleRect(scope),
        source_metadata: clone(scope.source_metadata || {}),
      }
    : normalizeAnnotationCandidate(scope || {})
  if (!normalized) return null
  return {
    candidate: normalized,
    address: candidateAddress(normalized),
    adapter_id: text(normalized.adapter_id || normalized.projection?.adapter_id),
    root_id: text(normalized.root_id || normalized.root?.id || normalized.projection?.root_id),
    root_kind: text(normalized.root_kind || normalized.root?.kind),
    subject_id: text(normalized.subject_id || normalized.id || normalized.subject?.id || normalized.projection?.subject_id),
    subject_kind: text(normalized.subject_kind || normalized.kind || normalized.role || normalized.subject?.kind || normalized.projection?.subject_kind),
    subject_path: subjectPathFromNode(normalized),
    rect: candidateVisibleRect(normalized),
  }
}

function pathHasPrefix(path = [], prefix = []) {
  if (!Array.isArray(path) || !Array.isArray(prefix) || path.length < prefix.length) return false
  return prefix.every((part, index) => text(path[index]) === text(part))
}

function candidateDirectnessForScope(candidate = {}, scope = null) {
  if (!scope) return { accepted: true, direct: true, reason: 'display_root_scope' }
  if (candidateAddress(candidate) === scope.address || text(candidate.subject_id || candidate.id) === scope.subject_id) {
    return { accepted: false, reason: 'candidate_is_active_scope' }
  }

  const adapter = text(candidate.adapter_id || candidate.projection?.adapter_id)
  const rootId = text(candidate.root_id || candidate.projection?.root_id)
  const subjectPath = subjectPathFromNode(candidate)
  const scopeIsDisplay = scope.subject_kind === 'display' || scope.root_kind === 'display'
  if (scopeIsDisplay) return { accepted: true, direct: true, reason: 'display_direct_child' }

  if (scope.adapter_id === 'aos-canvas-window' || scope.subject_kind === 'canvas_window' || scope.root_kind === 'canvas') {
    if (adapter === 'aos-toolkit-semantic-target' && rootId === scope.subject_id) {
      return { accepted: true, direct: true, reason: 'scoped_canvas_semantic_child' }
    }
    if (adapter === 'aos-canvas-window') {
      const parent = candidate.source_metadata?.parent || candidate.parent_canvas_id || candidate.parent
      if (text(parent) && text(parent) === scope.subject_id) return { accepted: true, direct: true, reason: 'scoped_canvas_child' }
    }
  }

  if (scope.adapter_id === 'aos-toolkit-semantic-target') {
    if (adapter === scope.adapter_id && rootId === scope.root_id && pathHasPrefix(subjectPath, scope.subject_path)) {
      return subjectPath.length === scope.subject_path.length + 1
        ? { accepted: true, direct: true, reason: 'scoped_semantic_direct_child' }
        : { accepted: false, reason: 'candidate_not_direct_child' }
    }
  }

  if (scope.adapter_id === 'macos-ax' || scope.root_kind === 'native_window') {
    if (adapter === 'macos-ax' && rootId === scope.root_id) return { accepted: true, direct: true, reason: 'scoped_native_window_child' }
    const browserBridge = browserDomCandidateMatchesNativeWindowScope(candidate, scope)
    if (browserBridge.ok) return { accepted: true, direct: true, reason: browserBridge.reason }
    if (adapter === 'aos-browser-dom-element-picker') return { accepted: false, reason: browserBridge.reason }
    return { accepted: false, reason: 'native_ax_root_mismatch' }
  }

  if (scope.adapter_id === 'aos-browser-dom-element-picker' || scope.subject_kind === 'browser_page') {
    if (adapter === 'aos-browser-dom-element-picker' && rootId === scope.root_id) {
      if (pathHasPrefix(subjectPath, scope.subject_path)) {
        return subjectPath.length === scope.subject_path.length + 1
          ? { accepted: true, direct: true, reason: 'scoped_browser_dom_direct_child' }
          : { accepted: false, reason: 'candidate_not_direct_child' }
      }
      return { accepted: true, direct: true, reason: 'scoped_browser_page_child' }
    }
    return { accepted: false, reason: 'browser_page_scope_mismatch' }
  }

  if (rootId && rootId === scope.root_id && pathHasPrefix(subjectPath, scope.subject_path)) {
    return subjectPath.length === scope.subject_path.length + 1
      ? { accepted: true, direct: true, reason: 'scoped_direct_child' }
      : { accepted: false, reason: 'candidate_not_direct_child' }
  }
  return { accepted: false, reason: 'candidate_not_in_active_scope' }
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

export function normalizeAnnotationCandidate(candidate = {}, options = {}) {
  if (!candidate || typeof candidate !== 'object') return null
  const projection = normalizeAnnotationProjectionStatus(candidate.projection || {
    ...candidate,
    display_space_rect: candidate.display_space_rect || candidate.visible_display_rect || candidate.rect,
  }, { default_status: 'visible' })
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

export function filterAnnotationCandidatesForScope(candidates = [], scope = null, point = null, options = {}) {
  const activeScope = scopeSubjectEvidence(scope)
  const scopeRect = activeScope?.rect || null
  const rejected = []
  const scoped = []
  for (const raw of Array.isArray(candidates) ? candidates : []) {
    const candidate = normalizeAnnotationCandidate(raw)
    if (!candidate || isImplicitAnnotationRootCandidate(candidate)) continue
    const rect = candidateVisibleRect(candidate)
    if (!rect) {
      rejected.push({ id: text(candidate.id || candidate.subject_id), reason: 'candidate_projection_missing' })
      continue
    }
    if (scopeRect && !rectContainsRect(scopeRect, rect, options.rect_tolerance ?? 0.5)) {
      rejected.push({ id: candidate.id, reason: 'candidate_outside_active_scope' })
      continue
    }
    const directness = candidateDirectnessForScope(candidate, activeScope)
    if (!directness.accepted) {
      rejected.push({ id: candidate.id, reason: directness.reason })
      continue
    }
    if (point && !rectContainsPoint(rect, point)) continue
    scoped.push({
      ...candidate,
      source_metadata: {
        ...candidate.source_metadata,
        active_scope_address: activeScope?.address || '',
        scope_filter_reason: directness.reason,
        scope_filter_limitation: directness.direct ? '' : 'scope_overlap_fallback',
      },
      priority_evidence: {
        ...(candidate.priority_evidence || {}),
        scoped_direct_child: directness.direct,
      },
    })
  }
  return options.include_rejections
    ? { candidates: scoped, rejected, active_scope: activeScope?.candidate || null }
    : scoped
}

export function chooseAnnotationCandidateForScope(candidates = [], scope = null, point = null, options = {}) {
  const scoped = filterAnnotationCandidatesForScope(candidates, scope, point, options)
  return chooseAnnotationCandidate(Array.isArray(scoped) ? scoped : scoped.candidates, point)
}

export function buildNativeWindowAnnotationCandidate(input = {}, options = {}) {
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
  return normalizeAnnotationCandidate({
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

export function buildNativeAxElementAnnotationCandidate(input = {}, options = {}) {
  if (!input || typeof input !== 'object') return null
  const payload = input.data && typeof input.data === 'object' ? input.data : input
  const selectedRoot = options.selected_root || options.scope || null
  const rootEvidence = selectedNativeRootEvidence(selectedRoot || {})
  const window = normalizeNativeWindowPayload(options.window || options.cursor_window || payload.window || {})
  const rootMatch = nativeRootMatchesWindow(rootEvidence, window)
  const bounds = normalizeAnnotationRectLike(payload.bounds || payload.frame || payload.rect)
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
  return normalizeAnnotationCandidate({
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
    local_space_rect: normalizeAnnotationRectLike(payload.local_space_rect),
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

export function normalizeAnnotationProjectionCapabilities(input = []) {
  const defaults = [
    { adapter_id: 'aos-canvas-window', status: 'visible', display_overlay: true, minimap: true, tree: true, can_reveal: true },
    { adapter_id: 'aos-toolkit-semantic-target', status: 'visible', display_overlay: true, minimap: true, tree: true, can_reveal: true },
    { adapter_id: 'aos-object-registry', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'object_registry_no_display_projection' },
    { adapter_id: 'macos-ax', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'bounded_ax_reveal_unavailable' },
    { adapter_id: 'browser-content-seam', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false, blocker_reason: 'browser_dom_cdp_deferred' },
    { adapter_id: 'generic-dom', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false },
    { adapter_id: 'three-canvas', status: 'unsupported', display_overlay: false, minimap: true, tree: true, can_reveal: false },
  ]
  const overrides = new Map((Array.isArray(input) ? input : []).map((item) => [text(item.adapter_id || item.id), item]))
  return defaults.map((item) => ({ ...item, ...(overrides.get(item.adapter_id) || {}) }))
}

export function normalizeAnnotationAdapterCapabilitySummary(input = []) {
  return normalizeAnnotationProjectionCapabilities(input).map((item) => ({
    adapter_id: text(item.adapter_id || item.id),
    status: text(item.status, 'unsupported'),
    can_project_display_overlay: Boolean(item.can_project_display_overlay ?? item.display_overlay),
    can_reveal: Boolean(item.can_reveal),
    tree: item.tree !== false,
    minimap: item.minimap !== false,
    blocker_reason: text(item.blocker_reason || item.reason),
  }))
}
