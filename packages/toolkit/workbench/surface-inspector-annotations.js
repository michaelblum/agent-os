import {
  ANNOTATION_SESSION_SCHEMA,
  ANNOTATION_SESSION_VERSION,
  createAnnotationSession,
  normalizeAnnotationAnchor,
  normalizeAnnotationSubjectAddress,
} from './annotation-session.js'
import {
  createContextSession,
  normalizeContextArtifact,
} from './context-session.js'
import {
  isImplicitAnnotationRootCandidate,
  normalizeAnnotationCandidate,
  normalizeAnnotationAdapterCapabilitySummary,
  normalizeAnnotationProjectionCapabilities,
} from './annotation-candidates.js'
import {
  normalizeAnnotationProjectionStatus,
  normalizeAnnotationRectLike,
  normalizeRevealResult,
} from './annotation-projection.js'

export const SURFACE_INSPECTOR_ANNOTATION_SCHEMA = 'surface_inspector_annotation_state'
export const SURFACE_INSPECTOR_ANNOTATION_VERSION = '0.1.0'
export const SURFACE_INSPECTOR_ANNOTATION_SNAPSHOT_SCHEMA = 'surface_inspector_annotation_snapshot'
export const SURFACE_INSPECTOR_ANNOTATION_SNAPSHOT_VERSION = '0.1.0'

const FRAME_PIN_KIND = 'frame_pin'
const COMMENT_KIND = 'comment'
const DEFAULT_ACTOR = Object.freeze({ role: 'operator', id: 'human' })
const REPROJECTION_MISSING_SOURCE_REASON = 'projection_refresh_source_missing'
const normalizeRectLike = normalizeAnnotationRectLike
const normalizeProjectionStatus = normalizeAnnotationProjectionStatus

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value)
}

function trimmedText(value, fallback = '') {
  const normalized = text(value).trim()
  return normalized || fallback
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

export function surfaceInspectorPinToAnnotationAnchor(pin = {}, options = {}) {
  const subject = normalizeAnnotationSubjectAddress({
    address: pin.address,
    adapter_id: pin.adapter_id,
    root_id: pin.root_id,
    root_label: pin.root_label,
    root_kind: pin.root_kind,
    subject_id: pin.subject_id,
    subject_path: pin.subject_path,
    subject_kind: pin.subject_kind || pin.kind,
    role: pin.role,
    label: pin.label,
    value: pin.value,
    text_excerpt: pin.text_excerpt,
    source_metadata: pin.source_tree_node_metadata || pin.source_metadata,
    projection: pin.projection,
    status: pin.status,
  })
  return normalizeAnnotationAnchor({
    id: options.id || (pin.id ? `anchor:${pin.id}` : ''),
    address: subject?.address,
    subject,
    scope_path: options.scope_path || pin.scope_path || [subject?.address],
    comment_text: options.comment_text ?? pin.comment_text ?? '',
    projection: pin.projection,
    actor: pin.actor || options.actor,
    created_at: pin.created_at,
    updated_at: pin.updated_at,
    status: pin.projection?.current_render_status || pin.projection?.status || pin.status,
  }, options)
}

function activeSurfaceInspectorPins(state = {}) {
  return (Array.isArray(state.pins) ? state.pins : []).filter((pin) => pin.status !== 'removed')
}

function activeSurfaceInspectorComments(state = {}) {
  return (Array.isArray(state.comments) ? state.comments : []).filter((comment) => comment.status !== 'removed' && trimmedText(comment.text))
}

function activeSurfaceInspectorFramePath(state = {}) {
  const pinsById = new Map(activeSurfaceInspectorPins(state).map((pin) => [pin.id, pin]))
  let cursor = pinsById.get(state.active_frame_id)
  const path = []
  const visited = new Set()
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    path.unshift(cursor)
    cursor = cursor.parent_pin_id ? pinsById.get(cursor.parent_pin_id) : null
  }
  return path
}

function commentsBySurfaceInspectorPin(state = {}) {
  const commentsByPin = new Map()
  for (const comment of activeSurfaceInspectorComments(state)) {
    if (!commentsByPin.has(comment.pin_id)) commentsByPin.set(comment.pin_id, [])
    commentsByPin.get(comment.pin_id).push(comment)
  }
  return commentsByPin
}

