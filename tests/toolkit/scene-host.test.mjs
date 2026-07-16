import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
  SCENE_DOCUMENT_CONTRACT_ID,
  SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
  SCENE_TRANSACTION_CONTRACT_ID,
  createDesktopWorldSceneHost,
  createLocalSceneViewportHost,
  createSceneImplementationRegistry,
  createSceneLease,
} from '../../packages/toolkit/scene/index.js'

function document() {
  return {
    contract: SCENE_DOCUMENT_CONTRACT_ID,
    schemaVersion: 1,
    id: 'companion/main',
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
        components: [
          {
            id: 'signal/audio',
            implementation: SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
            parameters: {
              signalId: 'audio.rms',
              target: 'material.emissiveIntensity',
              inputMin: 0,
              inputMax: 1,
              outputMin: 0,
              outputMax: 2,
              smoothingMs: 0,
              clamp: true,
            },
            enabled: true,
          },
          {
            id: 'animation/rotation',
            implementation: SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
            parameters: {
              target: 'transform.rotationY',
              from: 0,
              to: 1,
              durationMs: 1_000,
              delayMs: 0,
              playback: 'ping_pong',
              easing: 'linear',
            },
            enabled: true,
          },
        ],
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
        parameters: { color: '#bc13fe' },
        asset: null,
      },
    ],
    metadata: { privateLabel: 'not exposed by inspection' },
  }
}

function lease() {
  return createSceneLease({
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    scopeId: 'connection/fixture',
  })
}

function registry(events) {
  const value = createSceneImplementationRegistry()
  value.register({
    id: 'three.geometry.box',
    kind: 'geometry',
    create: ({ descriptor }) => events.push(`create:${descriptor.id}`),
  })
  value.register({
    id: 'three.material.physical',
    kind: 'material',
    create: ({ descriptor }) => events.push(`create:${descriptor.id}`),
  })
  return value
}

function projectionFactory(events, options = {}) {
  return async (context) => {
    if (options.failRevision === context.document.revision) throw new Error('fixture projection failure')
    for (const resource of context.document.resources) {
      context.registry.resolve(resource.implementation, resource.kind).create({ descriptor: resource })
    }
    const revision = context.document.revision
    const lifecycle = {
      start: () => events.push(`lifecycle:start:${revision}`),
      suspend: () => events.push(`lifecycle:suspend:${revision}`),
      resume: () => events.push(`lifecycle:resume:${revision}`),
      snapshot: () => ({ revision, state: 'fixture' }),
      dispose: () => events.push(`lifecycle:dispose:${revision}`),
    }
    return {
      scene: { revision },
      camera: { revision },
      renderer: { setSize() {} },
      lifecycle,
      activate: () => events.push(`activate:${revision}`),
      suspend: () => events.push(`suspend:${revision}`),
      resume: () => events.push(`resume:${revision}`),
      contextLost: () => events.push(`context-lost:${revision}`),
      applyAnimation: (_binding, value) => events.push(`animation:${revision}:${value}`),
      applySignal: (_binding, value) => events.push(`signal:${revision}:${value}`),
      dispose: () => events.push(`dispose:${revision}`),
    }
  }
}

function transaction(expectedRevision = 1) {
  return {
    contract: SCENE_TRANSACTION_CONTRACT_ID,
    transactionId: `transaction-${expectedRevision}`,
    stageId: 'desktop-world/main',
    ownerId: 'io.ch-osctrl.sigil',
    resourceId: 'companion/main',
    expectedRevision,
    operations: [{
      op: 'set_property',
      objectId: 'body/alpha',
      path: 'transform.scale',
      value: [1.2, 1.2, 1.2],
    }],
  }
}

