import {
  isCanonicalSceneId,
  isSceneRecord,
} from './scene-contract-primitives.js'

export const SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID = 'aos.scene.native-effect-program.v1'
export const SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID = 'aos.scene.native-effect-program.v2'
export const SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_IDS = Object.freeze([
  SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
  SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID,
])
export const SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION = 'aos.scene.effect.program'
export const SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID = 'aos.scene.native-effect-glsl.v1'
export const SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID = 'aos.scene.native-effect-program-digest.v1'

export const SCENE_NATIVE_EFFECT_PROGRAM_LIMITS = Object.freeze({
  maxConstantMagnitude: 1_000_000,
  maxGeometryCellSize: 64,
  maxGeometryPadding: 512,
  maxGeometryRadius: 2_048,
  maxDurationMs: 3_000,
  maxNodes: 64,
  maxNormalSampleDistance: 64,
  maxParameters: 16,
  maxPerspectiveDistance: 20_000,
  maxPositionOffset: 512,
  maxPrograms: 8,
  maxSerializedBytes: 32_768,
  maxTextureDisplacement: 96,
  maxTranscendentalOperations: 16,
  minDurationMs: 100,
  minGeometryCellSize: 2,
  minNormalSampleDistance: 0.25,
  minPerspectiveDistance: 256,
})

export const SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS = Object.freeze([
  'absolute',
  'add',
  'clamp01',
  'component_x',
  'component_y',
  'component_z',
  'compose2',
  'compose3',
  'constant',
  'cosine',
  'distance_to_segment',
  'divide',
  'dot',
  'exponential',
  'length',
  'maximum',
  'minimum',
  'mix',
  'multiply',
  'negate',
  'normalize',
  'one_minus',
  'perpendicular',
  'sine',
  'smoothstep',
  'subtract',
])

const BUILTIN_TYPES = new Map([
  ['clock.elapsed', 'scalar'],
  ['event.current', 'vec2'],
  ['event.delta', 'vec2'],
  ['event.origin', 'vec2'],
  ['event.total_delta', 'vec2'],
  ['surface.size', 'vec2'],
  ['surface.position', 'vec3'],
  ['surface.uv', 'vec2'],
  ['world.position', 'vec2'],
])
const OPERATORS = new Set(
  SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS.filter((entry) => entry !== 'constant'),
)

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function exactKeys(value, allowed, path, errors) {
  if (!isSceneRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, 'unknown_field', `${path}.${key}`, `Unknown native effect program field ${key}.`)
  }
}

function finiteScalar(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxConstantMagnitude
}

function constantType(value, allowVector3) {
  if (finiteScalar(value)) return 'scalar'
  if (Array.isArray(value) && value.length === 2 && value.every(finiteScalar)) return 'vec2'
  if (allowVector3 && Array.isArray(value) && value.length === 3 && value.every(finiteScalar)) return 'vec3'
  return null
}

function resolveReference(reference, types) {
  if (typeof reference !== 'string') return null
  if (types.has(reference)) return types.get(reference)
  if (reference.startsWith('parameter.')) return types.get(reference) ?? null
  if (reference.startsWith('node.')) return types.get(reference) ?? null
  return null
}

function sameType(inputs, count) {
  return inputs.length === count && inputs.every((entry) => entry === inputs[0])
    ? inputs[0]
    : null
}

