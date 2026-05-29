import {
  normalizeAnnotationCandidate,
} from './annotation-candidates.js'
import {
  createContextSession,
  normalizeContextArtifact,
  normalizeContextPathNode,
} from './context-session.js'

const SELECTION_MODE_SOURCE = 'selection_mode'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function stableId(prefix, parts = []) {
  const body = parts
    .map((part) => text(part))
    .filter(Boolean)
    .join(':')
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return body ? `${prefix}:${body}` : `${prefix}:unknown`
}

function subjectPath(candidate = {}) {
  if (Array.isArray(candidate.subject_path)) return candidate.subject_path.map((part) => text(part)).filter(Boolean)
  if (Array.isArray(candidate.path)) return candidate.path.map((part) => text(part)).filter(Boolean)
  if (candidate.subject_path) return text(candidate.subject_path).split('/').filter(Boolean)
  if (candidate.path) return text(candidate.path).split('/').filter(Boolean)
  return [text(candidate.subject_id || candidate.id || candidate.label, 'unknown')]
}

function projectionRect(candidate = {}) {
  const bounds = candidate.bounds || candidate.perceived_bounds || {}
  const rect = candidate.display_space_rect
    || candidate.visible_display_rect
    || candidate.rect
    || bounds.desktop_world
    || bounds.viewport
    || bounds.parent_local
    || bounds.document
    || bounds.page
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x)
  const y = Number(rect.y)
  const w = Number(rect.w ?? rect.width)
  const h = Number(rect.h ?? rect.height)
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

function candidateSubjectInput(candidate = {}, options = {}) {
  const sourceIds = candidate.source_ids || {}
  const adapter = candidate.adapter || {}
  const path = subjectPath(candidate)
  const rect = projectionRect(candidate)
  const adapterId = text(candidate.adapter_id || adapter.id, options.adapter_id || 'selection-mode')
  const rootId = text(
    candidate.root_id
      || sourceIds.display_id
      || sourceIds.canvas_id
      || sourceIds.window_id
      || candidate.display_id
      || candidate.canvas_id
      || candidate.window_id,
    options.root_id || path[0] || 'selection-root',
  )
  const subjectId = text(candidate.subject_id || sourceIds.subject_id || candidate.id || path.at(-1), stableId('subject', [rootId, path.at(-1)]))
  const projection = candidate.projection || {
    adapter_id: adapterId,
    root_id: rootId,
    subject_id: subjectId,
    subject_kind: text(candidate.subject_kind || candidate.kind || candidate.role, 'surface_subject'),
    current_render_status: text(candidate.current_render_status || candidate.hit_test_status || candidate.status, rect ? 'visible' : 'blocked'),
    can_project_display_overlay: Boolean(rect),
    display_space_rect: rect,
    visible_display_rect: rect,
    blocker_reason: text(candidate.blocker_reason || (Array.isArray(candidate.blockers) ? candidate.blockers[0] : '')),
  }
  return {
    ...clone(candidate),
    adapter_id: adapterId,
    root_id: rootId,
    root_kind: text(candidate.root_kind || candidate.root_type, sourceIds.display_id ? 'display' : 'surface_root'),
    root_label: text(candidate.root_label || candidate.display_label || sourceIds.display_id || rootId, rootId),
    subject_id: subjectId,
    subject_path: path.length ? path : [rootId, subjectId],
    subject_kind: text(candidate.subject_kind || candidate.kind || candidate.role, 'surface_subject'),
    role: text(candidate.role || candidate.kind),
    label: text(candidate.label || candidate.name || subjectId, subjectId),
    projection,
    source_metadata: {
      ...(candidate.source_metadata || candidate.metadata || {}),
      selection_mode_source_candidate_id: text(candidate.id || subjectId),
    },
  }
}

function normalizeCandidateNode(candidate = {}, options = {}) {
  const normalized = normalizeAnnotationCandidate(candidateSubjectInput(candidate, options), options)
    || candidateSubjectInput(candidate, options)
  const nodeId = text(options.node_id || candidate.node_id, stableId('node:selection-mode', [
    normalized.address,
    normalized.id,
    normalized.subject_id,
  ]))
  return normalizeContextPathNode({
    ...normalized,
    id: nodeId,
    comments: Array.isArray(candidate.comments) ? candidate.comments : [],
    comment_text: candidate.comment_text,
    blocker: candidate.blocker,
  }, options)
}

function candidateSummary(candidate = {}) {
  return {
    id: text(candidate.id || candidate.subject_id || candidate.node_id),
    address: text(candidate.address || candidate.subject_address),
    adapter_id: text(candidate.adapter_id || candidate.adapter?.id),
    subject_id: text(candidate.subject_id || candidate.source_ids?.subject_id),
    kind: text(candidate.subject_kind || candidate.kind || candidate.role),
    label: text(candidate.label || candidate.name),
  }
}

function matchNode(node = {}, rawCandidate = {}, selector = '') {
  const value = text(selector)
  if (!value) return false
  const rawIds = [
    rawCandidate.id,
    rawCandidate.node_id,
    rawCandidate.subject_id,
    rawCandidate.source_ids?.subject_id,
    rawCandidate.address,
    rawCandidate.subject_address,
  ].map((item) => text(item)).filter(Boolean)
  return node.id === value || node.address === value || rawIds.includes(value)
}

