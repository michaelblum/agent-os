import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  SCENE_EXTENSION_BUDGET_LIMITS,
  SCENE_EXTENSION_CONTRACT_ID,
  SCENE_EXTENSION_SCENE_ABI,
  SCENE_EXTENSION_SCHEMA_VERSION,
  SCENE_EXTENSION_THREE_REVISION,
  createTrustedSceneExtensionRegistry,
  inspectSceneExtensionProjectionResources,
  normalizeSceneExtensionInteractionRouteState,
  serializeSceneExtensionDigestMaterial,
  validateSceneExtensionManifest,
  validateSceneExtensionReference,
  validateSceneExtensionProjection,
} from '../../packages/toolkit/scene/index.js'

const digest = 'a'.repeat(64)

function budgets(overrides = {}) {
  return {
    maxDrawCalls: 32,
    maxObjects: 64,
    maxResources: 64,
    maxTextureBytes: 8 * 1024 * 1024,
    maxTriangles: 100_000,
    maxWorkingBytes: 16 * 1024 * 1024,
    ...overrides,
  }
}

function manifest(overrides = {}) {
  return {
    contract: SCENE_EXTENSION_CONTRACT_ID,
    schemaVersion: SCENE_EXTENSION_SCHEMA_VERSION,
    id: 'companion-renderer',
    ownerId: 'sigil',
    digest,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    implementationIds: [
      'sigil.companion.geometry',
      'sigil.companion.runtime',
    ],
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

function document() {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id: 'companion/main',
    revision: 1,
    rootObjectId: 'root',
    objects: [{
      id: 'root',
      parentId: null,
      kind: 'group',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      geometryId: null,
      materialId: null,
      components: [],
    }],
    resources: [],
    metadata: {},
  }
}

function projection(overrides = {}) {
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
    ...overrides,
  }
}

function context(overrides = {}) {
  return {
    THREE: { REVISION: SCENE_EXTENSION_THREE_REVISION },
    budgets: budgets(),
    document: document(),
    ...overrides,
  }
}

function errorCodes(result) {
  return new Set(result.errors.map(({ code }) => code))
}

test('scene extension manifests are exact, digest-pinned, owner-namespaced, and budgeted', () => {
  assert.deepEqual(validateSceneExtensionManifest(manifest()), { ok: true, errors: [] })

  const invalid = manifest({
    contract: 'aos.scene.cartridge.v1',
    schemaVersion: 2,
    id: '../extension',
    ownerId: 'Sigil',
    digest: `sha256:${digest}`,
    sceneAbi: 'aos.scene.projection.v2',
    implementationIds: ['other.runtime', 'sigil.companion.runtime', 'sigil.companion.runtime'],
    threeRevision: '184',
    budgets: budgets({ maxTriangles: Number.POSITIVE_INFINITY }),
    path: '/private/extensions/sigil.js',
  })
  const codes = errorCodes(validateSceneExtensionManifest(invalid))
  for (const code of [
    'unknown_field',
    'contract_id',
    'schema_version',
    'invalid_extension_segment',
    'invalid_digest',
    'scene_abi',
    'implementation_owner',
    'duplicate_implementation',
    'implementation_order',
    'three_revision',
    'invalid_budget',
  ]) assert.equal(codes.has(code), true, code)
})

test('scene extension manifests require every exact field and every finite integer budget', () => {
  const missing = manifest()
  delete missing.digest
  delete missing.budgets.maxObjects
  const missingCodes = errorCodes(validateSceneExtensionManifest(missing))
  assert.equal(missingCodes.has('missing_field'), true)

  for (const value of [-1, 1.5, Number.NaN, SCENE_EXTENSION_BUDGET_LIMITS.maxObjects + 1]) {
    const result = validateSceneExtensionManifest(manifest({ budgets: budgets({ maxObjects: value }) }))
    assert.equal(errorCodes(result).has('invalid_budget'), true, String(value))
  }
})

