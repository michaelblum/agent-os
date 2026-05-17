import { normalizeAnnotationProjectionStatus } from './annotation-projection.js'

export const ANNOTATION_SESSION_SCHEMA = 'aos_annotation_session'
export const ANNOTATION_SESSION_VERSION = '0.1.0'

export const ANNOTATION_SESSION_ENTRY_SOURCES = new Set([
  'hotkey',
  'status_menu',
  'surface_inspector',
  'sigil_radial',
  'unknown',
])

export const ANNOTATION_ANCHOR_STATUSES = new Set([
  'live',
  'stale',
  'absent',
  'blocked',
])

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

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key))
}

function hasAnyOwn(value, keys = []) {
  return keys.some((key) => hasOwn(value, key))
}

function firstOwnValue(pairs = []) {
  for (const [value, key] of pairs) {
    if (hasOwn(value, key)) return value[key]
  }
  return undefined
}

function stringList(value = []) {
  if (Array.isArray(value)) return value.map((part) => text(part)).filter(Boolean)
  return text(value).split('/').map((part) => text(part)).filter(Boolean)
}

function normalizeActor(actor = DEFAULT_ACTOR) {
  return {
    role: text(actor?.role, DEFAULT_ACTOR.role),
    id: text(actor?.id, DEFAULT_ACTOR.id),
  }
}

export function normalizeAnnotationProjectionEvidence(input = null) {
  if (!input || typeof input !== 'object') return null
  const projection = normalizeAnnotationProjectionStatus(input)
  return {
    adapter_id: text(input.adapter_id || input.adapter),
    subject_id: text(input.subject_id || input.id),
    subject_kind: text(input.subject_kind || input.kind || input.role),
    current_render_status: projection.current_render_status,
    can_project_display_overlay: projection.can_project_display_overlay,
    can_reveal: projection.can_reveal,
    display_space_rect: projection.display_space_rect,
    visible_display_rect: projection.visible_display_rect,
    coordinate_space: projection.coordinate_space,
    blocker_reason: projection.blocker_reason,
    refreshed_at: projection.refreshed_at,
    source_metadata: clone(input.source_metadata || input.source_tree_node_metadata || input.metadata || {}),
  }
}

export function normalizeAnnotationSubjectAddress(subject = null) {
  if (!subject || typeof subject !== 'object') return null
  const projection = normalizeAnnotationProjectionEvidence(subject.projection || subject.current_projection || subject)
  const subjectPath = stringList(subject.subject_path || subject.path || subject.subject?.path)
  const adapterId = text(subject.adapter_id || subject.adapter || projection?.adapter_id, 'unknown-adapter')
  const rootId = text(subject.root_id || subject.display_id || subject.canvas_id || subject.root?.id || projection?.root_id, 'unknown-root')
  const subjectId = text(subject.subject_id || subject.id || subject.subject?.id || projection?.subject_id || subjectPath.at(-1), 'unknown-subject')
  const address = text(subject.address || subject.subject_address, stableId('subject', [
    adapterId,
    rootId,
    ...subjectPath,
    subjectId,
  ]))

  return {
    address,
    adapter_id: adapterId,
    root: {
      id: rootId,
      kind: text(subject.root_kind || subject.root_type || subject.root?.kind, 'surface_root'),
      label: text(subject.root_label || subject.root_name || subject.root?.label || rootId, rootId),
    },
    subject: {
      id: subjectId,
      path: subjectPath.length ? subjectPath : [subjectId],
      kind: text(subject.subject_kind || subject.kind || subject.subject?.kind || subject.role || projection?.subject_kind, 'unknown'),
    },
    role: text(subject.role),
    label: text(subject.label || subject.title || subject.name),
    value: subject.value === undefined || subject.value === null ? '' : String(subject.value),
    text_excerpt: text(subject.text_excerpt || subject.text),
    source_metadata: clone(subject.source_metadata || subject.source_tree_node_metadata || subject.metadata || {}),
    fallback_evidence: clone(subject.fallback_evidence || subject.evidence || {}),
    projection,
    status: normalizeAnchorStatus(subject.status || projection?.current_render_status),
  }
}