function inferOperatorType(operation, inputs, allowVector3) {
  switch (operation) {
  case 'add':
  case 'subtract':
  case 'minimum':
  case 'maximum':
    return sameType(inputs, 2)
  case 'multiply':
    if (inputs.length !== 2) return null
    if (inputs[0] === inputs[1]) return inputs[0]
    if (inputs.includes('scalar') && inputs.some((entry) => ['vec2', 'vec3'].includes(entry))) {
      return inputs.find((entry) => entry !== 'scalar')
    }
    return null
  case 'divide':
    if (inputs.length !== 2) return null
    if (inputs[0] === 'scalar' && inputs[1] === 'scalar') return 'scalar'
    if (['vec2', 'vec3'].includes(inputs[0]) && ['scalar', inputs[0]].includes(inputs[1])) return inputs[0]
    return null
  case 'length':
    return inputs.length === 1 && ['vec2', 'vec3'].includes(inputs[0]) ? 'scalar' : null
  case 'normalize':
    return inputs.length === 1 && ['vec2', 'vec3'].includes(inputs[0]) ? inputs[0] : null
  case 'perpendicular':
    return inputs.length === 1 && inputs[0] === 'vec2' ? 'vec2' : null
  case 'absolute':
  case 'clamp01':
  case 'cosine':
  case 'exponential':
  case 'negate':
  case 'one_minus':
  case 'sine':
    return inputs.length === 1 && inputs[0] === 'scalar' ? 'scalar' : null
  case 'dot':
    return inputs.length === 2
      && inputs[0] === inputs[1]
      && ['vec2', 'vec3'].includes(inputs[0])
      ? 'scalar'
      : null
  case 'compose2':
    return allowVector3 && inputs.length === 2 && inputs.every((entry) => entry === 'scalar') ? 'vec2' : null
  case 'compose3':
    return allowVector3 && inputs.length === 3 && inputs.every((entry) => entry === 'scalar') ? 'vec3' : null
  case 'component_x':
  case 'component_y':
    return allowVector3 && inputs.length === 1 && ['vec2', 'vec3'].includes(inputs[0]) ? 'scalar' : null
  case 'component_z':
    return allowVector3 && inputs.length === 1 && inputs[0] === 'vec3' ? 'scalar' : null
  case 'smoothstep':
    return inputs.length === 3 && inputs.every((entry) => entry === 'scalar') ? 'scalar' : null
  case 'distance_to_segment':
    return inputs.length === 3 && inputs.every((entry) => entry === 'vec2') ? 'scalar' : null
  case 'mix':
    return inputs.length === 3
      && inputs[0] === inputs[1]
      && inputs[2] === 'scalar'
      ? inputs[0]
      : null
  default:
    return null
  }
}

function validateParameter(parameter, index, types, errors) {
  const path = `program.parameters.${index}`
  if (!isSceneRecord(parameter)) {
    addError(errors, 'invalid_native_effect_parameter', path, 'Native effect parameters must be bounded scalar declarations.')
    return
  }
  exactKeys(parameter, new Set(['default', 'id', 'max', 'min']), path, errors)
  if (!isCanonicalSceneId(parameter.id) || parameter.id.includes('/')) {
    addError(errors, 'invalid_native_effect_parameter_id', `${path}.id`, 'Native effect parameter IDs must be canonical local identifiers.')
    return
  }
  const reference = `parameter.${parameter.id}`
  if (types.has(reference)) {
    addError(errors, 'duplicate_native_effect_parameter', `${path}.id`, 'Native effect parameter IDs must be unique.')
    return
  }
  if (![parameter.default, parameter.min, parameter.max].every(finiteScalar)
      || parameter.min > parameter.default
      || parameter.default > parameter.max) {
    addError(errors, 'invalid_native_effect_parameter_bounds', path, 'Native effect parameter defaults must lie within finite bounds.')
    return
  }
  types.set(reference, 'scalar')
}

