import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_V3_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION,
  SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS,
  createSceneNativeEffectProgram,
  compileSceneNativeEffectProgramGLSL,
  digestSceneNativeEffectProgram,
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
    geometry: {
      kind: 'event_point',
      cellSize: 6,
      padding: 96,
      radius: 480,
    },
    material: {
      lighting: 'standard',
      ambient: 0.65,
      diffuse: 0.45,
      fresnel: 0.24,
      lightDirection: [-0.35, -0.45, 0.82],
      normalSampleDistance: 2,
      perspectiveDistance: 2_400,
      refraction: 12,
      roughness: 0.38,
      specular: 0.72,
    },
  }
}

function v3Program() {
  const candidate = v2Program()
  candidate.contract = SCENE_NATIVE_EFFECT_PROGRAM_V3_CONTRACT_ID
  candidate.schemaVersion = 3
  candidate.id = 'example.effect.fluid-trail'
  candidate.parameters.push(
    { id: 'damping', default: 1.35, min: 0.2, max: 4 },
    { id: 'duration', default: 0.22, min: 0.1, max: 3 },
    { id: 'lead', default: 1, min: 0.2, max: 2 },
    { id: 'pressure', default: 1.15, min: 0.2, max: 3 },
    { id: 'propagation', default: 0.18, min: 0.05, max: 0.35 },
    { id: 'radius', default: 42, min: 8, max: 160 },
    { id: 'surface_tension', default: 0.012, min: 0, max: 0.04 },
  )
  candidate.nodes = [
    { id: 'zero', op: 'constant', value: 0 },
    { id: 'height', op: 'multiply', inputs: ['state.height', 'parameter.amplitude'] },
    { id: 'position', op: 'compose3', inputs: ['node.zero', 'node.zero', 'node.height'] },
    { id: 'texture', op: 'multiply', inputs: ['state.gradient', 'parameter.amplitude'] },
    { id: 'gradient_length', op: 'length', inputs: ['state.gradient'] },
    { id: 'opacity', op: 'clamp01', inputs: ['node.gradient_length'] },
  ]
  candidate.outputs = {
    positionOffset: 'node.position',
    textureDisplacement: 'node.texture',
    opacity: 'node.opacity',
  }
  candidate.geometry = { kind: 'event_segment', cellSize: 6, padding: 192, width: 640 }
  candidate.state = {
    kind: 'damped_height_field',
    maxDimension: 192,
    minDimension: 64,
    fixedStepHz: 60,
    maxSubsteps: 3,
    edgeAbsorptionCells: 8,
    dampingParameter: 'damping',
    propagationParameter: 'propagation',
    surfaceTensionParameter: 'surface_tension',
    emitter: {
      kind: 'swept_brush',
      durationParameter: 'duration',
      pressureParameter: 'pressure',
      radiusParameter: 'radius',
      leadParameter: 'lead',
      spacingRadiusScale: 0.38,
      speedReference: 1_400,
      speedScaleMin: 0.3,
      speedScaleMax: 1.65,
      trajectoryEasing: 'ease_out_quart',
      lobes: [
        { offsetRadiusScale: 1, radiusScale: 1, strengthScale: 1 },
        { offsetRadiusScale: -0.42, radiusScale: 0.82, strengthScale: -0.72 },
      ],
    },
  }
  return candidate
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

  assert.equal(SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID, 'aos.scene.native-effect-program-digest.v1')
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
  assert.equal(created.material.lighting, 'standard')
  assert.equal(created.geometry.kind, 'event_point')

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
    (value) => { value.geometry.cellSize = 1 },
    (value) => { value.geometry.radius = 5_001 },
    (value) => { value.material.roughness = 0 },
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
  assert.equal(compiled.material.lighting, 'standard')
  assert.equal(compiled.geometry.kind, 'event_point')
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

test('v3 native effects add a bounded stateful height field without executable source', () => {
  const candidate = v3Program()
  assert.deepEqual(validateSceneNativeEffectProgram(candidate), { ok: true, errors: [] })
  const created = createSceneNativeEffectProgram(candidate)
  assert.equal(created.state.kind, 'damped_height_field')
  assert.equal(created.state.emitter.lobes.length, 2)
  assert.equal(created.state.emitter.trajectoryEasing, 'ease_out_quart')

  const compatible = v3Program()
  delete compatible.state.emitter.trajectoryEasing
  assert.deepEqual(validateSceneNativeEffectProgram(compatible), { ok: true, errors: [] })
  const explicitLinear = v3Program()
  explicitLinear.state.emitter.trajectoryEasing = 'linear'
  assert.deepEqual(validateSceneNativeEffectProgram(explicitLinear), { ok: true, errors: [] })
  for (const malformed of ['bounce', null, 1, true, undefined]) {
    const invalid = v3Program()
    invalid.state.emitter.trajectoryEasing = malformed
    assert.equal(validateSceneNativeEffectProgram(invalid).ok, false)
  }

  const compiled = compileSceneNativeEffectProgramGLSL(candidate)
  assert.match(compiled.source, /uniform sampler2D aosEffectStateTexture/u)
  assert.match(compiled.source, /aosEffectStateHeight/u)
  assert.match(compiled.source, /aosEffectStateGradient/u)
  assert.match(
    compiled.source,
    /aosEffectSurfaceSize \/ vec2\(textureSize\(aosEffectStateTexture, 0\)\)/u,
  )
  assert.match(compiled.source, /\) \/ \(2\.0 \* aosEffectStateWorldTexel\)/u)
  assert.match(
    compiled.source,
    /texture\(aosEffectStateTexture, surfaceUV \+ vec2\(aosEffectStateTexel\.x, 0\.0\)\)\.r\s+- texture\(aosEffectStateTexture, surfaceUV - vec2\(aosEffectStateTexel\.x, 0\.0\)\)\.r/u,
  )
  assert.match(
    compiled.source,
    /texture\(aosEffectStateTexture, surfaceUV \+ vec2\(0\.0, aosEffectStateTexel\.y\)\)\.r\s+- texture\(aosEffectStateTexture, surfaceUV - vec2\(0\.0, aosEffectStateTexel\.y\)\)\.r/u,
  )

  const surfaceSize = [30, 60]
  const textureSize = [3, 3]
  const worldTexel = surfaceSize.map((size, index) => size / textureSize[index])
  const gradient = [4 - 1, 7 - 3].map(
    (difference, index) => difference / (2 * worldTexel[index]),
  )
  assert.ok(Math.abs(gradient[0] - 0.15) < 0.000_001)
  assert.ok(Math.abs(gradient[1] - 0.10) < 0.000_001)

  for (const mutate of [
    (value) => { value.state.maxDimension = 257 },
    (value) => { value.state.fixedStepHz = 121 },
    (value) => { value.state.emitter.pressureParameter = 'missing' },
    (value) => { value.state.emitter.lobes = [] },
    (value) => { value.state.emitter.lobes[0].radiusScale = 0 },
    (value) => { value.parameters.find((entry) => entry.id === 'radius').max = 513 },
    (value) => { value.nodes[1].inputs[0] = 'state.missing' },
  ]) {
    const invalid = v3Program()
    mutate(invalid)
    assert.equal(validateSceneNativeEffectProgram(invalid).ok, false)
  }

  const leaked = v2Program()
  leaked.nodes[0].inputs[0] = 'state.gradient'
  assert.equal(validateSceneNativeEffectProgram(leaked).ok, false)
})
