import {
  ANNOTATION_SESSION_SCHEMA,
  ANNOTATION_SESSION_VERSION,
  createAnnotationSession,
  normalizeAnnotationAnchor,
  normalizeAnnotationSubjectAddress,
} from './annotation-session.js'

export const CONTEXT_SESSION_SCHEMA = 'aos_context_session'
export const CONTEXT_SESSION_VERSION = '0.1.0'
export const CONTEXT_ARTIFACT_SCHEMA = 'aos_context_artifact'
export const CONTEXT_KEYFRAME_SCHEMA = 'aos_context_keyframe'
export const CONTEXT_RECORDING_SCHEMA = 'aos_context_recording'

const DEFAULT_ACTOR = Object.freeze({ role: 'operator', id: 'human' })

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function isoNow(now = Date.now()) {
  if (typeof now === 'string') return now
  const date = now instanceof Date ? now : new Date(now)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
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

function normalizeActor(actor = DEFAULT_ACTOR) {
  return {
    role: text(actor?.role, DEFAULT_ACTOR.role),
    id: text(actor?.id, DEFAULT_ACTOR.id),
  }
}

function normalizeComment(comment = {}, options = {}) {
  const created = isoNow(comment.created_at || comment.updated_at || options.now || Date.now())
  return {
    id: text(comment.id, stableId('comment', [options.node_id, created, comment.text || comment.comment_text])),
    text: text(comment.text ?? comment.comment_text ?? comment.note),
    actor: normalizeActor(comment.actor || options.actor),
    created_at: created,
    updated_at: isoNow(comment.updated_at || options.now || created),
    source_metadata: clone(comment.source_metadata || comment.metadata || {}),
  }
}

function commentsFromInput(input = {}, options = {}) {
  const comments = Array.isArray(input.comments) ? input.comments : []
  const normalized = comments.map((comment) => (
    typeof comment === 'string'
      ? normalizeComment({ id: comment, text: '' }, options)
      : normalizeComment(comment, options)
  ))
  const commentText = text(input.comment_text)
  if (commentText) normalized.push(normalizeComment({ text: commentText }, options))
  return normalized
}

function blockerFromProjection(projection = null, explicit = undefined) {
  if (explicit === null) return null
  if (explicit && typeof explicit === 'object') return clone(explicit)
  const reason = text(projection?.blocker_reason)
  const status = text(projection?.current_render_status || projection?.status)
  if (!reason && (!status || status === 'visible' || status === 'live')) return null
  return {
    status: status || 'blocked',
    reason: reason || status || 'projection_blocked',
    source_metadata: clone(projection?.source_metadata || {}),
  }
}

export function normalizeContextPathNode(node = {}, options = {}) {
  const contextSubject = node.subject?.address || node.subject?.adapter_id ? node.subject : null
  const topLevelSubject = !contextSubject && (
    node.adapter_id || node.root_id || node.subject_id || node.projection || node.source_metadata
  )
    ? { ...node }
    : null
  if (topLevelSubject && node.subject?.id && !node.subject_id) delete topLevelSubject.id
  const subjectInput = node.address_record
    || contextSubject
    || (topLevelSubject
      ? topLevelSubject
      : (node.subject?.address || node.subject?.adapter_id ? node.subject : node.subject || node))
  const subject = normalizeAnnotationSubjectAddress(subjectInput)
  const address = text(node.address || subject?.address, stableId('subject', [node.id || options.index]))
  const id = text(node.id, stableId('node', [address]))
  const projection = node.projection === undefined ? clone(subject?.projection) : clone(node.projection)
  return {
    id,
    address,
    subject: {
      address,
      adapter_id: text(subject?.adapter_id || node.adapter_id, 'unknown-adapter'),
      root: clone(subject?.root || node.root || {}),
      subject: clone(subject?.subject || node.subject_identity || {}),
      source_metadata: clone(subject?.source_metadata || node.source_metadata || {}),
      fallback_evidence: clone(subject?.fallback_evidence || node.fallback_evidence || {}),
    },
    kind: text(node.kind || node.subject_kind || subject?.subject?.kind, 'unknown'),
    role: text(node.role || subject?.role),
    label: text(node.label || subject?.label || node.name || id, id),
    projection,
    blocker: blockerFromProjection(projection, node.blocker),
    comments: commentsFromInput(node, { ...options, node_id: id }),
  }
}

function normalizePointer(pointer = null) {
  if (!pointer || typeof pointer !== 'object') return null
  const x = Number(pointer.x)
  const y = Number(pointer.y)
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    coordinate_space: text(pointer.coordinate_space, 'desktop_world'),
    source_metadata: clone(pointer.source_metadata || pointer.metadata || {}),
  }
}

