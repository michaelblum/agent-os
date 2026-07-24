import {
  isCanonicalSceneId,
  isSceneRecord,
} from './scene-contract-primitives.js'
import { normalizeSceneExtensionInteractionRouteState } from './scene-extension-route-inspection.js'
import { validateSceneDocument } from './scene-document.js'

export const SCENE_EXTENSION_CONTRACT_ID = 'aos.scene.extension.v1'
export const SCENE_EXTENSION_SCHEMA_VERSION = 1
export const SCENE_EXTENSION_SCENE_ABI = 'aos.scene.projection.v1'
export const SCENE_EXTENSION_THREE_REVISION = '183'
export const SCENE_EXTENSION_REGISTRY_LIMIT = 64

// Runtime allocation growth is re-audited within 30 projection ticks (about
// 500 ms at 60 FPS) without traversing the Three tree on every frame.
const SCENE_EXTENSION_RESOURCE_AUDIT_INTERVAL_TICKS = 30

export const SCENE_EXTENSION_BUDGET_LIMITS = Object.freeze({
  maxDrawCalls: 2048,
  maxObjects: 1024,
  maxResources: 1024,
  maxTextureBytes: 256 * 1024 * 1024,
  maxTriangles: 2_000_000,
  maxWorkingBytes: 256 * 1024 * 1024,
})

const MANIFEST_KEYS = new Set([
  'budgets',
  'contract',
  'digest',
  'id',
  'implementationIds',
  'ownerId',
  'sceneAbi',
  'schemaVersion',
  'threeRevision',
])
const FACTORY_KEYS = new Set(['createProjection', 'manifest'])
const REFERENCE_KEYS = new Set([
  'digest',
  'id',
  'ownerId',
  'sceneAbi',
  'threeRevision',
])
const CONTEXT_KEYS = new Set(['THREE', 'budgets', 'document'])
const PROJECTION_METHODS = Object.freeze([
  'applySignal',
  'applyAnimation',
  'tick',
  'suspend',
  'resume',
  'contextLost',
  'contextRestored',
  'dispose',
])
const DIGEST_BUDGET_KEYS = Object.freeze([
  'maxDrawCalls',
  'maxObjects',
  'maxResources',
  'maxTextureBytes',
  'maxTriangles',
  'maxWorkingBytes',
])
const SHA256 = /^[a-f0-9]{64}$/u
const SAFE_EXTENSION_SEGMENT = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function projectionCleanupFailure(errors, message) {
  const failure = new AggregateError(errors, message)
  Object.defineProperty(failure, 'code', {
    configurable: false,
    enumerable: true,
    value: 'SCENE_EXTENSION_DISPOSE_FAILED',
    writable: false,
  })
  return failure
}

function exactKeys(value, expected, path, errors) {
  if (!isSceneRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) addError(errors, 'unknown_field', `${path}.${key}`, `Unknown scene extension field ${key}.`)
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) addError(errors, 'missing_field', `${path}.${key}`, `Missing scene extension field ${key}.`)
  }
}

function validateId(value, path, errors) {
  if (!isCanonicalSceneId(value)) {
    addError(errors, 'invalid_id', path, 'Scene extension identifiers must be canonical bounded lowercase IDs.')
    return false
  }
  return true
}

function validateExtensionSegment(value, path, errors) {
  if (typeof value !== 'string' || !SAFE_EXTENSION_SEGMENT.test(value)) {
    addError(errors, 'invalid_extension_segment', path, 'Scene extension owner and extension IDs must be canonical path segments.')
    return false
  }
  return true
}

function validateBudgets(value, path, errors, maximums = SCENE_EXTENSION_BUDGET_LIMITS) {
  if (!isSceneRecord(value)) {
    addError(errors, 'invalid_budgets', path, 'Scene extension budgets must be an object.')
    return
  }
  const keys = Object.keys(SCENE_EXTENSION_BUDGET_LIMITS)
  exactKeys(value, new Set(keys), path, errors)
  for (const key of keys) {
    const budget = value[key]
    if (!Number.isFinite(budget) || !Number.isInteger(budget) || budget < 0 || budget > maximums[key]) {
      addError(errors, 'invalid_budget', `${path}.${key}`, `Scene extension budget ${key} must be a finite integer within its engine limit.`)
    }
  }
}

