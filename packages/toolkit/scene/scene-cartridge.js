import {
  SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
  compileSceneAnimationBindings,
} from './scene-animation.js'
import {
  canonicalizeSceneDocument,
  validateSceneDocument,
} from './scene-document.js'
import {
  GENERIC_SCENE_IMPLEMENTATIONS,
  createGenericSceneImplementationRegistry,
} from './scene-generic-three.js'
import {
  SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
  compileSceneSignalBindings,
} from './scene-signal.js'
import {
  validateSceneInteractionDocument,
} from './scene-interaction.js'

export const SCENE_CARTRIDGE_CONTRACT_ID = 'aos.scene.cartridge.v1'
export const SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID = 'aos.scene.cartridge.animations.v1'
export const SCENE_CARTRIDGE_INTERACTIONS_CONTRACT_ID = 'aos.scene.cartridge.interactions.v1'

export const SCENE_CARTRIDGE_IMPLEMENTATIONS = Object.freeze({
  dragRecognizer: 'aos.scene.gesture.drag',
  longPressRecognizer: 'aos.scene.gesture.long-press',
  radialRecognizer: 'aos.scene.gesture.radial',
  tapRecognizer: 'aos.scene.gesture.tap',
  aimCommitResponse: 'aos.scene.response.aim-commit',
  dropResponse: 'aos.scene.response.drop',
  radialMenuResponse: 'aos.scene.response.radial-menu',
  signalGraphResponse: 'aos.scene.response.signal-graph',
  translateResponse: 'aos.scene.response.translate',
})

export const SCENE_CARTRIDGE_LIMITS = Object.freeze({
  maxAnimations: 256,
  maxAssets: 256,
  maxAssetBytes: 256 * 1024 * 1024,
  maxInteractions: 256,
  maxObjects: 1024,
  maxResources: 256,
})

const SAFE_ID = /^[a-z0-9](?:[a-z0-9._/-]{0,126}[a-z0-9])?$/u
const IMPLEMENTATION_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u
const SHA256 = /^[a-f0-9]{64}$/u
const MEDIA_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u
const SAFE_ASSET_MEDIA_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'model/gltf-binary',
])
const EXECUTABLE_FIELD = /^(?:callback|code|eval|fragmentShader|function|module|script|shaderSource|sourceCode|vertexShader)$/iu
const REMOTE_OR_EXECUTABLE_VALUE = /^(?:data|file|https?|javascript|vbscript):/iu
const EXACT_FILE_PATHS = Object.freeze({
  animations: 'animations.json',
  interactions: 'interactions.json',
  scene: 'scene.json',
})
const BUILTIN_IMPLEMENTATIONS = new Set([
  ...Object.values(GENERIC_SCENE_IMPLEMENTATIONS),
  ...Object.values(SCENE_CARTRIDGE_IMPLEMENTATIONS),
  SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
  SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
])

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message })
}

function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) return
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError(errors, 'unknown_field', `${path}.${key}`, `Unknown cartridge field ${key}.`)
  }
}

function validateId(value, path, errors) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    addError(errors, 'invalid_id', path, 'Cartridge identifiers must be bounded lowercase resource paths.')
    return false
  }
  if (value.includes('//') || value.split('/').some((part) => part === '.' || part === '..')) {
    addError(errors, 'invalid_id', path, 'Cartridge identifiers cannot contain empty or relative path segments.')
    return false
  }
  return true
}

function validateFiniteJson(value, path, errors, depth = 0) {
  if (depth > 8) {
    addError(errors, 'value_depth', path, 'Cartridge values exceed the maximum nesting depth.')
    return
  }
  if (typeof value === 'string') {
    if (value.length > 4096) addError(errors, 'value_length', path, 'Cartridge text exceeds the maximum length.')
    if (REMOTE_OR_EXECUTABLE_VALUE.test(value.trim())) {
      addError(errors, 'remote_runtime_value', path, 'Cartridges cannot reference remote or executable runtime values.')
    }
    return
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) addError(errors, 'non_finite_number', path, 'Cartridge numeric values must be finite.')
    return
  }
  if (Array.isArray(value)) {
    if (value.length > 256) {
      addError(errors, 'value_array_length', path, 'Cartridge arrays exceed the maximum length.')
      return
    }
    value.forEach((entry, index) => validateFiniteJson(entry, `${path}.${index}`, errors, depth + 1))
    return
  }
  if (!isRecord(value)) {
    addError(errors, 'executable_value', path, 'Cartridge values must be plain finite JSON.')
    return
  }
  const entries = Object.entries(value)
  if (entries.length > 64) {
    addError(errors, 'value_key_count', path, 'Cartridge objects contain too many keys.')
    return
  }
  for (const [key, entry] of entries) {
    if (EXECUTABLE_FIELD.test(key)) {
      addError(errors, 'executable_field', `${path}.${key}`, 'Cartridges cannot contain executable source fields.')
    }
    validateFiniteJson(entry, `${path}.${key}`, errors, depth + 1)
  }
}

