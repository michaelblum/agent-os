import {
  createAnnotationSession,
  normalizeAnnotationSubjectAddress,
  opacityForDepth,
  surfaceInspectorPinToAnnotationAnchor,
} from './annotation-session.js'

export const ANNOTATION_OVERLAY_RENDER_PLAN_SCHEMA = 'aos_annotation_overlay_render_plan'
export const ANNOTATION_OVERLAY_RENDER_PLAN_VERSION = '0.1.0'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function normalizeRect(rect = null) {
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const width = Number(rect.width ?? rect.w)
  const height = Number(rect.height ?? rect.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function isLiveProjectable(status, projection = null) {
  return status === 'live'
    && projection?.current_render_status === 'visible'
    && projection?.can_project_display_overlay === true
    && Boolean(normalizeRect(projection.display_space_rect))
}

function projectionReason(status, projection = null) {
  if (status === 'absent') return text(projection?.blocker_reason, 'subject_absent')
  if (status === 'stale') return text(projection?.blocker_reason, 'projection_stale')
  if (status === 'blocked') return text(projection?.blocker_reason, projection?.current_render_status || 'projection_blocked')
  if (!projection) return 'projection_missing'
  if (projection.current_render_status !== 'visible') return text(projection.blocker_reason, projection.current_render_status || 'projection_not_visible')
  if (projection.can_project_display_overlay !== true) return text(projection.blocker_reason, 'display_overlay_not_projectable')
  if (!normalizeRect(projection.display_space_rect)) return text(projection.blocker_reason, 'display_rect_missing')
  return ''
}

function groupTargetForSubject(subject = null) {
  const metadata = subject?.source_metadata || {}
  const root = subject?.root || {}
  const projection = subject?.projection || {}
  const adapterId = text(subject?.adapter_id || projection.adapter_id, 'unknown-adapter')
  const canvasId = text(
    metadata.canvas_id
      || metadata.surface
      || metadata.surface_id
      || (adapterId === 'aos-toolkit-semantic-target' ? root.id : '')
      || (adapterId === 'aos-canvas-window' ? subject?.subject?.id : '')
  )
  const displayId = text(
    metadata.display_id
      || metadata.display
      || (root.kind === 'display' ? root.id : '')
  )
  const rootId = text(root.id || projection.root_id || metadata.root_id, 'unknown-root')
  const id = canvasId || displayId || rootId
  return {
    id,
    kind: canvasId ? 'canvas' : (displayId ? 'display' : 'root'),
    canvas_id: canvasId,
    display_id: displayId,
    root_id: rootId,
    root_kind: text(root.kind, 'surface_root'),
    root_label: text(root.label, rootId),
  }
}

function frameRecord(subjectInput = null, {
  anchor = null,
  index = 0,
  count = 1,
  layer = 'committed',
} = {}) {
  const subject = normalizeAnnotationSubjectAddress(subjectInput || anchor?.subject || anchor)
  const projection = anchor?.projection || subject?.projection || null
  const status = anchor?.status || subject?.status || 'live'
  const live = isLiveProjectable(status, projection)
  const reason = projectionReason(status, projection)
  return {
    id: text(anchor?.id, `${layer}:${subject?.address || 'unknown'}`),
    layer,
    address: text(anchor?.address || subject?.address),
    subject,
    target: groupTargetForSubject(subject),
    rect: live ? normalizeRect(projection.display_space_rect) : null,
    evidence_rect: normalizeRect(projection?.visible_display_rect || projection?.display_space_rect),
    projection: clone(projection),
    status: live ? 'live' : status,
    reason,
    opacity: opacityForDepth(index, count),
  }
}

function activeInputForFrame(frame = null) {
  if (!frame || frame.status !== 'live' || !frame.rect) return null
  return {
    anchor_address: frame.address,
    target: frame.target,
    rect: frame.rect,
    placement: {
      x: frame.rect.x + Math.min(24, Math.max(8, frame.rect.width * 0.08)),
      y: frame.rect.y + Math.min(frame.rect.height + 8, Math.max(8, frame.rect.height * 0.18)),
    },
    placeholder: 'Leave comment (optional)',
  }
}

function commentChipForAnchor(anchor = {}) {
  const textValue = text(anchor.comment_text)
  if (!textValue) return null
  const frame = frameRecord(anchor.subject || anchor, { anchor, layer: 'comment' })
  return {
    id: `chip:${anchor.id}`,
    anchor_id: anchor.id,
    address: anchor.address,
    target: frame.target,
    rect: frame.rect,
    evidence_rect: frame.evidence_rect,
    text: textValue,
    label: textValue.length > 15 ? `${textValue.slice(0, 15)}...` : textValue,
    status: frame.status,
    reason: frame.reason,
  }
}

export function stableAnnotationOverlayGroupSignature(group = {}) {
  return JSON.stringify({
    id: group.target?.id || '',
    committed: (group.committed_frames || []).map((frame) => [frame.address, frame.status, frame.reason, frame.opacity, frame.rect]),
    preview: (group.preview_frames || []).map((frame) => [frame.address, frame.status, frame.reason, frame.opacity, frame.rect]),
    hover: group.hover_candidate
      ? [group.hover_candidate.address, group.hover_candidate.status, group.hover_candidate.reason, group.hover_candidate.rect]
      : null,
    comments: (group.comment_chips || []).map((chip) => [chip.id, chip.address, chip.text, chip.status, chip.reason, chip.rect]),
    active_input: group.active_comment_input
      ? [group.active_comment_input.anchor_address, group.active_comment_input.placement]
      : null,
    states: (group.frame_states || []).map((state) => [state.address, state.layer, state.status, state.reason]),
  })
}

function stableSignatureForPlan(plan) {
  return JSON.stringify({
    active: plan.active,
    groups: plan.groups.map((group) => group.signature),
  })
}

function addToGroup(groups, record) {
  const id = record?.target?.id
  if (!id) return null
  if (!groups.has(id)) {
    groups.set(id, {
      target: record.target,
      committed_frames: [],
      preview_frames: [],
      hover_candidate: null,
      comment_chips: [],
      active_comment_input: null,
      frame_states: [],
    })
  }
  return groups.get(id)
}

function appendFrame(groups, frame) {
  const group = addToGroup(groups, frame)
  if (!group) return
  if (frame.layer === 'committed') group.committed_frames.push(frame)
  else if (frame.layer === 'preview') group.preview_frames.push(frame)
  else if (frame.layer === 'hover') group.hover_candidate = frame
  if (frame.status !== 'live') {
    group.frame_states.push({
      address: frame.address,
      layer: frame.layer,
      status: frame.status,
      reason: frame.reason,
      evidence_rect: frame.evidence_rect,
    })
  }
}

export function buildAnnotationOverlayRenderPlan(input = {}, options = {}) {
  const session = createAnnotationSession(input)
  const groups = new Map()
  const anchorsByAddress = new Map(session.anchors.map((anchor) => [anchor.address, anchor]))
  const committedCount = session.committed_scope_stack.length
  const previewCount = session.preview_scope_stack.length

  session.committed_scope_stack.forEach((subject, index) => {
    appendFrame(groups, frameRecord(subject, {
      anchor: anchorsByAddress.get(subject.address),
      index,
      count: committedCount,
      layer: 'committed',
    }))
  })

  session.preview_scope_stack.forEach((subject, index) => {
    appendFrame(groups, frameRecord(subject, {
      anchor: anchorsByAddress.get(subject.address),
      index,
      count: previewCount,
      layer: 'preview',
    }))
  })

  if (session.hover_candidate) {
    appendFrame(groups, frameRecord(session.hover_candidate, {
      index: previewCount,
      count: Math.max(1, previewCount + 1),
      layer: 'hover',
    }))
  }

  for (const anchor of session.anchors) {
    const chip = commentChipForAnchor(anchor)
    if (!chip) continue
    const group = addToGroup(groups, chip)
    if (group) group.comment_chips.push(chip)
  }

  const activeSubject = session.preview_scope_stack.at(-1) || session.committed_scope_stack.at(-1)
  const activeFrame = activeSubject
    ? frameRecord(activeSubject, { anchor: anchorsByAddress.get(activeSubject.address), layer: 'active-input' })
    : null
  const activeInput = options.active_comment_input === false ? null : activeInputForFrame(activeFrame)
  if (activeInput) {
    const group = addToGroup(groups, { target: activeInput.target })
    if (group) group.active_comment_input = activeInput
  }

  const renderGroups = [...groups.values()]
    .sort((a, b) => a.target.id.localeCompare(b.target.id))
    .map((group) => ({
      ...group,
      signature: stableAnnotationOverlayGroupSignature(group),
    }))

  const plan = {
    schema: ANNOTATION_OVERLAY_RENDER_PLAN_SCHEMA,
    version: ANNOTATION_OVERLAY_RENDER_PLAN_VERSION,
    active: session.active,
    entry_source: session.entry_source,
    root: session.root,
    groups: renderGroups,
    updated_at: session.updated_at,
  }
  return {
    ...plan,
    signature: stableSignatureForPlan(plan),
  }
}

function activeSurfaceInspectorPins(state = {}) {
  return (Array.isArray(state.pins) ? state.pins : []).filter((pin) => pin.status !== 'removed')
}

function activeSurfaceInspectorComments(state = {}) {
  return (Array.isArray(state.comments) ? state.comments : []).filter((comment) => comment.status !== 'removed' && text(comment.text))
}

function activeSurfaceInspectorFramePath(state = {}) {
  const pinsById = new Map(activeSurfaceInspectorPins(state).map((pin) => [pin.id, pin]))
  let cursor = pinsById.get(state.active_frame_id)
  const path = []
  while (cursor) {
    path.unshift(cursor)
    cursor = cursor.parent_pin_id ? pinsById.get(cursor.parent_pin_id) : null
  }
  return path
}

export function surfaceInspectorAnnotationStateToSession(state = {}, options = {}) {
  const pins = activeSurfaceInspectorPins(state)
  const comments = activeSurfaceInspectorComments(state)
  const commentsByPin = new Map()
  for (const comment of comments) {
    if (!commentsByPin.has(comment.pin_id)) commentsByPin.set(comment.pin_id, [])
    commentsByPin.get(comment.pin_id).push(comment)
  }
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
