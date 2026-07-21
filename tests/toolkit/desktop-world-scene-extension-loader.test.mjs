import assert from 'node:assert/strict'
import test from 'node:test'

import { createDesktopWorldSceneExtensionLoader } from '../../packages/toolkit/components/desktop-world-stage/scene-extension-loader.js'
import {
  SCENE_EXTENSION_CONTRACT_ID,
  SCENE_EXTENSION_SCENE_ABI,
  SCENE_EXTENSION_SCHEMA_VERSION,
  SCENE_EXTENSION_THREE_REVISION,
  createTrustedSceneExtensionRegistry,
} from '../../packages/toolkit/scene/index.js'

const digestA = 'a'.repeat(64)
const digestB = 'b'.repeat(64)

function budgets() {
  return {
    maxDrawCalls: 32,
    maxObjects: 64,
    maxResources: 64,
    maxTextureBytes: 8 * 1024 * 1024,
    maxTriangles: 100_000,
    maxWorkingBytes: 16 * 1024 * 1024,
  }
}

function manifest(overrides = {}) {
  return {
    contract: SCENE_EXTENSION_CONTRACT_ID,
    schemaVersion: SCENE_EXTENSION_SCHEMA_VERSION,
    id: 'companion-renderer',
    ownerId: 'io.ch-osctrl.sigil',
    digest: digestA,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    implementationIds: ['io.ch-osctrl.sigil.companion.runtime'],
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
    budgets: budgets(),
    ...overrides,
  }
}

function reference(value = manifest()) {
  return {
    ownerId: value.ownerId,
    id: value.id,
    digest: value.digest,
    sceneAbi: value.sceneAbi,
    threeRevision: value.threeRevision,
  }
}

function ensure(loader, value = reference()) {
  return loader.ensure(value, value.ownerId)
}

function projection() {
  return {
    object: {
      isObject3D: true,
      traverse(visitor) { visitor(this) },
    },
    applySignal() {},
    applyAnimation() {},
    tick() {},
    suspend() {},
    resume() {},
    contextLost() {},
    contextRestored() {},
    dispose() {},
  }
}

function factory(overrides = {}) {
  return {
    manifest: manifest(),
    createProjection: () => projection(),
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('default module URLs are canonical and derived only from an exact validated reference', async () => {
  const imported = []
  const registry = createTrustedSceneExtensionRegistry()
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    async importModule(moduleURL) {
      imported.push(moduleURL)
      return { default: factory() }
    },
  })

  await ensure(loader)
  assert.deepEqual(imported, [
    `aos-scene-extension:///v1/io.ch-osctrl.sigil/companion-renderer/${digestA}/module.js?sceneAbi=aos.scene.projection.v1&threeRevision=183#load-generation-1`,
  ])

  await assert.rejects(
    ensure(loader, { ...reference(), moduleURL: 'file:///private/tmp/extension.js' }),
    (error) => error.code === 'SCENE_EXTENSION_REFERENCE_INVALID',
  )
  assert.equal(imported.length, 1)
})

test('custom URL resolution receives only a frozen exact reference and cannot escape the extension scheme', async () => {
  const registry = createTrustedSceneExtensionRegistry()
  let resolvedReference = null
  let importCount = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    resolveModuleURL(value) {
      resolvedReference = value
      return `aos-scene-extension:///installed/${value.digest}/module.js`
    },
    async importModule() {
      importCount += 1
      return { default: factory() }
    },
  })

  await ensure(loader)
  assert.deepEqual(resolvedReference, reference())
  assert.equal(Object.isFrozen(resolvedReference), true)
  assert.equal(importCount, 1)

  const rejected = createDesktopWorldSceneExtensionLoader({
    registry: createTrustedSceneExtensionRegistry(),
    resolveModuleURL: () => 'file:///Users/Michael/private-extension.js',
    importModule: async () => {
      throw new Error('must not import')
    },
  })
  await assert.rejects(
    ensure(rejected),
    (error) => error.code === 'SCENE_EXTENSION_URL_INVALID'
      && !String(error.message).includes('/Users/Michael'),
  )
})

