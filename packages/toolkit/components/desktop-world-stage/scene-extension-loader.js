import {
  SCENE_EXTENSION_REGISTRY_LIMIT,
  validateSceneExtensionReference,
} from '../../scene/scene-extension.js'

const EXTENSION_PATH_PREFIX = '/.aos-scene-extension/'
const EXTENSION_VALIDATION_ORIGIN = 'https://aos.invalid'
const DEFAULT_IMPORT_TIMEOUT_MS = 2_000
const IDENTITY_FIELDS = Object.freeze([
  'ownerId',
  'id',
  'digest',
  'sceneAbi',
  'threeRevision',
])

function loaderError(code, message) {
  const error = new Error(message)
  error.name = 'DesktopWorldSceneExtensionLoaderError'
  Object.defineProperty(error, 'code', {
    configurable: false,
    enumerable: true,
    value: code,
    writable: false,
  })
  error.stack = `${error.name}: ${message}`
  return error
}

function exactReference(reference) {
  let validation
  try {
    validation = validateSceneExtensionReference(reference)
  } catch {
    throw loaderError('SCENE_EXTENSION_REFERENCE_INVALID', 'Scene extension reference is invalid.')
  }
  if (!validation.ok) {
    throw loaderError('SCENE_EXTENSION_REFERENCE_INVALID', 'Scene extension reference is invalid.')
  }
  return Object.freeze(Object.fromEntries(
    IDENTITY_FIELDS.map((field) => [field, reference[field]]),
  ))
}

function identityKey(reference) {
  return IDENTITY_FIELDS.map((field) => reference[field]).join('\u0000')
}

function manifestMatchesReference(manifest, reference) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  return IDENTITY_FIELDS.every((field) => manifest[field] === reference[field])
}

function defaultModuleURL(reference) {
  const ownerId = encodeURIComponent(reference.ownerId)
  const id = encodeURIComponent(reference.id)
  const sceneAbi = encodeURIComponent(reference.sceneAbi)
  const threeRevision = encodeURIComponent(reference.threeRevision)
  return `${EXTENSION_PATH_PREFIX}v1/${ownerId}/${id}/${reference.digest}/module.js?sceneAbi=${sceneAbi}&threeRevision=${threeRevision}`
}

function canonicalModuleURL(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw loaderError('SCENE_EXTENSION_URL_INVALID', 'Scene extension module URL is invalid.')
  }
  let parsed
  try {
    parsed = new URL(value, EXTENSION_VALIDATION_ORIGIN)
  } catch {
    throw loaderError('SCENE_EXTENSION_URL_INVALID', 'Scene extension module URL is invalid.')
  }
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || parsed.origin !== EXTENSION_VALIDATION_ORIGIN
    || !parsed.pathname.startsWith(EXTENSION_PATH_PREFIX)
    || parsed.username
    || parsed.password
    || parsed.hash
  ) {
    throw loaderError('SCENE_EXTENSION_URL_INVALID', 'Scene extension module URL is invalid.')
  }
  return `${parsed.pathname}${parsed.search}`
}

function defaultImportModule(moduleURL) {
  return import(moduleURL)
}

function moduleURLForGeneration(moduleURL, generation) {
  const parsed = new URL(moduleURL, EXTENSION_VALIDATION_ORIGIN)
  parsed.hash = `load-generation-${generation}`
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

function exactDefaultFactory(moduleNamespace) {
  if (!moduleNamespace || typeof moduleNamespace !== 'object') {
    throw loaderError('SCENE_EXTENSION_MODULE_INVALID', 'Scene extension module must export exactly one default factory object.')
  }
  const exportedNames = Object.keys(moduleNamespace)
  if (exportedNames.length !== 1 || exportedNames[0] !== 'default') {
    throw loaderError('SCENE_EXTENSION_MODULE_INVALID', 'Scene extension module must export exactly one default factory object.')
  }
  const factory = moduleNamespace.default
  if (!factory || typeof factory !== 'object' || Array.isArray(factory)) {
    throw loaderError('SCENE_EXTENSION_MODULE_INVALID', 'Scene extension module must export exactly one default factory object.')
  }
  return factory
}

function validateLoaderOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader options are invalid.')
  }
  const keys = Object.keys(options)
  if (keys.some((key) => !['registry', 'importModule', 'importTimeoutMs', 'resolveModuleURL'].includes(key))) {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader options are invalid.')
  }
  if (
    !options.registry
    || typeof options.registry.resolve !== 'function'
    || typeof options.registry.register !== 'function'
    || typeof options.registry.retain !== 'function'
  ) {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader requires a trusted extension registry.')
  }
  if (options.importModule !== undefined && typeof options.importModule !== 'function') {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader importModule must be a function.')
  }
  if (options.importTimeoutMs !== undefined && (
    !Number.isInteger(options.importTimeoutMs)
    || options.importTimeoutMs < 1
    || options.importTimeoutMs > 10_000
  )) {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader timeout is invalid.')
  }
  if (options.resolveModuleURL !== undefined && typeof options.resolveModuleURL !== 'function') {
    throw loaderError('SCENE_EXTENSION_LOADER_INVALID', 'DesktopWorld scene extension loader resolveModuleURL must be a function.')
  }
}

