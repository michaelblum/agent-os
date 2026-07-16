export const SCENE_DOCUMENT_CONTRACT_ID = 'aos.scene.document.v1'
export const SCENE_TRANSACTION_CONTRACT_ID = 'aos.scene.transaction.v1'
export const SCENE_LEASE_CONTRACT_ID = 'aos.scene.lease.v1'

export const SCENE_DOCUMENT_LIMITS = Object.freeze({
  maxObjects: 1024,
  maxResources: 256,
  maxComponentsPerObject: 32,
  maxOperationsPerTransaction: 256,
  maxParameterDepth: 8,
  maxParameterKeys: 64,
  maxParameterArrayLength: 256,
  maxParameterStringLength: 4096,
  maxAssetBytes: 256 * 1024 * 1024,
})

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/u
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u
const OBJECT_KINDS = new Set(['group', 'mesh', 'points', 'line', 'light', 'camera'])
const RESOURCE_KINDS = new Set(['geometry', 'material', 'texture', 'shader', 'effect'])
const OPERATION_KINDS = new Set([
  'put_object',
  'remove_object',
  'set_property',
  'put_resource',
  'remove_resource',
])

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function validateExactKeys(value, allowed, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, 'unknown_field', `${path}.${key}`, `Unknown scene field ${key}.`)
    }
  }
}

function validateId(value, path, errors) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    addError(errors, 'invalid_id', path, 'Scene identifiers must be bounded lowercase resource paths.')
    return false
  }
  if (value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
    addError(errors, 'invalid_id', path, 'Scene identifiers cannot contain empty or relative path segments.')
    return false
  }
  return true
}

function validateImplementation(value, path, errors) {
  if (typeof value !== 'string' || !IMPLEMENTATION_ID.test(value)) {
    addError(errors, 'invalid_implementation', path, 'Scene implementations require a bounded registry identifier.')
  }
}

function validateFiniteTuple(value, length, path, errors, options = {}) {
  if (!Array.isArray(value) || value.length !== length) {
    addError(errors, 'invalid_tuple', path, `Expected a ${length}-value tuple.`)
    return
  }
  value.forEach((entry, index) => {
    if (!Number.isFinite(entry)) {
      addError(errors, 'non_finite_number', `${path}.${index}`, 'Scene numeric values must be finite.')
    } else if (options.positive && entry <= 0) {
      addError(errors, 'non_positive_scale', `${path}.${index}`, 'Scene scale values must be positive.')
    }
  })
}

function validateParameters(value, path, errors, depth = 0) {
  if (depth > SCENE_DOCUMENT_LIMITS.maxParameterDepth) {
    addError(errors, 'parameter_depth', path, 'Scene parameters exceed the maximum nesting depth.')
    return
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > SCENE_DOCUMENT_LIMITS.maxParameterStringLength) {
      addError(errors, 'parameter_string_length', path, 'Scene parameter text exceeds the maximum length.')
    }
    return
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      addError(errors, 'non_finite_number', path, 'Scene numeric values must be finite.')
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > SCENE_DOCUMENT_LIMITS.maxParameterArrayLength) {
      addError(errors, 'parameter_array_length', path, 'Scene parameter arrays exceed the maximum length.')
      return
    }
    value.forEach((entry, index) => validateParameters(entry, `${path}.${index}`, errors, depth + 1))
    return
  }
  if (!isRecord(value)) {
    addError(errors, 'parameter_type', path, 'Scene parameters must be finite JSON values.')
    return
  }
  const entries = Object.entries(value)
  if (entries.length > SCENE_DOCUMENT_LIMITS.maxParameterKeys) {
    addError(errors, 'parameter_key_count', path, 'Scene parameter objects contain too many keys.')
    return
  }
  for (const [key, entry] of entries) {
    validateParameters(entry, `${path}.${key}`, errors, depth + 1)
  }
}

function validateTransform(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_transform', path, 'Scene objects require a transform object.')
    return
  }
  validateExactKeys(value, new Set(['position', 'rotation', 'scale']), path, errors)
  validateFiniteTuple(value.position, 3, `${path}.position`, errors)
  validateFiniteTuple(value.rotation, 3, `${path}.rotation`, errors)
  validateFiniteTuple(value.scale, 3, `${path}.scale`, errors, { positive: true })
}