test('scene extension digest material binds manifest authority and factory-body bytes canonically', () => {
  const first = serializeSceneExtensionDigestMaterial(manifest(), 'b'.repeat(64))
  assert.equal(first, serializeSceneExtensionDigestMaterial(manifest(), 'b'.repeat(64)))
  assert.notEqual(first, serializeSceneExtensionDigestMaterial(
    manifest({ implementationIds: ['sigil.companion.runtime'] }),
    'b'.repeat(64),
  ))
  assert.notEqual(first, serializeSceneExtensionDigestMaterial(
    manifest({ budgets: budgets({ maxObjects: 63 }) }),
    'b'.repeat(64),
  ))
  assert.notEqual(first, serializeSceneExtensionDigestMaterial(manifest(), 'c'.repeat(64)))
  assert.throws(() => serializeSceneExtensionDigestMaterial(manifest(), 'invalid'), /factory-body digest/)
})

test('projection validation requires one object subtree and the complete lifecycle ABI', () => {
  assert.deepEqual(validateSceneExtensionProjection(projection()), { ok: true, errors: [] })
  const invalid = projection({
    object: null,
    applySignal: null,
    contextRestored: undefined,
    inspectInteractionRoute: 'invalid',
  })
  const codes = errorCodes(validateSceneExtensionProjection(invalid))
  assert.equal(codes.has('invalid_projection_object'), true)
  assert.equal(codes.has('missing_projection_method'), true)
  assert.equal(codes.has('invalid_projection_method'), true)
  assert.equal(validateSceneExtensionProjection(null).ok, false)
})

test('extension interaction inspection accepts only bounded content-free route facts', () => {
  const input = {
    active: true,
    destination: [900, 600],
    kind: 'line',
    origin: [400, 300],
    progress: 0.5,
  }
  const inspection = normalizeSceneExtensionInteractionRouteState(input)
  assert.deepEqual(inspection, input)
  assert.notEqual(inspection, input)
  assert.equal(Object.isFrozen(inspection), true)
  assert.equal(Object.isFrozen(inspection.origin), true)
  assert.deepEqual(normalizeSceneExtensionInteractionRouteState(null), null)
  assert.throws(
    () => normalizeSceneExtensionInteractionRouteState(undefined),
    /must be an object/u,
  )

  const customIterableDestination = [900, 600]
  Object.setPrototypeOf(customIterableDestination, {
    *[Symbol.iterator]() {
      yield 900
      yield 600
      yield 'product-secret'
    },
  })
  assert.deepEqual(
    normalizeSceneExtensionInteractionRouteState({
      ...input,
      destination: customIterableDestination,
    }).destination,
    [900, 600],
  )

  for (const malformed of [
    { ...input, transcript: 'must not escape' },
    { ...input, progress: 2 },
    { ...input, kind: 'product-transition' },
    { ...input, origin: [0, 0, 0] },
    { ...input, origin: Object.assign(Array(2), { 1: 0 }) },
    { ...input, origin: Object.assign([0, 0], { transcript: 'must not escape' }) },
  ]) {
    assert.throws(
      () => normalizeSceneExtensionInteractionRouteState(malformed),
      /Scene extension interaction/u,
    )
  }
  let getterCalls = 0
  const getter = { ...input }
  Object.defineProperty(getter, 'active', {
    enumerable: true,
    get() {
      getterCalls += 1
      return true
    },
  })
  assert.throws(
    () => normalizeSceneExtensionInteractionRouteState(getter),
    /invalid fields/u,
  )
  assert.equal(getterCalls, 0)
  assert.throws(
    () => normalizeSceneExtensionInteractionRouteState(Object.assign(
      Object.create({ inherited: true }),
      input,
    )),
    /invalid fields/u,
  )
})

