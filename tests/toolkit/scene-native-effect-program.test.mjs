import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION,
  SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS,
  createSceneNativeEffectProgram,
  compileSceneNativeEffectProgramGLSL,
  digestSceneNativeEffectProgram,
  encodeSceneNativeEffectProgramDigestInput,
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

function v2Program() {
  return {
    contract: SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID,
    schemaVersion: 2,
    id: 'example.effect.sheet-wave',
    revision: 1,
    durationMs: 1_400,
    parameters: [{ id: 'amplitude', default: 18, min: 0, max: 96 }],
    nodes: [
      { id: 'delta', op: 'subtract', inputs: ['world.position', 'event.current'] },
      { id: 'distance', op: 'length', inputs: ['node.delta'] },
      { id: 'phase', op: 'add', inputs: ['node.distance', 'clock.elapsed'] },
      { id: 'wave', op: 'cosine', inputs: ['node.phase'] },
      { id: 'height', op: 'multiply', inputs: ['node.wave', 'parameter.amplitude'] },
      { id: 'zero', op: 'constant', value: 0 },
      { id: 'position', op: 'compose3', inputs: ['node.zero', 'node.zero', 'node.height'] },
      { id: 'texture', op: 'constant', value: [0, 0] },
      { id: 'one', op: 'constant', value: 1 },
    ],
    outputs: {
      positionOffset: 'node.position',
      textureDisplacement: 'node.texture',
      opacity: 'node.one',
    },
    material: {
      lighting: 'lambert',
      ambient: 0.65,
      diffuse: 0.45,
      lightDirection: [-0.35, -0.45, 0.82],
      normalSampleDistance: 2,
      perspectiveDistance: 2_400,
    },
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

test('native effect program digests use one deterministic cross-language contract', async () => {
  const candidate = program()
  const reordered = Object.fromEntries(Object.entries(candidate).reverse())
  reordered.parameters = candidate.parameters.map((parameter) => ({
    max: parameter.max,
    min: parameter.min,
    default: parameter.default,
    id: parameter.id,
  }))

  const encoded = encodeSceneNativeEffectProgramDigestInput(candidate)
  assert.ok(encoded instanceof Uint8Array)
  assert.equal(
    new TextDecoder().decode(encoded.slice(0, SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID.length + 1)),
    `${SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID}\0`,
  )
  const digest = await digestSceneNativeEffectProgram(candidate)
  assert.equal(digest, '9ff0d850e0a5360cae8c3d4fb3691a565873e2f8e6ef589793ca7ed6f57a4a5c')
  assert.equal(await digestSceneNativeEffectProgram(reordered), digest)

  const negativeZero = program()
  negativeZero.nodes.at(-1).value = -0
  const positiveZero = program()
  positiveZero.nodes.at(-1).value = 0
  assert.equal(await digestSceneNativeEffectProgram(negativeZero), await digestSceneNativeEffectProgram(positiveZero))
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

test('v2 native effects express bounded 3D sheet deformation and material state', () => {
  const candidate = v2Program()
  assert.deepEqual(validateSceneNativeEffectProgram(candidate), { ok: true, errors: [] })
  const created = createSceneNativeEffectProgram(candidate)
  assert.equal(created.outputs.positionOffset, 'node.position')
  assert.equal(created.material.lighting, 'lambert')

  const v1Vector = program()
  v1Vector.nodes.splice(-1, 0, { id: 'vector3', op: 'constant', value: [0, 0, 1] })
  assert.equal(validateSceneNativeEffectProgram(v1Vector).ok, false)

  const v1Composition = program()
  v1Composition.nodes.push({ id: 'composed', op: 'compose2', inputs: ['node.one', 'node.one'] })
  assert.equal(validateSceneNativeEffectProgram(v1Composition).ok, false)

  for (const mutate of [
    (value) => { value.outputs.positionOffset = 'node.texture' },
    (value) => { value.material.lightDirection = [0, 0, 0] },
    (value) => { value.material.normalSampleDistance = 65 },
    (value) => { value.material.perspectiveDistance = 128 },
  ]) {
    const invalid = v2Program()
    mutate(invalid)
    assert.equal(validateSceneNativeEffectProgram(invalid).ok, false)
  }
})

test('the same v2 graph compiles to a bounded Three.js-compatible GLSL function', () => {
  const candidate = v2Program()
  const compiled = compileSceneNativeEffectProgramGLSL(candidate)
  const repeated = compileSceneNativeEffectProgramGLSL(candidate)
  assert.equal(compiled.contract, SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID)
  assert.equal(compiled.source, repeated.source)
  assert.deepEqual(compiled.parameterIds, ['amplitude'])
  assert.equal(compiled.material.lighting, 'lambert')
  assert.match(compiled.source, /AosNativeEffectEvaluation aosEvaluateNativeEffect/u)
  assert.match(compiled.source, /vec3 aosRawPositionOffset = aosNode6/u)
  assert.match(compiled.source, /aosFinite\(aosRawPositionOffset\)/u)
  assert.match(compiled.source, /aosPositionLength > 512\.0/u)
  assert.match(compiled.source, /aosDisplacementLength > 96\.0/u)
  assert.doesNotMatch(compiled.source, /positionOffset = clamp/u)
  assert.match(compiled.source, /uniform float aosEffectParameters\[1\]/u)
  assert.doesNotMatch(compiled.source, /example\.effect\.sheet-wave/u)
  assert.equal(Object.isFrozen(compiled), true)
  assert.equal(Object.isFrozen(compiled.parameterIds), true)
})