function validateNode(node, index, types, errors, allowVector3) {
  const path = `program.nodes.${index}`
  if (!isSceneRecord(node)) {
    addError(errors, 'invalid_native_effect_node', path, 'Native effect program nodes must be bounded declarations.')
    return
  }
  const constant = node.op === 'constant'
  exactKeys(node, constant ? new Set(['id', 'op', 'value']) : new Set(['id', 'inputs', 'op']), path, errors)
  if (!isCanonicalSceneId(node.id) || node.id.includes('/')) {
    addError(errors, 'invalid_native_effect_node_id', `${path}.id`, 'Native effect node IDs must be canonical local identifiers.')
    return
  }
  const reference = `node.${node.id}`
  if (types.has(reference)) {
    addError(errors, 'duplicate_native_effect_node', `${path}.id`, 'Native effect node IDs must be unique.')
    return
  }
  if (constant) {
    const type = constantType(node.value, allowVector3)
    if (!type) addError(errors, 'invalid_native_effect_constant', `${path}.value`, `Native effect constants must be a bounded scalar, vec2${allowVector3 ? ', or vec3' : ''}.`)
    else types.set(reference, type)
    return
  }
  if (!OPERATORS.has(node.op)) {
    addError(errors, 'unknown_native_effect_operator', `${path}.op`, 'Native effect programs may use only registered operators.')
    return
  }
  if (!Array.isArray(node.inputs) || node.inputs.length < 1 || node.inputs.length > 3) {
    addError(errors, 'invalid_native_effect_inputs', `${path}.inputs`, 'Native effect operators require between one and three ordered inputs.')
    return
  }
  const inputTypes = node.inputs.map((entry, inputIndex) => {
    const type = resolveReference(entry, types)
    if (!type) addError(errors, 'unknown_native_effect_reference', `${path}.inputs.${inputIndex}`, 'Native effect nodes may reference only built-ins, parameters, or prior nodes.')
    return type
  })
  if (inputTypes.some((entry) => !entry)) return
  const type = inferOperatorType(node.op, inputTypes, allowVector3)
  if (!type) {
    addError(errors, 'invalid_native_effect_operator_types', path, 'Native effect operator inputs do not match its typed signature.')
    return
  }
  types.set(reference, type)
}

function validateMaterial(material, errors) {
  const path = 'program.material'
  if (!isSceneRecord(material)) {
    addError(errors, 'invalid_native_effect_material', path, 'V2 native effect programs require a bounded material declaration.')
    return
  }
  const standard = material.lighting === 'standard'
  exactKeys(material, new Set([
    'ambient', 'diffuse', 'lightDirection', 'lighting',
    'normalSampleDistance', 'perspectiveDistance',
    ...(standard ? ['fresnel', 'refraction', 'roughness', 'specular'] : []),
  ]), path, errors)
  if (!['lambert', 'standard', 'unlit'].includes(material.lighting)) {
    addError(errors, 'invalid_native_effect_lighting', `${path}.lighting`, 'Native effect materials support unlit, Lambert, or standard lighting.')
  }
  for (const field of ['ambient', 'diffuse']) {
    if (!finiteScalar(material[field]) || material[field] < 0 || material[field] > 2) {
      addError(errors, 'invalid_native_effect_material_scalar', `${path}.${field}`, 'Native effect material light levels must be finite values from 0 through 2.')
    }
  }
  const direction = material.lightDirection
  if (!Array.isArray(direction)
      || direction.length !== 3
      || !direction.every(finiteScalar)
      || Math.hypot(...direction) < 0.000001) {
    addError(errors, 'invalid_native_effect_light_direction', `${path}.lightDirection`, 'Native effect light direction must be a finite nonzero vec3.')
  }
  if (!finiteScalar(material.normalSampleDistance)
      || material.normalSampleDistance < SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.minNormalSampleDistance
      || material.normalSampleDistance > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxNormalSampleDistance) {
    addError(errors, 'invalid_native_effect_normal_sample_distance', `${path}.normalSampleDistance`, 'Native effect normal sampling must stay within the engine bounds.')
  }
  if (!finiteScalar(material.perspectiveDistance)
      || material.perspectiveDistance < SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.minPerspectiveDistance
      || material.perspectiveDistance > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxPerspectiveDistance) {
    addError(errors, 'invalid_native_effect_perspective_distance', `${path}.perspectiveDistance`, 'Native effect perspective distance must stay within the engine bounds.')
  }
  if (standard) {
    for (const [field, minimum, maximum] of [
      ['fresnel', 0, 1],
      ['refraction', 0, SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxTextureDisplacement],
      ['roughness', 0.02, 1],
      ['specular', 0, 2],
    ]) {
      if (!finiteScalar(material[field]) || material[field] < minimum || material[field] > maximum) {
        addError(errors, 'invalid_native_effect_material_scalar', `${path}.${field}`, `Native effect material ${field} is outside the engine bounds.`)
      }
    }
  }
}

