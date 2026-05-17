import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addAnnotationCommentText,
  clearAnnotationSession,
  commitAnnotationPreview,
  createAnnotationSession,
  enterAnnotationSession,
  normalizeAnnotationSubjectAddress,
  opacityForDepth,
  opacityLadderForScope,
  refreshAnnotationAnchorStatus,
  setAnnotationHoverCandidate,
  setAnnotationPreviewStack,
  surfaceInspectorPinToAnnotationAnchor,
  upsertAnnotationAnchor,
} from '../../packages/toolkit/workbench/annotation-session.js'

const subject = (id, path = ['display:1', id], extra = {}) => ({
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  root_id: extra.root_id || 'display:1',
  root_kind: extra.root_kind || 'display',
  root_label: extra.root_label || 'Built-in Display',
  subject_id: id,
  subject_path: path,
  subject_kind: extra.subject_kind || 'frame',
  role: extra.role || '',
  label: extra.label || id,
  value: extra.value,
  text_excerpt: extra.text_excerpt,
  source_metadata: extra.source_metadata || { source: 'test-tree' },
  fallback_evidence: extra.fallback_evidence || { path },
  projection: extra.projection || {
    adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
    subject_id: id,
    subject_kind: extra.subject_kind || 'frame',
    current_render_status: 'visible',
    can_project_display_overlay: true,
    visible_display_rect: { x: 10, y: 20, w: 100, h: 40 },
    refreshed_at: '2026-05-13T00:00:00.000Z',
  },
})

test('annotation subjects normalize stable address, adapter, root, subject, evidence, and projection', () => {
  const normalized = normalizeAnnotationSubjectAddress(subject('button', ['display:1', 'window:1', 'button'], {
    subject_kind: 'button',
    role: 'button',
    label: 'Save',
    value: 'Save value',
    text_excerpt: 'Save changes',
  }))

  assert.equal(normalized.address, 'subject:aos-toolkit-semantic-target:display:1:display:1:window:1:button:button')
  assert.equal(normalized.adapter_id, 'aos-toolkit-semantic-target')
  assert.deepEqual(normalized.root, { id: 'display:1', kind: 'display', label: 'Built-in Display' })
  assert.deepEqual(normalized.subject, { id: 'button', path: ['display:1', 'window:1', 'button'], kind: 'button' })
  assert.equal(normalized.role, 'button')
  assert.equal(normalized.label, 'Save')
  assert.equal(normalized.value, 'Save value')
  assert.equal(normalized.text_excerpt, 'Save changes')
  assert.equal(normalized.projection.current_render_status, 'visible')
  assert.equal(normalized.status, 'live')
  assert.deepEqual(normalized.fallback_evidence.path, ['display:1', 'window:1', 'button'])
})

test('annotation subjects keep sparse projection evidence live but unprojectable', () => {
  const normalized = normalizeAnnotationSubjectAddress({
    adapter_id: 'a',
    root_id: 'r',
    subject_id: 's',
  })

  assert.equal(normalized.projection.current_render_status, 'visible')
  assert.equal(normalized.projection.can_project_display_overlay, false)
  assert.equal(normalized.projection.display_space_rect, null)
  assert.equal(normalized.status, 'live')
})

test('session entry keeps committed and preview stacks separate from hover-only preview state', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    entry_source: 'hotkey',
    root: subject('display-root'),
    updated_at: '2026-05-13T00:00:00.000Z',
  })

  assert.equal(session.schema, 'aos_annotation_session')
  assert.equal(session.version, '0.1.0')
  assert.equal(session.active, true)
  assert.equal(session.entry_source, 'hotkey')
  assert.equal(session.committed_scope_stack.length, 1)
  assert.equal(session.preview_scope_stack.length, 1)

  session = setAnnotationHoverCandidate(session, subject('window', ['display:1', 'window']), {
    updated_at: '2026-05-13T00:00:01.000Z',
  })

  assert.equal(session.hover_candidate.subject.id, 'window')
  assert.deepEqual(session.committed_scope_stack.map((item) => item.subject.id), ['display-root'])
  assert.deepEqual(session.preview_scope_stack.map((item) => item.subject.id), ['display-root', 'window'])
  assert.deepEqual(session.anchors, [])
})