export function surfaceInspectorAnnotationStateToSession(state = {}, options = {}) {
  const pins = activeSurfaceInspectorPins(state)
  const comments = activeSurfaceInspectorComments(state)
  const commentsByPin = commentsBySurfaceInspectorPin({ comments })
  const committedPins = activeSurfaceInspectorFramePath(state)
  const committed = committedPins.map((pin) => surfaceInspectorPinToAnnotationAnchor(pin).subject).filter(Boolean)
  const hover = state.last_hover_candidate
    ? normalizeAnnotationSubjectAddress(state.last_hover_candidate)
    : null
  const anchors = pins.map((pin) => {
    const pinComments = commentsByPin.get(pin.id) || []
    return surfaceInspectorPinToAnnotationAnchor(pin, {
      comment_text: pinComments.map((comment) => comment.text).join('\n\n'),
    })
  })
  return createAnnotationSession({
    active: Boolean(state.annotation_mode?.active),
    entry_source: options.entry_source || 'surface_inspector',
    root: committed[0] || hover || anchors[0]?.subject || null,
    committed_scope_stack: committed,
    preview_scope_stack: hover ? [...committed, hover] : committed,
    hover_candidate: hover,
    anchors,
    snapshot_count: Number.isFinite(Number(state.snapshot_count)) ? Number(state.snapshot_count) : 0,
    updated_at: options.updated_at || Date.now(),
  })
}

function activeSurfaceInspectorPinPath(state = {}, pin = {}) {
  const pinsById = new Map(activeSurfaceInspectorPins(state).map((item) => [item.id, item]))
  const scopePinIds = (Array.isArray(state.annotation_scope_stack) ? state.annotation_scope_stack : [])
    .map((frame) => text(frame.pin_id || frame.id))
    .filter((id) => pinsById.has(id))
  const scopedIndex = scopePinIds.lastIndexOf(pin.id)
  if (scopedIndex >= 0 && (pin.id === state.active_frame_id || scopePinIds.at(-1) === pin.id)) {
    return scopePinIds.slice(0, scopedIndex + 1).map((id) => pinsById.get(id)).filter(Boolean)
  }

  const path = []
  const visited = new Set()
  let cursor = pinsById.get(pin.id)
  while (cursor && !visited.has(cursor.id)) {
    path.unshift(cursor)
    visited.add(cursor.id)
    cursor = cursor.parent_pin_id ? pinsById.get(cursor.parent_pin_id) : null
  }
  return path
}

function contextCommentFromSurfaceInspectorComment(comment = {}, pin = {}) {
  return {
    id: comment.id,
    text: comment.text,
    actor: comment.actor,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    source_metadata: {
      source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
      source_comment_id: comment.id,
      source_pin_id: pin.id || comment.pin_id,
      source_subject_id: comment.subject_id,
    },
  }
}

function contextPathNodeFromSurfaceInspectorPin(pin = {}, comments = []) {
  const metadata = pin.source_tree_node_metadata || pin.source_metadata || {}
  const anchor = surfaceInspectorPinToAnnotationAnchor(pin, {
    comment_text: comments.map((comment) => comment.text).filter(Boolean).join('\n\n'),
  })
  return {
    id: `context-node:surface-inspector:${pin.id}`,
    subject: anchor.subject,
    kind: pin.subject_kind || metadata.subject_kind || metadata.kind || pin.kind,
    role: pin.role || metadata.role || metadata.ax_role,
    label: pin.label || metadata.label || metadata.title || metadata.name || pin.subject_id || pin.id,
    projection: pin.projection,
    blocker: pin.projection?.blocker || undefined,
    comments: comments.map((comment) => contextCommentFromSurfaceInspectorComment(comment, pin)),
  }
}

function contextAnchorFromSurfaceInspectorPin(pin = {}, node = {}, comments = []) {
  const anchor = surfaceInspectorPinToAnnotationAnchor(pin, {
    comment_text: comments.map((comment) => comment.text).filter(Boolean).join('\n\n'),
  })
  return {
    id: `context-anchor:surface-inspector:${pin.id}`,
    node_id: node.id,
    address: node.address || anchor.address,
    status: anchor.status,
    projection: anchor.projection,
    comment_text: anchor.comment_text,
    comments: comments.map((comment) => comment.id),
    source_annotation_anchor_id: anchor.id,
    metadata: {
      source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
      source_pin_id: pin.id,
      source_parent_pin_id: pin.parent_pin_id || '',
    },
  }
}