test('owner mismatch fails before registry lookup or module import', async () => {
  let imports = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry: createTrustedSceneExtensionRegistry(),
    importModule: async () => {
      imports += 1
      return { default: factory() }
    },
  })
  await assert.rejects(
    loader.ensure(reference(), 'io.example.other'),
    (error) => error.code === 'SCENE_EXTENSION_OWNER_MISMATCH',
  )
  assert.equal(imports, 0)
})

test('module admission timeout releases capacity, retries with a fresh generation, and tombstones late registration', async () => {
  const registry = createTrustedSceneExtensionRegistry()
  const gates = [deferred(), deferred()]
  const imports = []
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    importModule: (moduleURL) => {
      const gate = gates[imports.length]
      imports.push(moduleURL)
      return gate.promise
    },
    importTimeoutMs: 50,
  })
  const first = ensure(loader)
  await assert.rejects(
    first,
    (error) => error.code === 'SCENE_EXTENSION_IMPORT_TIMEOUT',
  )
  assert.equal(registry.snapshot().count, 0)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })

  const retry = ensure(loader)
  assert.notEqual(retry, first)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(imports.length, 2)
  assert.notEqual(imports[0], imports[1])
  assert.match(imports[0], /#load-generation-1$/u)
  assert.match(imports[1], /#load-generation-2$/u)

  gates[1].resolve({ default: factory() })
  const handle = await retry
  assert.equal(handle.manifest.digest, digestA)
  assert.equal(registry.snapshot().count, 1)

  gates[0].resolve({ default: factory() })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registry.snapshot().count, 1)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })
})

test('runtime module import is the authoritative compatibility gate before registry admission', async () => {
  const retainedManifest = manifest({
    id: 'retained-renderer',
    digest: digestB,
    implementationIds: ['io.ch-osctrl.sigil.retained-renderer.runtime'],
  })
  const retainedFactory = factory({ manifest: retainedManifest })
  const registry = createTrustedSceneExtensionRegistry({ factories: [retainedFactory] })
  let attempts = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    async importModule() {
      attempts += 1
      if (attempts === 1) throw new SyntaxError('runtime parser rejected installed source')
      return { default: factory() }
    },
  })

  await assert.rejects(
    ensure(loader),
    (error) => error.code === 'SCENE_EXTENSION_IMPORT_FAILED'
      && !String(error.message).includes('runtime parser'),
  )
  assert.equal(registry.resolve(reference(retainedManifest)).manifest.digest, digestB)
  assert.equal(registry.resolve(reference()), null)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })

  const handle = await ensure(loader)
  assert.equal(handle.manifest.digest, digestA)
  assert.equal(registry.snapshot().count, 2)
})

test('ensure returns an exact registered handle without importing', async () => {
  const registeredFactory = factory()
  const registry = createTrustedSceneExtensionRegistry({ factories: [registeredFactory] })
  let imports = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    importModule: async () => {
      imports += 1
      return { default: registeredFactory }
    },
  })

  const expected = registry.resolve(reference())
  const actual = await ensure(loader)
  assert.equal(actual, expected)
  assert.equal(imports, 0)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })
})

test('concurrent ensures deduplicate one import by full immutable identity', async () => {
  const gate = deferred()
  const registry = createTrustedSceneExtensionRegistry()
  const imports = []
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    async importModule(moduleURL) {
      imports.push(moduleURL)
      return gate.promise
    },
  })

  const first = ensure(loader)
  const second = ensure(loader)
  assert.equal(first, second)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(imports.length, 1)
  const pendingSnapshot = loader.snapshot()
  assert.deepEqual(pendingSnapshot, {
    inflightCount: 1,
    loading: [{ ...reference(), state: 'loading' }],
  })
  assert.doesNotMatch(JSON.stringify(pendingSnapshot), /aos-scene-extension:|private-extension|module\.js/u)

  gate.resolve({ default: factory() })
  const [firstHandle, secondHandle] = await Promise.all([first, second])
  assert.equal(firstHandle, secondHandle)
  assert.equal(registry.snapshot().count, 1)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })
})