function normalizeAcquisition(acquisition = {}, { path = [], activeTargetNodeId = '' } = {}) {
  const leaf = path.at(-1)
  return {
    mode: text(acquisition.mode, 'unknown'),
    pointer: normalizePointer(acquisition.pointer),
    leaf_node_id: text(acquisition.leaf_node_id || acquisition.clicked_leaf_node_id || leaf?.id),
    selected_node_id: text(acquisition.selected_node_id || activeTargetNodeId || leaf?.id),
    hovered_node_id: text(acquisition.hovered_node_id),
    candidate_report: clone(acquisition.candidate_report || acquisition.decision_report || {}),
    source_metadata: clone(acquisition.source_metadata || acquisition.metadata || {}),
  }
}

function normalizeAnchor(anchor = {}, { pathNodesByAddress = new Map(), pathNodesById = new Map(), now = Date.now() } = {}) {
  const nodeId = text(anchor.node_id || anchor.path_node_id)
  const node = pathNodesById.get(nodeId)
    || pathNodesByAddress.get(text(anchor.address))
    || null
  const sourceAnchor = normalizeAnnotationAnchor(anchor, { now })
  const resolvedNodeId = text(node?.id || nodeId || stableId('node', [sourceAnchor.address]))
  return {
    id: text(anchor.id, stableId('anchor', [resolvedNodeId])),
    node_id: resolvedNodeId,
    address: text(anchor.address || sourceAnchor.address || node?.address),
    status: text(anchor.status || sourceAnchor.status, 'live'),
    projection: clone(anchor.projection === undefined ? sourceAnchor.projection : anchor.projection),
    comment_text: text(anchor.comment_text ?? sourceAnchor.comment_text),
    comments: Array.isArray(anchor.comments) ? clone(anchor.comments) : [],
    source_annotation_anchor_id: text(anchor.source_annotation_anchor_id || sourceAnchor.id),
    metadata: clone(anchor.metadata || {}),
  }
}

export function normalizeContextArtifact(artifact = {}, options = {}) {
  const now = options.now || artifact.updated_at || artifact.created_at || Date.now()
  const path = (Array.isArray(artifact.path) ? artifact.path : [])
    .map((node, index) => normalizeContextPathNode(node, { now, index }))
  const pathNodesByAddress = new Map(path.map((node) => [node.address, node]))
  const pathNodesById = new Map(path.map((node) => [node.id, node]))
  const activeTargetNodeId = text(
    artifact.active_target_node_id || artifact.selected_node_id || path.at(-1)?.id,
  )
  return {
    schema: CONTEXT_ARTIFACT_SCHEMA,
    version: CONTEXT_SESSION_VERSION,
    id: text(artifact.id, stableId('context-artifact', [activeTargetNodeId || path.at(-1)?.address])),
    kind: text(artifact.kind, 'selection'),
    path,
    active_target_node_id: activeTargetNodeId,
    acquisition: normalizeAcquisition(artifact.acquisition, { path, activeTargetNodeId }),
    anchors: (Array.isArray(artifact.anchors) ? artifact.anchors : [])
      .map((anchor) => normalizeAnchor(anchor, { pathNodesByAddress, pathNodesById, now })),
    metadata: clone(artifact.metadata || {}),
    source_session_ref: artifact.source_session_ref ? clone(artifact.source_session_ref) : null,
  }
}

function sourceAnnotationSessionSummary(session = {}) {
  const normalized = createAnnotationSession(session)
  return {
    schema: ANNOTATION_SESSION_SCHEMA,
    version: ANNOTATION_SESSION_VERSION,
    active: normalized.active,
    entry_source: normalized.entry_source,
    updated_at: normalized.updated_at,
    root_address: text(normalized.root?.address),
    committed_scope_addresses: normalized.committed_scope_stack.map((subject) => subject.address),
    preview_scope_addresses: normalized.preview_scope_stack.map((subject) => subject.address),
    hover_candidate_address: text(normalized.hover_candidate?.address),
    anchor_addresses: normalized.anchors.map((anchor) => anchor.address),
    snapshot_count: normalized.snapshot_count,
  }
}

