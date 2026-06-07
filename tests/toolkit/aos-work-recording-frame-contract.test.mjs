import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = resolve(__dirname, '../../docs/design/fixtures/aos-work-recording-frame-v0')

async function readJson(name) {
  return JSON.parse(await readFile(resolve(fixtureDir, name), 'utf8'))
}

function walk(value, visit, path = []) {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, [...path, String(index)]))
    return
  }
  visit(value, path)
  for (const [key, child] of Object.entries(value)) {
    walk(child, visit, [...path, key])
  }
}

function refPath(value) {
  return value && typeof value === 'object' && Object.keys(value).length === 1 ? value.$ref : null
}

function descriptorForRef(fixture, pointer) {
  if (pointer === '#/target_descriptor') return fixture.target_descriptor
  if (pointer === '#/previous_target_descriptor') return fixture.previous_target_descriptor
  throw new Error(`unknown descriptor ref ${pointer}`)
}

function materializeDescriptor(fixture, descriptorOrRef) {
  return descriptorForRef(fixture, refPath(descriptorOrRef)) || descriptorOrRef
}

function namespaceKey(namespace = {}) {
  return JSON.stringify({
    app_id: namespace.app_id,
    canvas_id: namespace.canvas_id,
    surface_id: namespace.surface_id,
    component_family: namespace.component_family,
    structural_owner: namespace.structural_owner,
  })
}

function durableIdentityKey(descriptor = {}) {
  return `${namespaceKey(descriptor.target?.owner_namespace)}\u0000${descriptor.target?.target_id}`
}

function assertDescriptorShape(descriptor, context = descriptor?.ref || 'descriptor') {
  assert.ok(descriptor.ref, `${context} requires state-scoped ref`)
  assert.ok(descriptor.state_id, `${context} requires state_id`)
  assert.ok(descriptor.target?.target_id, `${context} requires target.target_id`)
  assert.ok(descriptor.target?.owner_namespace?.app_id, `${context} requires owner namespace app_id`)
  assert.ok(descriptor.target?.owner_namespace?.canvas_id, `${context} requires owner namespace canvas_id`)
  assert.ok(Array.isArray(descriptor.actions) && descriptor.actions.length > 0, `${context} requires primitive actions`)
  assert.ok(descriptor.state && typeof descriptor.state === 'object', `${context} requires current state`)
  assert.ok(descriptor.provenance?.canvas_id, `${context} requires provenance canvas_id`)
  assert.ok(descriptor.reacquisition?.machine_fingerprint, `${context} requires machine reacquisition fingerprint`)
  assert.ok(descriptor.reacquisition?.hint_fingerprint, `${context} requires hint reacquisition fingerprint`)
}

function assertNoPresentationIdentity(descriptor, context = descriptor?.ref || 'descriptor') {
  const identityText = JSON.stringify({
    target_id: descriptor.target?.target_id,
    owner_namespace: descriptor.target?.owner_namespace,
  })
  for (const presentation of [descriptor.name, descriptor.label, descriptor.accessible_name].filter(Boolean)) {
    assert.notEqual(identityText, presentation, `${context} used presentation text as identity`)
    assert.equal(identityText.includes(`"${presentation}"`), false, `${context} embedded presentation text in identity`)
  }
  walk(descriptor.provenance, (node, path) => {
    if (path.includes('bounds') || path.includes('center') || path.includes('frame')) {
      assert.equal(identityText.includes(JSON.stringify(node)), false, `${context} copied coordinates into identity`)
    }
  })
}

function assertTargetRef(fixture, targetRef, context) {
  assert.ok(targetRef.ref, `${context} requires ref`)
  assert.ok(targetRef.state_id, `${context} requires state_id`)
  const descriptor = materializeDescriptor(fixture, targetRef.target_descriptor)
  assertDescriptorShape(descriptor, context)
  assert.equal(targetRef.ref, descriptor.ref, `${context} ref must match descriptor`)
  assert.equal(targetRef.state_id, descriptor.state_id, `${context} state_id must match descriptor`)
}