function validateDataOnlyReferences(value, path, errors, depth = 0) {
  if (depth > 12) {
    addError(errors, 'value_depth', path, 'Cartridge content exceeds the maximum nesting depth.')
    return
  }
  if (typeof value === 'string') {
    if (REMOTE_OR_EXECUTABLE_VALUE.test(value.trim())) {
      addError(errors, 'remote_runtime_value', path, 'Cartridges cannot reference remote or executable runtime values.')
    }
    return
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateDataOnlyReferences(entry, `${path}.${index}`, errors, depth + 1))
    return
  }
  if (!isRecord(value)) {
    addError(errors, 'executable_value', path, 'Cartridge content must be plain finite JSON.')
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (EXECUTABLE_FIELD.test(key)) {
      addError(errors, 'executable_field', `${path}.${key}`, 'Cartridges cannot contain executable source fields.')
    }
    validateDataOnlyReferences(entry, `${path}.${key}`, errors, depth + 1)
  }
}

function validateDigestFile(value, expectedPath, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_file', path, 'Cartridge files require path and SHA-256 fields.')
    return
  }
  exactKeys(value, new Set(['path', 'sha256']), path, errors)
  if (value.path !== expectedPath) {
    addError(errors, 'noncanonical_file_path', `${path}.path`, `Cartridge file path must be ${expectedPath}.`)
  }
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) {
    addError(errors, 'invalid_file_digest', `${path}.sha256`, 'Cartridge file SHA-256 is invalid.')
  }
}

function validateAsset(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_asset', path, 'Cartridge assets require a digest-addressed descriptor.')
    return
  }
  exactKeys(value, new Set(['bytes', 'mediaType', 'path', 'sha256']), path, errors)
  if (typeof value.path !== 'string' || !/^assets\/[a-z0-9][a-z0-9._/-]{0,239}$/u.test(value.path)) {
    addError(errors, 'invalid_asset_path', `${path}.path`, 'Cartridge assets must use canonical paths beneath assets/.')
  } else if (value.path.includes('//') || value.path.split('/').some((part) => part === '.' || part === '..')) {
    addError(errors, 'invalid_asset_path', `${path}.path`, 'Cartridge asset paths cannot contain relative or empty segments.')
  }
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)) {
    addError(errors, 'invalid_asset_digest', `${path}.sha256`, 'Cartridge asset SHA-256 is invalid.')
  }
  if (!Number.isInteger(value.bytes) || value.bytes <= 0 || value.bytes > 64 * 1024 * 1024) {
    addError(errors, 'invalid_asset_size', `${path}.bytes`, 'Cartridge assets must be between 1 byte and 64 MiB.')
  }
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType) || !SAFE_ASSET_MEDIA_TYPES.has(value.mediaType)) {
    addError(errors, 'invalid_asset_media_type', `${path}.mediaType`, 'Cartridge asset media type is not supported.')
  }
}

function validateBudgets(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_budgets', path, 'Cartridge budgets are required.')
    return
  }
  const keys = Object.keys(SCENE_CARTRIDGE_LIMITS)
  exactKeys(value, new Set(keys), path, errors)
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > SCENE_CARTRIDGE_LIMITS[key]) {
      addError(errors, 'invalid_budget', `${path}.${key}`, `Cartridge budget ${key} exceeds the engine limit.`)
    }
  }
  if (Number.isInteger(value.maxObjects) && value.maxObjects < 1) {
    addError(errors, 'invalid_budget', `${path}.maxObjects`, 'Cartridge maxObjects must be at least 1.')
  }
}

function validateImplementationDeclaration(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_implementation', path, 'Implementation declarations require an ID and kind.')
    return
  }
  exactKeys(value, new Set(['id', 'kind']), path, errors)
  if (typeof value.id !== 'string' || !IMPLEMENTATION_ID.test(value.id)) {
    addError(errors, 'invalid_implementation', `${path}.id`, 'Implementation ID is invalid.')
  }
  if (!['component', 'effect', 'geometry', 'interaction', 'material', 'recognizer', 'response', 'shader', 'texture'].includes(value.kind)) {
    addError(errors, 'invalid_implementation_kind', `${path}.kind`, 'Implementation kind is invalid.')
  }
}