test('factory and projection hooks reject Promise-like results from the synchronous ABI', async (t) => {
  const asynchronousFactoryRegistry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest(),
      async createProjection() { return projection() },
    }],
  })
  assert.throws(
    () => asynchronousFactoryRegistry.resolve(reference()).createProjection(context()),
    /factory createProjection\(\) must complete synchronously/u,
  )

  for (const method of [
    'activate',
    'applyAnimation',
    'applyInteraction',
    'applySignal',
    'contextLost',
    'contextRestored',
    'dispose',
    'inspectInteractionRoute',
    'resume',
    'suspend',
    'tick',
  ]) {
    await t.test(method, () => {
      const registry = createTrustedSceneExtensionRegistry({
        factories: [{
          manifest: manifest(),
          createProjection: () => projection({
            [method]() { return Promise.resolve() },
          }),
        }],
      })
      const admitted = registry.resolve(reference()).createProjection(context())
      assert.throws(
        () => admitted[method](),
        new RegExp(`projection ${method}\\(\\) must complete synchronously`, 'u'),
      )
    })
  }

  const throwingThenRegistry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest(),
      createProjection: () => projection({
        applySignal() {
          return Object.defineProperty({}, 'then', {
            get() { throw new Error('then getter must not escape') },
          })
        },
      }),
    }],
  })
  const admitted = throwingThenRegistry.resolve(reference()).createProjection(context())
  assert.throws(
    () => admitted.applySignal(),
    /projection applySignal\(\) must complete synchronously/u,
  )
})

test('projection disposal remains retryable until the consumer hook succeeds', () => {
  let calls = 0
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest(),
      createProjection: () => projection({
        dispose() {
          calls += 1
          if (calls === 1) throw new Error('transient cleanup failure')
        },
      }),
    }],
  })
  const admitted = registry.resolve(reference()).createProjection(context())

  assert.throws(() => admitted.dispose(), /transient cleanup failure/u)
  assert.doesNotThrow(() => admitted.dispose())
  assert.equal(calls, 2)
})

test('projection activation re-audits resources before publication', () => {
  const children = []
  const object = {
    isObject3D: true,
    traverse(visitor) {
      visitor(this)
      for (const child of children) visitor(child)
    },
  }
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest(),
      createProjection: () => projection({
        object,
        activate() { children.push({ isObject3D: true }) },
      }),
    }],
  })
  const admitted = registry.resolve(reference()).createProjection(context({
    budgets: budgets({ maxObjects: 1 }),
  }))

  assert.throws(() => admitted.activate(), /exceeded maxObjects/u)
})

test('projection resource inspection measures and enforces concrete Three resources', () => {
  const geometry = {
    attributes: { position: { count: 6, array: new Float32Array(18) } },
    groups: [{}, {}],
    index: null,
  }
  const texture = { isTexture: true, image: { width: 4, height: 8 } }
  const material = { map: texture }
  const child = { geometry, isMesh: true, material, visible: true }
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); visitor(child) },
  }
  assert.deepEqual(inspectSceneExtensionProjectionResources(object), {
    drawCalls: 2,
    geometryBytes: 72,
    objects: 2,
    resources: 3,
    textureBytes: 128,
    triangles: 2,
    workingBytes: 200,
  })

  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest({ budgets: budgets({ maxTriangles: 1 }) }),
      createProjection: () => projection({ object }),
    }],
  })
  const handle = registry.resolve({
    ownerId: 'sigil',
    id: 'companion-renderer',
    digest,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
  })
  assert.throws(
    () => handle.createProjection(context({ budgets: budgets({ maxTriangles: 1 }) })),
    /exceeded maxTriangles/u,
  )
})

test('projection inspection accounts for instancing and compressed texture mipmaps', () => {
  const geometry = {
    attributes: { position: { count: 3, array: new Float32Array(9) } },
    groups: [],
    index: null,
  }
  const texture = {
    isTexture: true,
    mipmaps: [
      { data: new Uint8Array(32) },
      { data: new Uint8Array(8) },
    ],
  }
  const instance = {
    count: 25,
    geometry,
    isInstancedMesh: true,
    material: { map: texture },
    visible: true,
  }
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); visitor(instance) },
  }

  assert.deepEqual(inspectSceneExtensionProjectionResources(object), {
    drawCalls: 1,
    geometryBytes: 36,
    objects: 2,
    resources: 3,
    textureBytes: 40,
    triangles: 25,
    workingBytes: 76,
  })
})