function validateGeometry(geometry, errors) {
  const path = 'program.geometry'
  if (!isSceneRecord(geometry)) {
    addError(errors, 'invalid_native_effect_geometry', path, 'Native effect geometry must be a bounded declaration.')
    return
  }
  const kind = geometry.kind
  const allowed = kind === 'surface'
    ? new Set(['cellSize', 'kind'])
    : kind === 'event_segment'
      ? new Set(['cellSize', 'kind', 'padding', 'width'])
      : new Set(['cellSize', 'kind', 'padding', 'radius'])
  exactKeys(geometry, allowed, path, errors)
  if (!['event_endpoints', 'event_point', 'event_segment', 'surface'].includes(kind)) {
    addError(errors, 'invalid_native_effect_geometry_kind', `${path}.kind`, 'Native effect geometry kind is unsupported.')
  }
  if (!finiteScalar(geometry.cellSize)
      || geometry.cellSize < SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.minGeometryCellSize
      || geometry.cellSize > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxGeometryCellSize) {
    addError(errors, 'invalid_native_effect_geometry_cell_size', `${path}.cellSize`, 'Native effect geometry cell size is outside the engine bounds.')
  }
  if (kind !== 'surface') {
    if (!finiteScalar(geometry.padding)
        || geometry.padding < 0
        || geometry.padding > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxGeometryPadding) {
      addError(errors, 'invalid_native_effect_geometry_padding', `${path}.padding`, 'Native effect geometry padding is outside the engine bounds.')
    }
    const extentField = kind === 'event_segment' ? 'width' : 'radius'
    if (!finiteScalar(geometry[extentField])
        || geometry[extentField] < geometry.cellSize
        || geometry[extentField] > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxGeometryRadius) {
      addError(errors, 'invalid_native_effect_geometry_extent', `${path}.${extentField}`, 'Native effect geometry extent is outside the engine bounds.')
    }
  }
}

