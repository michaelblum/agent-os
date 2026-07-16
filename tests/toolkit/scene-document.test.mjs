import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_DOCUMENT_CONTRACT_ID,
  SCENE_TRANSACTION_CONTRACT_ID,
  canonicalizeSceneDocument,
  createSceneLease,
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