function selectionPathCandidates(input = {}) {
  const ancestors = Array.isArray(input.path_candidates)
    ? input.path_candidates
    : Array.isArray(input.ancestor_candidates)
      ? input.ancestor_candidates
      : []
  const leaf = input.clicked_leaf_candidate || input.leaf_candidate || input.clicked_leaf || null
  if (!leaf) return ancestors
  const leafKey = text(leaf.id || leaf.subject_id || leaf.address || leaf.subject_address)
  const hasLeaf = ancestors.some((candidate) => {
    const candidateKey = text(candidate.id || candidate.subject_id || candidate.address || candidate.subject_address)
    return candidateKey && candidateKey === leafKey
  })
  return hasLeaf ? ancestors : [...ancestors, leaf]
}

function selectionCandidateReport(input = {}, { path = [], rawCandidates = [], selectedNode = null, leafNode = null } = {}) {
  return {
    ...(input.candidate_report || {}),
    selected_target: {
      node_id: selectedNode?.id || '',
      address: selectedNode?.address || '',
    },
    clicked_leaf: {
      node_id: leafNode?.id || '',
      address: leafNode?.address || '',
    },
    ambiguous_candidates: (Array.isArray(input.ambiguous_candidates) ? input.ambiguous_candidates : [])
      .map(candidateSummary),
    skipped_ancestors: (Array.isArray(input.skipped_ancestors) ? input.skipped_ancestors : [])
      .map((entry) => typeof entry === 'string' ? { id: entry, reason: 'skipped' } : clone(entry)),
    rejected_ancestors: (Array.isArray(input.rejected_ancestors) ? input.rejected_ancestors : [])
      .map((entry) => typeof entry === 'string' ? { id: entry, reason: 'rejected' } : clone(entry)),
    adapter_blockers: (Array.isArray(input.adapter_blockers) ? input.adapter_blockers : [])
      .map((entry) => typeof entry === 'string' ? { reason: entry } : clone(entry)),
    path_node_ids: path.map((node) => node.id),
    source_candidate_count: rawCandidates.length,
  }
}

export function createSelectionModeContextSession(input = {}, options = {}) {
  const updatedAt = options.updated_at || input.updated_at || input.captured_at || Date.now()
  const rawCandidates = selectionPathCandidates(input)
  const path = rawCandidates.map((candidate, index) => normalizeCandidateNode(candidate, {
    ...options,
    now: updatedAt,
    index,
  }))
  const leafNode = path.at(-1) || null
  const selectedSelector = text(
    input.selected_target_id
      || input.selected_node_id
      || input.selected_target_address
      || input.selected_address,
  )
  const selectedIndex = rawCandidates.findIndex((candidate, index) => matchNode(path[index], candidate, selectedSelector))
  const selectedNode = selectedIndex >= 0 ? path[selectedIndex] : leafNode
  const anchors = path
    .filter((node) => node.id === selectedNode?.id || node.comments.length > 0)
    .map((node) => ({
      id: stableId('anchor:selection-mode', [node.id]),
      node_id: node.id,
      address: node.address,
      status: node.blocker ? node.blocker.status : 'live',
      projection: node.projection,
      comment_text: node.comments.map((comment) => comment.text).filter(Boolean).join('\n\n'),
      comments: node.comments.map((comment) => comment.id),
      metadata: { source: SELECTION_MODE_SOURCE },
    }))
  const artifact = normalizeContextArtifact({
    id: input.artifact_id || options.artifact_id,
    kind: input.kind || 'selection',
    path,
    active_target_node_id: selectedNode?.id || '',
    acquisition: {
      mode: SELECTION_MODE_SOURCE,
      pointer: input.pointer || input.click_evidence?.pointer || input.click || null,
      leaf_node_id: leafNode?.id || '',
      selected_node_id: selectedNode?.id || '',
      hovered_node_id: input.hovered_node_id || leafNode?.id || '',
      candidate_report: selectionCandidateReport(input, { path, rawCandidates, selectedNode, leafNode }),
      source_metadata: {
        ...(input.source_metadata || {}),
        click_evidence: clone(input.click_evidence || null),
      },
    },
    anchors,
    metadata: {
      source: SELECTION_MODE_SOURCE,
      selected_target_may_differ_from_leaf: Boolean(selectedNode && leafNode && selectedNode.id !== leafNode.id),
      ...(input.metadata || {}),
    },
    source_session_ref: input.source_session_ref || null,
  }, { ...options, now: updatedAt })

  return createContextSession({
    id: input.id || input.session_id || options.id,
    created_at: input.created_at || options.created_at || updatedAt,
    updated_at: updatedAt,
    active: input.active ?? true,
    entry_source: SELECTION_MODE_SOURCE,
    source_annotation_session: input.source_annotation_session || null,
    artifacts: [artifact],
    active_artifact_id: artifact.id,
    keyframes: input.keyframes || [],
    metadata: {
      source: SELECTION_MODE_SOURCE,
      helper: 'createSelectionModeContextSession',
      ...(input.session_metadata || {}),
    },
  })
}

export function selectionModeContextArtifact(input = {}, options = {}) {
  return createSelectionModeContextSession(input, options).artifacts[0]
}
