import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
  SCENE_DOCUMENT_CONTRACT_ID,
  SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
  SCENE_TRANSACTION_CONTRACT_ID,
  applySceneTransaction,
  canonicalizeSceneDocument,
  compileSceneAnimationBindings,
  compileSceneSignalBindings,
  createSceneAnimationController,
  createSceneImplementationRegistry,
  createSceneLease,
  createSceneSignalController,
  sceneDocumentRequiredImplementations,
  validateSceneDocument,
  validateSceneTransaction,
} from '../../packages/toolkit/scene/index.js'

function sceneDocument() {
  return {
    contract: SCENE_DOCUMENT_CONTRACT_ID,
    schemaVersion: 1,
    id: 'fixture/main',
    revision: 1,
    rootObjectId: 'root',
    objects: [
      {
        id: 'root',
        parentId: null,
        kind: 'group',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        geometryId: null,
        materialId: null,
        components: [],
      },
      {
        id: 'body/alpha',
        parentId: 'root',
        kind: 'mesh',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        geometryId: 'geometry/box',
        materialId: 'material/alpha',
        components: [{
          id: 'motion/rotate',
          implementation: 'aos.motion.rotate',
          parameters: { axis: [0, 1, 0], radiansPerSecond: 0.12 },
          enabled: true,
        }],
      },
    ],
    resources: [
      {
        id: 'geometry/box',
        kind: 'geometry',
        implementation: 'three.geometry.box',
        parameters: { width: 1, height: 1, depth: 1 },
        asset: null,
      },
      {
        id: 'material/alpha',
        kind: 'material',
        implementation: 'three.material.physical',
        parameters: { color: '#bc13fe', opacity: 0.88 },
        asset: null,
      },
    ],
    metadata: { seed: 23 },
  }
}

test('scene document validates a bounded declarative object graph', () => {
  const document = sceneDocument()
  assert.deepEqual(validateSceneDocument(document), { ok: true, errors: [] })
  assert.deepEqual(sceneDocumentRequiredImplementations(document), [
    'aos.motion.rotate',
    'three.geometry.box',
    'three.material.physical',
  ])
  assert.deepEqual(canonicalizeSceneDocument({ ...document, metadata: { z: 1, a: 2 } }).metadata, { a: 2, z: 1 })
})

test('scene document rejects cycles, missing resources, executable values, and unknown fields', () => {
  const document = sceneDocument()
  document.objects[0].parentId = 'body/alpha'
  document.objects[1].geometryId = 'geometry/missing'
  document.objects[1].components[0].parameters.callback = () => {}
  document.remoteScript = 'https://example.test/scene.js'
  const result = validateSceneDocument(document)
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.code === 'object_cycle'))
  assert.ok(result.errors.some((error) => error.code === 'resource_reference'))
  assert.ok(result.errors.some((error) => error.code === 'parameter_type'))
  assert.ok(result.errors.some((error) => error.code === 'unknown_field'))
})

test('scene document returns structured errors for malformed entries and non-JSON objects', () => {
  for (const malformed of [null, 42, 'object']) {
    const document = sceneDocument()
    document.objects[1] = malformed
    assert.doesNotThrow(() => validateSceneDocument(document))
    assert.ok(validateSceneDocument(document).errors.some((error) => error.code === 'invalid_object'))
  }

  const document = sceneDocument()
  document.metadata.createdAt = new Date()
  assert.ok(validateSceneDocument(document).errors.some((error) => error.code === 'parameter_type'))
})

test('scene document bounds aggregate assets and does not traverse oversized graphs', () => {
  const document = sceneDocument()
  document.resources.push(...Array.from({ length: 4 }, (_, index) => ({
    id: `texture/${index}`,
    kind: 'texture',
    implementation: 'three.texture.image',
    parameters: {},
    asset: {
      sha256: index.toString(16).padStart(64, '0'),
      mediaType: 'image/png',
      bytes: 64 * 1024 * 1024,
    },
  })), {
    id: 'texture/overflow',
    kind: 'texture',
    implementation: 'three.texture.image',
    parameters: {},
    asset: {
      sha256: 'f'.repeat(64),
      mediaType: 'image/png',
      bytes: 1,
    },
  })
  assert.ok(validateSceneDocument(document).errors.some((error) => error.code === 'asset_total_size'))

  const inaccessible = new Proxy({}, {
    get() {
      throw new Error('oversized scene objects must not be traversed')
    },
  })
  const result = validateSceneDocument({
    ...sceneDocument(),
    objects: Array(1025).fill(inaccessible),
  })
  assert.ok(result.errors.some((error) => error.code === 'object_count'))
})

test('scene transactions are owner scoped and revision checked', () => {
  const transaction = {
    contract: SCENE_TRANSACTION_CONTRACT_ID,
    transactionId: 'transaction-1',
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    expectedRevision: 4,
    operations: [{
      op: 'set_property',
      objectId: 'body/alpha',
      path: 'transform.scale',
      value: [1.1, 1.1, 1.1],
    }],
  }
  assert.deepEqual(validateSceneTransaction(transaction), { ok: true, errors: [] })
  assert.equal(validateSceneTransaction({ ...transaction, expectedRevision: -1 }).ok, false)
})