function assertReplayPolicyIsSemanticAndGated(policy) {
  assert.equal(policy.mode, 'semantic_reacquire_then_do')
  assert.equal(policy.raw_input_policy, 'do_not_blindly_replay_for_aos_owned_surface')
  assert.equal(policy.work_record_gates.replay_requires_workflow_gate, true)
  assert.equal(policy.work_record_gates.repair_requires_workflow_gate, true)

  const resolveStep = policy.steps.find((step) => step.kind === 'resolve_descriptor')
  assert.ok(resolveStep, `${policy.id} requires resolve_descriptor step`)
  assert.ok(resolveStep.machine_facts_first.includes('target.owner_namespace'))
  assert.ok(resolveStep.machine_facts_first.includes('target.target_id'))
  assert.ok(resolveStep.machine_facts_first.some((fact) => fact.includes('capabilities')))
  assert.ok(resolveStep.hint_facts_only.some((fact) => fact.includes('label_hints') || fact === 'name'))
  assert.equal(resolveStep.ambiguous_result, 'block')
  assert.equal(resolveStep.missing_result, 'block')
}

test('fixture manifest lists the recording frame cases', async () => {
  const manifest = await readJson('manifest.json')

  assert.equal(manifest.schema, 'aos.work-recording-frame.fixture-pack.v0')
  assert.deepEqual(manifest.fixtures.sort(), [
    'blocked-replay-repair-needed.json',
    'periodic-keyframe-checkpoint.json',
    'toolkit-slider-recording.json',
  ])
})

test('baseline and delta frames preserve descriptor identity without label or coordinate identity', async () => {
  const fixture = await readJson('toolkit-slider-recording.json')
  const descriptor = fixture.target_descriptor
  const baseline = fixture.frames.find((frame) => frame.frame_type === 'recording_baseline')
  const delta = fixture.frames.find((frame) => frame.frame_type === 'recording_delta_frame')

  assertDescriptorShape(descriptor)
  assertNoPresentationIdentity(descriptor)
  assert.equal(descriptor.name, 'Brightness')
  assert.equal(baseline.state_id, descriptor.state_id)
  assert.equal(durableIdentityKey(materializeDescriptor(fixture, baseline.target_descriptors[0])), durableIdentityKey(descriptor))

  assertTargetRef(fixture, delta.action_intents[0].target_ref, 'delta.action_intents[0].target_ref')
  assertTargetRef(fixture, delta.state_patches[0].target_ref, 'delta.state_patches[0].target_ref')
  assert.equal(durableIdentityKey(materializeDescriptor(fixture, delta.execution_results[0].target.target_descriptor)), durableIdentityKey(descriptor))
})

test('delta frames keep interaction records typed instead of collapsing them into an event blob', async () => {
  const fixture = await readJson('toolkit-slider-recording.json')
  const delta = fixture.frames.find((frame) => frame.frame_type === 'recording_delta_frame')

  assert.ok(Array.isArray(delta.action_intents) && delta.action_intents.length === 1)
  assert.ok(Array.isArray(delta.execution_results) && delta.execution_results.length === 1)
  assert.ok(Array.isArray(delta.gesture_frames) && delta.gesture_frames.length === 3)
  assert.ok(Array.isArray(delta.state_patches) && delta.state_patches.length === 1)
  assert.ok(Array.isArray(delta.observations) && delta.observations.length === 1)
  assert.equal(Object.hasOwn(delta, 'events'), false)
  assert.equal(delta.action_intents[0].transaction_id, delta.transaction_id)
  assert.equal(delta.execution_results[0].transaction_id, delta.transaction_id)
  assert.equal(delta.state_patches[0].transaction_id, delta.transaction_id)
})