export function validateSceneNativeEffectProgram(program) {
  const errors = []
  if (!isSceneRecord(program)) {
    return { ok: false, errors: [{ code: 'invalid_native_effect_program', path: 'program', message: 'Native effect program must be an object.' }] }
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(program)).byteLength > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxSerializedBytes) {
      addError(errors, 'native_effect_program_size', 'program', 'Native effect program exceeds its serialized byte limit.')
    }
  } catch {
    addError(errors, 'invalid_native_effect_program', 'program', 'Native effect program must be finite JSON.')
  }
  const version = program.contract === SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID
    ? 1
    : program.contract === SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID ? 2 : null
  const allowVector3 = version === 2
  exactKeys(program, new Set([
    'contract', 'durationMs', 'id', ...(allowVector3 ? ['geometry', 'material'] : []),
    'nodes', 'outputs', 'parameters', 'revision', 'schemaVersion',
  ]), 'program', errors)
  if (!version) addError(errors, 'invalid_native_effect_program_contract', 'program.contract', 'Native effect program contract is unsupported.')
  if (program.schemaVersion !== version) addError(errors, 'invalid_native_effect_program_version', 'program.schemaVersion', 'Native effect program schema version is unsupported.')
  if (!isCanonicalSceneId(program.id)) addError(errors, 'invalid_native_effect_program_id', 'program.id', 'Native effect program ID must be canonical.')
  if (!Number.isInteger(program.revision) || program.revision < 1 || program.revision > 2_147_483_647) addError(errors, 'invalid_native_effect_program_revision', 'program.revision', 'Native effect program revision must be a positive bounded integer.')
  if (!Number.isInteger(program.durationMs)
      || program.durationMs < SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.minDurationMs
      || program.durationMs > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxDurationMs) {
    addError(errors, 'invalid_native_effect_program_duration', 'program.durationMs', 'Native effect program duration must be a bounded integer.')
  }

  const types = new Map(BUILTIN_TYPES)
  if (!allowVector3) types.delete('surface.position')
  if (!Array.isArray(program.parameters) || program.parameters.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxParameters) {
    addError(errors, 'invalid_native_effect_parameter_count', 'program.parameters', 'Native effect programs exceed the parameter limit.')
  } else {
    program.parameters.forEach((entry, index) => validateParameter(entry, index, types, errors))
  }
  if (!Array.isArray(program.nodes) || program.nodes.length < 1 || program.nodes.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxNodes) {
    addError(errors, 'invalid_native_effect_node_count', 'program.nodes', 'Native effect programs require a bounded node graph.')
  } else {
    program.nodes.forEach((entry, index) => validateNode(entry, index, types, errors, allowVector3))
    const transcendentalCount = program.nodes.filter((entry) => [
      'cosine', 'exponential', 'sine', 'smoothstep',
    ].includes(entry?.op)).length
    if (transcendentalCount > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxTranscendentalOperations) {
      addError(errors, 'native_effect_program_cost', 'program.nodes', 'Native effect program exceeds its transcendental operation budget.')
    }
  }
  if (!isSceneRecord(program.outputs)) {
    addError(errors, 'invalid_native_effect_outputs', 'program.outputs', 'Native effect programs require bounded geometry and material outputs.')
  } else {
    const outputKeys = allowVector3
      ? ['opacity', 'positionOffset', 'textureDisplacement']
      : ['displacement', 'opacity']
    exactKeys(program.outputs, new Set(outputKeys), 'program.outputs', errors)
    const displacement = allowVector3
      ? program.outputs.textureDisplacement
      : program.outputs.displacement
    if (resolveReference(displacement, types) !== 'vec2') addError(errors, 'invalid_native_effect_output_type', allowVector3 ? 'program.outputs.textureDisplacement' : 'program.outputs.displacement', 'Native effect texture displacement must reference a vec2 value.')
    if (resolveReference(program.outputs.opacity, types) !== 'scalar') addError(errors, 'invalid_native_effect_output_type', 'program.outputs.opacity', 'Native effect opacity must reference a scalar value.')
    if (allowVector3 && resolveReference(program.outputs.positionOffset, types) !== 'vec3') {
      addError(errors, 'invalid_native_effect_output_type', 'program.outputs.positionOffset', 'V2 native effect position offset must reference a vec3 value.')
    }
  }
  if (allowVector3) {
    if (program.geometry !== undefined) validateGeometry(program.geometry, errors)
    validateMaterial(program.material, errors)
  }
  return { ok: errors.length === 0, errors }
}

const digestEncoder = new TextEncoder()
const digestDomain = digestEncoder.encode(`${SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID}\0`)

function appendDigestLength(bytes, value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new TypeError('Native effect program digest input exceeds its bounded length.')
  }
  bytes.push(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

function appendDigestBytes(bytes, value) {
  for (const byte of value) bytes.push(byte)
}

function appendDigestString(bytes, value) {
  const encoded = digestEncoder.encode(value)
  appendDigestLength(bytes, encoded.byteLength)
  appendDigestBytes(bytes, encoded)
}

function compareDigestKeys(left, right) {
  const leftBytes = digestEncoder.encode(left)
  const rightBytes = digestEncoder.encode(right)
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index]
  }
  return leftBytes.length - rightBytes.length
}

function appendDigestValue(bytes, value) {
  if (value === null) {
    bytes.push(0)
    return
  }
  if (typeof value === 'boolean') {
    bytes.push(value ? 2 : 1)
    return
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    bytes.push(3)
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setFloat64(0, Object.is(value, -0) ? 0 : value, false)
    appendDigestBytes(bytes, new Uint8Array(buffer))
    return
  }
  if (typeof value === 'string') {
    bytes.push(4)
    appendDigestString(bytes, value)
    return
  }
  if (Array.isArray(value)) {
    bytes.push(5)
    appendDigestLength(bytes, value.length)
    value.forEach((entry) => appendDigestValue(bytes, entry))
    return
  }
  if (isSceneRecord(value)) {
    const keys = Object.keys(value).sort(compareDigestKeys)
    bytes.push(6)
    appendDigestLength(bytes, keys.length)
    for (const key of keys) {
      appendDigestString(bytes, key)
      appendDigestValue(bytes, value[key])
    }
    return
  }
  throw new TypeError('Native effect program digest input must contain only finite JSON values.')
}