export function normalizeAnchorStatus(status = 'live') {
  const normalized = text(status, 'live')
  if (normalized === 'visible' || normalized === 'active' || normalized === 'projectable') return 'live'
  if (normalized === 'unsupported' || normalized === 'hidden' || normalized === 'virtualized') return 'blocked'
  return ANNOTATION_ANCHOR_STATUSES.has(normalized) ? normalized : 'live'
}

function subjectAddress(value = null) {
  if (typeof value === 'string') return text(value)
  return normalizeAnnotationSubjectAddress(value)?.address || ''
}

function normalizeScopePath(scopePath = []) {
  return (Array.isArray(scopePath) ? scopePath : [scopePath])
    .map((item) => subjectAddress(item))
    .filter(Boolean)
}

const ANCHOR_CONTAINER_KEYS = [
  'actor',
  'comment_text',
  'created_at',
  'live_status',
  'note',
  'scope_path',
  'updated_at',
]

const SUBJECT_REPLACEMENT_KEYS = [
  'adapter',
  'adapter_id',
  'canvas_id',
  'display_id',
  'evidence',
  'fallback_evidence',
  'kind',
  'label',
  'metadata',
  'name',
  'path',
  'role',
  'root',
  'root_id',
  'root_kind',
  'root_label',
  'root_name',
  'root_type',
  'source_metadata',
  'source_tree_node_metadata',
  'subject',
  'subject_id',
  'subject_kind',
  'subject_path',
  'text_excerpt',
  'title',
  'value',
]

function subjectInputForAnchor(value = {}) {
  if (!value || typeof value !== 'object') return value
  if (hasOwn(value, 'address_record')) return value.address_record
  if (hasOwn(value, 'subject') && hasAnyOwn(value, ANCHOR_CONTAINER_KEYS)) return value.subject
  return value
}

function hasSubjectReplacementInput(value = {}) {
  const input = subjectInputForAnchor(value)
  return Boolean(input && typeof input === 'object' && hasAnyOwn(input, SUBJECT_REPLACEMENT_KEYS))
}

export function normalizeAnnotationAnchor(anchor = {}, options = {}) {
  const subject = normalizeAnnotationSubjectAddress(anchor.subject || anchor.address_record || anchor)
  const address = text(anchor.address || subject?.address, 'subject:unknown')
  const created = isoNow(anchor.created_at || anchor.updated_at || options.now || Date.now())
  const projection = normalizeAnnotationProjectionEvidence(anchor.projection || anchor.current_projection || subject?.projection)
  const status = normalizeAnchorStatus(anchor.status || anchor.live_status || subject?.status || projection?.current_render_status)
  return {
    id: text(anchor.id, stableId('anchor', [address])),
    address,
    subject,
    scope_path: normalizeScopePath(anchor.scope_path?.length ? anchor.scope_path : [address]),
    comment_text: text(anchor.comment_text ?? anchor.text ?? anchor.note),
    projection,
    actor: normalizeActor(anchor.actor || options.actor),
    created_at: created,
    updated_at: isoNow(anchor.updated_at || options.now || created),
    status,
  }
}

export function createAnnotationSession(input = {}) {
  const updatedAt = isoNow(input.updated_at || input.now || Date.now())
  return {
    schema: ANNOTATION_SESSION_SCHEMA,
    version: ANNOTATION_SESSION_VERSION,
    active: Boolean(input.active),
    entry_source: ANNOTATION_SESSION_ENTRY_SOURCES.has(input.entry_source) ? input.entry_source : 'unknown',
    root: normalizeAnnotationSubjectAddress(input.root),
    committed_scope_stack: Array.isArray(input.committed_scope_stack)
      ? input.committed_scope_stack.map(normalizeAnnotationSubjectAddress).filter(Boolean)
      : [],
    preview_scope_stack: Array.isArray(input.preview_scope_stack)
      ? input.preview_scope_stack.map(normalizeAnnotationSubjectAddress).filter(Boolean)
      : [],
    hover_candidate: normalizeAnnotationSubjectAddress(input.hover_candidate),
    anchors: Array.isArray(input.anchors)
      ? input.anchors.map((anchor) => normalizeAnnotationAnchor(anchor, { now: updatedAt }))
      : [],
    snapshot_count: Number.isFinite(Number(input.snapshot_count)) ? Number(input.snapshot_count) : 0,
    updated_at: updatedAt,
  }
}

