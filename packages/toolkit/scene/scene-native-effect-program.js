import {
  isCanonicalSceneId,
  isSceneRecord,
} from './scene-contract-primitives.js'

export const SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID = 'aos.scene.native-effect-program.v1'
export const SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION = 'aos.scene.effect.program'

export const SCENE_NATIVE_EFFECT_PROGRAM_LIMITS = Object.freeze({
  maxConstantMagnitude: 1_000_000,
  maxDurationMs: 3_000,
  maxNodes: 64,
  maxParameters: 16,
  maxPrograms: 8,
  maxSerializedBytes: 32_768,
  maxTranscendentalOperations: 16,
  minDurationMs: 100,
})

export const SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS = Object.freeze([
  'absolute',
  'add',
  'clamp01',
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

function constantType(value) {
  if (finiteScalar(value)) return 'scalar'
  if (Array.isArray(value) && value.length === 2 && value.every(finiteScalar)) return 'vec2'
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

function inferOperatorType(operation, inputs) {
  switch (operation) {
  case 'add':
  case 'subtract':
  case 'minimum':
  case 'maximum':
    return sameType(inputs, 2)
  case 'multiply':
    if (inputs.length !== 2) return null
    if (inputs[0] === inputs[1]) return inputs[0]
    if (inputs.includes('scalar') && inputs.includes('vec2')) return 'vec2'
    return null
  case 'divide':
    if (inputs.length !== 2) return null
    if (inputs[0] === 'scalar' && inputs[1] === 'scalar') return 'scalar'
    if (inputs[0] === 'vec2' && ['scalar', 'vec2'].includes(inputs[1])) return 'vec2'
    return null
  case 'length':
    return inputs.length === 1 && inputs[0] === 'vec2' ? 'scalar' : null
  case 'normalize':
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
    return inputs.length === 2 && inputs.every((entry) => entry === 'vec2') ? 'scalar' : null
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

function validateNode(node, index, types, errors) {
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
    const type = constantType(node.value)
    if (!type) addError(errors, 'invalid_native_effect_constant', `${path}.value`, 'Native effect constants must be a bounded scalar or vec2.')
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
  const type = inferOperatorType(node.op, inputTypes)
  if (!type) {
    addError(errors, 'invalid_native_effect_operator_types', path, 'Native effect operator inputs do not match its typed signature.')
    return
  }
  types.set(reference, type)
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
  exactKeys(program, new Set([
    'contract', 'durationMs', 'id', 'nodes', 'outputs', 'parameters', 'revision', 'schemaVersion',
  ]), 'program', errors)
  if (program.contract !== SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID) addError(errors, 'invalid_native_effect_program_contract', 'program.contract', 'Native effect program contract is unsupported.')
  if (program.schemaVersion !== 1) addError(errors, 'invalid_native_effect_program_version', 'program.schemaVersion', 'Native effect program schema version is unsupported.')
  if (!isCanonicalSceneId(program.id)) addError(errors, 'invalid_native_effect_program_id', 'program.id', 'Native effect program ID must be canonical.')
  if (!Number.isInteger(program.revision) || program.revision < 1 || program.revision > 2_147_483_647) addError(errors, 'invalid_native_effect_program_revision', 'program.revision', 'Native effect program revision must be a positive bounded integer.')
  if (!Number.isInteger(program.durationMs)
      || program.durationMs < SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.minDurationMs
      || program.durationMs > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxDurationMs) {
    addError(errors, 'invalid_native_effect_program_duration', 'program.durationMs', 'Native effect program duration must be a bounded integer.')
  }

  const types = new Map(BUILTIN_TYPES)
  if (!Array.isArray(program.parameters) || program.parameters.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxParameters) {
    addError(errors, 'invalid_native_effect_parameter_count', 'program.parameters', 'Native effect programs exceed the parameter limit.')
  } else {
    program.parameters.forEach((entry, index) => validateParameter(entry, index, types, errors))
  }
  if (!Array.isArray(program.nodes) || program.nodes.length < 1 || program.nodes.length > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxNodes) {
    addError(errors, 'invalid_native_effect_node_count', 'program.nodes', 'Native effect programs require a bounded node graph.')
  } else {
    program.nodes.forEach((entry, index) => validateNode(entry, index, types, errors))
    const transcendentalCount = program.nodes.filter((entry) => [
      'cosine', 'exponential', 'sine', 'smoothstep',
    ].includes(entry?.op)).length
    if (transcendentalCount > SCENE_NATIVE_EFFECT_PROGRAM_LIMITS.maxTranscendentalOperations) {
      addError(errors, 'native_effect_program_cost', 'program.nodes', 'Native effect program exceeds its transcendental operation budget.')
    }
  }
  if (!isSceneRecord(program.outputs)) {
    addError(errors, 'invalid_native_effect_outputs', 'program.outputs', 'Native effect programs require displacement and opacity outputs.')
  } else {
    exactKeys(program.outputs, new Set(['displacement', 'opacity']), 'program.outputs', errors)
    if (resolveReference(program.outputs.displacement, types) !== 'vec2') addError(errors, 'invalid_native_effect_output_type', 'program.outputs.displacement', 'Native effect displacement must reference a vec2 value.')
    if (resolveReference(program.outputs.opacity, types) !== 'scalar') addError(errors, 'invalid_native_effect_output_type', 'program.outputs.opacity', 'Native effect opacity must reference a scalar value.')
  }
  return { ok: errors.length === 0, errors }
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