export function createContextArtifactFromAnnotationSession(session = {}, options = {}) {
  const normalized = createAnnotationSession(session)
  const stack = normalized.committed_scope_stack.length
    ? normalized.committed_scope_stack
    : normalized.preview_scope_stack
  const path = stack.map((subject, index) => {
    const anchor = normalized.anchors.find((item) => item.address === subject.address)
    return normalizeContextPathNode({
      ...subject,
      id: stableId('node', [subject.address]),
      comments: anchor?.comment_text ? [{ text: anchor.comment_text, actor: anchor.actor }] : [],
    }, { now: options.now || normalized.updated_at, index })
  })
  const pathNodesByAddress = new Map(path.map((node) => [node.address, node]))
  const anchors = normalized.anchors
    .map((anchor) => normalizeAnchor({
      ...anchor,
      node_id: pathNodesByAddress.get(anchor.address)?.id,
      source_annotation_anchor_id: anchor.id,
    }, {
      pathNodesByAddress,
      pathNodesById: new Map(path.map((node) => [node.id, node])),
      now: options.now || normalized.updated_at,
    }))
  return normalizeContextArtifact({
    id: options.id,
    kind: options.kind || 'selection',
    path,
    active_target_node_id: options.active_target_node_id || path.at(-1)?.id,
    acquisition: {
      mode: options.mode || normalized.entry_source,
      pointer: options.pointer || null,
      leaf_node_id: options.leaf_node_id || path.at(-1)?.id,
      selected_node_id: options.active_target_node_id || path.at(-1)?.id,
      hovered_node_id: normalized.hover_candidate ? stableId('node', [normalized.hover_candidate.address]) : '',
      candidate_report: options.candidate_report || {},
      source_metadata: options.source_metadata || {},
    },
    anchors,
    source_session_ref: {
      schema: ANNOTATION_SESSION_SCHEMA,
      version: ANNOTATION_SESSION_VERSION,
      anchor_addresses: normalized.anchors.map((anchor) => anchor.address),
    },
    metadata: options.metadata || {},
  }, options)
}

function rejectEmbeddedAssetRef(key, value) {
  if (/base64|binary|image_data/i.test(String(key))) {
    throw new TypeError(`context asset ref '${key}' cannot store embedded image data`)
  }
  if (typeof value === 'string' && /^data:/i.test(value)) {
    throw new TypeError(`context asset ref '${key}' cannot use a data URL`)
  }
  if (value && typeof value === 'object') {
    if (typeof value.uri === 'string' && /^data:/i.test(value.uri)) {
      throw new TypeError(`context asset ref '${key}' cannot use a data URL`)
    }
    const serialized = JSON.stringify(value)
    if (/data:image\//i.test(serialized)) {
      throw new TypeError(`context asset ref '${key}' cannot store embedded image data`)
    }
  }
}

function normalizeAssetRefs(assetRefs = {}) {
  const source = assetRefs && typeof assetRefs === 'object' ? assetRefs : {}
  return Object.fromEntries(Object.entries(source).map(([key, value]) => {
    rejectEmbeddedAssetRef(key, value)
    return [key, clone(value)]
  }))
}

function isAnnotationSessionSummary(input = {}) {
  return input?.schema === ANNOTATION_SESSION_SCHEMA
    && Array.isArray(input.committed_scope_addresses)
    && Array.isArray(input.preview_scope_addresses)
    && Array.isArray(input.anchor_addresses)
}

function normalizeAnnotationSessionSummary(input = {}) {
  if (!isAnnotationSessionSummary(input)) return sourceAnnotationSessionSummary(input)
  return {
    schema: ANNOTATION_SESSION_SCHEMA,
    version: ANNOTATION_SESSION_VERSION,
    active: Boolean(input.active),
    entry_source: text(input.entry_source, 'unknown'),
    updated_at: isoNow(input.updated_at || Date.now()),
    root_address: text(input.root_address),
    committed_scope_addresses: input.committed_scope_addresses.map((address) => text(address)).filter(Boolean),
    preview_scope_addresses: input.preview_scope_addresses.map((address) => text(address)).filter(Boolean),
    hover_candidate_address: text(input.hover_candidate_address),
    anchor_addresses: input.anchor_addresses.map((address) => text(address)).filter(Boolean),
    snapshot_count: Number.isFinite(Number(input.snapshot_count)) ? Number(input.snapshot_count) : 0,
  }
}