test('committing preview creates commentless frame anchors for the selected chain', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    entry_source: 'status_menu',
    root: subject('display-root'),
    updated_at: '2026-05-13T00:00:00.000Z',
  })
  session = setAnnotationPreviewStack(session, [
    subject('display-root'),
    subject('window', ['display:1', 'window']),
    subject('button', ['display:1', 'window', 'button'], { subject_kind: 'button' }),
  ])
  session = commitAnnotationPreview(session, { updated_at: '2026-05-13T00:00:02.000Z' })

  assert.deepEqual(session.committed_scope_stack.map((item) => item.subject.id), ['display-root', 'window', 'button'])
  assert.deepEqual(session.preview_scope_stack.map((item) => item.subject.id), ['display-root', 'window', 'button'])
  assert.equal(session.hover_candidate, null)
  assert.equal(session.anchors.length, 3)
  assert.equal(session.anchors.every((anchor) => anchor.comment_text === ''), true)
  assert.deepEqual(session.anchors.at(-1).scope_path, session.committed_scope_stack.map((item) => item.address))
})

test('comment text is optional and updates existing anchors by authoritative address', () => {
  const target = subject('button', ['display:1', 'window', 'button'], { subject_kind: 'button' })
  let session = upsertAnnotationAnchor(createAnnotationSession(), target, {
    updated_at: '2026-05-13T00:00:00.000Z',
  })

  assert.equal(session.anchors.length, 1)
  assert.equal(session.anchors[0].comment_text, '')

  session = addAnnotationCommentText(session, target, 'Leave this aligned with the label.', {
    updated_at: '2026-05-13T00:00:01.000Z',
  })

  assert.equal(session.anchors.length, 1)
  assert.equal(session.anchors[0].address, normalizeAnnotationSubjectAddress(target).address)
  assert.equal(session.anchors[0].comment_text, 'Leave this aligned with the label.')
  assert.equal(session.anchors[0].projection.current_render_status, 'visible')
})

test('comment text can create an anchor and preview commit updates without duplicating it', () => {
  const target = subject('input', ['display:1', 'window', 'input'], { subject_kind: 'text_field' })
  let session = enterAnnotationSession(createAnnotationSession(), {
    root: subject('display-root'),
  })

  session = addAnnotationCommentText(session, target, 'Optional note')
  assert.equal(session.anchors.length, 1)
  assert.equal(session.anchors[0].comment_text, 'Optional note')

  session = setAnnotationPreviewStack(session, [subject('display-root'), target])
  session = commitAnnotationPreview(session)

  assert.equal(session.anchors.length, 2)
  assert.equal(session.anchors.find((anchor) => anchor.address === normalizeAnnotationSubjectAddress(target).address).comment_text, 'Optional note')
})

test('refresh-only anchor updates preserve comment text and subject metadata', () => {
  const target = subject('button', ['display:1', 'window', 'button'], {
    subject_kind: 'button',
    role: 'button',
    label: 'Save',
    text_excerpt: 'Save changes',
  })
  let session = upsertAnnotationAnchor(createAnnotationSession(), target, {
    comment_text: 'Keep this annotation attached.',
    updated_at: '2026-05-13T00:00:00.000Z',
  })
  const address = normalizeAnnotationSubjectAddress(target).address

  session = refreshAnnotationAnchorStatus(session, address, {
    current_render_status: 'stale',
    can_project_display_overlay: false,
    blocker_reason: 'projection_outdated',
    refreshed_at: '2026-05-13T00:00:01.000Z',
  }, {
    updated_at: '2026-05-13T00:00:02.000Z',
  })

  const anchor = session.anchors.find((item) => item.address === address)
  assert.equal(anchor.comment_text, 'Keep this annotation attached.')
  assert.equal(anchor.subject.adapter_id, 'aos-toolkit-semantic-target')
  assert.deepEqual(anchor.subject.root, { id: 'display:1', kind: 'display', label: 'Built-in Display' })
  assert.deepEqual(anchor.subject.subject, { id: 'button', path: ['display:1', 'window', 'button'], kind: 'button' })
  assert.equal(anchor.subject.role, 'button')
  assert.equal(anchor.subject.label, 'Save')
  assert.equal(anchor.subject.text_excerpt, 'Save changes')
  assert.equal(anchor.status, 'stale')
  assert.equal(anchor.projection.current_render_status, 'stale')
  assert.equal(anchor.projection.blocker_reason, 'projection_outdated')
})