function validateComponent(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_component', path, 'Scene components must be objects.')
    return
  }
  validateExactKeys(value, new Set(['id', 'implementation', 'parameters', 'enabled']), path, errors)
  validateId(value.id, `${path}.id`, errors)
  validateImplementation(value.implementation, `${path}.implementation`, errors)
  if (!isRecord(value.parameters)) {
    addError(errors, 'invalid_parameters', `${path}.parameters`, 'Scene component parameters must be an object.')
  } else {
    validateParameters(value.parameters, `${path}.parameters`, errors)
  }
  if (typeof value.enabled !== 'boolean') {
    addError(errors, 'invalid_enabled', `${path}.enabled`, 'Scene component enabled must be boolean.')
  }
}

function validateSceneObject(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_object', path, 'Scene objects must be objects.')
    return
  }
  validateExactKeys(value, new Set([
    'id', 'parentId', 'kind', 'transform', 'visible', 'geometryId', 'materialId', 'components',
  ]), path, errors)
  validateId(value.id, `${path}.id`, errors)
  if (value.parentId !== null) validateId(value.parentId, `${path}.parentId`, errors)
  if (!OBJECT_KINDS.has(value.kind)) {
    addError(errors, 'invalid_object_kind', `${path}.kind`, 'Scene object kind is not supported.')
  }
  validateTransform(value.transform, `${path}.transform`, errors)
  if (typeof value.visible !== 'boolean') {
    addError(errors, 'invalid_visibility', `${path}.visible`, 'Scene object visibility must be boolean.')
  }
  for (const key of ['geometryId', 'materialId']) {
    if (value[key] !== null) validateId(value[key], `${path}.${key}`, errors)
  }
  if (!Array.isArray(value.components) || value.components.length > SCENE_DOCUMENT_LIMITS.maxComponentsPerObject) {
    addError(errors, 'component_count', `${path}.components`, 'Scene object components exceed the allowed count.')
  } else {
    const componentIds = new Set()
    value.components.forEach((component, index) => {
      validateComponent(component, `${path}.components.${index}`, errors)
      if (componentIds.has(component?.id)) {
        addError(errors, 'duplicate_component_id', `${path}.components.${index}.id`, 'Component IDs must be unique per object.')
      }
      componentIds.add(component?.id)
    })
  }
}

function validateSceneResource(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_resource', path, 'Scene resources must be objects.')
    return
  }
  validateExactKeys(value, new Set(['id', 'kind', 'implementation', 'parameters', 'asset']), path, errors)
  validateId(value.id, `${path}.id`, errors)
  if (!RESOURCE_KINDS.has(value.kind)) {
    addError(errors, 'invalid_resource_kind', `${path}.kind`, 'Scene resource kind is not supported.')
  }
  validateImplementation(value.implementation, `${path}.implementation`, errors)
  if (!isRecord(value.parameters)) {
    addError(errors, 'invalid_parameters', `${path}.parameters`, 'Scene resource parameters must be an object.')
  } else {
    validateParameters(value.parameters, `${path}.parameters`, errors)
  }
  if (value.asset !== null) {
    if (!isRecord(value.asset)) {
      addError(errors, 'invalid_asset', `${path}.asset`, 'Scene assets must be digest-addressed descriptors.')
    } else {
      validateExactKeys(value.asset, new Set(['sha256', 'mediaType', 'bytes']), `${path}.asset`, errors)
      if (typeof value.asset.sha256 !== 'string' || !SHA256.test(value.asset.sha256)) {
        addError(errors, 'invalid_asset_digest', `${path}.asset.sha256`, 'Scene asset SHA-256 is invalid.')
      }
      if (typeof value.asset.mediaType !== 'string' || !MEDIA_TYPE.test(value.asset.mediaType)) {
        addError(errors, 'invalid_asset_media_type', `${path}.asset.mediaType`, 'Scene asset media type is invalid.')
      }
      if (!Number.isInteger(value.asset.bytes) || value.asset.bytes <= 0 || value.asset.bytes > 64 * 1024 * 1024) {
        addError(errors, 'invalid_asset_size', `${path}.asset.bytes`, 'Scene assets must be between 1 byte and 64 MiB.')
      }
    }
  }
}