function contextArtifactFromSurfaceInspectorPin(state = {}, pin = {}, options = {}) {
  const pathPins = activeSurfaceInspectorPinPath(state, pin)
  const commentsByPin = commentsBySurfaceInspectorPin(state)
  const path = pathPins.map((pathPin) => (
    contextPathNodeFromSurfaceInspectorPin(pathPin, commentsByPin.get(pathPin.id) || [])
  ))
  const activeTargetNodeId = path.at(-1)?.id || ''
  const anchors = pathPins.map((pathPin, index) => (
    contextAnchorFromSurfaceInspectorPin(pathPin, {
      id: path[index]?.id,
    }, commentsByPin.get(pathPin.id) || [])
  ))
  return normalizeContextArtifact({
    id: `context-artifact:surface-inspector:${pin.id}`,
    kind: 'surface_inspector_selection',
    path,
    active_target_node_id: activeTargetNodeId,
    acquisition: {
      mode: 'surface_inspector',
      pointer: null,
      leaf_node_id: activeTargetNodeId,
      selected_node_id: activeTargetNodeId,
      candidate_report: {
        source_pin_id: pin.id,
        source_parent_pin_id: pin.parent_pin_id || '',
        source_subject_id: pin.subject_id,
        source_subject_path: Array.isArray(pin.subject_path) ? [...pin.subject_path] : [],
        path_pin_ids: pathPins.map((item) => item.id),
        active_frame_id: state.active_frame_id,
        active_edge_id: state.active_edge_id,
        projection_refresh: clone(state.projection_refresh),
        last_projection_blocker: clone(state.last_projection_blocker),
      },
      source_metadata: {
        source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
        source_version: SURFACE_INSPECTOR_ANNOTATION_VERSION,
        source_pin_id: pin.id,
        source_state_snapshot_version: state.snapshot_version,
        annotation_scope_stack_pin_ids: (Array.isArray(state.annotation_scope_stack) ? state.annotation_scope_stack : [])
          .map((frame) => text(frame.pin_id || frame.id))
          .filter(Boolean),
      },
    },
    anchors,
    source_session_ref: {
      schema: ANNOTATION_SESSION_SCHEMA,
      version: ANNOTATION_SESSION_VERSION,
      source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
    },
    metadata: {
      source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
      source_pin_id: pin.id,
      active: pin.id === state.active_frame_id,
    },
  }, options)
}

export function surfaceInspectorAnnotationStateToContextSession(state = {}, options = {}) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  const updatedAt = options.updated_at || Date.now()
  const sourceSession = surfaceInspectorAnnotationStateToSession(normalized, {
    entry_source: options.entry_source || 'surface_inspector',
    updated_at: updatedAt,
  })
  const pins = activeSurfaceInspectorPins(normalized)
  const artifacts = pins.map((pin) => contextArtifactFromSurfaceInspectorPin(normalized, pin, {
    now: updatedAt,
  }))
  const activeArtifact = artifacts.find((artifact) => (
    artifact.metadata?.source_pin_id === normalized.active_frame_id
  )) || artifacts[0] || null

  return createContextSession({
    id: options.id,
    created_at: options.created_at || updatedAt,
    updated_at: updatedAt,
    active: Boolean(normalized.annotation_mode?.active),
    entry_source: options.entry_source || 'surface_inspector',
    source_annotation_session: sourceSession,
    artifacts,
    active_artifact_id: activeArtifact?.id || '',
    metadata: {
      source: SURFACE_INSPECTOR_ANNOTATION_SCHEMA,
      source_version: SURFACE_INSPECTOR_ANNOTATION_VERSION,
      source_state_snapshot_version: normalized.snapshot_version,
      active_frame_id: normalized.active_frame_id,
      active_edge_id: normalized.active_edge_id,
      artifact_count: artifacts.length,
      compatibility_adapter: 'surface_inspector_annotations',
      ...(options.metadata || {}),
    },
  })
}

