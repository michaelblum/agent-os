import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneInteractionRuntime,
  sceneAffordanceRegionId,
} from '../../packages/toolkit/components/desktop-world-stage/scene-interaction-runtime.js'
import { canonicalInputRegionEvent } from '../lib/input-event-fixtures.mjs'

const document = {
  contract: 'aos.scene.document.v1',
  schemaVersion: 1,
  id: 'runtime-test',
  revision: 1,
  rootObjectId: 'root',
  objects: [
    { id: 'root', parentId: null, kind: 'group', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
    { id: 'body', parentId: 'root', kind: 'mesh', transform: { position: [100, 200, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
  ],
  resources: [],
  metadata: {},
}

const interactions = {
  contract: 'aos.scene.cartridge.interactions.v1',
  schemaVersion: 1,
  affordances: [{
    id: 'body-hit',
    objectId: 'body',
    geometry: { kind: 'rect', width: 80, height: 60, offset: [0, 0] },
    enabled: true,
    priority: 100,
    consumePolicy: 'captured',
    metadata: { label: 'Body' },
  }],
  interactions: [{
    id: 'drag-body',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
    response: { implementation: 'aos.scene.response.translate', parameters: { axis: 'both' } },
  }],
}

function harness({
  primary = true,
  register = async () => {},
  remove = async () => {},
  update = async () => {},
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  const calls = []
  const responses = []
  const events = []
  const outlet = {
    document: () => document,
    applyInteractionResponse(_key, event) {
      responses.push(event)
      return { ...event.response, applied: true, revision: 1 }
    },
  }
  const runtime = createDesktopWorldSceneInteractionRuntime({
    outlet,
    isPrimary: () => primary,
    topology: () => ({ displays: [{ displayId: 1, index: 0, bounds: [0, 0, 1000, 800] }] }),
    registerRegion: async (payload) => { calls.push(['register', payload.id]); await register(payload) },
    updateRegion: async (payload) => { calls.push(['update', payload.id]); await update(payload) },
    removeRegion: async (id) => { calls.push(['remove', id]); await remove(id) },
    scheduleFrame(callback) { callback() },
    scheduleTimer,
    emitEvent(event) { events.push(event) },
  })
  return { calls, events, outlet, responses, runtime }
}

function routed(regionId, type, x, y, sequenceValue) {
  return canonicalInputRegionEvent({
    regionId,
    ownerCanvasId: 'aos-desktop-world-stage',
    type,
    phase: type === 'left_mouse_down' ? 'down' : type === 'left_mouse_up' ? 'up' : 'drag',
    deliveryRole: type === 'left_mouse_down' ? 'owned' : 'captured',
    x,
    y,
    sequenceValue,
    gestureId: 'gesture-1',
  })
}

test('stage interaction runtime registers one owner-scoped region and applies the full drag lifecycle', async () => {
  const { calls, events, responses, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  assert.deepEqual(calls, [['register', regionId]])
  runtime.handleInput(routed(regionId, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(regionId, 'left_mouse_dragged', 140, 230, 2))
  const activeDevTools = runtime.devtoolsSnapshot()
  assert.deepEqual(activeDevTools.hitRegions, [{
    affordanceId: 'body-hit',
    frame: [60, 170, 80, 60],
    id: regionId,
    registered: true,
    resourceId: 'companion/main',
  }])
  assert.deepEqual(activeDevTools.affordances, [{
    enabled: true,
    id: 'body-hit',
    objectId: 'body',
    priority: 100,
    resourceId: 'companion/main',
  }])
  assert.equal(activeDevTools.gestures.length, 1)
  assert.equal(activeDevTools.gestures[0].kind, 'drag')
  assert.deepEqual(activeDevTools.interactions[0].recognizers, ['aos.scene.gesture.drag'])
  runtime.handleInput(routed(regionId, 'left_mouse_up', 150, 240, 3))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(responses.map(({ frame }) => frame.phase), ['start', 'update', 'end'])
  assert.deepEqual(responses[0].topology, { displays: [{ displayId: 1, index: 0, bounds: [0, 0, 1000, 800] }] })
  assert.deepEqual(events.map(({ event }) => event.gesture.phase), ['start', 'update', 'end'])
  assert.deepEqual(calls, [['register', regionId], ['update', regionId]])
  assert.equal(runtime.snapshot(key).leases[0].registered, 1)
})

test('secondary segments build the same region index without mutating daemon regions or duplicating events', async () => {
  const { calls, events, responses, runtime } = harness({ primary: false })
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  assert.deepEqual(calls, [])
  assert.equal(runtime.handleInput(routed(regionId, 'left_mouse_down', 100, 200, 1)), true)
  assert.equal(runtime.handleInput(routed(regionId, 'left_mouse_dragged', 120, 220, 2)), true)
  assert.equal(runtime.handleInput(routed(regionId, 'left_mouse_up', 120, 220, 3)), true)
  assert.equal(responses.length, 3)
  assert.deepEqual(events, [])
})

test('interaction leases remove and restore regions across suspension and topology changes', async () => {
  const { calls, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  await runtime.suspend(key)
  await runtime.resume(key)
  await runtime.topologyChanged()
  await runtime.release(key)

  assert.deepEqual(calls, [
    ['register', regionId],
    ['remove', regionId],
    ['register', regionId],
    ['update', regionId],
    ['remove', regionId],
  ])
  assert.deepEqual(runtime.snapshot().leases, [])
})

test('mounts without interaction documents remain backward compatible', async () => {
  const { calls, runtime } = harness()
  const snapshot = await runtime.mount({
    key: 'example.consumer::legacy',
    owner: 'example.consumer',
    resource: 'legacy',
    document,
  })
  assert.deepEqual(snapshot.leases, [])
  assert.deepEqual(calls, [])
})

test('release during delayed registration cannot leak a daemon input region', async () => {
  let finishRegistration
  const registration = new Promise((resolve) => { finishRegistration = resolve })
  const { calls, runtime } = harness({ register: () => registration })
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const mounting = runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  await new Promise((resolve) => setImmediate(resolve))
  const releasing = runtime.release(key)
  finishRegistration()
  await Promise.all([mounting, releasing])

  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id === regionId).length, 2)
  assert.deepEqual(runtime.snapshot().leases, [])
})

test('failed region cleanup remains visible and can be retried while suspended', async () => {
  let removalAttempts = 0
  const { runtime } = harness({
    remove: async () => {
      removalAttempts += 1
      if (removalAttempts === 1) throw new Error('region transport unavailable')
    },
  })
  const key = 'example.consumer::companion/main'
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  await assert.rejects(runtime.suspend(key), /input-region cleanup failed/u)
  assert.equal(runtime.snapshot(key).leases[0].suspended, true)
  assert.equal(runtime.snapshot(key).leases[0].registered, 1)

  assert.equal(await runtime.suspend(key), true)
  assert.equal(runtime.snapshot(key).leases[0].registered, 0)
})

test('translated hit-region refresh retries once without duplicating the gesture lifecycle', async () => {
  let updateAttempts = 0
  const { calls, runtime } = harness({
    update: async () => {
      updateAttempts += 1
      if (updateAttempts === 1) throw new Error('transient update failure')
    },
    scheduleTimer(callback) { queueMicrotask(callback); return 1 },
  })
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  runtime.handleInput(routed(regionId, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(regionId, 'left_mouse_dragged', 140, 230, 2))
  runtime.handleInput(routed(regionId, 'left_mouse_up', 150, 240, 3))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(updateAttempts, 2)
  assert.equal(runtime.snapshot(key).leases[0].regionSyncErrorCode, null)
  assert.deepEqual(calls.filter(([kind]) => kind === 'update'), [
    ['update', regionId],
    ['update', regionId],
  ])
})

test('accepted aim-and-commit release refreshes the destination hit region', async () => {
  const { calls, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const regionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const aimInteractions = structuredClone(interactions)
  aimInteractions.interactions[0].response = {
    implementation: 'aos.scene.response.aim-commit',
    parameters: { coordinates: 'world', durationMs: 220, easing: 'ease_out_quart', route: 'line' },
  }
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: aimInteractions })
  runtime.handleInput(routed(regionId, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(regionId, 'left_mouse_dragged', 260, 320, 2))
  runtime.handleInput(routed(regionId, 'left_mouse_up', 260, 320, 3))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(calls, [['register', regionId], ['update', regionId]])
})
