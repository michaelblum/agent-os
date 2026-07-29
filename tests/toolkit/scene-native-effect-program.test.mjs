import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION,
  SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS,
  createSceneNativeEffectProgram,
  validateSceneNativeEffectParameters,
  validateSceneNativeEffectProgram,
} from '../../packages/toolkit/scene/authoring.js'

function program() {
  return {
    contract: SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
    schemaVersion: 1,
    id: 'example.effect.lens',
    revision: 1,
    durationMs: 900,
    parameters: [{ id: 'amplitude', default: 12, min: 0, max: 96 }],
    nodes: [
      { id: 'delta', op: 'subtract', inputs: ['world.position', 'event.current'] },
      { id: 'distance', op: 'length', inputs: ['node.delta'] },
      { id: 'direction', op: 'normalize', inputs: ['node.delta'] },
      { id: 'displacement', op: 'multiply', inputs: ['node.direction', 'parameter.amplitude'] },
      { id: 'uv', op: 'divide', inputs: ['node.displacement', 'surface.size'] },
      { id: 'one', op: 'constant', value: 1 },
    ],
    outputs: { displacement: 'node.displacement', opacity: 'node.one' },
  }
}

test('native effect authoring accepts a bounded typed graph and freezes its copy', () => {
  const candidate = program()
  assert.deepEqual(validateSceneNativeEffectProgram(candidate), { ok: true, errors: [] })
  const created = createSceneNativeEffectProgram(candidate)
  candidate.nodes[0].inputs[0] = 'surface.uv'
  assert.equal(created.nodes[0].inputs[0], 'world.position')
  assert.equal(Object.isFrozen(created), true)
  assert.equal(Object.isFrozen(created.nodes), true)
  assert.equal(SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION, 'aos.scene.effect.program')
  assert.ok(SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS.includes('constant'))
})

test('native effect graphs reject forward references, type drift, source, and excess work', () => {
  const forward = program()
  forward.nodes[0].inputs[0] = 'node.distance'
  assert.ok(validateSceneNativeEffectProgram(forward).errors.some((entry) => entry.code === 'unknown_native_effect_reference'))

  const drift = program()
  drift.outputs.opacity = 'node.displacement'
  assert.ok(validateSceneNativeEffectProgram(drift).errors.some((entry) => entry.code === 'invalid_native_effect_output_type'))

  const source = program()
  source.nodes[0].source = 'kernel void run() {}'
  assert.ok(validateSceneNativeEffectProgram(source).errors.some((entry) => entry.code === 'unknown_field'))

  const excessive = program()
  excessive.nodes = Array.from({ length: 65 }, (_, index) => ({ id: `n${index}`, op: 'constant', value: 0 }))
  assert.ok(validateSceneNativeEffectProgram(excessive).errors.some((entry) => entry.code === 'invalid_native_effect_node_count'))

  const trailingSeparator = program()
  trailingSeparator.id = 'example.effect-'
  assert.ok(validateSceneNativeEffectProgram(trailingSeparator).errors.some((entry) => entry.code === 'invalid_native_effect_program_id'))

  const costly = program()
  costly.nodes = [
    { id: 'seed', op: 'constant', value: 0 },
    ...Array.from({ length: 17 }, (_, index) => ({
      id: `sine${index}`,
      op: 'sine',
      inputs: [index === 0 ? 'node.seed' : `node.sine${index - 1}`],
    })),
    { id: 'displacement', op: 'constant', value: [0, 0] },
  ]
  costly.outputs = { displacement: 'node.displacement', opacity: 'node.sine16' }
  assert.ok(validateSceneNativeEffectProgram(costly).errors.some((entry) => entry.code === 'native_effect_program_cost'))

  const oversized = program()
  oversized.untrustedPadding = 'x'.repeat(33_000)
  assert.ok(validateSceneNativeEffectProgram(oversized).errors.some((entry) => entry.code === 'native_effect_program_size'))
})

test('native effect parameter overrides are schema-bound', () => {
  assert.deepEqual(validateSceneNativeEffectParameters(program(), { amplitude: 24 }), { ok: true, errors: [] })
  for (const values of [{ amplitude: 97 }, { amplitude: true }, { unknown: 1 }]) {
    assert.equal(validateSceneNativeEffectParameters(program(), values).ok, false)
  }
})