test('projection texture discovery treats raw shader buffers as terminal values', () => {
  const child = {
    geometry: { attributes: {}, groups: [], index: null },
    material: { uniforms: { field: { value: new Float32Array(1_024) } } },
    visible: true,
  }
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); visitor(child) },
  }

  assert.deepEqual(inspectSceneExtensionProjectionResources(object), {
    drawCalls: 1,
    geometryBytes: 0,
    objects: 2,
    resources: 2,
    textureBytes: 0,
    triangles: 0,
    workingBytes: 0,
  })
})

test('projection inspection accounts for morph, interleaved, and instanced buffers without double-counting backing stores', () => {
  const shared = new ArrayBuffer(256)
  const interleaved = { data: { array: new Float32Array(shared, 0, 32) }, count: 4 }
  const morph = { array: new Float32Array(shared, 128, 16), count: 4 }
  const instanceMatrix = { array: new Float32Array(16 * 3) }
  const instanceColor = { array: new Float32Array(3 * 3) }
  const geometry = {
    attributes: { position: interleaved, color: interleaved },
    morphAttributes: { position: [morph] },
    groups: [],
    index: null,
  }
  const instance = {
    count: 3,
    geometry,
    instanceColor,
    instanceMatrix,
    isInstancedMesh: true,
    material: {},
    visible: true,
  }
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); visitor(instance) },
  }

  assert.deepEqual(inspectSceneExtensionProjectionResources(object), {
    drawCalls: 1,
    geometryBytes: 484,
    objects: 2,
    resources: 2,
    textureBytes: 0,
    triangles: 3,
    workingBytes: 484,
  })

  const registry = createTrustedSceneExtensionRegistry({
    factories: [{ manifest: manifest(), createProjection: () => projection({ object }) }],
  })
  assert.throws(
    () => registry.resolve(reference()).createProjection(context({
      budgets: budgets({ maxWorkingBytes: 483 }),
    })),
    /exceeded maxWorkingBytes/u,
  )
})

test('host-lowered budgets govern admission and sampled runtime growth', () => {
  const children = []
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); for (const child of children) visitor(child) },
  }
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest({ budgets: budgets({ maxObjects: 8 }) }),
      createProjection: () => projection({
        object,
        tick() {
          if (children.length === 0) children.push({})
        },
      }),
    }],
  })
  const handle = registry.resolve(reference())
  assert.throws(
    () => handle.createProjection(context({ budgets: budgets({ maxObjects: 0 }) })),
    /exceeded maxObjects/u,
  )

  const dynamic = handle.createProjection(context({ budgets: budgets({ maxObjects: 1 }) }))
  assert.equal(dynamic.resourceMetrics().objects, 1)
  for (let tick = 0; tick < 29; tick += 1) assert.doesNotThrow(() => dynamic.tick(16))
  assert.throws(() => dynamic.tick(16), /exceeded maxObjects/u)
})

test('runtime resource audits are sampled instead of allocating a tree walk every frame', () => {
  let traversals = 0
  const object = {
    isObject3D: true,
    traverse(visitor) { traversals += 1; visitor(this) },
  }
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{ manifest: manifest(), createProjection: () => projection({ object }) }],
  })
  const dynamic = registry.resolve(reference()).createProjection(context())
  assert.equal(traversals, 1)
  const admittedMetrics = dynamic.resourceMetrics()
  for (let tick = 0; tick < 29; tick += 1) dynamic.tick(16)
  assert.equal(traversals, 1)
  assert.equal(dynamic.resourceMetrics(), admittedMetrics)
  dynamic.tick(16)
  assert.equal(traversals, 2)
  assert.notEqual(dynamic.resourceMetrics(), admittedMetrics)
})