export function validateSceneCartridgeManifest(manifest) {
  const errors = []
  if (!isRecord(manifest)) {
    return { ok: false, errors: [{ code: 'invalid_manifest', path: '', message: 'Scene cartridge manifest must be an object.' }] }
  }
  exactKeys(manifest, new Set([
    'assets', 'budgets', 'contract', 'files', 'id', 'implementations', 'metadata', 'revision', 'schemaVersion',
  ]), 'manifest', errors)
  if (manifest.contract !== SCENE_CARTRIDGE_CONTRACT_ID) {
    addError(errors, 'contract_id', 'manifest.contract', `Scene cartridge contract must be ${SCENE_CARTRIDGE_CONTRACT_ID}.`)
  }
  if (manifest.schemaVersion !== 1) addError(errors, 'schema_version', 'manifest.schemaVersion', 'Scene cartridge schema version must be 1.')
  validateId(manifest.id, 'manifest.id', errors)
  if (!Number.isInteger(manifest.revision) || manifest.revision < 1) {
    addError(errors, 'revision', 'manifest.revision', 'Scene cartridge revision must be a positive integer.')
  }
  if (!isRecord(manifest.files)) {
    addError(errors, 'invalid_files', 'manifest.files', 'Cartridge files are required.')
  } else {
    exactKeys(manifest.files, new Set(Object.keys(EXACT_FILE_PATHS)), 'manifest.files', errors)
    for (const [key, expectedPath] of Object.entries(EXACT_FILE_PATHS)) {
      validateDigestFile(manifest.files[key], expectedPath, `manifest.files.${key}`, errors)
    }
  }
  validateBudgets(manifest.budgets, 'manifest.budgets', errors)
  if (!Array.isArray(manifest.assets) || manifest.assets.length > SCENE_CARTRIDGE_LIMITS.maxAssets) {
    addError(errors, 'asset_count', 'manifest.assets', 'Cartridge assets exceed the engine limit.')
  } else {
    const paths = new Set()
    const digests = new Set()
    let bytes = 0
    manifest.assets.forEach((asset, index) => {
      validateAsset(asset, `manifest.assets.${index}`, errors)
      if (paths.has(asset?.path)) addError(errors, 'duplicate_asset_path', `manifest.assets.${index}.path`, 'Cartridge asset paths must be unique.')
      if (digests.has(asset?.sha256)) addError(errors, 'duplicate_asset_digest', `manifest.assets.${index}.sha256`, 'Cartridge asset digests must be unique.')
      paths.add(asset?.path)
      digests.add(asset?.sha256)
      if (Number.isInteger(asset?.bytes)) bytes += asset.bytes
    })
    if (bytes > SCENE_CARTRIDGE_LIMITS.maxAssetBytes) {
      addError(errors, 'asset_total_size', 'manifest.assets', 'Cartridge assets exceed the engine byte limit.')
    }
  }
  if (!Array.isArray(manifest.implementations) || manifest.implementations.length > 512) {
    addError(errors, 'implementation_count', 'manifest.implementations', 'Cartridge implementation declarations exceed the limit.')
  } else {
    const ids = new Set()
    manifest.implementations.forEach((entry, index) => {
      validateImplementationDeclaration(entry, `manifest.implementations.${index}`, errors)
      if (ids.has(entry?.id)) addError(errors, 'duplicate_implementation', `manifest.implementations.${index}.id`, 'Implementation IDs must be unique.')
      ids.add(entry?.id)
    })
  }
  if (!isRecord(manifest.metadata)) addError(errors, 'invalid_metadata', 'manifest.metadata', 'Cartridge metadata must be an object.')
  else validateFiniteJson(manifest.metadata, 'manifest.metadata', errors)
  return { ok: errors.length === 0, errors }
}