function validateDocumentGraph(document, errors) {
  const objectIds = new Set()
  const resources = new Map()
  for (const [index, resource] of document.resources.entries()) {
    validateSceneResource(resource, `resources.${index}`, errors)
    if (resources.has(resource?.id)) {
      addError(errors, 'duplicate_resource_id', `resources.${index}.id`, 'Scene resource IDs must be unique.')
    }
    resources.set(resource?.id, resource)
  }
  const totalAssetBytes = document.resources.reduce(
    (total, resource) => total + (
      Number.isInteger(resource?.asset?.bytes) ? resource.asset.bytes : 0
    ),
    0,
  )
  if (totalAssetBytes > SCENE_DOCUMENT_LIMITS.maxAssetBytes) {
    addError(errors, 'asset_total_size', 'resources', 'Scene assets exceed the total byte limit.')
  }
  for (const [index, object] of document.objects.entries()) {
    validateSceneObject(object, `objects.${index}`, errors)
    if (objectIds.has(object?.id)) {
      addError(errors, 'duplicate_object_id', `objects.${index}.id`, 'Scene object IDs must be unique.')
    }
    objectIds.add(object?.id)
  }
  if (!objectIds.has(document.rootObjectId)) {
    addError(errors, 'missing_root_object', 'rootObjectId', 'Scene root object must exist.')
  }
  for (const [index, object] of document.objects.entries()) {
    if (object.parentId !== null && !objectIds.has(object.parentId)) {
      addError(errors, 'missing_parent_object', `objects.${index}.parentId`, 'Scene parent object must exist.')
    }
    if (object.id === document.rootObjectId && object.parentId !== null) {
      addError(errors, 'root_has_parent', `objects.${index}.parentId`, 'Scene root object cannot have a parent.')
    }
    for (const [field, kind] of [['geometryId', 'geometry'], ['materialId', 'material']]) {
      const resourceId = object[field]
      if (resourceId !== null && resources.get(resourceId)?.kind !== kind) {
        addError(errors, 'resource_reference', `objects.${index}.${field}`, `Scene ${field} must reference a ${kind} resource.`)
      }
    }
  }
  const parentById = new Map(document.objects.map((object) => [object.id, object.parentId]))
  for (const [index, object] of document.objects.entries()) {
    const visited = new Set()
    let current = object.id
    let reachedRoot = false
    let cycle = false
    while (typeof current === 'string') {
      if (visited.has(current)) {
        addError(errors, 'object_cycle', `objects.${index}.parentId`, 'Scene object hierarchy cannot contain a cycle.')
        cycle = true
        break
      }
      visited.add(current)
      if (current === document.rootObjectId) reachedRoot = true
      const parent = parentById.get(current)
      if (parent === null) break
      if (typeof parent !== 'string') break
      current = parent
    }
    if (!cycle && !reachedRoot) {
      addError(errors, 'object_disconnected', `objects.${index}.parentId`, 'Every scene object must descend from the root object.')
    }
  }
}

export function validateSceneDocument(document) {
  const errors = []
  if (!isRecord(document)) {
    return { ok: false, errors: [{ code: 'invalid_document', path: '', message: 'Scene document must be an object.' }] }
  }
  validateExactKeys(document, new Set([
    'contract', 'schemaVersion', 'id', 'revision', 'rootObjectId', 'objects', 'resources', 'metadata',
  ]), 'document', errors)
  if (document.contract !== SCENE_DOCUMENT_CONTRACT_ID) {
    addError(errors, 'contract_id', 'contract', `Scene document contract must be ${SCENE_DOCUMENT_CONTRACT_ID}.`)
  }
  if (document.schemaVersion !== 1) addError(errors, 'schema_version', 'schemaVersion', 'Scene schema version must be 1.')
  validateId(document.id, 'id', errors)
  if (!Number.isInteger(document.revision) || document.revision < 1) {
    addError(errors, 'revision', 'revision', 'Scene revision must be a positive integer.')
  }
  validateId(document.rootObjectId, 'rootObjectId', errors)
  if (!Array.isArray(document.objects) || document.objects.length < 1 || document.objects.length > SCENE_DOCUMENT_LIMITS.maxObjects) {
    addError(errors, 'object_count', 'objects', 'Scene document object count is outside the allowed range.')
  }
  if (!Array.isArray(document.resources) || document.resources.length > SCENE_DOCUMENT_LIMITS.maxResources) {
    addError(errors, 'resource_count', 'resources', 'Scene document resource count exceeds the allowed range.')
  }
  if (!isRecord(document.metadata)) {
    addError(errors, 'invalid_metadata', 'metadata', 'Scene metadata must be an object.')
  } else {
    validateParameters(document.metadata, 'metadata', errors)
  }
  if (
    Array.isArray(document.objects)
    && document.objects.length >= 1
    && document.objects.length <= SCENE_DOCUMENT_LIMITS.maxObjects
    && Array.isArray(document.resources)
    && document.resources.length <= SCENE_DOCUMENT_LIMITS.maxResources
  ) {
    validateDocumentGraph(document, errors)
  }
  return { ok: errors.length === 0, errors }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  )
}