export function createContextKeyframe(keyframe = {}, options = {}) {
  const capturedAt = isoNow(keyframe.captured_at || options.captured_at || options.now || Date.now())
  return {
    schema: CONTEXT_KEYFRAME_SCHEMA,
    version: CONTEXT_SESSION_VERSION,
    id: text(keyframe.id, stableId('keyframe', [capturedAt, keyframe.trigger])),
    captured_at: capturedAt,
    trigger: text(keyframe.trigger || options.trigger, 'manual'),
    artifact_ids: Array.isArray(keyframe.artifact_ids) ? keyframe.artifact_ids.map((id) => text(id)).filter(Boolean) : [],
    artifacts: Array.isArray(keyframe.artifacts) ? keyframe.artifacts.map((artifact) => normalizeContextArtifact(artifact, options)) : [],
    session_summary: keyframe.session_summary ? clone(keyframe.session_summary) : null,
    asset_refs: normalizeAssetRefs(keyframe.asset_refs),
    metadata: clone(keyframe.metadata || {}),
  }
}

function normalizeRecordingEvent(event = {}, options = {}) {
  const occurredAt = isoNow(event.occurred_at || event.created_at || options.now || Date.now())
  return {
    id: text(event.id, stableId('event', [event.kind, occurredAt, event.after_keyframe_id])),
    kind: text(event.kind || event.type, 'note'),
    occurred_at: occurredAt,
    after_keyframe_id: text(event.after_keyframe_id),
    before_keyframe_id: text(event.before_keyframe_id),
    text: text(event.text || event.note || event.message),
    action: event.action ? clone(event.action) : null,
    blocker: event.blocker ? clone(event.blocker) : null,
    source_metadata: clone(event.source_metadata || {}),
    metadata: clone(event.metadata || {}),
  }
}

export function createContextRecording(recording = {}, options = {}) {
  const updatedAt = isoNow(recording.updated_at || options.updated_at || options.now || Date.now())
  const createdAt = isoNow(recording.created_at || options.created_at || updatedAt)
  const keyframes = Array.isArray(recording.keyframes)
    ? recording.keyframes.map((keyframe) => createContextKeyframe(keyframe, { now: updatedAt }))
    : []
  return {
    schema: CONTEXT_RECORDING_SCHEMA,
    version: CONTEXT_SESSION_VERSION,
    id: text(recording.id || recording.recording_id, stableId('recording', [createdAt])),
    created_at: createdAt,
    updated_at: updatedAt,
    source_session_ref: recording.source_session_ref ? clone(recording.source_session_ref) : null,
    keyframes,
    events: Array.isArray(recording.events)
      ? recording.events.map((event) => normalizeRecordingEvent(event, { now: updatedAt }))
      : [],
    asset_refs: normalizeAssetRefs(recording.asset_refs),
    source_metadata: clone(recording.source_metadata || {}),
    metadata: clone(recording.metadata || {}),
  }
}

export function createContextSession(input = {}) {
  const updatedAt = isoNow(input.updated_at || input.now || Date.now())
  const createdAt = isoNow(input.created_at || updatedAt)
  const artifacts = Array.isArray(input.artifacts)
    ? input.artifacts.map((artifact) => normalizeContextArtifact(artifact, { now: updatedAt }))
    : []
  return {
    schema: CONTEXT_SESSION_SCHEMA,
    version: CONTEXT_SESSION_VERSION,
    id: text(input.id || input.session_id, stableId('context-session', [createdAt])),
    created_at: createdAt,
    updated_at: updatedAt,
    active: Boolean(input.active),
    entry_source: text(input.entry_source, input.source_annotation_session?.entry_source || 'unknown'),
    source_annotation_session: input.source_annotation_session
      ? normalizeAnnotationSessionSummary(input.source_annotation_session)
      : null,
    artifacts,
    active_artifact_id: text(input.active_artifact_id || artifacts[0]?.id),
    keyframes: Array.isArray(input.keyframes)
      ? input.keyframes.map((keyframe) => createContextKeyframe(keyframe, { now: updatedAt }))
      : [],
    metadata: clone(input.metadata || {}),
  }
}

export function contextSessionSnapshot(input = {}, options = {}) {
  const session = createContextSession({
    ...input,
    updated_at: options.captured_at || options.now || input.updated_at,
  })
  return {
    ...session,
    keyframes: session.keyframes.length
      ? session.keyframes
      : [
          createContextKeyframe({
            id: options.keyframe_id,
            captured_at: options.captured_at || session.updated_at,
            trigger: options.trigger || 'snapshot',
            artifact_ids: session.artifacts.map((artifact) => artifact.id),
            session_summary: {
              schema: session.schema,
              version: session.version,
              id: session.id,
            },
            asset_refs: options.asset_refs || {},
          }),
        ],
  }
}
