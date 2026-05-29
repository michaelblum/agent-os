import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addAnnotationCommentText,
  commitAnnotationPreview,
  createAnnotationSession,
  enterAnnotationSession,
  setAnnotationPreviewStack,
} from '../../packages/toolkit/workbench/annotation-session.js'
import {
  CONTEXT_SESSION_SCHEMA,
  createContextArtifactFromAnnotationSession,
  createContextKeyframe,
  createContextRecording,
  createContextSession,
  contextSessionSnapshot,
  normalizeContextArtifact,
  normalizeContextPathNode,
} from '../../packages/toolkit/workbench/context-session.js'

const projection = (id, rect = { x: 10, y: 20, w: 100, h: 40 }, extra = {}) => ({
  adapter_id: extra.adapter_id || 'aos-toolkit-semantic-target',
  subject_id: id,
  subject_kind: extra.subject_kind || 'frame',
  current_render_status: extra.current_render_status || 'visible',
  can_project_display_overlay: extra.can_project_display_overlay ?? true,
  display_space_rect: extra.current_render_status && extra.current_render_status !== 'visible' ? null : rect,
  visible_display_rect: rect,
  blocker_reason: extra.blocker_reason || '',
  refreshed_at: '2026-05-28T12:00:00.000Z',
})

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
  source_metadata: extra.source_metadata || {},
  fallback_evidence: extra.fallback_evidence || {},
  projection: extra.projection || projection(id, extra.rect, extra),
})

test('context session can wrap an aos_annotation_session summary', () => {
  let session = enterAnnotationSession(createAnnotationSession(), {
    entry_source: 'sigil_radial',
    root: subject('display-root', ['display:1']),
    updated_at: '2026-05-28T12:00:00.000Z',
  })
  session = setAnnotationPreviewStack(session, [
    subject('display-root', ['display:1']),
    subject('window', ['display:1', 'window']),
  ])
  session = commitAnnotationPreview(session, {
    updated_at: '2026-05-28T12:00:01.000Z',
  })

  const artifact = createContextArtifactFromAnnotationSession(session, {
    id: 'context-artifact:window',
    now: '2026-05-28T12:00:01.000Z',
  })
  const context = createContextSession({
    id: 'context-session:window',
    active: true,
    entry_source: 'sigil_radial',
    source_annotation_session: session,
    artifacts: [artifact],
    updated_at: '2026-05-28T12:00:01.000Z',
  })

  assert.equal(context.schema, CONTEXT_SESSION_SCHEMA)
  assert.equal(context.source_annotation_session.schema, 'aos_annotation_session')
  assert.equal(context.source_annotation_session.entry_source, 'sigil_radial')
  assert.deepEqual(context.artifacts[0].path.map((node) => node.subject.subject.id), ['display-root', 'window'])

  const wrappedSummary = createContextSession({
    id: 'context-session:summary',
    entry_source: 'sigil_radial',
    source_annotation_session: context.source_annotation_session,
    artifacts: [artifact],
    updated_at: '2026-05-28T12:00:02.000Z',
  })
  assert.deepEqual(
    wrappedSummary.source_annotation_session.committed_scope_addresses,
    context.source_annotation_session.committed_scope_addresses,
  )
})

test('context artifacts preserve root-to-leaf path and active leaf selection', () => {
  const artifact = normalizeContextArtifact({
    id: 'context-artifact:button',
    path: [
      subject('display-root', ['display:1']),
      subject('window', ['display:1', 'window']),
      subject('button', ['display:1', 'window', 'button'], { subject_kind: 'button', role: 'button', label: 'Save' }),
    ],
    active_target_node_id: 'node:subject:aos-toolkit-semantic-target:display:1:display:1:window:button:button',
    acquisition: {
      mode: 'selection_mode',
      pointer: { x: 50, y: 60, coordinate_space: 'desktop_world' },
      candidate_report: { selected: 'button' },
    },
  }, { now: '2026-05-28T12:00:00.000Z' })

  assert.deepEqual(artifact.path.map((node) => node.subject.subject.id), ['display-root', 'window', 'button'])
  assert.equal(artifact.acquisition.leaf_node_id, artifact.path.at(-1).id)
  assert.equal(artifact.acquisition.selected_node_id, artifact.active_target_node_id)
  assert.equal(artifact.acquisition.pointer.x, 50)
  assert.equal(artifact.acquisition.candidate_report.selected, 'button')
})