function encodeSceneNativeEffectProgramDigestInput(program) {
  const validation = validateSceneNativeEffectProgram(program)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message ?? 'Invalid native effect program.')
  const bytes = [...digestDomain]
  appendDigestValue(bytes, program)
  if (bytes.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxSerializedBytes * 4) {
    throw new TypeError('Native effect program digest input exceeds its bounded size.')
  }
  return Uint8Array.from(bytes)
}

export async function digestSceneNativeEffectProgram(program) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new TypeError('Native effect program digest requires Web Crypto.')
  const digest = await subtle.digest('SHA-256', encodeSceneNativeEffectProgramDigestInput(program))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function validateSceneNativeEffectParameters(program, values, path = 'parameters') {
  const errors = []
  const validation = validateSceneNativeEffectProgram(program)
  if (!validation.ok) return validation
  if (!isSceneRecord(values)) return { ok: false, errors: [{ code: 'invalid_parameters', path, message: 'Native effect parameters must be an object.' }] }
  const declarations = new Map(program.parameters.map((entry) => [entry.id, entry]))
  for (const [id, value] of Object.entries(values)) {
    const declaration = declarations.get(id)
    if (!declaration) addError(errors, 'unknown_native_effect_parameter', `${path}.${id}`, 'Native effect parameter is not declared by the program.')
    else if (!finiteScalar(value) || value < declaration.min || value > declaration.max) addError(errors, 'invalid_native_effect_parameter', `${path}.${id}`, 'Native effect parameter must be finite and within its declared bounds.')
  }
  return { ok: errors.length === 0, errors }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (isSceneRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]))
  return value
}

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze)
  else if (isSceneRecord(value)) Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

export function createSceneNativeEffectProgram(program) {
  const validation = validateSceneNativeEffectProgram(program)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message ?? 'Invalid native effect program.')
  return freeze(clone(program))
}

function glslScalar(value) {
  const encoded = Number(value).toPrecision(9).replace(/(?:\.0+|(?:(\.\d*?)0+))(?=e|$)/u, '$1')
  return /[.e]/iu.test(encoded) ? encoded : `${encoded}.0`
}

function glslType(type) {
  if (type === 'scalar') return 'float'
  return type
}

function glslReference(reference, variables, parameterIndexes) {
  const builtins = {
    'clock.elapsed': 'aosEffectElapsed',
    'event.current': 'aosEffectEventCurrent',
    'event.delta': 'aosEffectEventDelta',
    'event.origin': 'aosEffectEventOrigin',
    'event.total_delta': 'aosEffectEventTotalDelta',
    'surface.position': 'surfacePosition',
    'surface.size': 'aosEffectSurfaceSize',
    'surface.uv': 'surfaceUV',
    'world.position': 'worldPosition',
  }
  if (builtins[reference]) return builtins[reference]
  if (reference.startsWith('parameter.')) {
    const index = parameterIndexes.get(reference.slice('parameter.'.length))
    return index === undefined ? null : `aosEffectParameters[${index}]`
  }
  return variables.get(reference) ?? null
}