test('loader bounds concurrent immutable module admissions', async () => {
  const values = Array.from({ length: 65 }, (_, index) => manifest({
    id: `renderer-${index + 1}`,
    digest: (index + 1).toString(16).padStart(64, '0'),
    implementationIds: [`io.ch-osctrl.sigil.renderer-${index + 1}.runtime`],
  }))
  const gates = values.slice(0, 64).map(() => deferred())
  let imports = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry: createTrustedSceneExtensionRegistry(),
    importModule: () => {
      const index = imports
      imports += 1
      return gates[index].promise.then(() => ({ default: factory({ manifest: values[index] }) }))
    },
  })
  const admitted = values.slice(0, 64).map((value) => ensure(loader, reference(value)))
  await assert.rejects(
    ensure(loader, reference(values[64])),
    (error) => error.code === 'SCENE_EXTENSION_LOADER_CAPACITY',
  )
  assert.equal(loader.snapshot().inflightCount, 64)
  gates.forEach((gate) => gate.resolve())
  await Promise.all(admitted)
  assert.equal(imports, 64)
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })
})

test('timed-out unresolved imports continue to consume bounded physical capacity', async () => {
  const values = Array.from({ length: 65 }, (_, index) => manifest({
    id: `abandoned-renderer-${index + 1}`,
    digest: (index + 1).toString(16).padStart(64, '0'),
    implementationIds: [`io.ch-osctrl.sigil.abandoned-renderer-${index + 1}.runtime`],
  }))
  const gates = values.slice(0, 64).map(() => deferred())
  let imports = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry: createTrustedSceneExtensionRegistry(),
    importTimeoutMs: 1,
    importModule: () => {
      const index = imports++
      return gates[index]?.promise ?? Promise.resolve({ default: factory({ manifest: values[index] }) })
    },
  })
  const timedOut = values.slice(0, 64).map((value) => ensure(loader, reference(value)))
  await Promise.all(timedOut.map((promise) => assert.rejects(
    promise,
    (error) => error.code === 'SCENE_EXTENSION_IMPORT_TIMEOUT',
  )))
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })
  await assert.rejects(
    ensure(loader, reference(values[64])),
    (error) => error.code === 'SCENE_EXTENSION_LOADER_CAPACITY',
  )
  assert.equal(imports, 64)

  gates.forEach((gate, index) => gate.resolve({ default: factory({ manifest: values[index] }) }))
  await new Promise((resolve) => setImmediate(resolve))
  const final = await ensure(loader, reference(values[64]))
  assert.equal(final.manifest.digest, values[64].digest)
})

test('module manifest identity must exactly match every requested identity field', async (t) => {
  const cases = [
    ['ownerId', 'other-owner'],
    ['id', 'different-extension'],
    ['digest', digestB],
    ['sceneAbi', 'aos.scene.projection.v2'],
    ['threeRevision', '184'],
  ]
  for (const [field, value] of cases) {
    await t.test(field, async () => {
      const registry = createTrustedSceneExtensionRegistry()
      const loader = createDesktopWorldSceneExtensionLoader({
        registry,
        importModule: async () => ({
          default: factory({ manifest: manifest({ [field]: value }) }),
        }),
      })
      await assert.rejects(
        ensure(loader),
        (error) => error.code === 'SCENE_EXTENSION_IDENTITY_MISMATCH',
      )
      assert.equal(registry.snapshot().count, 0)
    })
  }
})