test('rejected and dynamically over-budget projections are disposed exactly once', () => {
  const children = []
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this); for (const child of children) visitor(child) },
  }
  let rejectedDisposals = 0
  const rejectedRegistry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest({ budgets: budgets({ maxObjects: 0 }) }),
      createProjection: () => projection({
        object,
        dispose() { rejectedDisposals += 1 },
      }),
    }],
  })
  assert.throws(
    () => rejectedRegistry.resolve(reference()).createProjection(context({ budgets: budgets({ maxObjects: 0 }) })),
    /exceeded maxObjects/u,
  )
  assert.equal(rejectedDisposals, 1)

  let dynamicDisposals = 0
  const dynamicRegistry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest({ budgets: budgets({ maxObjects: 1 }) }),
      createProjection: () => projection({
        object,
        tick() { children.push({}) },
        dispose() { dynamicDisposals += 1 },
      }),
    }],
  })
  const dynamic = dynamicRegistry.resolve(reference()).createProjection(context({ budgets: budgets({ maxObjects: 1 }) }))
  for (let tick = 0; tick < 29; tick += 1) assert.doesNotThrow(() => dynamic.tick(16))
  assert.throws(() => dynamic.tick(16), /exceeded maxObjects/u)
  dynamic.dispose()
  assert.equal(dynamicDisposals, 1)
})

test('failed cleanup of a rejected projection carries the fail-closed stage code', () => {
  const object = {
    isObject3D: true,
    traverse(visitor) { visitor(this) },
  }
  let disposalAttempts = 0
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest({ budgets: budgets({ maxObjects: 0 }) }),
      createProjection: () => projection({
        object,
        dispose() {
          disposalAttempts += 1
          throw new Error('cleanup failed')
        },
      }),
    }],
  })

  let failure = null
  try {
    registry.resolve(reference()).createProjection(context({ budgets: budgets({ maxObjects: 0 }) }))
  } catch (error) {
    failure = error
  }
  assert.match(failure?.message ?? '', /admission and cleanup both failed/u)
  assert.equal(failure.code, 'SCENE_EXTENSION_DISPOSE_FAILED')
  assert.equal(disposalAttempts, 1)
})

test('trusted registry resolves only exact immutable extension identities', () => {
  const factory = { manifest: manifest(), createProjection: () => projection() }
  const registry = createTrustedSceneExtensionRegistry({ factories: [factory] })
  const reference = {
    ownerId: factory.manifest.ownerId,
    id: factory.manifest.id,
    digest: factory.manifest.digest,
    sceneAbi: factory.manifest.sceneAbi,
    threeRevision: factory.manifest.threeRevision,
  }
  assert.ok(registry.resolve(reference))
  assert.equal(registry.resolve({ ...reference, digest: 'b'.repeat(64) }), null)
  assert.equal(registry.resolve({ ...reference, id: 'missing' }), null)
  assert.throws(() => registry.resolve({ ...reference, threeRevision: '184' }), /Three revision/)
  assert.throws(() => registry.resolve({ ...reference, localPath: '/tmp/extension.js' }), /Unknown scene extension field/)
  assert.throws(() => registry.register(factory), /already registered/)
  assert.throws(() => registry.register({ ...factory, sourcePath: '/tmp/extension.js' }), /Unknown scene extension field/)
})

test('trusted registry keeps immutable extension digests independently addressable', () => {
  const first = manifest()
  const second = manifest({ digest: 'b'.repeat(64) })
  const registry = createTrustedSceneExtensionRegistry({
    factories: [
      { manifest: first, createProjection: () => projection() },
      { manifest: second, createProjection: () => projection() },
    ],
  })
  assert.ok(registry.resolve(reference(first)))
  assert.ok(registry.resolve(reference(second)))
  assert.equal(registry.snapshot().count, 2)
  assert.throws(
    () => registry.register({ manifest: first, createProjection: () => projection() }),
    /already registered/,
  )
  assert.deepEqual(validateSceneExtensionReference(reference(first)), { ok: true, errors: [] })
})