export function enterAnnotationSession(session = {}, options = {}) {
  const now = isoNow(options.updated_at || options.now || Date.now())
  const root = normalizeAnnotationSubjectAddress(options.root ?? session.root)
  const initialStack = Array.isArray(options.committed_scope_stack)
    ? options.committed_scope_stack.map(normalizeAnnotationSubjectAddress).filter(Boolean)
    : (root ? [root] : [])
  return createAnnotationSession({
    ...session,
    active: true,
    entry_source: options.entry_source || session.entry_source,
    root,
    committed_scope_stack: initialStack,
    preview_scope_stack: Array.isArray(options.preview_scope_stack)
      ? options.preview_scope_stack
      : initialStack,
    hover_candidate: null,
    updated_at: now,
  })
}

export function clearAnnotationSession(session = {}, options = {}) {
  const current = createAnnotationSession(session)
  return createAnnotationSession({
    active: false,
    entry_source: options.entry_source || current.entry_source,
    root: null,
    committed_scope_stack: [],
    preview_scope_stack: [],
    hover_candidate: null,
    anchors: [],
    snapshot_count: current.snapshot_count,
    updated_at: options.updated_at || options.now || Date.now(),
  })
}

export function setAnnotationPreviewStack(session = {}, stack = [], options = {}) {
  const current = createAnnotationSession(session)
  return createAnnotationSession({
    ...current,
    preview_scope_stack: stack,
    updated_at: options.updated_at || options.now || Date.now(),
  })
}

export function setAnnotationHoverCandidate(session = {}, candidate = null, options = {}) {
  const current = createAnnotationSession(session)
  const hover = normalizeAnnotationSubjectAddress(candidate)
  const committed = current.committed_scope_stack
  const preview = hover ? [...committed, hover] : committed
  return createAnnotationSession({
    ...current,
    hover_candidate: hover,
    preview_scope_stack: preview,
    updated_at: options.updated_at || options.now || Date.now(),
  })
}

export function upsertAnnotationAnchor(session = {}, subjectOrAnchor = {}, options = {}) {
  const current = createAnnotationSession(session)
  const hasSubjectInput = hasSubjectReplacementInput(subjectOrAnchor)
  const subject = hasSubjectInput
    ? normalizeAnnotationSubjectAddress(subjectInputForAnchor(subjectOrAnchor))
    : null
  const address = text(subjectOrAnchor.address || subject?.address)
  if (!address) return current
  const existingIndex = current.anchors.findIndex((anchor) => anchor.address === address)
  const existing = existingIndex >= 0 ? current.anchors[existingIndex] : null
  const hasScopePathInput = hasOwn(options, 'scope_path') || hasOwn(subjectOrAnchor, 'scope_path')
  const scopePath = hasScopePathInput
    ? normalizeScopePath(firstOwnValue([[options, 'scope_path'], [subjectOrAnchor, 'scope_path']]))
    : (existing?.scope_path || normalizeScopePath([address]))
  const hasCommentTextInput = hasOwn(options, 'comment_text') ||
    hasAnyOwn(subjectOrAnchor, ['comment_text', 'text', 'note'])
  const commentText = hasCommentTextInput
    ? firstOwnValue([[options, 'comment_text'], [subjectOrAnchor, 'comment_text'], [subjectOrAnchor, 'text'], [subjectOrAnchor, 'note']])
    : (existing?.comment_text ?? '')
  const hasProjectionInput = hasOwn(options, 'projection') ||
    hasAnyOwn(subjectOrAnchor, ['projection', 'current_projection'])
  const projection = hasProjectionInput
    ? firstOwnValue([[options, 'projection'], [subjectOrAnchor, 'projection'], [subjectOrAnchor, 'current_projection']])
    : (existing?.projection || subject?.projection)
  const hasStatusInput = hasOwn(options, 'status') ||
    hasAnyOwn(subjectOrAnchor, ['status', 'live_status'])
  const status = hasStatusInput
    ? firstOwnValue([[options, 'status'], [subjectOrAnchor, 'status'], [subjectOrAnchor, 'live_status']])
    : (hasProjectionInput ? projection?.current_render_status || projection?.status : existing?.status || subject?.status)
  const hasActorInput = hasOwn(options, 'actor') || hasOwn(subjectOrAnchor, 'actor')
  const actor = hasActorInput
    ? firstOwnValue([[options, 'actor'], [subjectOrAnchor, 'actor']])
    : existing?.actor
  const incoming = normalizeAnnotationAnchor({
    id: subjectOrAnchor.id,
    address,
    subject: subject || existing?.subject,
    scope_path: scopePath,
    comment_text: commentText,
    projection,
    status,
    actor,
    updated_at: options.updated_at || options.now || Date.now(),
  })
  const anchors = [...current.anchors]
  if (existingIndex >= 0) {
    anchors[existingIndex] = {
      ...anchors[existingIndex],
      ...incoming,
      id: anchors[existingIndex].id,
      created_at: anchors[existingIndex].created_at,
      subject: hasSubjectInput ? incoming.subject : anchors[existingIndex].subject,
      scope_path: hasScopePathInput ? incoming.scope_path : anchors[existingIndex].scope_path,
      comment_text: hasCommentTextInput ? incoming.comment_text : anchors[existingIndex].comment_text,
      projection: hasProjectionInput ? incoming.projection : anchors[existingIndex].projection,
      actor: hasActorInput ? incoming.actor : anchors[existingIndex].actor,
      status: (hasStatusInput || hasProjectionInput) ? incoming.status : anchors[existingIndex].status,
    }
  } else {
    anchors.push(incoming)
  }
  return createAnnotationSession({
    ...current,
    anchors,
    updated_at: options.updated_at || options.now || Date.now(),
  })
}