function compareIds(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function cloneManifest(manifest) {
  return Object.freeze({
    contract: manifest.contract,
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    ownerId: manifest.ownerId,
    digest: manifest.digest,
    sceneAbi: manifest.sceneAbi,
    implementationIds: Object.freeze([...manifest.implementationIds]),
    threeRevision: manifest.threeRevision,
    budgets: Object.freeze({ ...manifest.budgets }),
  })
}

function manifestIdentity(manifest) {
  return Object.freeze({
    ownerId: manifest.ownerId,
    id: manifest.id,
    digest: manifest.digest,
    sceneAbi: manifest.sceneAbi,
    threeRevision: manifest.threeRevision,
  })
}

function finiteByteLength(value) {
  const length = Number(value?.byteLength)
  return Number.isSafeInteger(length) && length >= 0 ? length : 0
}

function addWorkingStorage(value, storage, measured) {
  if (!value || typeof value !== 'object') return measured
  const backing = value.buffer && typeof value.buffer === 'object' ? value.buffer : value
  if (storage.has(backing)) return measured
  storage.add(backing)
  return Math.min(Number.MAX_SAFE_INTEGER, measured + finiteByteLength(backing))
}

function attributeArray(attribute) {
  return attribute?.data?.array ?? attribute?.array ?? null
}

function geometryMetrics(geometry, storage, measuredBytes) {
  if (!geometry || typeof geometry !== 'object') return { bytes: measuredBytes, triangles: 0 }
  let bytes = addWorkingStorage(attributeArray(geometry.index), storage, measuredBytes)
  for (const attribute of Object.values(geometry.attributes ?? {})) {
    bytes = addWorkingStorage(attributeArray(attribute), storage, bytes)
  }
  for (const attributes of Object.values(geometry.morphAttributes ?? {})) {
    if (!Array.isArray(attributes)) continue
    for (const attribute of attributes) {
      bytes = addWorkingStorage(attributeArray(attribute), storage, bytes)
    }
  }
  const positionCount = Number(geometry.attributes?.position?.count)
  const indexCount = Number(geometry.index?.count)
  const primitiveCount = Number.isFinite(indexCount) ? indexCount : positionCount
  return {
    bytes,
    triangles: Number.isFinite(primitiveCount) ? Math.max(0, Math.floor(primitiveCount / 3)) : 0,
  }
}

function collectTextures(value, textures, visited, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4 || visited.has(value)) return
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return
  visited.add(value)
  if (value.isTexture === true) {
    textures.add(value)
    return
  }
  const values = Array.isArray(value) ? value : Object.values(value)
  if (values.length > 256) throw new RangeError('Scene extension texture graph exceeded its inspection budget.')
  for (const entry of values) collectTextures(entry, textures, visited, depth + 1)
}

function textureBytes(texture, storage, measuredBytes) {
  if (Array.isArray(texture?.mipmaps) && texture.mipmaps.length > 0) {
    if (texture.mipmaps.length > 256) throw new RangeError('Scene extension texture mipmaps exceeded their inspection budget.')
    return texture.mipmaps.reduce(
      (total, mipmap) => textureSourceBytes(mipmap?.data ?? mipmap, storage, total),
      measuredBytes,
    )
  }
  const source = texture?.source?.data ?? texture?.image ?? null
  if (Array.isArray(source)) {
    if (source.length > 256) throw new RangeError('Scene extension texture array exceeded its inspection budget.')
    return source.reduce(
      (total, entry) => textureSourceBytes(entry, storage, total),
      measuredBytes,
    )
  }
  return textureSourceBytes(source, storage, measuredBytes)
}