test('module admission accepts exactly one default factory object and delegates factory validation to the registry', async (t) => {
  const malformedModules = [
    null,
    {},
    { default: null },
    { default: [] },
    { default: factory(), named: true },
  ]
  for (const [index, moduleNamespace] of malformedModules.entries()) {
    await t.test(`malformed-${index}`, async () => {
      const registry = createTrustedSceneExtensionRegistry()
      const loader = createDesktopWorldSceneExtensionLoader({
        registry,
        importModule: async () => moduleNamespace,
      })
      await assert.rejects(
        ensure(loader),
        (error) => error.code === 'SCENE_EXTENSION_MODULE_INVALID',
      )
      assert.equal(registry.snapshot().count, 0)
    })
  }

  const registry = createTrustedSceneExtensionRegistry()
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    importModule: async () => ({
      default: factory({ createProjection: 'not-a-function' }),
    }),
  })
  await assert.rejects(
    ensure(loader),
    (error) => error.code === 'SCENE_EXTENSION_REGISTRATION_FAILED',
  )
  assert.equal(registry.snapshot().count, 0)
})

test('failed imports clear inflight state and retry without leaking module source or local paths', async () => {
  const registry = createTrustedSceneExtensionRegistry()
  let attempts = 0
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    async importModule() {
      attempts += 1
      if (attempts === 1) {
        throw new Error('failed source file:///Users/Michael/private/extension-source.js')
      }
      return { default: factory() }
    },
  })

  await assert.rejects(
    ensure(loader),
    (error) => {
      const serialized = `${error.name} ${error.message} ${error.stack}`
      return error.code === 'SCENE_EXTENSION_IMPORT_FAILED'
        && !serialized.includes('/Users/Michael')
        && !serialized.includes('extension-source')
    },
  )
  assert.deepEqual(loader.snapshot(), { inflightCount: 0, loading: [] })

  const handle = await ensure(loader)
  assert.equal(handle.manifest.digest, digestA)
  assert.equal(attempts, 2)
  assert.equal(registry.snapshot().count, 1)
})

test('module and registry identity failures cannot leak getter-provided source paths', async () => {
  const sourcePath = 'file:///Users/Michael/private/extension-source.js'
  const throwingFactory = factory()
  Object.defineProperty(throwingFactory, 'manifest', {
    enumerable: true,
    get() { throw new Error(sourcePath) },
  })
  const moduleLoader = createDesktopWorldSceneExtensionLoader({
    registry: createTrustedSceneExtensionRegistry(),
    importModule: async () => ({ default: throwingFactory }),
  })
  await assert.rejects(ensure(moduleLoader), (error) => {
    const serialized = `${error.message} ${error.stack}`
    return error.code === 'SCENE_EXTENSION_IDENTITY_MISMATCH'
      && !serialized.includes('/Users/Michael')
  })

  const registryLoader = createDesktopWorldSceneExtensionLoader({
    registry: {
      register() { throw new Error(sourcePath) },
      resolve() { throw new Error(sourcePath) },
      retain() { throw new Error(sourcePath) },
    },
    importModule: async () => ({ default: factory() }),
  })
  await assert.rejects(ensure(registryLoader), (error) => {
    const serialized = `${error.message} ${error.stack}`
    return error.code === 'SCENE_EXTENSION_REGISTRY_FAILED'
      && !serialized.includes('/Users/Michael')
  })
})

test('multiple digests of the same extension load and resolve independently', async () => {
  const firstManifest = manifest({ digest: digestA })
  const secondManifest = manifest({ digest: digestB })
  const factories = new Map([
    [digestA, factory({ manifest: firstManifest })],
    [digestB, factory({ manifest: secondManifest })],
  ])
  const imported = []
  const registry = createTrustedSceneExtensionRegistry()
  const loader = createDesktopWorldSceneExtensionLoader({
    registry,
    async importModule(moduleURL) {
      imported.push(moduleURL)
      const digest = moduleURL.includes(digestA) ? digestA : digestB
      return { default: factories.get(digest) }
    },
  })

  const [first, second] = await Promise.all([
    ensure(loader, reference(firstManifest)),
    ensure(loader, reference(secondManifest)),
  ])
  assert.equal(first.manifest.digest, digestA)
  assert.equal(second.manifest.digest, digestB)
  assert.notEqual(first, second)
  assert.equal(imported.length, 2)
  assert.equal(registry.snapshot().count, 2)
  assert.equal(registry.resolve(reference(firstManifest)), first)
  assert.equal(registry.resolve(reference(secondManifest)), second)
})