test('active target can be an ancestor while acquisition preserves the clicked leaf', () => {
  const windowNode = normalizeContextPathNode(subject('window', ['display:1', 'window']))
  const leafNode = normalizeContextPathNode(subject('button', ['display:1', 'window', 'button'], {
    subject_kind: 'button',
    role: 'button',
  }))
  const artifact = normalizeContextArtifact({
    id: 'context-artifact:ancestor',
    path: [windowNode, leafNode],
    active_target_node_id: windowNode.id,
    acquisition: {
      mode: 'selection_mode',
      pointer: { x: 210, y: 240, coordinate_space: 'desktop_world' },
      leaf_node_id: leafNode.id,
      selected_node_id: windowNode.id,
      candidate_report: { active_target_override: windowNode.id },
    },
  })

  assert.equal(artifact.active_target_node_id, windowNode.id)
  assert.equal(artifact.acquisition.leaf_node_id, leafNode.id)
  assert.equal(artifact.acquisition.selected_node_id, windowNode.id)
})

test('comments attach to path nodes while anchor comment_text remains compatible', () => {
  let session = createAnnotationSession({ active: true })
  const target = subject('button', ['display:1', 'window', 'button'], { subject_kind: 'button' })
  session = addAnnotationCommentText(session, target, 'Keep this label visible.', {
    updated_at: '2026-05-28T12:00:01.000Z',
  })

  const artifact = createContextArtifactFromAnnotationSession({
    ...session,
    committed_scope_stack: [target],
  }, {
    id: 'context-artifact:comment',
    now: '2026-05-28T12:00:01.000Z',
  })

  assert.equal(artifact.path[0].comments[0].text, 'Keep this label visible.')
  assert.equal(artifact.anchors[0].comment_text, 'Keep this label visible.')
  assert.equal(artifact.anchors[0].source_annotation_anchor_id, session.anchors[0].id)
})

test('projection blockers are preserved on path nodes and anchors', () => {
  const blocked = subject('missing', ['display:1', 'missing'], {
    projection: projection('missing', null, {
      current_render_status: 'absent',
      can_project_display_overlay: false,
      blocker_reason: 'subject_removed',
    }),
  })
  const node = normalizeContextPathNode(blocked)
  const artifact = normalizeContextArtifact({
    id: 'context-artifact:blocked',
    path: [node],
    active_target_node_id: node.id,
    anchors: [{ node_id: node.id, address: node.address, status: 'absent', projection: node.projection }],
  })

  assert.equal(artifact.path[0].blocker.reason, 'subject_removed')
  assert.equal(artifact.anchors[0].status, 'absent')
  assert.equal(artifact.anchors[0].projection.current_render_status, 'absent')
})

test('keyframes can reference multiple artifacts without embedding assets', () => {
  const first = normalizeContextArtifact({ id: 'context-artifact:a', path: [subject('a')], active_target_node_id: 'node:subject:aos-toolkit-semantic-target:display:1:display:1:a:a' })
  const second = normalizeContextArtifact({ id: 'context-artifact:b', path: [subject('b')], active_target_node_id: 'node:subject:aos-toolkit-semantic-target:display:1:display:1:b:b' })
  const keyframe = createContextKeyframe({
    id: 'keyframe:001',
    captured_at: '2026-05-28T12:00:03.000Z',
    trigger: 'sigil_radial_camera',
    artifact_ids: [first.id, second.id],
    asset_refs: {
      capture_image: 'capture.png',
      surface_inspector_annotation_snapshot: 'annotation-snapshot.json',
    },
  })
  const snapshot = contextSessionSnapshot({
    id: 'context-session:snapshot',
    artifacts: [first, second],
    keyframes: [keyframe],
    updated_at: '2026-05-28T12:00:03.000Z',
  })

  assert.deepEqual(snapshot.keyframes[0].artifact_ids, [first.id, second.id])
  assert.equal(snapshot.keyframes[0].asset_refs.capture_image, 'capture.png')
  assert.equal(snapshot.artifacts.length, 2)
})