test('trusted registry evicts unused entries but rejects unbounded live digest accumulation', () => {
  const registry = createTrustedSceneExtensionRegistry()
  const leases = []
  for (let index = 0; index < 64; index += 1) {
    const registeredManifest = manifest({ digest: index.toString(16).padStart(64, '0') })
    registry.register({
      manifest: registeredManifest,
      createProjection: () => projection(),
    })
    leases.push(registry.retain(reference(registeredManifest)))
  }
  assert.throws(
    () => registry.register({
      manifest: manifest({ digest: 'f'.repeat(64) }),
      createProjection: () => projection(),
    }),
    /capacity exceeded/u,
  )
  leases[0].release()
  const replacement = manifest({ digest: 'e'.repeat(64) })
  registry.register({ manifest: replacement, createProjection: () => projection() })
  assert.ok(registry.resolve(reference(replacement)))
  assert.equal(registry.snapshot().count, 64)
})

test('trusted registry supplies only the bounded browser projection context', () => {
  let received = null
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{
      manifest: manifest(),
      createProjection(value) {
        received = value
        return projection()
      },
    }],
  })
  const reference = {
    ownerId: 'sigil',
    id: 'companion-renderer',
    digest,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
  }
  const handle = registry.resolve(reference)
  assert.ok(handle)
  assert.equal(handle.createProjection(context()).object !== null, true)
  assert.deepEqual(Object.keys(received).sort(), ['THREE', 'budgets', 'document'])
  assert.equal(Object.isFrozen(received), true)
  assert.equal(Object.isFrozen(received.budgets), true)

  for (const forbidden of ['renderer', 'camera', 'requestAnimationFrame', 'documentElement', 'fs', 'network', 'nativeBridge']) {
    assert.throws(
      () => handle.createProjection(context({ [forbidden]: {} })),
      /Unknown scene extension field/,
      forbidden,
    )
  }
  assert.throws(() => handle.createProjection(context({ THREE: { REVISION: '184' } })), /Three revision/)
  assert.throws(
    () => handle.createProjection(context({ budgets: budgets({ maxObjects: 65 }) })),
    /finite integer within its engine limit/,
  )
})

test('trusted registry rejects invalid projection factories after invocation', () => {
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{ manifest: manifest(), createProjection: () => ({ object: { isObject3D: true, traverse() {} } }) }],
  })
  const handle = registry.resolve({
    ownerId: 'sigil',
    id: 'companion-renderer',
    digest,
    sceneAbi: SCENE_EXTENSION_SCENE_ABI,
    threeRevision: SCENE_EXTENSION_THREE_REVISION,
  })
  assert.throws(() => handle.createProjection(context()), /requires applySignal/)
})

test('registry snapshots expose bounded metadata without factories, functions, or local paths', () => {
  const registry = createTrustedSceneExtensionRegistry({
    factories: [{ manifest: manifest(), createProjection: () => projection() }],
  })
  const snapshot = registry.snapshot()
  assert.equal(snapshot.count, 1)
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.extensions), true)
  assert.deepEqual(snapshot.extensions[0], manifest())
  assert.equal(JSON.stringify(snapshot).includes('/'), false)
  assert.equal(JSON.stringify(snapshot).includes('createProjection'), false)
  assert.equal(Object.values(snapshot.extensions[0]).some((value) => typeof value === 'function'), false)
})

test('scene extension contract has no loader, installer, authorization, or dynamic-import behavior', async () => {
  const source = await readFile(new URL('../../packages/toolkit/scene/scene-extension.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /node:fs|node:path|import\s*\(|authorize|install|sourcePath|localPath/u)
})