export function createDesktopWorldSceneExtensionLoader(options) {
  validateLoaderOptions(options)
  const registry = options.registry
  const importModule = options.importModule ?? defaultImportModule
  const importTimeoutMs = options.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS
  const resolveModuleURL = options.resolveModuleURL ?? defaultModuleURL
  const inflight = new Map()
  let nextGeneration = 0
  let unresolvedImports = 0

  function resolveRegistered(reference) {
    let handle
    try {
      handle = registry.resolve(reference)
      if (handle !== null && !manifestMatchesReference(handle?.manifest, reference)) {
        throw new Error('mismatched registry handle')
      }
    } catch {
      throw loaderError('SCENE_EXTENSION_REGISTRY_FAILED', 'Scene extension registry lookup failed.')
    }
    return handle
  }

  async function loadFactory(reference, generation) {
    let moduleURL
    try {
      moduleURL = canonicalModuleURL(resolveModuleURL(reference))
    } catch (error) {
      if (error?.code === 'SCENE_EXTENSION_URL_INVALID') throw error
      throw loaderError('SCENE_EXTENSION_URL_INVALID', 'Scene extension module URL could not be resolved.')
    }

    let moduleNamespace
    try {
      // This import is the authoritative WebKit parser/linker gate. The
      // host-generated fragment gives retries a fresh module-map identity
      // without changing the installed artifact identity or scheme lookup.
      moduleNamespace = await importModule(moduleURLForGeneration(moduleURL, generation))
    } catch {
      throw loaderError('SCENE_EXTENSION_IMPORT_FAILED', 'Scene extension module import failed.')
    }

    let factory
    try {
      factory = exactDefaultFactory(moduleNamespace)
    } catch (error) {
      if (error?.code === 'SCENE_EXTENSION_MODULE_INVALID') throw error
      throw loaderError('SCENE_EXTENSION_MODULE_INVALID', 'Scene extension module must export exactly one default factory object.')
    }
    let moduleIdentityMatches = false
    try {
      moduleIdentityMatches = manifestMatchesReference(factory.manifest, reference)
    } catch {
      moduleIdentityMatches = false
    }
    if (!moduleIdentityMatches) {
      throw loaderError('SCENE_EXTENSION_IDENTITY_MISMATCH', 'Scene extension module identity does not match the requested reference.')
    }
    return factory
  }

  function registerFactory(factory, reference) {
    let handle
    try {
      handle = registry.register(factory)
      if (!manifestMatchesReference(handle?.manifest, reference)) {
        throw new Error('mismatched registered handle')
      }
    } catch {
      throw loaderError('SCENE_EXTENSION_REGISTRATION_FAILED', 'Scene extension factory registration failed.')
    }
    return handle
  }

  function beginLoad(reference, key) {
    nextGeneration += 1
    const entry = {
      generation: nextGeneration,
      reference,
      promise: null,
      state: 'loading',
    }
    const isCurrent = () => entry.state === 'loading' && inflight.get(key) === entry
    const retire = (state) => {
      if (entry.state !== 'loading') return false
      entry.state = state
      if (inflight.get(key) === entry) inflight.delete(key)
      return true
    }
    unresolvedImports += 1
    const rawImport = Promise.resolve().then(() => loadFactory(reference, entry.generation))
    rawImport.then(
      () => { unresolvedImports -= 1 },
      () => { unresolvedImports -= 1 },
    )
    entry.promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!retire('timed_out')) return
        reject(loaderError(
          'SCENE_EXTENSION_IMPORT_TIMEOUT',
          'Scene extension module import timed out.',
        ))
      }, importTimeoutMs)
      rawImport.then(
        (factory) => {
          if (!isCurrent()) return
          clearTimeout(timer)
          try {
            const handle = registerFactory(factory, reference)
            retire('registered')
            resolve(handle)
          } catch (error) {
            retire('failed')
            reject(error)
          }
        },
        (error) => {
          if (!isCurrent()) return
          clearTimeout(timer)
          retire('failed')
          reject(error)
        },
      )
    })
    return entry
  }

  function ensure(reference, expectedOwner) {
    let validatedReference
    let registered
    try {
      validatedReference = exactReference(reference)
      if (typeof expectedOwner !== 'string' || validatedReference.ownerId !== expectedOwner) {
        throw loaderError('SCENE_EXTENSION_OWNER_MISMATCH', 'Scene extension owner does not match the scene lease owner.')
      }
      registered = resolveRegistered(validatedReference)
    } catch (error) {
      return Promise.reject(error)
    }
    if (registered) return Promise.resolve(registered)

    const key = identityKey(validatedReference)
    const existing = inflight.get(key)
    if (existing) return existing.promise
    if (unresolvedImports >= SCENE_EXTENSION_REGISTRY_LIMIT) {
      return Promise.reject(loaderError(
        'SCENE_EXTENSION_LOADER_CAPACITY',
        'Scene extension loader capacity exceeded.',
      ))
    }

    const entry = beginLoad(validatedReference, key)
    inflight.set(key, entry)
    return entry.promise
  }

  function snapshot() {
    const loading = [...inflight.values()]
      .map(({ reference, state }) => Object.freeze({ ...reference, state }))
      .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
    return Object.freeze({
      inflightCount: loading.length,
      loading: Object.freeze(loading),
    })
  }

  return Object.freeze({ ensure, snapshot })
}