test('recordings preserve ordered keyframes and timeline events', () => {
  const first = createContextKeyframe({
    id: 'keyframe:001',
    captured_at: '2026-05-28T12:00:00.000Z',
    trigger: 'sigil_radial_camera',
    artifact_ids: ['context-artifact:a'],
    asset_refs: { capture_image: 'capture.png' },
  })
  const second = createContextKeyframe({
    id: 'keyframe:002',
    captured_at: '2026-05-28T12:00:03.000Z',
    trigger: 'ctrl_opt_c',
    artifact_ids: ['context-artifact:a'],
    asset_refs: { context_session_json: 'context-session.json' },
  })
  const recording = createContextRecording({
    id: 'recording:demo',
    created_at: '2026-05-28T12:00:00.000Z',
    updated_at: '2026-05-28T12:00:04.000Z',
    keyframes: [first, second],
    events: [
      {
        id: 'event:note',
        kind: 'text',
        occurred_at: '2026-05-28T12:00:01.000Z',
        after_keyframe_id: first.id,
        before_keyframe_id: second.id,
        text: 'Operator selected the window ancestor.',
      },
      {
        id: 'event:blocker',
        kind: 'blocker',
        occurred_at: '2026-05-28T12:00:02.000Z',
        after_keyframe_id: first.id,
        blocker: { status: 'blocked', reason: 'projection_stale' },
      },
    ],
    asset_refs: { transcript: { uri: 'notes/context-recording.md', media_type: 'text/markdown' } },
    source_metadata: { source: 'test' },
  })

  assert.equal(recording.schema, 'aos_context_recording')
  assert.deepEqual(recording.keyframes.map((keyframe) => keyframe.id), ['keyframe:001', 'keyframe:002'])
  assert.deepEqual(recording.events.map((event) => event.kind), ['text', 'blocker'])
  assert.equal(recording.events[0].after_keyframe_id, first.id)
  assert.equal(recording.events[1].blocker.reason, 'projection_stale')
  assert.equal(recording.asset_refs.transcript.uri, 'notes/context-recording.md')
})

test('keyframe and recording asset refs reject embedded image data', () => {
  assert.throws(() => createContextKeyframe({
    id: 'keyframe:bad',
    captured_at: '2026-05-28T12:00:00.000Z',
    trigger: 'manual',
    asset_refs: { capture_image: 'data:image/png;base64,AAAA' },
  }), /data\/blob URL/)

  assert.throws(() => createContextRecording({
    id: 'recording:bad',
    asset_refs: { image_data: { uri: 'capture.png' } },
  }), /embedded image data/)
})

test('asset refs reject blob and leading-whitespace data refs without rejecting file-like refs', () => {
  for (const [name, fn] of [
    ['keyframe string blob', () => createContextKeyframe({ asset_refs: { capture: 'blob:https://example.test/resource' } })],
    ['keyframe whitespace data', () => createContextKeyframe({ asset_refs: { capture: ' Data:text/plain;base64,SGk=' } })],
    ['recording object blob uri', () => createContextRecording({ asset_refs: { capture: { uri: 'blob:https://example.test/resource' } } })],
    ['recording object whitespace data uri', () => createContextRecording({ asset_refs: { capture: { uri: ' Data:text/plain;base64,SGk=' } } })],
  ]) {
    assert.throws(fn, /data\/blob URL/, name)
  }

  const keyframe = createContextKeyframe({
    asset_refs: {
      capture: 'capture.png',
      annotation_snapshot: 'annotation-snapshot.json',
      notes: { uri: 'notes/context-recording.md', media_type: 'text/markdown' },
    },
  })
  assert.equal(keyframe.asset_refs.capture, 'capture.png')
  assert.equal(keyframe.asset_refs.annotation_snapshot, 'annotation-snapshot.json')
  assert.equal(keyframe.asset_refs.notes.uri, 'notes/context-recording.md')
})