function normalizeProjectionRefreshState(input = {}) {
  return {
    generation: Number.isFinite(Number(input.generation)) ? Number(input.generation) : 0,
    pending_settle_reason: text(input.pending_settle_reason),
    stale_reason: text(input.stale_reason),
    last_result: input.last_result ? clone(input.last_result) : null,
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
    projection_capabilities: normalizeAnnotationProjectionCapabilities(input.projection_capabilities),
    adapter_capability_summary: normalizeAnnotationAdapterCapabilitySummary(input.adapter_capability_summary || input.projection_capabilities),
    last_reveal_request: input.last_reveal_request ? clone(input.last_reveal_request) : null,
    last_reveal_result: input.last_reveal_result ? normalizeRevealResult(input.last_reveal_result) : null,
    last_hover_candidate: input.last_hover_candidate ? clone(input.last_hover_candidate) : null,
    annotation_scope_stack: Array.isArray(input.annotation_scope_stack) ? input.annotation_scope_stack.map(normalizeScopeFrame).filter(Boolean) : [],
    last_projection_blocker: input.last_projection_blocker ? clone(input.last_projection_blocker) : null,
    clear_confirmation: input.clear_confirmation ? clone(input.clear_confirmation) : null,
    editor: input.editor ? clone(input.editor) : null,
    projection_refresh: normalizeProjectionRefreshState(input.projection_refresh),
    snapshot_version: Number.isFinite(Number(input.snapshot_version)) ? Number(input.snapshot_version) : 0,
    snapshot_count: Number.isFinite(Number(input.snapshot_count)) ? Number(input.snapshot_count) : 0,
    last_snapshot_evidence: input.last_snapshot_evidence ? clone(input.last_snapshot_evidence) : null,
  }
  reconcileActiveFrame(state)
  return state
}

function staleProjectionFromProjection(projection = {}, reason = 'projection_stale', options = {}) {
  const current = normalizeProjectionStatus(projection || {})
  const blockerReason = text(options.blocker_reason || reason, 'projection_stale')
  return normalizeProjectionStatus({
    ...current,
    status: options.status || 'stale',
    current_render_status: options.status || 'stale',
    projectable: false,
    can_project_display_overlay: false,
    can_reveal: Boolean(current.can_reveal),
    display_space_rect: null,
    visible_display_rect: options.keep_visible_evidence === true ? current.visible_display_rect : null,
    blocker_reason: blockerReason,
    refreshed_at: options.refreshed_at || Date.now(),
  })
}

function markScopeProjectionStale(scope = {}, reason = 'projection_stale', options = {}) {
  return {
    ...scope,
    projection: staleProjectionFromProjection(scope.projection || scope, reason, options),
  }
}

function projectionRefreshResult(reason, options = {}) {
  return {
    reason: text(reason),
    refreshed_at: isoNow(options.refreshed_at || options.now || Date.now()),
    matched_count: Number.isFinite(Number(options.matched_count)) ? Number(options.matched_count) : 0,
    missing_count: Number.isFinite(Number(options.missing_count)) ? Number(options.missing_count) : 0,
    refreshed_pin_ids: Array.isArray(options.refreshed_pin_ids) ? [...options.refreshed_pin_ids] : [],
    missing_pin_ids: Array.isArray(options.missing_pin_ids) ? [...options.missing_pin_ids] : [],
    blocker_reason: text(options.blocker_reason),
  }
}

function candidateMatchKeys(candidate = {}) {
  const metadata = candidate.source_metadata || candidate.source_tree_node_metadata || candidate.metadata || {}
  return new Set([
    candidate.id,
    candidate.subject_id,
    metadata.id,
    metadata.subject_id,
    candidate.projection?.subject_id,
  ].map((item) => text(item)).filter(Boolean))
}

function pinMatchKeys(pin = {}) {
  const metadata = pin.source_tree_node_metadata || pin.source_metadata || {}
  return new Set([
    pin.id,
    pin.subject_id,
    metadata.id,
    metadata.subject_id,
    pin.projection?.subject_id,
  ].map((item) => text(item)).filter(Boolean))
}

function pinMatchesCandidate(pin = {}, candidate = {}) {
  const pinKeys = pinMatchKeys(pin)
  const candidateKeys = candidateMatchKeys(candidate)
  for (const key of pinKeys) {
    if (candidateKeys.has(key)) return true
  }
  return false
}

function candidateForPin(pin = {}, candidates = []) {
  return candidates.find((candidate) => {
    if (!candidate) return false
    if (pin.adapter_id && candidate.adapter_id && pin.adapter_id !== candidate.adapter_id) {
      const compatibleCanvasSemantic = pin.adapter_id === 'aos-canvas-window' && candidate.adapter_id === 'aos-toolkit-semantic-target'
      if (!compatibleCanvasSemantic) return false
    }
    return pinMatchesCandidate(pin, candidate)
  }) || null
}

