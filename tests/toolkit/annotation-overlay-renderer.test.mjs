import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAnnotationOverlayRenderPlan } from '../../packages/toolkit/workbench/annotation-overlay-renderer.js'
import {
  addAnnotationCommentText,
  commitAnnotationPreview,
  createAnnotationSession,
  enterAnnotationSession,
  refreshAnnotationAnchorStatus,
  setAnnotationHoverCandidate,
  setAnnotationPreviewStack,
  upsertAnnotationAnchor,
} from '../../packages/toolkit/workbench/annotation-session.js'

const annotationOverlayRendererSource = readFileSync(new URL('../../packages/toolkit/workbench/annotation-overlay-renderer.js', import.meta.url), 'utf8')

const projection = (id, rect = { x: 10, y: 20, width: 100, height: 40 }, extra = {}) => ({
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  subject_id: id,
  subject_kind: extra.subject_kind || 'frame',
  current_render_status: extra.current_render_status || 'visible',
  can_project_display_overlay: extra.can_project_display_overlay ?? true,
  can_reveal: false,
  display_space_rect: extra.current_render_status && extra.current_render_status !== 'visible' ? null : rect,
  visible_display_rect: rect,
  blocker_reason: extra.blocker_reason || '',
  refreshed_at: '2026-05-13T00:00:00.000Z',
})

const subject = (id, path = ['display:1', id], extra = {}) => ({
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  root_id: extra.root_id || 'canvas:main',
  root_kind: extra.root_kind || 'canvas',
  root_label: extra.root_label || 'Main Canvas',
  subject_id: id,
  subject_path: path,
  subject_kind: extra.subject_kind || 'frame',
  label: extra.label || id,
  source_metadata: extra.source_metadata || { canvas_id: extra.root_id || 'canvas:main' },
  projection: extra.projection || projection(id, extra.rect),
  status: extra.status,
})

test('renderer groups committed and preview ancestry with display-first opacity', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    entry_source: 'surface_inspector',
    root: subject('root', ['root']),
    updated_at: '2026-05-13T00:00:00.000Z',
  })
  session = setAnnotationPreviewStack(session, [
    subject('root', ['root']),
    subject('window', ['root', 'window']),
    subject('button', ['root', 'window', 'button']),
  ], {
    updated_at: '2026-05-13T00:00:01.000Z',
  })
  session = commitAnnotationPreview(session, {
    updated_at: '2026-05-13T00:00:02.000Z',
  })

  const plan = buildAnnotationOverlayRenderPlan(session)
  assert.equal(plan.schema, 'aos_annotation_overlay_render_plan')
  assert.equal(plan.groups.length, 1)
  assert.deepEqual(plan.groups[0].target, {
    id: 'canvas:main',
    kind: 'canvas',
    canvas_id: 'canvas:main',
    display_id: '',
    root_id: 'canvas:main',
    root_kind: 'canvas',
    root_label: 'Main Canvas',
  })
  assert.deepEqual(plan.groups[0].committed_frames.map((frame) => Number(frame.opacity.toFixed(3))), [0.75, 0.875, 1])
  assert.deepEqual(plan.groups[0].preview_frames.map((frame) => frame.layer), ['preview', 'preview', 'preview'])
  assert.equal(plan.groups[0].committed_frames.at(-1).status, 'live')
  assert.ok(plan.groups[0].active_comment_input)
  assert.equal(plan.groups[0].active_comment_input.placeholder, 'Leave comment (optional)')
})

test('neutral annotation overlay renderer source does not export Surface Inspector adapters', () => {
  assert.doesNotMatch(annotationOverlayRendererSource, /surfaceInspector/)
  assert.doesNotMatch(annotationOverlayRendererSource, /SurfaceInspector/)
  assert.doesNotMatch(annotationOverlayRendererSource, /pinToAnnotationAnchor/)
})

test('commentless anchors render as frames while comment text renders optional chips', () => {
  const target = subject('button', ['root', 'button'])
  let session = upsertAnnotationAnchor(createAnnotationSession({ active: true }), target)
  session = addAnnotationCommentText(session, target, 'Move this under the primary action')
  session = upsertAnnotationAnchor(session, subject('frame-only', ['root', 'frame-only']))

  const plan = buildAnnotationOverlayRenderPlan(session)
  const chips = plan.groups.flatMap((group) => group.comment_chips)
  assert.equal(chips.length, 1)
  assert.equal(chips[0].text, 'Move this under the primary action')
  assert.equal(chips[0].label, 'Move this under...')
})

