import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDir = resolve(__dirname, '../../docs/design/fixtures/aos-interaction-grammar-v0')

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
  if (pointer === '#/see/semantic_targets/0') return fixture.see?.semantic_targets?.[0]
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

function assertReplayPlanIsMachineFirst(plan) {
  const resolveStep = plan.steps.find((step) => step.kind === 'resolve_descriptor')
  assert.ok(resolveStep, `${plan.id} requires resolve_descriptor step`)
  assert.ok(resolveStep.machine_facts_first.includes('target.owner_namespace'))
  assert.ok(resolveStep.machine_facts_first.includes('target.target_id'))
  assert.ok(resolveStep.machine_facts_first.some((fact) => fact.includes('capabilities')))
  assert.ok(resolveStep.hint_facts_only.some((fact) => fact.includes('label_hints') || fact === 'name'))
  assert.equal(resolveStep.ambiguous_result, 'block')
}

test('fixture manifest lists the interaction grammar cases', async () => {
  const manifest = await readJson('manifest.json')

  assert.equal(manifest.schema, 'aos.interaction-grammar.fixture-pack.v0')
  assert.deepEqual(manifest.fixtures.sort(), [
    'ambiguous-same-label-reacquisition.json',
    'stale-ref-replay-plan.json',
    'toolkit-slider-sequence.json',
  ])
})

test('slider sequence links see, intent, execution, gesture, patch, record, and replay through descriptor identity', async () => {
  const fixture = await readJson('toolkit-slider-sequence.json')
  const descriptor = fixture.see.semantic_targets[0]

  assertDescriptorShape(descriptor)
  assertNoPresentationIdentity(descriptor)
  assert.equal(descriptor.name, 'Brightness')
  assert.equal(descriptor.actions.includes('set-value'), true)

  assertTargetRef(fixture, fixture.action_intent.target_ref, 'action_intent.target_ref')
  assert.equal(fixture.action_intent.action_type, 'set-value')
  assert.equal(fixture.action_intent.source_state_id, descriptor.state_id)
  assert.equal(fixture.action_intent.input.value, 0.7)

  assert.equal(fixture.execution_result.action_intent_id, fixture.action_intent.id)
  assert.equal(fixture.execution_result.transaction_id, fixture.action_intent.transaction_id)
  assert.equal(fixture.execution_result.execution.state_id, descriptor.state_id)
  assert.equal(durableIdentityKey(materializeDescriptor(fixture, fixture.execution_result.target.target_descriptor)), durableIdentityKey(descriptor))
  assert.equal(durableIdentityKey(materializeDescriptor(fixture, fixture.execution_result.resolved_target.target_descriptor)), durableIdentityKey(descriptor))

  for (const frame of fixture.gesture_frames) {
    assert.equal(frame.schema, 'aos.gesture-frame')
    assert.equal(frame.transaction_id, fixture.action_intent.transaction_id)
    assert.equal(frame.semantic_action, 'set-value')
    assert.equal(durableIdentityKey(materializeDescriptor(fixture, frame.semantic_target)), durableIdentityKey(descriptor))
  }

  assertTargetRef(fixture, fixture.state_patch.target_ref, 'state_patch.target_ref')
  assert.deepEqual(fixture.state_patch.changes[0].path, ['state', 'value'])
  assert.equal(fixture.work_record.execution_map.action_intents[0].$ref, '#/action_intent')
  assert.equal(fixture.work_record.execution_map.execution_results[0].$ref, '#/execution_result')
  assert.equal(fixture.work_record.execution_map.state_patches[0].$ref, '#/state_patch')
  assertReplayPlanIsMachineFirst(fixture.recording_replay_plan)
  assert.equal(fixture.recording_replay_plan.raw_input_policy, 'do_not_blindly_replay_for_aos_owned_slider')
})

test('execution results preserve current aos do metadata fields when present', async () => {
  const slider = await readJson('toolkit-slider-sequence.json')
  const stale = await readJson('stale-ref-replay-plan.json')

  for (const fixture of [slider, stale]) {
    const result = fixture.execution_result
    assert.ok(Object.hasOwn(result, 'status'), `${fixture.case} preserves status`)
    assert.ok(Object.hasOwn(result, 'reason'), `${fixture.case} preserves reason`)
    assert.ok(Object.hasOwn(result, 'duration_ms'), `${fixture.case} preserves duration_ms`)
    assert.ok(Object.hasOwn(result.execution, 'backend'), `${fixture.case} preserves backend`)
    assert.ok(Object.hasOwn(result.execution, 'strategy'), `${fixture.case} preserves strategy`)
    assert.ok(Object.hasOwn(result.execution, 'fallback_used'), `${fixture.case} preserves fallback_used`)
    assert.ok(Object.hasOwn(result.execution, 'state_id'), `${fixture.case} preserves state_id`)
    assert.ok(Object.hasOwn(result, 'target'), `${fixture.case} preserves target details`)
    assert.ok(Object.hasOwn(result, 'resolved_target'), `${fixture.case} preserves resolved target`)
    assert.ok(Object.hasOwn(result, 'post_action_state'), `${fixture.case} preserves post-action state`)
  }
})

test('stale state scoped refs reject before execution and plan machine-first reacquisition', async () => {
  const fixture = await readJson('stale-ref-replay-plan.json')

  assertDescriptorShape(fixture.previous_target_descriptor)
  assertNoPresentationIdentity(fixture.previous_target_descriptor)
  assertTargetRef(fixture, fixture.action_intent.target_ref, 'stale action_intent.target_ref')
  assert.equal(fixture.execution_result.status, 'blocked')
  assert.equal(fixture.execution_result.reason, 'stale_ref')
  assert.equal(fixture.execution_result.executed, false)
  assert.equal(fixture.execution_result.resolved_target.status, 'stale_ref')
  assert.equal(fixture.execution_result.resolved_target.action_blocked, true)
  assert.notEqual(fixture.execution_result.resolved_target.supplied_state_id, fixture.execution_result.resolved_target.current_state_id)
  assertReplayPlanIsMachineFirst(fixture.recording_replay_plan)
})

test('ambiguous same-label reacquisition stays blocked', async () => {
  const fixture = await readJson('ambiguous-same-label-reacquisition.json')

  assertDescriptorShape(fixture.previous_target_descriptor)
  fixture.candidates.forEach((candidate) => {
    assertDescriptorShape(candidate)
    assertNoPresentationIdentity(candidate)
  })
  assert.deepEqual(fixture.candidates.map((candidate) => candidate.name), ['Open', 'Open'])
  assert.equal(fixture.resolution.status, 'ambiguous')
  assert.equal(fixture.resolution.action_blocked, true)
  assert.equal(fixture.resolution.selected_ref, null)
  assert.deepEqual(fixture.resolution.candidate_refs, fixture.candidates.map((candidate) => candidate.ref))
  assert.equal(fixture.resolution.labels_used_as_hints_only, true)
  assertReplayPlanIsMachineFirst(fixture.recording_replay_plan)
})

test('target-addressed records never use raw coordinates as primary identity', async () => {
  for (const fixtureName of [
    'toolkit-slider-sequence.json',
    'stale-ref-replay-plan.json',
    'ambiguous-same-label-reacquisition.json',
  ]) {
    const fixture = await readJson(fixtureName)
    walk(fixture, (node, path) => {
      if (!node.target?.target_id || !node.target?.owner_namespace) return
      assertNoPresentationIdentity(node, `${fixtureName}:${path.join('.')}`)
    })
  }
})