function validateAnimations(value, scene, budgets, errors) {
  if (!isRecord(value)) {
    addError(errors, 'invalid_animations', 'animations', 'Cartridge animations must be an object.')
    return
  }
  exactKeys(value, new Set(['animations', 'contract', 'schemaVersion']), 'animations', errors)
  if (value.contract !== SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID) addError(errors, 'contract_id', 'animations.contract', `Animation contract must be ${SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID}.`)
  if (value.schemaVersion !== 1) addError(errors, 'schema_version', 'animations.schemaVersion', 'Animation schema version must be 1.')
  const compiled = compileSceneAnimationBindings(scene)
  if (!compiled.ok) {
    errors.push(...compiled.errors.map((error) => ({ ...error, path: `scene.${error.path}` })))
  }
  const bindingIds = new Set(compiled.ok ? compiled.bindings.map((entry) => entry.id) : [])
  if (!Array.isArray(value.animations) || value.animations.length > budgets.maxAnimations) {
    addError(errors, 'animation_count', 'animations.animations', 'Cartridge animations exceed their declared budget.')
    return
  }
  const ids = new Set()
  value.animations.forEach((animation, index) => {
    const path = `animations.animations.${index}`
    if (!isRecord(animation)) {
      addError(errors, 'invalid_animation', path, 'Cartridge animation groups must be objects.')
      return
    }
    exactKeys(animation, new Set(['autoplay', 'bindingIds', 'id']), path, errors)
    validateId(animation.id, `${path}.id`, errors)
    if (ids.has(animation.id)) addError(errors, 'duplicate_animation', `${path}.id`, 'Cartridge animation IDs must be unique.')
    ids.add(animation.id)
    if (typeof animation.autoplay !== 'boolean') addError(errors, 'invalid_autoplay', `${path}.autoplay`, 'Animation autoplay must be boolean.')
    if (!Array.isArray(animation.bindingIds) || animation.bindingIds.length < 1 || animation.bindingIds.length > 256) {
      addError(errors, 'animation_binding_count', `${path}.bindingIds`, 'Animation groups require bounded binding IDs.')
    } else {
      for (const [bindingIndex, bindingId] of animation.bindingIds.entries()) {
        if (!bindingIds.has(bindingId)) addError(errors, 'unknown_animation_binding', `${path}.bindingIds.${bindingIndex}`, 'Animation group references an unknown scene binding.')
      }
    }
  })
}

function validateInteractions(value, scene, budgets, knownImplementations, errors) {
  const validation = validateSceneInteractionDocument(value, {
    maxInteractions: budgets.maxInteractions,
    scene,
  })
  errors.push(...validation.errors)
  if (!isRecord(value) || !Array.isArray(value.interactions)) return
  for (const [index, interaction] of value.interactions.entries()) {
    for (const field of ['recognizer', 'response']) {
      const implementation = interaction?.[field]?.implementation
      if (implementation && !knownImplementations.has(implementation)) {
        addError(errors, 'unknown_implementation', `interactions.interactions.${index}.${field}.implementation`, 'Interaction implementation is not registered.')
      }
    }
  }
}