test('group signatures are stable per target and change only with group contents', () => {
  const targetA = subject('button-a', ['root', 'button-a'], {
    root_id: 'canvas:a',
    source_metadata: { canvas_id: 'canvas:a' },
  })
  const targetB = subject('button-b', ['root', 'button-b'], {
    root_id: 'canvas:b',
    source_metadata: { canvas_id: 'canvas:b' },
  })
  let session = createAnnotationSession({
    active: true,
    committed_scope_stack: [targetA, targetB],
  })
  session = upsertAnnotationAnchor(session, targetA)
  session = upsertAnnotationAnchor(session, targetB)

  const first = buildAnnotationOverlayRenderPlan(session)
  session = addAnnotationCommentText(session, targetA, 'Comment on A')
  const changed = buildAnnotationOverlayRenderPlan(session)

  const firstA = first.groups.find((group) => group.target.id === 'canvas:a')
  const firstB = first.groups.find((group) => group.target.id === 'canvas:b')
  const changedA = changed.groups.find((group) => group.target.id === 'canvas:a')
  const changedB = changed.groups.find((group) => group.target.id === 'canvas:b')

  assert.ok(firstA.signature)
  assert.ok(firstB.signature)
  assert.notEqual(firstA.signature, changedA.signature)
  assert.equal(firstB.signature, changedB.signature)
})

test('stale absent and blocked anchors do not render old rectangles as live frames', () => {
  const stale = subject('stale', ['root', 'stale'])
  const absent = subject('absent', ['root', 'absent'])
  const blocked = subject('blocked', ['root', 'blocked'], {
    projection: projection('blocked', { x: 2, y: 3, width: 30, height: 20 }, {
      current_render_status: 'unsupported',
      can_project_display_overlay: false,
      blocker_reason: 'adapter_unsupported',
    }),
  })
  let session = createAnnotationSession({
    active: true,
    committed_scope_stack: [stale, absent, blocked],
  })
  session = upsertAnnotationAnchor(session, stale)
  session = upsertAnnotationAnchor(session, absent)
  session = refreshAnnotationAnchorStatus(session, stale, {
    current_render_status: 'stale',
    can_project_display_overlay: false,
    visible_display_rect: { x: 1, y: 2, width: 3, height: 4 },
    blocker_reason: 'projection_outdated',
  })
  session = refreshAnnotationAnchorStatus(session, absent, {
    current_render_status: 'absent',
    can_project_display_overlay: false,
    visible_display_rect: { x: 5, y: 6, width: 7, height: 8 },
    blocker_reason: 'subject_removed',
  })
  session = upsertAnnotationAnchor(session, blocked, {
    status: 'blocked',
    projection: blocked.projection,
  })

  const plan = buildAnnotationOverlayRenderPlan({
    ...session,
    committed_scope_stack: session.anchors.map((anchor) => anchor.subject),
  })
  const frames = plan.groups.flatMap((group) => group.committed_frames)
  const framesBySubject = new Map(frames.map((frame) => [frame.subject.subject.id, frame]))
  assert.equal(frames.length, 3)
  assert.equal(frames.every((frame) => frame.rect === null), true)
  assert.equal(framesBySubject.get('stale').status, 'stale')
  assert.equal(framesBySubject.get('absent').status, 'absent')
  assert.equal(framesBySubject.get('blocked').status, 'blocked')
  assert.equal(framesBySubject.get('stale').reason, 'projection_outdated')
  assert.equal(framesBySubject.get('absent').reason, 'subject_removed')
  assert.equal(framesBySubject.get('blocked').reason, 'adapter_unsupported')
  assert.equal(plan.groups.flatMap((group) => group.frame_states).length, 3)
})

test('hover candidates remain preview-only and do not create comment chips', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    root: subject('root', ['root']),
  })
  session = setAnnotationHoverCandidate(session, subject('hover', ['root', 'hover']))

  const plan = buildAnnotationOverlayRenderPlan(session)
  const group = plan.groups[0]
  assert.equal(group.hover_candidate.address.includes('hover'), true)
  assert.equal(group.comment_chips.length, 0)
  assert.equal(plan.groups.flatMap((item) => item.committed_frames).length, 1)
  assert.equal(session.anchors.length, 0)
})

test('stable signatures ignore unchanged hover and projection state', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    root: subject('root', ['root']),
  })
  session = setAnnotationHoverCandidate(session, subject('hover', ['root', 'hover']))

  const first = buildAnnotationOverlayRenderPlan(session)
  const second = buildAnnotationOverlayRenderPlan(createAnnotationSession({
    ...session,
    updated_at: '2026-05-13T00:00:30.000Z',
  }))
  const changed = buildAnnotationOverlayRenderPlan(setAnnotationHoverCandidate(session, subject('other-hover', ['root', 'other-hover'])))

  assert.equal(first.signature, second.signature)
  assert.notEqual(first.signature, changed.signature)
})