export function normalizePinRecord(pin = {}) {
  const node = pin.source_node_metadata || pin.source_tree_node_metadata || pin.source_metadata || pin.node || {}
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
    source_tree_node_metadata: clone(pin.source_tree_node_metadata || pin.source_node_metadata || pin.source_metadata || node),
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

export function recordSurfaceInspectorAnnotationSnapshotSuccess(state, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.snapshot_count += 1
  next.last_snapshot_evidence = {
    trigger: text(options.trigger, 'manual'),
    bundle_path: text(options.bundle_path),
    bundle_json_path: text(options.bundle_json_path),
    captured_at: isoNow(options.captured_at || options.at || Date.now()),
  }
  return next
}

export function pinSurfaceInspectorFrame(state, node = {}, options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const subjectPath = subjectPathFromNode(node)
  const requestedParentPinId = (options.parent_pin_id ?? next.active_frame_id) || null
  const rootId = text(options.root_id || node.root_id || node.display_id || node.root_label, 'main')
  const id = text(options.id, stableId('pin', [rootId, ...subjectPath]))
  const parentPinId = requestedParentPinId === id ? null : requestedParentPinId
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
  const visited = new Set()
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
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

export function markSurfaceInspectorAnnotationProjectionsStale(state, reason = 'projection_stale', options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const staleReason = text(reason, 'projection_stale')
  const refreshedAt = options.refreshed_at || options.now || Date.now()
  next.pins = next.pins.map((pin) => {
    if (pin.status === 'removed') return pin
    return {
      ...pin,
      projection: staleProjectionFromProjection(pin.projection, staleReason, { refreshed_at: refreshedAt }),
      updated_at: isoNow(refreshedAt),
    }
  })
  next.annotation_scope_stack = next.annotation_scope_stack.map((frame) => markScopeProjectionStale(frame, staleReason, { refreshed_at: refreshedAt }))
  if (next.last_hover_candidate) {
    next.last_hover_candidate = markScopeProjectionStale(next.last_hover_candidate, staleReason, { refreshed_at: refreshedAt })
  }
  next.last_projection_blocker = { reason: staleReason }
  next.projection_refresh = {
    generation: next.projection_refresh.generation + 1,
    pending_settle_reason: text(options.pending_settle_reason || staleReason),
    stale_reason: staleReason,
    last_result: next.projection_refresh.last_result,
  }
  return bump(next)
}

export function refreshSurfaceInspectorAnnotationProjectionsFromEvidence(state, evidence = [], options = {}) {
  const next = createSurfaceInspectorAnnotationState(state)
  const reason = text(options.reason, 'settled_projection_refresh')
  const candidates = (Array.isArray(evidence) ? evidence : [evidence])
    .map((candidate) => normalizeAnnotationCandidate(candidate))
    .filter(Boolean)
  const refreshedPinIds = []
  const missingPinIds = []

  next.pins = next.pins.map((pin) => {
    if (pin.status === 'removed') return pin
    const candidate = candidateForPin(pin, candidates)
    if (!candidate) {
      const projection = staleProjectionFromProjection(pin.projection, REPROJECTION_MISSING_SOURCE_REASON, {
        status: 'blocked',
        refreshed_at: options.refreshed_at || options.now || Date.now(),
      })
      missingPinIds.push(pin.id)
      return { ...pin, projection, updated_at: isoNow(options.refreshed_at || options.now || Date.now()) }
    }
    refreshedPinIds.push(pin.id)
    return normalizePinRecord({
      ...pin,
      root_id: candidate.root_id || pin.root_id,
      root_label: candidate.root_label || pin.root_label,
      root_kind: candidate.root_kind || pin.root_kind,
      subject_id: candidate.subject_id || pin.subject_id,
      subject_path: candidate.subject_path || pin.subject_path,
      adapter_id: candidate.adapter_id || pin.adapter_id,
      source_tree_node_metadata: {
        ...pin.source_tree_node_metadata,
        ...candidate.source_metadata,
        id: candidate.id,
        subject_id: candidate.subject_id,
      },
      projection: candidate.projection,
      updated_at: options.refreshed_at || options.now || Date.now(),
    })
  })

  const pinsById = new Map(next.pins.map((pin) => [pin.id, pin]))
  next.annotation_scope_stack = next.annotation_scope_stack.map((frame) => {
    const pin = pinsById.get(frame.pin_id)
    return pin ? scopeFrameFromPin(pin) : markScopeProjectionStale(frame, REPROJECTION_MISSING_SOURCE_REASON, {
      status: 'blocked',
      refreshed_at: options.refreshed_at || options.now || Date.now(),
    })
  })
  if (next.last_hover_candidate) {
    const candidate = candidateForPin({
      id: next.last_hover_candidate.id,
      subject_id: next.last_hover_candidate.subject_id,
      root_id: next.last_hover_candidate.root_id,
      adapter_id: next.last_hover_candidate.adapter_id,
      projection: next.last_hover_candidate.projection,
      source_tree_node_metadata: next.last_hover_candidate.source_metadata,
    }, candidates)
    next.last_hover_candidate = candidate || markScopeProjectionStale(next.last_hover_candidate, REPROJECTION_MISSING_SOURCE_REASON, {
      status: 'blocked',
      refreshed_at: options.refreshed_at || options.now || Date.now(),
    })
  }

  next.last_projection_blocker = missingPinIds.length > 0
    ? { reason: REPROJECTION_MISSING_SOURCE_REASON, pin_ids: missingPinIds }
    : null
  next.projection_refresh = {
    generation: next.projection_refresh.generation + 1,
    pending_settle_reason: '',
    stale_reason: '',
    last_result: projectionRefreshResult(reason, {
      ...options,
      matched_count: refreshedPinIds.length,
      missing_count: missingPinIds.length,
      refreshed_pin_ids: refreshedPinIds,
      missing_pin_ids: missingPinIds,
      blocker_reason: missingPinIds.length > 0 ? REPROJECTION_MISSING_SOURCE_REASON : '',
    }),
  }
  reconcileActiveFrame(next)
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
  const visited = new Set()
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
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
    const visited = new Set([pin.id])
    while ((commentsByPin.get(cursor.id) || []).length === 0) {
      const children = (childrenByParent.get(cursor.id) || []).filter((child) => child.status !== 'removed').sort(pinSort)
      if (children.length !== 1) break
      if (visited.has(children[0].id)) break
      cursor = children[0]
      visited.add(cursor.id)
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
    projection_refresh: clone(normalized.projection_refresh),
    snapshot_version: normalized.snapshot_version,
    snapshot_count: normalized.snapshot_count,
    last_snapshot_evidence: clone(normalized.last_snapshot_evidence || null),
  }
}

function currentAnnotationScope(normalized = {}) {
  return normalized.annotation_scope_stack?.at?.(-1) || null
}

function activeAnnotationRootContext(normalized = {}) {
  const scope = currentAnnotationScope(normalized)
  const activePin = normalized.pins.find((pin) => pin.id === normalized.active_frame_id) || normalized.pins.at(-1) || null
  const source = scope || activePin || normalized.last_hover_candidate || null
  return {
    current_scope_id: scope?.subject_id || 'root',
    root_id: text(source?.root_id || source?.subject_id, 'root'),
    root_kind: text(source?.root_kind || source?.subject_kind, 'surface_root'),
    root_label: text(source?.root_label || source?.label || source?.root_id || source?.subject_id, 'main'),
    adapter_id: text(source?.adapter_id, ''),
    subject_id: text(source?.subject_id || source?.id, ''),
    subject_path: Array.isArray(source?.subject_path) ? clone(source.subject_path) : [],
    display_space_rect: clone(source?.projection?.visible_display_rect || source?.projection?.display_space_rect || source?.display_space_rect || null),
    local_space_rect: clone(source?.projection?.local_space_rect || source?.local_space_rect || null),
    source_metadata: clone(source?.source_metadata || source?.source_tree_node_metadata || {}),
  }
}

function snapshotSubjectFromAnnotationRecord(record = {}) {
  const metadata = record.source_tree_node_metadata || record.source_metadata || {}
  return {
    id: text(record.subject_id || metadata.subject_id || metadata.id),
    path: Array.isArray(record.subject_path) ? clone(record.subject_path) : subjectPathFromNode(record),
    kind: text(record.subject_kind || metadata.subject_kind || metadata.kind || record.root_kind),
    role: text(record.role || metadata.role || metadata.ax_role),
    label: text(record.label || metadata.label || metadata.title || metadata.name),
    value: record.value ?? metadata.value ?? null,
    text_excerpt: text(record.text_excerpt || metadata.text_excerpt || metadata.text || metadata.accessible_name),
    source_metadata: clone(metadata),
  }
}

function snapshotProjectionProof(projection = {}) {
  const normalized = normalizeProjectionStatus(projection)
  return {
    current_render_status: normalized.current_render_status,
    projectable: normalized.projectable,
    can_project_display_overlay: normalized.can_project_display_overlay,
    can_reveal: normalized.can_reveal,
    visible_display_rect: clone(normalized.visible_display_rect),
    display_space_rect: clone(normalized.display_space_rect),
    local_space_rect: clone(normalized.local_space_rect),
    coordinate_space: normalized.coordinate_space,
    blocker_reason: normalized.blocker_reason,
    blocker: clone(normalized.blocker),
    reveal_status: normalized.can_reveal ? 'available' : 'unsupported',
    reveal_blocker_reason: normalized.can_reveal ? '' : (normalized.blocker_reason || 'reveal_unavailable'),
    ancestor_viewport_clip_chain: clone(normalized.ancestor_viewport_clip_chain),
    scrollable_ancestor_chain: clone(normalized.scrollable_ancestor_chain),
    z_order_evidence: clone(normalized.z_order_evidence),
    refreshed_at: normalized.refreshed_at,
  }
}

function snapshotPin(pin = {}) {
  return {
    id: pin.id,
    kind: pin.kind,
    root_id: pin.root_id,
    root_label: pin.root_label,
    root_kind: pin.root_kind,
    adapter_id: pin.adapter_id,
    parent_pin_id: pin.parent_pin_id,
    depth: pin.depth,
    actor: clone(pin.actor),
    created_at: pin.created_at,
    updated_at: pin.updated_at,
    status: pin.status,
    subject: snapshotSubjectFromAnnotationRecord(pin),
    projection: snapshotProjectionProof(pin.projection || pin),
  }
}

function snapshotComment(comment = {}, pinsById = new Map()) {
  const pin = pinsById.get(comment.pin_id)
  return {
    id: comment.id,
    kind: comment.kind,
    pin_id: comment.pin_id,
    annotation_kind: 'comment',
    actor: clone(comment.actor),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    status: comment.status,
    text: comment.text,
    subject: snapshotSubjectFromAnnotationRecord({
      ...comment,
      source_tree_node_metadata: pin?.source_tree_node_metadata || {},
    }),
    projection: pin ? snapshotProjectionProof(pin.projection || pin) : null,
  }
}

function snapshotSessionSubject(subject = null) {
  if (!subject) return null
  return {
    address: text(subject.address),
    adapter_id: text(subject.adapter_id),
    root: clone(subject.root || null),
    subject: clone(subject.subject || null),
    role: text(subject.role),
    label: text(subject.label),
    value: subject.value ?? '',
    text_excerpt: text(subject.text_excerpt),
    source_metadata: clone(subject.source_metadata || {}),
    fallback_evidence: clone(subject.fallback_evidence || {}),
    projection: subject.projection ? snapshotProjectionProof(subject.projection) : null,
    status: text(subject.status, 'live'),
  }
}

function snapshotSessionAnchor(anchor = {}) {
  return {
    id: text(anchor.id),
    address: text(anchor.address),
    subject: snapshotSessionSubject(anchor.subject),
    scope_path: Array.isArray(anchor.scope_path) ? [...anchor.scope_path] : [],
    comment_text: text(anchor.comment_text),
    projection: anchor.projection ? snapshotProjectionProof(anchor.projection) : null,
    actor: clone(anchor.actor || {}),
    created_at: text(anchor.created_at),
    updated_at: text(anchor.updated_at),
    status: text(anchor.status, 'live'),
  }
}

function snapshotSessionBoundary(session = {}) {
  return {
    schema: session.schema,
    version: session.version,
    active: Boolean(session.active),
    entry_source: text(session.entry_source, 'surface_inspector'),
    root: snapshotSessionSubject(session.root),
    committed_scope_stack: Array.isArray(session.committed_scope_stack)
      ? session.committed_scope_stack.map(snapshotSessionSubject).filter(Boolean)
      : [],
    preview_scope_stack: Array.isArray(session.preview_scope_stack)
      ? session.preview_scope_stack.map(snapshotSessionSubject).filter(Boolean)
      : [],
    hover_candidate: snapshotSessionSubject(session.hover_candidate),
    anchors: Array.isArray(session.anchors)
      ? session.anchors.map(snapshotSessionAnchor)
      : [],
    snapshot_count: Number.isFinite(Number(session.snapshot_count)) ? Number(session.snapshot_count) : 0,
    updated_at: text(session.updated_at),
  }
}

function isSuspiciousImageDataPath(path = []) {
  return path.some((part) => /^(assets|base64|image_data|binary)$/i.test(String(part)))
}

function noEmbeddedImageData(value, path = []) {
  if (typeof value === 'string') {
    if (/^data:image\//i.test(value)) return false
    return !isSuspiciousImageDataPath(path) || !/^[A-Za-z0-9+/]{120,}={0,2}$/.test(value)
  }
  if (Array.isArray(value)) return value.every((item, index) => noEmbeddedImageData(item, [...path, index]))
  if (value && typeof value === 'object') {
    return Object.entries(value).every(([key, item]) => !/base64|image_data|binary/i.test(key) && noEmbeddedImageData(item, [...path, key]))
  }
  return true
}

export function buildSurfaceInspectorAnnotationSnapshotArtifact(state, options = {}) {
  const normalized = createSurfaceInspectorAnnotationState(state)
  const capturedAt = isoNow(options.captured_at || Date.now())
  const session = surfaceInspectorAnnotationStateToSession(normalized, {
    entry_source: options.entry_source || 'surface_inspector',
    updated_at: capturedAt,
  })
  const pins = normalized.pins.map(snapshotPin)
  const pinsById = new Map(normalized.pins.map((pin) => [pin.id, pin]))
  const activeEdge = computeSurfaceInspectorActiveEdge(normalized)
  const artifact = {
    schema: SURFACE_INSPECTOR_ANNOTATION_SNAPSHOT_SCHEMA,
    version: SURFACE_INSPECTOR_ANNOTATION_SNAPSHOT_VERSION,
    capture: {
      captured_at: capturedAt,
      trigger: text(options.trigger, 'manual'),
      source_canvas_id: text(options.source_canvas_id || options.canvas_id || 'surface-inspector'),
      surface_inspector_frame: clone(options.surface_inspector_frame || null),
      assets: clone(options.assets || {}),
    },
    session: snapshotSessionBoundary(session),
    active_context: activeAnnotationRootContext(normalized),
    selection: {
      active_edge_id: normalized.active_edge_id,
      active_frame_id: normalized.active_frame_id,
      current_scope_id: currentAnnotationScope(normalized)?.subject_id || 'root',
      frame_path_pin_ids: activeEdge.frame_path.map((pin) => pin.id),
    },
    annotation_mode: clone(normalized.annotation_mode),
    empty_state: normalized.pins.length === 0 && normalized.comments.length === 0,
    pins,
    comments: normalized.comments.map((comment) => snapshotComment(comment, pinsById)),
    hover_candidate: normalized.last_hover_candidate ? {
      id: normalized.last_hover_candidate.id,
      adapter_id: normalized.last_hover_candidate.adapter_id,
      root_id: normalized.last_hover_candidate.root_id,
      root_kind: normalized.last_hover_candidate.root_kind,
      root_label: normalized.last_hover_candidate.root_label,
      subject: snapshotSubjectFromAnnotationRecord(normalized.last_hover_candidate),
      projection: snapshotProjectionProof(normalized.last_hover_candidate.projection || normalized.last_hover_candidate),
      blocker_reason: text(normalized.last_hover_candidate.blocker_reason),
    } : null,
    projection_capabilities: normalized.projection_capabilities.map(clone),
    adapter_capability_summary: normalized.adapter_capability_summary.map(clone),
    blockers: {
      last_projection_blocker: clone(normalized.last_projection_blocker),
      unsupported_stale_absent: normalized.pins
        .filter((pin) => ['unsupported', 'stale', 'absent'].includes(pin.projection.current_render_status) || pin.projection.blocker_reason)
        .map((pin) => ({ pin_id: pin.id, status: pin.projection.current_render_status, blocker_reason: pin.projection.blocker_reason })),
    },
    reveal: {
      last_request: clone(normalized.last_reveal_request),
      last_result: clone(normalized.last_reveal_result),
    },
    annotation_scope_stack: clone(normalized.annotation_scope_stack),
    source_state: {
      schema: normalized.schema,
      version: normalized.version,
      snapshot_version: normalized.snapshot_version,
      snapshot_count: normalized.snapshot_count,
    },
  }
  if (!noEmbeddedImageData(artifact)) {
    throw new TypeError('annotation snapshot artifact must reference external assets instead of embedding image data')
  }
  return artifact
}

export function setSurfaceInspectorHoverCandidate(state, candidate = null, blocker = null) {
  const next = createSurfaceInspectorAnnotationState(state)
  next.last_hover_candidate = candidate && !isImplicitAnnotationRootCandidate(candidate)
    ? normalizeAnnotationCandidate(candidate)
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