function textureSourceBytes(source, storage, measuredBytes) {
  const directSource = source?.data ?? source
  const direct = finiteByteLength(directSource)
  if (direct > 0) return addWorkingStorage(directSource, storage, measuredBytes)
  const width = Number(source?.width)
  const height = Number(source?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return measuredBytes
  if (source && typeof source === 'object') {
    if (storage.has(source)) return measuredBytes
    storage.add(source)
  }
  return Math.min(Number.MAX_SAFE_INTEGER, measuredBytes + (Math.ceil(width) * Math.ceil(height) * 4))
}

function drawCallsFor(object) {
  if (!object?.geometry || !object?.material || object.visible === false) return 0
  if (Array.isArray(object.material)) return Math.max(1, object.material.length)
  const groups = object.geometry.groups
  return Array.isArray(groups) && groups.length > 0 ? groups.length : 1
}

function assertSynchronousHookResult(result, hook) {
  if (result === null || (typeof result !== 'object' && typeof result !== 'function')) return result
  let then
  try {
    then = result.then
  } catch {
    throw new TypeError(`Scene extension ${hook} must complete synchronously.`)
  }
  if (typeof then === 'function') {
    throw new TypeError(`Scene extension ${hook} must complete synchronously.`)
  }
  return result
}

function callSynchronousProjectionHook(projection, method, args = []) {
  return assertSynchronousHookResult(
    projection[method].apply(projection, args),
    `projection ${method}()`,
  )
}

export function inspectSceneExtensionProjectionResources(object) {
  if (!object || object.isObject3D !== true || typeof object.traverse !== 'function') {
    throw new TypeError('Scene extension projection requires a Three Object3D subtree.')
  }
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  let drawCalls = 0
  let objects = 0
  let triangles = 0
  let geometryBytes = 0
  const workingStorage = new Set()
  object.traverse((entry) => {
    objects += 1
    if (entry?.geometry) geometries.add(entry.geometry)
    const entries = Array.isArray(entry?.material) ? entry.material : [entry?.material]
    for (const material of entries) if (material) materials.add(material)
    drawCalls += drawCallsFor(entry)
    if (entry?.geometry && entry.visible !== false) {
      const instances = entry.isInstancedMesh === true
        ? Math.max(0, Math.floor(Number(entry.count) || 0))
        : 1
      triangles += geometryMetrics(entry.geometry, new Set(), 0).triangles * instances
    }
    if (entry?.isInstancedMesh === true) {
      geometryBytes = addWorkingStorage(attributeArray(entry.instanceMatrix), workingStorage, geometryBytes)
      geometryBytes = addWorkingStorage(attributeArray(entry.instanceColor), workingStorage, geometryBytes)
    }
  })
  const visited = new Set()
  for (const material of materials) collectTextures(material, textures, visited)
  for (const geometry of geometries) {
    geometryBytes = geometryMetrics(geometry, workingStorage, geometryBytes).bytes
  }
  let measuredTextureBytes = 0
  const textureStorage = new Set()
  for (const texture of textures) {
    measuredTextureBytes = textureBytes(texture, textureStorage, measuredTextureBytes)
  }
  return Object.freeze({
    drawCalls,
    geometryBytes,
    objects,
    resources: geometries.size + materials.size + textures.size,
    textureBytes: measuredTextureBytes,
    triangles,
    workingBytes: geometryBytes + measuredTextureBytes,
  })
}

function assertProjectionBudgets(object, budgets) {
  const metrics = inspectSceneExtensionProjectionResources(object)
  const checks = [
    ['drawCalls', 'maxDrawCalls'],
    ['objects', 'maxObjects'],
    ['resources', 'maxResources'],
    ['textureBytes', 'maxTextureBytes'],
    ['triangles', 'maxTriangles'],
    ['workingBytes', 'maxWorkingBytes'],
  ]
  for (const [metric, budget] of checks) {
    if (metrics[metric] > budgets[budget]) {
      throw new RangeError(`Scene extension projection exceeded ${budget}.`)
    }
  }
  return metrics
}

function extensionKey(ownerId, id, digest) {
  return `${ownerId}\u0000${id}\u0000${digest}`
}

export function validateSceneExtensionReference(reference) {
  const errors = []
  if (!isSceneRecord(reference)) {
    return { ok: false, errors: [{ code: 'invalid_reference', path: 'reference', message: 'Scene extension reference must be an object.' }] }
  }
  exactKeys(reference, REFERENCE_KEYS, 'reference', errors)
  validateExtensionSegment(reference.ownerId, 'reference.ownerId', errors)
  validateExtensionSegment(reference.id, 'reference.id', errors)
  if (typeof reference.digest !== 'string' || !SHA256.test(reference.digest)) {
    addError(errors, 'invalid_digest', 'reference.digest', 'Scene extension digest must be a lowercase SHA-256 hex string.')
  }
  if (reference.sceneAbi !== SCENE_EXTENSION_SCENE_ABI) {
    addError(errors, 'scene_abi', 'reference.sceneAbi', `Scene extension ABI must be ${SCENE_EXTENSION_SCENE_ABI}.`)
  }
  if (reference.threeRevision !== SCENE_EXTENSION_THREE_REVISION) {
    addError(errors, 'three_revision', 'reference.threeRevision', `Scene extension Three revision must be ${SCENE_EXTENSION_THREE_REVISION}.`)
  }
  return { ok: errors.length === 0, errors }
}

function validateProjectionContext(context, manifest) {
  const errors = []
  if (!isSceneRecord(context)) {
    return { ok: false, errors: [{ code: 'invalid_context', path: 'context', message: 'Scene extension context must be an object.' }] }
  }
  exactKeys(context, CONTEXT_KEYS, 'context', errors)
  if (!context.THREE || (typeof context.THREE !== 'object' && typeof context.THREE !== 'function')) {
    addError(errors, 'invalid_three', 'context.THREE', 'Scene extension context requires the AOS-provided Three namespace.')
  } else if (context.THREE.REVISION !== manifest.threeRevision) {
    addError(errors, 'three_revision', 'context.THREE.REVISION', 'Scene extension context Three revision does not match the manifest.')
  }
  const documentValidation = validateSceneDocument(context.document)
  if (!documentValidation.ok) {
    addError(errors, 'invalid_document', 'context.document', 'Scene extension context requires a valid scene document.')
  }
  validateBudgets(context.budgets, 'context.budgets', errors, manifest.budgets)
  return { ok: errors.length === 0, errors }
}

export function validateSceneExtensionManifest(manifest) {
  const errors = []
  if (!isSceneRecord(manifest)) {
    return { ok: false, errors: [{ code: 'invalid_manifest', path: 'manifest', message: 'Scene extension manifest must be an object.' }] }
  }
  exactKeys(manifest, MANIFEST_KEYS, 'manifest', errors)
  if (manifest.contract !== SCENE_EXTENSION_CONTRACT_ID) {
    addError(errors, 'contract_id', 'manifest.contract', `Scene extension contract must be ${SCENE_EXTENSION_CONTRACT_ID}.`)
  }
  if (manifest.schemaVersion !== SCENE_EXTENSION_SCHEMA_VERSION) {
    addError(errors, 'schema_version', 'manifest.schemaVersion', `Scene extension schema version must be ${SCENE_EXTENSION_SCHEMA_VERSION}.`)
  }
  validateExtensionSegment(manifest.ownerId, 'manifest.ownerId', errors)
  validateExtensionSegment(manifest.id, 'manifest.id', errors)
  if (typeof manifest.digest !== 'string' || !SHA256.test(manifest.digest)) {
    addError(errors, 'invalid_digest', 'manifest.digest', 'Scene extension digest must be a lowercase SHA-256 hex string.')
  }
  if (manifest.sceneAbi !== SCENE_EXTENSION_SCENE_ABI) {
    addError(errors, 'scene_abi', 'manifest.sceneAbi', `Scene extension ABI must be ${SCENE_EXTENSION_SCENE_ABI}.`)
  }
  if (manifest.threeRevision !== SCENE_EXTENSION_THREE_REVISION) {
    addError(errors, 'three_revision', 'manifest.threeRevision', `Scene extension Three revision must be ${SCENE_EXTENSION_THREE_REVISION}.`)
  }
  if (!Array.isArray(manifest.implementationIds) || manifest.implementationIds.length === 0 || manifest.implementationIds.length > 256) {
    addError(errors, 'implementation_count', 'manifest.implementationIds', 'Scene extensions require between 1 and 256 implementation IDs.')
  } else {
    let previous = null
    const seen = new Set()
    manifest.implementationIds.forEach((implementationId, index) => {
      const path = `manifest.implementationIds.${index}`
      const valid = validateId(implementationId, path, errors)
      if (valid && typeof manifest.ownerId === 'string' && !implementationId.startsWith(`${manifest.ownerId}.`)) {
        addError(errors, 'implementation_owner', path, 'Scene extension implementation IDs must be namespaced beneath ownerId.')
      }
      if (seen.has(implementationId)) addError(errors, 'duplicate_implementation', path, 'Scene extension implementation IDs must be unique.')
      if (previous !== null && compareIds(previous, implementationId) >= 0) {
        addError(errors, 'implementation_order', path, 'Scene extension implementation IDs must be uniquely sorted.')
      }
      seen.add(implementationId)
      previous = implementationId
    })
  }
  validateBudgets(manifest.budgets, 'manifest.budgets', errors)
  return { ok: errors.length === 0, errors }
}

export function serializeSceneExtensionDigestMaterial(manifest, bodyDigest) {
  const validation = validateSceneExtensionManifest(manifest)
  if (!validation.ok) throw new TypeError(validation.errors[0].message)
  if (typeof bodyDigest !== 'string' || !SHA256.test(bodyDigest)) {
    throw new TypeError('Scene extension factory-body digest must be a lowercase SHA-256 hex string.')
  }
  return [
    'aos.scene.extension.digest.v1',
    `contract:${manifest.contract}`,
    `schemaVersion:${manifest.schemaVersion}`,
    `ownerId:${manifest.ownerId}`,
    `id:${manifest.id}`,
    `sceneAbi:${manifest.sceneAbi}`,
    `threeRevision:${manifest.threeRevision}`,
    `implementationCount:${manifest.implementationIds.length}`,
    ...manifest.implementationIds.map((id) => `implementation:${id}`),
    ...DIGEST_BUDGET_KEYS.map((key) => `budget.${key}:${manifest.budgets[key]}`),
    `bodySha256:${bodyDigest}`,
    '',
  ].join('\n')
}

export function validateSceneExtensionProjection(projection) {
  const errors = []
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { ok: false, errors: [{ code: 'invalid_projection', path: 'projection', message: 'Scene extension projection must be an object.' }] }
  }
  if (!projection.object || projection.object.isObject3D !== true || typeof projection.object.traverse !== 'function') {
    addError(errors, 'invalid_projection_object', 'projection.object', 'Scene extension projection requires a Three Object3D subtree.')
  }
  for (const method of PROJECTION_METHODS) {
    if (typeof projection[method] !== 'function') {
      addError(errors, 'missing_projection_method', `projection.${method}`, `Scene extension projection requires ${method}().`)
    }
  }
  if (
    projection.inspectInteractionRoute !== undefined
    && typeof projection.inspectInteractionRoute !== 'function'
  ) {
    addError(
      errors,
      'invalid_projection_method',
      'projection.inspectInteractionRoute',
      'Scene extension projection inspectInteractionRoute must be a function when provided.',
    )
  }
  return { ok: errors.length === 0, errors }
}