test('local viewport host applies atomic transactions, signals, recovery, and disposal', async () => {
  const events = []
  const host = createLocalSceneViewportHost({
    document: document(),
    lease: lease(),
    registry: registry(events),
    prepareProjection: projectionFactory(events),
  })

  assert.equal((await host.mount()).ok, true)
  assert.equal(host.snapshot().status, 'ready')
  assert.equal(host.publishSignal('audio.rms', 0.5, 100), 1)
  assert.ok(events.includes('signal:1:1'))
  assert.equal(host.tick(500), 1)
  assert.ok(events.includes('animation:1:0.5'))

  const committed = await host.transact(transaction())
  assert.equal(committed.ok, true)
  assert.equal(committed.revision, 2)
  assert.ok(events.indexOf('activate:2') < events.indexOf('dispose:1'))
  assert.equal((await host.transact(transaction())).code, 'scene_revision_conflict')
  assert.equal(host.snapshot().status, 'ready')
  assert.equal(host.snapshot().revision, 2)

  assert.equal(host.suspend().status, 'suspended')
  assert.equal(host.publishSignal('audio.rms', 1, 200), 0)
  assert.equal(host.tick(750), 0)
  assert.equal(host.resume().status, 'ready')
  assert.equal(host.markContextLost().status, 'context_lost')
  const recovered = await host.recoverContext()
  assert.equal(recovered.ok, true)
  assert.equal(host.snapshot().recoveries, 1)

  const inspection = host.inspect()
  assert.equal(inspection.contract, 'aos.scene.inspection.v1')
  assert.equal(inspection.objects.length, 2)
  assert.deepEqual(inspection.metadataKeys, ['privateLabel'])
  assert.doesNotMatch(JSON.stringify(inspection), /not exposed by inspection/u)

  const disposed = await host.dispose()
  assert.equal(disposed.status, 'disposed')
  assert.deepEqual(await host.dispose(), disposed)
  assert.equal(host.publishSignal('audio.rms', 1), 0)
})

test('failed candidate preparation preserves the active revision and projection', async () => {
  const events = []
  const host = createLocalSceneViewportHost({
    document: document(),
    lease: lease(),
    registry: registry(events),
    prepareProjection: projectionFactory(events, { failRevision: 2 }),
  })
  await host.mount()
  const result = await host.transact(transaction())
  assert.equal(result.ok, false)
  assert.equal(result.code, 'scene_projection_prepare_failed')
  assert.doesNotMatch(JSON.stringify(result), /fixture projection failure/u)
  assert.equal(host.snapshot().revision, 1)
  assert.equal(host.snapshot().status, 'ready')
  assert.ok(!events.includes('dispose:1'))
  await host.dispose()
})

test('host budgets and implementation coverage fail before projection work', async () => {
  const events = []
  const missingRegistry = createSceneImplementationRegistry()
  const missing = createLocalSceneViewportHost({
    document: document(),
    lease: lease(),
    registry: missingRegistry,
    prepareProjection: projectionFactory(events),
  })
  assert.equal((await missing.mount()).code, 'scene_implementation_unavailable')
  assert.deepEqual(events, [])

  const bounded = createLocalSceneViewportHost({
    document: document(),
    lease: lease(),
    registry: registry(events),
    prepareProjection: projectionFactory(events),
    budgets: { maxObjects: 1 },
  })
  assert.equal((await bounded.mount()).code, 'scene_host_object_budget')
  assert.deepEqual(events, [])
})

test('DesktopWorld host mounts the same projection and stops its surface once', async () => {
  const events = []
  const surface = {
    start: async () => events.push('surface:start'),
    mountScene: ({ scene }) => events.push(`surface:mount:${scene.revision}`),
    refreshViewport: () => events.push('surface:refresh'),
    stop: () => events.push('surface:stop'),
  }
  const host = createDesktopWorldSceneHost({
    document: document(),
    lease: lease(),
    registry: registry(events),
    prepareProjection: projectionFactory(events),
    surface,
  })
  assert.equal((await host.mount()).ok, true)
  assert.deepEqual(events.filter((event) => event.startsWith('surface:')), [
    'surface:start',
    'surface:mount:1',
    'surface:refresh',
  ])
  await host.dispose()
  await host.dispose()
  assert.equal(events.filter((event) => event === 'surface:stop').length, 1)
})
