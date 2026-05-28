import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSigilContextRecordingRuntime,
} from '../../apps/sigil/renderer/live-modules/context-recording-runtime.js'

const contextSession = {
  schema: 'aos_context_session',
  version: '0.1.0',
  id: 'context-session:test',
  artifacts: [
    { id: 'context-artifact:window' },
  ],
}

test('context recording runtime owns active context keyframes and recording assembly', () => {
  const liveState = {}
  const rendererState = {}
  let nowIndex = 0
  const runtime = createSigilContextRecordingRuntime({
    liveState,
    rendererState,
    now: () => `2026-05-28T12:00:0${nowIndex++}.000Z`,
  })

  const active = runtime.setActiveContextProvider({
    source: 'selection_mode',
    contextSession,
    trigger: 'selection_mode_commit',
    reason: 'test',
  })
  assert.equal(active.context_keyframe.artifact_ids[0], 'context-artifact:window')
  assert.equal(liveState.activeContext, active)
  assert.equal(rendererState.activeContext, active)

  const recording = runtime.appendContextRecordingKeyframe()
  assert.equal(recording.keyframes.length, 1)
  assert.equal(liveState.contextRecording.recording, recording)
  assert.equal(rendererState.contextRecording.recording, recording)

  const updated = runtime.appendContextRecordingEvent({
    kind: 'text',
    text: 'Operator selected the window ancestor.',
  })
  assert.equal(updated.events.length, 1)
  assert.equal(updated.events[0].text, 'Operator selected the window ancestor.')
  assert.equal(runtime.exportContextRecording(), updated)
})

test('reticle active context uses canonical external asset refs', () => {
  const runtime = createSigilContextRecordingRuntime()
  const active = runtime.updateActiveContextFromReticle(contextSession, 'camera')

  assert.equal(active.source, 'sigil_annotation_reticle')
  assert.equal(active.context_keyframe.asset_refs.capture_image, 'capture.png')
  assert.equal(
    active.context_keyframe.asset_refs.surface_inspector_annotation_snapshot,
    'annotation-snapshot.json',
  )
})

test('reticle bundle context assembly stays owned by context recording runtime', () => {
  const liveState = {}
  const runtime = createSigilContextRecordingRuntime({
    liveState,
    now: () => '2026-05-28T12:00:00.000Z',
  })
  const resolved = runtime.resolveReticleBundleContext({
    reticleContextSession: contextSession,
    event: { anchor_count: 2 },
    reason: 'radial-camera',
  })

  assert.equal(resolved.contextSession, contextSession)
  assert.equal(resolved.contextKeyframe.trigger, 'sigil_radial_camera')
  assert.equal(resolved.contextKeyframe.metadata.anchor_count, 2)
  assert.equal(resolved.contextKeyframe.asset_refs.capture_image, 'capture.png')
  assert.equal(
    resolved.contextKeyframe.asset_refs.surface_inspector_annotation_snapshot,
    'annotation-snapshot.json',
  )
  assert.equal(resolved.contextUnavailable, null)
  assert.equal(liveState.activeContext.context_keyframe, resolved.contextKeyframe)
})