export function createTrustedSceneExtensionRegistry(input = {}) {
  if (!isSceneRecord(input)) throw new TypeError('Scene extension registry options must be an object.')
  const optionKeys = new Set(['factories'])
  const optionErrors = []
  exactKeys({ factories: [], ...input }, optionKeys, 'options', optionErrors)
  if (optionErrors.length > 0) throw new TypeError(optionErrors[0].message)
  if (input.factories !== undefined && !Array.isArray(input.factories)) {
    throw new TypeError('Scene extension registry factories must be an array.')
  }

  const entries = new Map()

  function evictUnused() {
    while (entries.size >= SCENE_EXTENSION_REGISTRY_LIMIT) {
      const unused = [...entries].find(([, entry]) => entry.references === 0)
      if (!unused) break
      entries.delete(unused[0])
    }
  }

  const api = {
    register(factory) {
      if (!isSceneRecord(factory)) throw new TypeError('Trusted scene extension factories must be objects.')
      const factoryErrors = []
      exactKeys(factory, FACTORY_KEYS, 'factory', factoryErrors)
      if (factoryErrors.length > 0) throw new TypeError(factoryErrors[0].message)
      const validation = validateSceneExtensionManifest(factory.manifest)
      if (!validation.ok) throw new TypeError(validation.errors[0].message)
      if (typeof factory.createProjection !== 'function') {
        throw new TypeError('Trusted scene extension factories require createProjection().')
      }
      const manifest = cloneManifest(factory.manifest)
      const key = extensionKey(manifest.ownerId, manifest.id, manifest.digest)
      if (entries.has(key)) {
        throw new TypeError(`Scene extension ${manifest.ownerId}/${manifest.id} is already registered.`)
      }
      evictUnused()
      if (entries.size >= SCENE_EXTENSION_REGISTRY_LIMIT) {
        throw new RangeError('Trusted scene extension registry capacity exceeded.')
      }
      const handle = Object.freeze({
        manifest,
        createProjection(context) {
          const contextValidation = validateProjectionContext(context, manifest)
          if (!contextValidation.ok) throw new TypeError(contextValidation.errors[0].message)
          let projection = null
          try {
            projection = assertSynchronousHookResult(
              factory.createProjection(Object.freeze({
                THREE: context.THREE,
                budgets: Object.freeze({ ...context.budgets }),
                document: context.document,
              })),
              'factory createProjection()',
            )
            const projectionValidation = validateSceneExtensionProjection(projection)
            if (!projectionValidation.ok) throw new TypeError(projectionValidation.errors[0].message)
            const effectiveBudgets = Object.freeze({ ...context.budgets })
            let currentMetrics = assertProjectionBudgets(projection.object, effectiveBudgets)
            let ticksSinceResourceAudit = 0
            let disposed = false
            const disposeProjection = () => {
              if (disposed) return
              const result = callSynchronousProjectionHook(projection, 'dispose')
              disposed = true
              return result
            }
            const callLifecycleHook = (name, args = []) => {
              const result = callSynchronousProjectionHook(projection, name, args)
              currentMetrics = assertProjectionBudgets(projection.object, effectiveBudgets)
              ticksSinceResourceAudit = 0
              return result
            }
            return Object.freeze({
              object: projection.object,
              activate: typeof projection.activate === 'function'
                ? (...args) => callLifecycleHook('activate', args)
                : undefined,
              applyInteraction: typeof projection.applyInteraction === 'function'
                ? (...args) => callSynchronousProjectionHook(projection, 'applyInteraction', args)
                : undefined,
              applyAnimation: (...args) => callSynchronousProjectionHook(projection, 'applyAnimation', args),
              applySignal: (...args) => callSynchronousProjectionHook(projection, 'applySignal', args),
              contextLost: (...args) => callLifecycleHook('contextLost', args),
              contextRestored: (...args) => callLifecycleHook('contextRestored', args),
              dispose: disposeProjection,
              inspectInteractionRoute: typeof projection.inspectInteractionRoute === 'function'
                ? () => normalizeSceneExtensionInteractionRouteState(
                  callSynchronousProjectionHook(projection, 'inspectInteractionRoute'),
                )
                : undefined,
              resourceMetrics: () => currentMetrics,
              resume: (...args) => callLifecycleHook('resume', args),
              suspend: (...args) => callLifecycleHook('suspend', args),
              tick(...args) {
                try {
                  const result = callSynchronousProjectionHook(projection, 'tick', args)
                  ticksSinceResourceAudit += 1
                  if (ticksSinceResourceAudit >= SCENE_EXTENSION_RESOURCE_AUDIT_INTERVAL_TICKS) {
                    currentMetrics = assertProjectionBudgets(projection.object, effectiveBudgets)
                    ticksSinceResourceAudit = 0
                  }
                  return result
                } catch (error) {
                  try {
                    disposeProjection()
                  } catch (disposeError) {
                    throw projectionCleanupFailure(
                      [error, disposeError],
                      'Scene extension projection update and cleanup both failed.',
                    )
                  }
                  throw error
                }
              },
            })
          } catch (error) {
            if (projection && typeof projection.dispose === 'function') {
              try {
                callSynchronousProjectionHook(projection, 'dispose')
              } catch (disposeError) {
                throw projectionCleanupFailure(
                  [error, disposeError],
                  'Scene extension projection admission and cleanup both failed.',
                )
              }
            }
            throw error
          }
        },
      })
      entries.set(key, { handle, references: 0 })
      return handle
    },
    resolve(reference) {
      const validation = validateSceneExtensionReference(reference)
      if (!validation.ok) throw new TypeError(validation.errors[0].message)
      const entry = entries.get(extensionKey(reference.ownerId, reference.id, reference.digest)) ?? null
      if (!entry) return null
      const identity = manifestIdentity(entry.handle.manifest)
      if (Object.keys(identity).some((key) => identity[key] !== reference[key])) return null
      return entry.handle
    },
    retain(reference) {
      const validation = validateSceneExtensionReference(reference)
      if (!validation.ok) throw new TypeError(validation.errors[0].message)
      const key = extensionKey(reference.ownerId, reference.id, reference.digest)
      const entry = entries.get(key)
      if (!entry) return null
      const identity = manifestIdentity(entry.handle.manifest)
      if (Object.keys(identity).some((field) => identity[field] !== reference[field])) return null
      entry.references += 1
      let active = true
      return Object.freeze({
        handle: entry.handle,
        release() {
          if (!active) return false
          active = false
          entry.references = Math.max(0, entry.references - 1)
          return true
        },
      })
    },
    snapshot() {
      return Object.freeze({
        count: entries.size,
        extensions: Object.freeze([...entries.values()]
          .map(({ handle }) => cloneManifest(handle.manifest))
          .sort((left, right) => compareIds(
            `${left.ownerId}/${left.id}/${left.digest}`,
            `${right.ownerId}/${right.id}/${right.digest}`,
          ))),
      })
    },
  }

  for (const factory of input.factories ?? []) api.register(factory)
  return Object.freeze(api)
}