test('scene transactions apply atomically and leave rejected candidates unchanged', () => {
  const document = { ...sceneDocument(), id: 'companion/main' }
  const lease = createSceneLease({
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    scopeId: 'connection/42',
  })
  const transaction = {
    contract: SCENE_TRANSACTION_CONTRACT_ID,
    transactionId: 'transaction-2',
    stageId: lease.stageId,
    ownerId: lease.ownerId,
    resourceId: lease.resourceId,
    expectedRevision: 1,
    operations: [{
      op: 'set_property',
      objectId: 'body/alpha',
      path: 'transform.scale',
      value: [1.2, 1.2, 1.2],
    }],
  }
  const applied = applySceneTransaction(document, transaction, { lease })
  assert.equal(applied.ok, true)
  assert.equal(applied.document.revision, 2)
  assert.deepEqual(applied.document.objects[1].transform.scale, [1.2, 1.2, 1.2])
  assert.deepEqual(document.objects[1].transform.scale, [1, 1, 1])

  const rejected = applySceneTransaction(document, {
    ...transaction,
    operations: [{ op: 'remove_resource', resourceId: 'geometry/box' }],
  }, { lease })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'scene_transaction_result_invalid')
  assert.equal(document.resources.length, 2)

  assert.equal(applySceneTransaction(document, {
    ...transaction,
    ownerId: 'io.example.other',
  }, { lease }).code, 'scene_transaction_lease_mismatch')
})

test('scene registry and numeric signal bindings fail closed', () => {
  const document = { ...sceneDocument(), id: 'companion/main' }
  document.objects[1].components.push({
    id: 'signal/audio',
    implementation: SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
    parameters: {
      signalId: 'audio.rms',
      target: 'material.emissiveIntensity',
      inputMin: 0,
      inputMax: 1,
      outputMin: 0.2,
      outputMax: 1.2,
      smoothingMs: 0,
      clamp: true,
    },
    enabled: true,
  })
  const registry = createSceneImplementationRegistry()
  registry.register({ id: 'three.geometry.box', kind: 'geometry', create: () => ({}) })
  registry.register({ id: 'three.material.physical', kind: 'material', create: () => ({}) })
  registry.register({ id: 'aos.motion.rotate', kind: 'component', create: () => ({}) })
  assert.deepEqual(registry.validateDocument(document), {
    ok: true,
    errors: [],
    missing: [],
    mismatched: [],
  })
  assert.equal(registry.validateDocument(null).ok, false)
  assert.equal(compileSceneSignalBindings(document).bindings.length, 1)

  const values = []
  const controller = createSceneSignalController(document, {
    apply: (_binding, value) => values.push(value),
    now: () => 10,
  })
  assert.equal(controller.publish('audio.rms', 0.5), 1)
  assert.deepEqual(values, [0.7])
  assert.equal(controller.publish('audio.rms', Number.NaN), 0)
  assert.equal(controller.dispose(), true)
  assert.equal(controller.publish('audio.rms', 1), 0)

  document.objects[1].components.at(-1).parameters.smoothingMs = 100
  const smoothed = []
  const smoothController = createSceneSignalController(document, {
    apply: (_binding, value, _input, at) => smoothed.push({ at, value }),
  })
  assert.equal(smoothController.publish('audio.rms', 0, 100), 1)
  assert.equal(smoothController.publish('audio.rms', 1, 200), 1)
  assert.equal(smoothController.publish('audio.rms', 0, 150), 1)
  assert.equal(smoothed.at(-1).at, 200)
  assert.equal(smoothed.at(-1).value, smoothed.at(-2).value)

  const failingController = createSceneSignalController(document, {
    apply: () => { throw new Error('sensitive projection detail') },
  })
  assert.equal(failingController.publish('audio.rms', 0.5, 300), 0)
  assert.equal(failingController.snapshot().failures, 1)
  assert.doesNotMatch(JSON.stringify(failingController.snapshot()), /sensitive projection detail/u)

  document.objects[1].components.at(-1).parameters.remoteScript = 'https://example.test/a.js'
  assert.equal(compileSceneSignalBindings(document).ok, false)
})

test('scene animation bindings use an explicit deterministic elapsed clock', () => {
  const document = sceneDocument()
  document.objects[1].components.push({
    id: 'animation/pulse',
    implementation: SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
    parameters: {
      target: 'material.emissiveIntensity',
      from: 0,
      to: 2,
      durationMs: 1_000,
      delayMs: 100,
      playback: 'ping_pong',
      easing: 'linear',
    },
    enabled: true,
  })
  assert.equal(compileSceneAnimationBindings(document).bindings.length, 1)
  const values = []
  const controller = createSceneAnimationController(document, {
    apply: (_binding, value) => values.push(value),
  })
  assert.equal(controller.tick(100), 1)
  assert.equal(controller.tick(600), 1)
  assert.equal(controller.tick(1_600), 1)
  assert.deepEqual(values, [0, 1, 1])
  assert.equal(controller.tick(-1), 0)
  assert.equal(controller.dispose(), true)

  const failingController = createSceneAnimationController(document, {
    apply: () => { throw new Error('sensitive animation detail') },
  })
  assert.equal(failingController.tick(500), 0)
  assert.equal(failingController.snapshot().failures, 1)
  assert.equal(failingController.snapshot().frames, 0)
  assert.doesNotMatch(JSON.stringify(failingController.snapshot()), /sensitive animation detail/u)

  document.objects[1].components.at(-1).parameters.playback = 'random'
  assert.equal(compileSceneAnimationBindings(document).ok, false)
})

test('scene leases preserve stage, owner, resource, and scope identity', () => {
  assert.deepEqual(createSceneLease({
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    scopeId: 'connection/42',
  }), {
    contract: 'aos.scene.lease.v1',
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    scopeId: 'connection/42',
  })
})