function glslExpression(node, inputs, inputTypes) {
  switch (node.op) {
  case 'constant':
    if (!Array.isArray(node.value)) return glslScalar(node.value)
    return `${glslType(constantType(node.value, true))}(${node.value.map(glslScalar).join(', ')})`
  case 'absolute': return `abs(${inputs[0]})`
  case 'add': return `(${inputs[0]} + ${inputs[1]})`
  case 'clamp01': return `clamp(${inputs[0]}, 0.0, 1.0)`
  case 'component_x': return `(${inputs[0]}.x)`
  case 'component_y': return `(${inputs[0]}.y)`
  case 'component_z': return `(${inputs[0]}.z)`
  case 'compose2': return `vec2(${inputs[0]}, ${inputs[1]})`
  case 'compose3': return `vec3(${inputs[0]}, ${inputs[1]}, ${inputs[2]})`
  case 'cosine': return `cos(${inputs[0]})`
  case 'distance_to_segment': return `aosPointSegmentDistance(${inputs.join(', ')})`
  case 'divide':
    if (node.type === 'scalar') return `aosSafeScalarDivide(${inputs[0]}, ${inputs[1]})`
    return inputTypes[1] === 'scalar'
      ? `(${inputs[0]} / aosSafeScalarDenominator(${inputs[1]}))`
      : `aosSafeVectorDivide(${inputs[0]}, ${inputs[1]})`
  case 'dot': return `dot(${inputs[0]}, ${inputs[1]})`
  case 'exponential': return `exp(clamp(${inputs[0]}, -32.0, 32.0))`
  case 'length': return `length(${inputs[0]})`
  case 'maximum': return `max(${inputs[0]}, ${inputs[1]})`
  case 'minimum': return `min(${inputs[0]}, ${inputs[1]})`
  case 'mix': return `mix(${inputs[0]}, ${inputs[1]}, ${inputs[2]})`
  case 'multiply': return `(${inputs[0]} * ${inputs[1]})`
  case 'negate': return `(-${inputs[0]})`
  case 'normalize': return `aosSafeNormalize(${inputs[0]})`
  case 'one_minus': return `(1.0 - ${inputs[0]})`
  case 'perpendicular': return `vec2(-${inputs[0]}.y, ${inputs[0]}.x)`
  case 'sine': return `sin(${inputs[0]})`
  case 'smoothstep': return `smoothstep(${inputs[0]}, ${inputs[1]}, ${inputs[2]})`
  case 'subtract': return `(${inputs[0]} - ${inputs[1]})`
  default: return null
  }
}

const GLSL_COMMON_SOURCE = `
float aosSafeScalarDenominator(float value) {
  float safeValue = max(abs(value), 0.000001);
  return value < 0.0 ? -safeValue : safeValue;
}
float aosSafeScalarDivide(float numerator, float denominator) {
  return numerator / aosSafeScalarDenominator(denominator);
}
vec2 aosSafeVectorDivide(vec2 numerator, vec2 denominator) {
  return numerator / vec2(
    aosSafeScalarDenominator(denominator.x),
    aosSafeScalarDenominator(denominator.y)
  );
}
vec3 aosSafeVectorDivide(vec3 numerator, vec3 denominator) {
  return numerator / vec3(
    aosSafeScalarDenominator(denominator.x),
    aosSafeScalarDenominator(denominator.y),
    aosSafeScalarDenominator(denominator.z)
  );
}
vec2 aosSafeNormalize(vec2 value) {
  float magnitude = length(value);
  return magnitude > 0.000001 ? value / magnitude : vec2(0.0);
}
vec3 aosSafeNormalize(vec3 value) {
  float magnitude = length(value);
  return magnitude > 0.000001 ? value / magnitude : vec3(0.0, 0.0, 1.0);
}
float aosPointSegmentDistance(vec2 point, vec2 start, vec2 end) {
  vec2 segment = end - start;
  float denominator = max(dot(segment, segment), 0.000001);
  float amount = clamp(dot(point - start, segment) / denominator, 0.0, 1.0);
  return length(point - (start + segment * amount));
}
bool aosFinite(float value) {
  return value == value && abs(value) <= 3.402823e38;
}
bool aosFinite(vec2 value) {
  return all(equal(value, value))
    && all(lessThanEqual(abs(value), vec2(3.402823e38)));
}
bool aosFinite(vec3 value) {
  return all(equal(value, value))
    && all(lessThanEqual(abs(value), vec3(3.402823e38)));
}`.trim()