export function canonicalizeSceneDocument(document) {
  const validation = validateSceneDocument(document)
  if (!validation.ok) {
    throw new TypeError(validation.errors[0]?.message || 'Invalid scene document.')
  }
  return canonicalValue(document)
}

export function sceneDocumentRequiredImplementations(document) {
  const canonical = canonicalizeSceneDocument(document)
  return [...new Set([
    ...canonical.resources.map((resource) => resource.implementation),
    ...canonical.objects.flatMap((object) => object.components.map((component) => component.implementation)),
  ])].sort()
}

function validateSceneOperation(operation, path, errors) {
  if (!isRecord(operation) || !OPERATION_KINDS.has(operation.op)) {
    addError(errors, 'invalid_operation', path, 'Scene transaction operation is not supported.')
    return
  }
  switch (operation.op) {
    case 'put_object':
      validateExactKeys(operation, new Set(['op', 'object']), path, errors)
      validateSceneObject(operation.object, `${path}.object`, errors)
      break
    case 'put_resource':
      validateExactKeys(operation, new Set(['op', 'resource']), path, errors)
      validateSceneResource(operation.resource, `${path}.resource`, errors)
      break
    case 'remove_object':
    case 'remove_resource':
      validateExactKeys(operation, new Set(['op', operation.op === 'remove_object' ? 'objectId' : 'resourceId']), path, errors)
      validateId(operation[operation.op === 'remove_object' ? 'objectId' : 'resourceId'], `${path}.id`, errors)
      break
    case 'set_property':
      validateExactKeys(operation, new Set(['op', 'objectId', 'path', 'value']), path, errors)
      validateId(operation.objectId, `${path}.objectId`, errors)
      if (typeof operation.path !== 'string' || !/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){0,7}$/u.test(operation.path)) {
        addError(errors, 'invalid_property_path', `${path}.path`, 'Scene property path is invalid.')
      }
      validateParameters(operation.value, `${path}.value`, errors)
      break
  }
}

export function validateSceneTransaction(transaction) {
  const errors = []
  if (!isRecord(transaction)) {
    return { ok: false, errors: [{ code: 'invalid_transaction', path: '', message: 'Scene transaction must be an object.' }] }
  }
  validateExactKeys(transaction, new Set([
    'contract', 'transactionId', 'stageId', 'ownerId', 'resourceId', 'expectedRevision', 'operations',
  ]), 'transaction', errors)
  if (transaction.contract !== SCENE_TRANSACTION_CONTRACT_ID) {
    addError(errors, 'contract_id', 'contract', `Scene transaction contract must be ${SCENE_TRANSACTION_CONTRACT_ID}.`)
  }
  for (const key of ['transactionId', 'stageId', 'ownerId', 'resourceId']) validateId(transaction[key], key, errors)
  if (!Number.isInteger(transaction.expectedRevision) || transaction.expectedRevision < 0) {
    addError(errors, 'expected_revision', 'expectedRevision', 'Expected scene revision must be a nonnegative integer.')
  }
  if (!Array.isArray(transaction.operations) || transaction.operations.length < 1 || transaction.operations.length > SCENE_DOCUMENT_LIMITS.maxOperationsPerTransaction) {
    addError(errors, 'operation_count', 'operations', 'Scene transaction operation count is outside the allowed range.')
  } else {
    transaction.operations.forEach((operation, index) => validateSceneOperation(operation, `operations.${index}`, errors))
  }
  return { ok: errors.length === 0, errors }
}

export function validateSceneLease(lease) {
  const errors = []
  if (!isRecord(lease)) {
    return { ok: false, errors: [{ code: 'invalid_lease', path: '', message: 'Scene lease must be an object.' }] }
  }
  validateExactKeys(lease, new Set(['contract', 'stageId', 'ownerId', 'resourceId', 'scopeId']), 'lease', errors)
  if (lease.contract !== SCENE_LEASE_CONTRACT_ID) {
    addError(errors, 'contract_id', 'contract', `Scene lease contract must be ${SCENE_LEASE_CONTRACT_ID}.`)
  }
  for (const key of ['stageId', 'ownerId', 'resourceId', 'scopeId']) validateId(lease[key], key, errors)
  return { ok: errors.length === 0, errors }
}

export function createSceneLease(input = {}) {
  const lease = {
    contract: SCENE_LEASE_CONTRACT_ID,
    stageId: input.stageId,
    ownerId: input.ownerId,
    resourceId: input.resourceId,
    scopeId: input.scopeId,
  }
  const validation = validateSceneLease(lease)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene lease.')
  return Object.freeze(lease)
}