test('gesture frames are optional linked evidence/playback frames, not the recording model', async () => {
  const fixture = await readJson('toolkit-slider-recording.json')
  const delta = fixture.frames.find((frame) => frame.frame_type === 'recording_delta_frame')
  const descriptorKey = durableIdentityKey(fixture.target_descriptor)

  assert.equal(delta.frame_type, 'recording_delta_frame')
  for (const frame of delta.gesture_frames) {
    assert.equal(frame.schema, 'aos.gesture-frame')
    assert.equal(frame.transaction_id, delta.transaction_id)
    assert.equal(frame.semantic_action, 'set-value')
    assert.equal(durableIdentityKey(materializeDescriptor(fixture, frame.semantic_target)), descriptorKey)
  }
  assert.ok(delta.evidence_refs.some((ref) => ref.evidence_id === 'evidence:gesture-trace'))
  assert.ok(delta.observations.some((item) => item.kind === 'surface_inspector_annotation'))
})

test('replay policy is semantic, machine-first, and preserves Work Record gates', async () => {
  const fixture = await readJson('toolkit-slider-recording.json')

  assertReplayPolicyIsSemanticAndGated(fixture.recording_replay_policy)
  assert.equal(fixture.work_record.execution_map.replay_policy.replay_requires_workflow_gate, true)
  assert.equal(fixture.work_record.execution_map.replay_policy.repair_requires_workflow_gate, true)
})

test('keyframes are recovery checkpoints and do not replace semantic deltas', async () => {
  const fixture = await readJson('periodic-keyframe-checkpoint.json')
  const keyframe = fixture.frame

  assertDescriptorShape(fixture.target_descriptor)
  assertNoPresentationIdentity(fixture.target_descriptor)
  assert.equal(keyframe.frame_type, 'recording_keyframe')
  assert.equal(keyframe.keyframe_reason, 'periodic_recovery_checkpoint')
  assert.equal(keyframe.does_not_replace_semantic_deltas, true)
  assert.deepEqual(fixture.semantic_delta_refs.action_intent_refs, ['intent:set-brightness-070'])
  assert.deepEqual(fixture.semantic_delta_refs.execution_result_refs, ['result:set-brightness-070'])
  assert.deepEqual(fixture.semantic_delta_refs.state_patch_refs, ['patch:set-brightness-070'])
})

test('blocked replay appends repair-needed health without mutating historical frames or evidence', async () => {
  const fixture = await readJson('blocked-replay-repair-needed.json')
  const health = fixture.appended_health_record

  assertDescriptorShape(fixture.previous_target_descriptor)
  assertNoPresentationIdentity(fixture.previous_target_descriptor)
  assert.equal(fixture.history_mutation_policy, 'append_only')
  assert.equal(fixture.replay_attempt.resolution.status, 'ambiguous')
  assert.equal(fixture.replay_attempt.resolution.action_blocked, true)
  assert.equal(fixture.replay_attempt.resolution.selected_ref, null)
  assert.equal(fixture.replay_attempt.resolution.labels_used_as_hints_only, true)
  assert.equal(fixture.replay_attempt.execution_result.executed, false)
  assert.equal(health.verdict, 'repairable')
  assert.equal(health.repair_policy.repair_requires_workflow_gate, true)
  assert.equal(health.repair_policy.must_preserve_historical_frames, true)
  assert.equal(health.repair_policy.must_preserve_historical_evidence, true)
  assert.deepEqual(health.affected_frame_refs, fixture.original_frame_refs)
  assert.deepEqual(health.evidence_refs, fixture.original_evidence_refs)
})

test('recording fixtures never make raw input replay, labels, or coordinates durable identity', async () => {
  for (const fixtureName of [
    'toolkit-slider-recording.json',
    'periodic-keyframe-checkpoint.json',
    'blocked-replay-repair-needed.json',
  ]) {
    const fixture = await readJson(fixtureName)
    walk(fixture, (node, path) => {
      if (node.target?.target_id && node.target?.owner_namespace) {
        assertNoPresentationIdentity(node, `${fixtureName}:${path.join('.')}`)
      }
      if (node.raw_input_policy) {
        assert.notEqual(node.raw_input_policy, 'blind_raw_replay')
        assert.notEqual(node.raw_input_policy, 'default_raw_input_replay')
      }
    })
  }
})