export function compileSceneNativeEffectProgramGLSL(program) {
  const validation = validateSceneNativeEffectProgram(program)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message ?? 'Invalid native effect program.')
  const version = program.schemaVersion
  const types = new Map(BUILTIN_TYPES)
  if (version === 1) types.delete('surface.position')
  const parameterIndexes = new Map(program.parameters.map((entry, index) => [entry.id, index]))
  program.parameters.forEach((entry) => types.set(`parameter.${entry.id}`, 'scalar'))
  const variables = new Map()
  const statements = []
  program.nodes.forEach((node, index) => {
    const reference = `node.${node.id}`
    const inputTypes = node.op === 'constant' ? [] : node.inputs.map((entry) => types.get(entry))
    const type = node.op === 'constant'
      ? constantType(node.value, version === 2)
      : inferOperatorType(node.op, inputTypes, version === 2)
    const inputs = node.op === 'constant'
      ? []
      : node.inputs.map((entry) => glslReference(entry, variables, parameterIndexes))
    const expression = glslExpression({ ...node, type }, inputs, inputTypes)
    if (!type || !expression || inputs.some((entry) => !entry)) {
      throw new TypeError('Native effect program could not compile to GLSL.')
    }
    const variable = `aosNode${index}`
    statements.push(`  ${glslType(type)} ${variable} = ${expression};`)
    variables.set(reference, variable)
    types.set(reference, type)
  })
  const positionOffset = version === 2
    ? glslReference(program.outputs.positionOffset, variables, parameterIndexes)
    : 'vec3(0.0)'
  const textureDisplacement = glslReference(
    version === 2 ? program.outputs.textureDisplacement : program.outputs.displacement,
    variables,
    parameterIndexes,
  )
  const opacity = glslReference(program.outputs.opacity, variables, parameterIndexes)
  const parameterCount = Math.max(1, program.parameters.length)
  const maxPositionOffset = glslScalar(SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxPositionOffset)
  const maxTextureDisplacement = glslScalar(SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxTextureDisplacement)
  const source = `${GLSL_COMMON_SOURCE}

uniform float aosEffectElapsed;
uniform vec2 aosEffectEventCurrent;
uniform vec2 aosEffectEventDelta;
uniform vec2 aosEffectEventOrigin;
uniform vec2 aosEffectEventTotalDelta;
uniform vec2 aosEffectSurfaceSize;
uniform float aosEffectParameters[${parameterCount}];

struct AosNativeEffectEvaluation {
  vec3 positionOffset;
  vec2 textureDisplacement;
  float opacity;
};

AosNativeEffectEvaluation aosEvaluateNativeEffect(
  vec2 worldPosition,
  vec2 surfaceUV,
  vec3 surfacePosition
) {
${statements.join('\n')}
  AosNativeEffectEvaluation result;
  vec3 aosRawPositionOffset = ${positionOffset};
  result.positionOffset = aosFinite(aosRawPositionOffset) ? aosRawPositionOffset : vec3(0.0);
  float aosPositionLength = length(result.positionOffset);
  if (aosPositionLength > ${maxPositionOffset}) result.positionOffset *= ${maxPositionOffset} / aosPositionLength;
  vec2 aosRawTextureDisplacement = ${textureDisplacement};
  result.textureDisplacement = aosFinite(aosRawTextureDisplacement) ? aosRawTextureDisplacement : vec2(0.0);
  float aosDisplacementLength = length(result.textureDisplacement);
  if (aosDisplacementLength > ${maxTextureDisplacement}) result.textureDisplacement *= ${maxTextureDisplacement} / aosDisplacementLength;
  float aosRawOpacity = ${opacity};
  result.opacity = aosFinite(aosRawOpacity) ? clamp(aosRawOpacity, 0.0, 1.0) : 0.0;
  return result;
}`
  return freeze({
    contract: SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID,
    geometry: version === 2 && program.geometry ? clone(program.geometry) : null,
    schemaVersion: 1,
    material: version === 2 ? clone(program.material) : null,
    parameterIds: program.parameters.map((entry) => entry.id),
    source,
  })
}