function requiredImplementationEntries(scene, interactions) {
  const sceneKinds = new Map()
  for (const resource of scene.resources) sceneKinds.set(resource.implementation, resource.kind)
  for (const object of scene.objects) {
    for (const component of object.components) sceneKinds.set(component.implementation, 'component')
  }
  const interactionKinds = new Map()
  for (const interaction of interactions.interactions) {
    interactionKinds.set(interaction.recognizer.implementation, 'recognizer')
    interactionKinds.set(interaction.response.implementation, 'response')
  }
  return [...new Map([...sceneKinds, ...interactionKinds]).entries()]
    .map(([id, kind]) => ({ id, kind }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function validateSceneCartridge(cartridge, options = {}) {
  const errors = []
  if (!isRecord(cartridge)) return { ok: false, errors: [{ code: 'invalid_cartridge', path: '', message: 'Scene cartridge must be an object.' }] }
  exactKeys(cartridge, new Set(['animations', 'assets', 'interactions', 'manifest', 'scene']), 'cartridge', errors)
  const manifestResult = validateSceneCartridgeManifest(cartridge.manifest)
  errors.push(...manifestResult.errors)
  if (!manifestResult.ok) return { ok: false, errors }
  const sceneResult = validateSceneDocument(cartridge.scene)
  errors.push(...sceneResult.errors.map((error) => ({ ...error, path: `scene.${error.path}` })))
  if (!sceneResult.ok) return { ok: false, errors }
  const scene = canonicalizeSceneDocument(cartridge.scene)
  const budgets = cartridge.manifest.budgets
  if (scene.id !== cartridge.manifest.id) addError(errors, 'scene_id_mismatch', 'scene.id', 'Scene document ID must match the cartridge ID.')
  if (scene.revision !== cartridge.manifest.revision) addError(errors, 'scene_revision_mismatch', 'scene.revision', 'Scene revision must match the cartridge revision.')
  if (scene.objects.length > budgets.maxObjects) addError(errors, 'object_budget', 'scene.objects', 'Scene objects exceed the cartridge budget.')
  if (scene.resources.length > budgets.maxResources) addError(errors, 'resource_budget', 'scene.resources', 'Scene resources exceed the cartridge budget.')
  if (cartridge.manifest.assets.length > budgets.maxAssets) addError(errors, 'asset_budget', 'manifest.assets', 'Cartridge assets exceed the declared count budget.')
  const declaredAssetBytes = cartridge.manifest.assets.reduce((total, asset) => total + asset.bytes, 0)
  if (declaredAssetBytes > budgets.maxAssetBytes) addError(errors, 'asset_byte_budget', 'manifest.assets', 'Cartridge assets exceed the declared byte budget.')
  validateDataOnlyReferences(scene, 'scene', errors)
  const registry = options.registry ?? createGenericSceneImplementationRegistry()
  const registryValidation = registry.validateDocument(scene)
  for (const entry of registryValidation.missing) {
    addError(errors, 'unknown_implementation', `scene.${entry.sourceId}`, `Scene implementation ${entry.id} is not registered.`)
  }
  for (const entry of registryValidation.mismatched) {
    addError(errors, 'implementation_kind', `scene.${entry.sourceId}`, `Scene implementation ${entry.id} is invalid for ${entry.kind}.`)
  }
  const signalCompilation = compileSceneSignalBindings(scene)
  if (!signalCompilation.ok) {
    errors.push(...signalCompilation.errors.map((error) => ({ ...error, path: `scene.${error.path}` })))
  }
  validateAnimations(cartridge.animations, scene, budgets, errors)
  const knownImplementations = new Set([
    ...BUILTIN_IMPLEMENTATIONS,
    ...registry.snapshot().implementations.map((entry) => entry.id),
  ])
  validateInteractions(cartridge.interactions, scene, budgets, knownImplementations, errors)
  if (errors.length > 0) return { ok: false, errors }
  const required = requiredImplementationEntries(scene, cartridge.interactions)
  const declared = [...cartridge.manifest.implementations].sort((left, right) => left.id.localeCompare(right.id))
  if (JSON.stringify(required) !== JSON.stringify(declared)) {
    addError(errors, 'implementation_declarations', 'manifest.implementations', 'Manifest implementations must exactly match the cartridge requirements.')
  }
  for (const entry of required) {
    if (!knownImplementations.has(entry.id)) addError(errors, 'unknown_implementation', 'manifest.implementations', `Cartridge implementation ${entry.id} is not registered.`)
  }
  const manifestAssets = new Map(cartridge.manifest.assets.map((asset) => [asset.sha256, asset]))
  const loadedAssets = new Map((cartridge.assets ?? []).map((asset) => [asset.sha256, asset]))
  const referencedAssets = new Set(scene.resources.flatMap((resource) => resource.asset ? [resource.asset.sha256] : []))
  for (const resource of scene.resources) {
    if (!resource.asset) continue
    const declaredAsset = manifestAssets.get(resource.asset.sha256)
    if (!declaredAsset || declaredAsset.bytes !== resource.asset.bytes || declaredAsset.mediaType !== resource.asset.mediaType) {
      addError(errors, 'asset_declaration_mismatch', `scene.resources.${resource.id}.asset`, 'Scene asset descriptor must match the cartridge manifest.')
    }
  }
  for (const asset of cartridge.manifest.assets) {
    if (!referencedAssets.has(asset.sha256)) addError(errors, 'unreferenced_asset', `manifest.assets.${asset.path}`, 'Every cartridge asset must be referenced by the scene document.')
    const loaded = loadedAssets.get(asset.sha256)
    if (loaded && (loaded.path !== asset.path || loaded.bytes !== asset.bytes || loaded.mediaType !== asset.mediaType)) {
      addError(errors, 'loaded_asset_mismatch', `assets.${asset.path}`, 'Loaded asset metadata does not match the manifest.')
    }
  }
  if (loadedAssets.size > 0 && loadedAssets.size !== manifestAssets.size) addError(errors, 'loaded_asset_count', 'assets', 'Loaded assets do not match the manifest.')
  return { ok: errors.length === 0, errors }
}

export function resolveSceneCartridge(cartridge, options = {}) {
  const validation = validateSceneCartridge(cartridge, options)
  if (!validation.ok) throw new TypeError(validation.errors[0]?.message || 'Invalid scene cartridge.')
  return Object.freeze({
    animations: canonicalValue(cartridge.animations),
    assets: canonicalValue(cartridge.assets ?? cartridge.manifest.assets),
    document: canonicalizeSceneDocument(cartridge.scene),
    interactions: canonicalValue(cartridge.interactions),
    manifest: canonicalValue(cartridge.manifest),
    requiredImplementations: cartridge.manifest.implementations.map((entry) => entry.id).sort(),
  })
}