test('clearing or exiting resets live state without incrementing snapshots', () => {
  let session = createAnnotationSession({ snapshot_count: 2 })
  session = upsertAnnotationAnchor(session, subject('button'), { comment_text: 'Note' })
  session = clearAnnotationSession(session, { updated_at: '2026-05-13T00:00:03.000Z' })

  assert.equal(session.active, false)
  assert.equal(session.root, null)
  assert.deepEqual(session.committed_scope_stack, [])
  assert.deepEqual(session.preview_scope_stack, [])
  assert.equal(session.hover_candidate, null)
  assert.deepEqual(session.anchors, [])
  assert.equal(session.snapshot_count, 2)
})

test('absent and stale subjects update anchor live status without treating old projection as truth', () => {
  const target = subject('removed-button')
  let session = upsertAnnotationAnchor(createAnnotationSession(), target)
  session = refreshAnnotationAnchorStatus(session, target, {
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: 'removed-button',
    current_render_status: 'absent',
    can_project_display_overlay: false,
    visible_display_rect: { x: 1, y: 2, w: 3, h: 4 },
    blocker_reason: 'subject_removed',
    refreshed_at: '2026-05-13T00:00:04.000Z',
  })

  assert.equal(session.anchors[0].status, 'absent')
  assert.equal(session.anchors[0].projection.current_render_status, 'absent')
  assert.equal(session.anchors[0].projection.can_project_display_overlay, false)
  assert.equal(session.anchors[0].projection.display_space_rect, null)
  assert.equal(session.anchors[0].projection.blocker_reason, 'subject_removed')

  session = refreshAnnotationAnchorStatus(session, target, {
    adapter_id: 'aos-toolkit-semantic-target',
    subject_id: 'removed-button',
    current_render_status: 'stale',
    can_project_display_overlay: false,
    blocker_reason: 'projection_outdated',
  })

  assert.equal(session.anchors[0].status, 'stale')
  assert.equal(session.anchors[0].projection.can_project_display_overlay, false)
})

test('Surface Inspector pin records can become neutral session anchors', () => {
  const anchor = surfaceInspectorPinToAnnotationAnchor({
    id: 'pin-save',
    root_id: 'display:1',
    root_label: 'Built-in Display',
    root_kind: 'display',
    adapter_id: 'aos-canvas-window',
    subject_id: 'save',
    subject_path: ['display:1', 'window', 'save'],
    source_tree_node_metadata: { source: 'surface-inspector' },
    projection: {
      current_render_status: 'visible',
      visible_display_rect: { x: 1, y: 2, w: 3, h: 4 },
    },
    created_at: '2026-05-13T00:00:00.000Z',
  })

  assert.equal(anchor.id, 'anchor:pin-save')
  assert.equal(anchor.address, 'subject:aos-canvas-window:display:1:display:1:window:save:save')
  assert.equal(anchor.comment_text, '')
  assert.equal(anchor.status, 'live')
  assert.equal(anchor.subject.source_metadata.source, 'surface-inspector')
})

test('opacity helper uses display-first root floor through current frame', () => {
  assert.deepEqual(opacityLadderForScope(1), [1])
  assert.deepEqual(opacityLadderForScope(2), [0.75, 1])
  assert.deepEqual(opacityLadderForScope(3), [0.75, 0.875, 1])

  const four = opacityLadderForScope(4)
  assert.equal(four[0], 0.75)
  assert.equal(Number(four[1].toFixed(3)), 0.833)
  assert.equal(Number(four[2].toFixed(3)), 0.917)
  assert.equal(four[3], 1)
  assert.equal(opacityForDepth(100, 4), 1)
})