export function addAnnotationCommentText(session = {}, subjectOrAddress = {}, commentText = '', options = {}) {
  const subject = typeof subjectOrAddress === 'string'
    ? { address: subjectOrAddress }
    : subjectOrAddress
  return upsertAnnotationAnchor(session, subject, {
    ...options,
    comment_text: commentText,
  })
}

export function commitAnnotationPreview(session = {}, options = {}) {
  let next = createAnnotationSession(session)
  const stack = next.preview_scope_stack.length ? next.preview_scope_stack : next.committed_scope_stack
  const scopePath = stack.map((subject) => subject.address)
  for (const subject of stack) {
    next = upsertAnnotationAnchor(next, subject, {
      scope_path: scopePath.slice(0, scopePath.indexOf(subject.address) + 1),
      comment_text: next.anchors.find((anchor) => anchor.address === subject.address)?.comment_text || '',
      actor: options.actor,
      updated_at: options.updated_at || options.now || Date.now(),
    })
  }
  return createAnnotationSession({
    ...next,
    committed_scope_stack: stack,
    preview_scope_stack: stack,
    hover_candidate: null,
    updated_at: options.updated_at || options.now || Date.now(),
  })
}

export function refreshAnnotationAnchorStatus(session = {}, addressOrSubject = {}, projection = {}, options = {}) {
  const current = createAnnotationSession(session)
  const address = subjectAddress(addressOrSubject)
  if (!address) return current
  const status = normalizeAnchorStatus(options.status || projection.current_render_status || projection.status)
  return upsertAnnotationAnchor(current, {
    address,
    projection,
    status,
  }, {
    status,
    projection,
    updated_at: options.updated_at || options.now || Date.now(),
  })
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

export function opacityForDepth(index, count, floor = 0.75) {
  const n = Number(count)
  if (!Number.isFinite(n) || n <= 1) return 1
  const i = Math.min(Math.max(Number(index) || 0, 0), n - 1)
  const f = Math.min(Math.max(Number(floor), 0), 1)
  const t = i / (n - 1)
  return f + t * (1 - f)
}

export function opacityLadderForScope(count, floor = 0.75) {
  const n = Math.max(0, Number(count) || 0)
  return Array.from({ length: n }, (_, index) => opacityForDepth(index, n, floor))
}
