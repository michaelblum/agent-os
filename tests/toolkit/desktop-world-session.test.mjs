import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneSession,
} from '../../packages/toolkit/scene/desktop-world-session.js'

const identity = Object.freeze({
  stageId: 'desktop-world/main',
  ownerId: 'example.consumer',
  resourceId: 'companion/main',
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, reject, resolve }
}

function scene(revision = 1) {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id: identity.resourceId,
    revision,
    rootObjectId: 'root',
    objects: [{
      id: 'root', parentId: null, kind: 'group',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true, geometryId: null, materialId: null, components: [],
    }],
    resources: [],
    metadata: {},
  }
}

function interactions() {
  return {
    contract: 'aos.scene.cartridge.interactions.v1',
    schemaVersion: 1,
    affordances: [],
    interactions: [],
  }
}

function interactiveScene() {
  return {
    ...scene(),
    objects: [
      ...scene().objects,
      {
        id: 'body', parentId: 'root', kind: 'group',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true, geometryId: null, materialId: null, components: [],
      },
    ],
  }
}

function interactiveInteractions() {
  return {
    contract: 'aos.scene.cartridge.interactions.v1',
    schemaVersion: 1,
    affordances: [{
      id: 'body', objectId: 'body', geometry: { kind: 'rect', width: 100, height: 100, offset: [0, 0] },
      enabled: true, priority: 100, consumePolicy: 'captured', metadata: {},
    }],
    interactions: [{
      id: 'move-body', affordanceId: 'body',
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { button: 0, threshold: 4 } },
      response: { implementation: 'aos.scene.response.translate', parameters: { coordinates: 'world' } },
    }],
  }
}

function transaction(expectedRevision = 1) {
  return {
    contract: 'aos.scene.transaction.v1',
    transactionId: `transaction.${expectedRevision}`,
    stageId: identity.stageId,
    ownerId: identity.ownerId,
    resourceId: identity.resourceId,
    expectedRevision,
    operations: [{
      op: 'set_property', objectId: 'root', path: 'transform.position', value: [20, 30, 0],
    }],
  }
}

function gesture(sequence = 1) {
  return {
    contract: 'aos.scene.event.v1', schemaVersion: 1, type: 'gesture', sequence,
    ...identity,
    affordanceId: 'body-aim', interactionId: 'aim-commit',
    gesture: {
      id: 'drag-1', kind: 'drag', phase: 'start', pointerSessionId: 'pointer-1', cancellationReason: null,
    },
    coordinates: {
      origin: { x: 10, y: 20 }, previous: { x: 10, y: 20 }, current: { x: 30, y: 40 },
      desktopWorld: { x: 30, y: 40 }, native: { x: 30, y: 860 },
      delta: { x: 20, y: 20 }, totalDelta: { x: 20, y: 20 },
    },
    topology: null,
    response: { kind: 'signal_graph', signals: [] },
    at: sequence,
  }
}

function fakeTransportFactory(options = {}) {
  const transports = []
  const connect = async (sessionIdentity) => {
    const completion = deferred()
    const subscriptions = new Map()
    const transport = {
      identity: sessionIdentity,
      operations: [],
      subscriptions,
      completed: completion.promise,
      async send(operation) {
        transport.operations.push(operation)
        if (options.send) return options.send({ operation, transport, transports })
        return { operation: operation.op, resource: identity.resourceId, status: 'ok' }
      },
      async subscribe(eventName, listener) {
        transport.operations.push({ op: 'subscribe', events: [eventName] })
        subscriptions.set(eventName, listener)
        return async () => {
          transport.operations.push({ op: 'unsubscribe', events: [eventName] })
          subscriptions.delete(eventName)
        }
      },
      async close() {
        completion.resolve({ status: 'closed' })
      },
      disconnect(error = Object.assign(new Error('closed'), { code: 'SCENE_TRANSPORT_CLOSED' })) {
        completion.reject(error)
      },
      emit(eventName, event) {
        subscriptions.get(eventName)?.(event)
      },
    }
    transports.push(transport)
    return transport
  }
  return { connect, transports }
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(message)
}

test('scene session serializes operations and commits only acknowledged structural state', async () => {
  const mountGate = deferred()
  const fixture = fakeTransportFactory({
    async send({ operation }) {
      if (operation.op === 'mount') await mountGate.promise
      return { operation: operation.op, resource: identity.resourceId, status: 'ok' }
    },
  })
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  const mounting = session.mount({ document: scene(), interactions: interactions() })
  const inspecting = session.inspect()
  await waitFor(() => fixture.transports.length === 1 && fixture.transports[0].operations.length === 1, 'mount did not start')
  assert.deepEqual(fixture.transports[0].operations.map((entry) => entry.op), ['mount'])
  assert.equal(session.snapshot().committedRevision, null)
  mountGate.resolve()
  await mounting
  await inspecting
  assert.deepEqual(fixture.transports[0].operations.map((entry) => entry.op), ['mount', 'inspect'])
  assert.equal(session.snapshot().committedRevision, 1)

  await session.transact(transaction())
  assert.equal(session.snapshot().committedRevision, 2)
  assert.equal(fixture.transports[0].operations.at(-1).lease.ownerId, identity.ownerId)
  await session.signal('audio.rms', 0.5, 42)
  await session.play('idle-spin')
  await session.suspend()
  assert.equal(session.snapshot().suspended, true)
  await session.resume()
  await session.remove()
  assert.equal(session.snapshot().mounted, false)
  assert.equal((await session.close()).status, 'closed')
  assert.equal((await session.close()).status, 'closed')
})

test('scene session validates non-empty interactions against the mounted document', async () => {
  const fixture = fakeTransportFactory()
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  await session.mount({ document: interactiveScene(), interactions: interactiveInteractions() })
  assert.equal(session.snapshot().committedRevision, 1)
  await session.close()
})

test('scene session restores committed mount, suspension, and subscriptions once', async () => {
  const fixture = fakeTransportFactory()
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  const received = []
  await session.mount({ document: scene(), interactions: interactions() })
  await session.subscribe('gesture', (event) => received.push(event.sequence))
  await session.suspend()
  fixture.transports[0].disconnect()
  await waitFor(() => session.snapshot().status === 'ready' && fixture.transports.length === 2, 'session did not recover')

  assert.deepEqual(fixture.transports[1].operations.map((entry) => entry.op), ['mount', 'subscribe', 'suspend'])
  assert.equal(session.snapshot().recoveryAttempts, 1)
  fixture.transports[0].emit('gesture', gesture(1))
  fixture.transports[1].emit('gesture', gesture(1))
  assert.deepEqual(received, [1])
  await session.close()
})

test('scene session remounts canonical state but never replays an uncertain operation', async () => {
  let failed = false
  const fixture = fakeTransportFactory({
    async send({ operation, transport }) {
      if (operation.op === 'signal' && !failed) {
        failed = true
        transport.disconnect()
        throw Object.assign(new Error('lost acknowledgement'), { code: 'SCENE_TRANSPORT_CLOSED' })
      }
      return { operation: operation.op, resource: identity.resourceId, status: 'ok' }
    },
  })
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  await session.mount({ document: scene(), interactions: interactions() })
  await assert.rejects(session.signal('audio.rms', 0.7), { code: 'SCENE_OPERATION_UNCERTAIN' })
  assert.equal(fixture.transports.length, 2)
  assert.deepEqual(fixture.transports[1].operations.map((entry) => entry.op), ['mount'])
  assert.equal(session.snapshot().status, 'ready')
  await session.close()
})

test('scene session fails terminally after its single recovery budget is spent', async () => {
  const fixture = fakeTransportFactory()
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  await session.mount({ document: scene(), interactions: interactions() })
  fixture.transports[0].disconnect()
  await waitFor(() => fixture.transports.length === 2 && session.snapshot().status === 'ready', 'first recovery did not finish')
  fixture.transports[1].disconnect()
  await waitFor(() => session.snapshot().status === 'faulted', 'second disconnect did not fault')
  await assert.rejects(session.inspect(), { code: 'SCENE_SESSION_FAULTED' })
})

test('scene session faults on malformed transport results and non-monotonic events', async () => {
  const invalidResult = fakeTransportFactory({
    async send({ operation }) {
      return { operation: operation.op, resource: 'other/resource', status: 'ok' }
    },
  })
  const malformed = createDesktopWorldSceneSession({ ...identity, connect: invalidResult.connect })
  await assert.rejects(malformed.inspect(), { code: 'SCENE_SESSION_FAULTED' })
  assert.equal(malformed.snapshot().lastErrorCode, 'SCENE_SESSION_INVALID_RESULT')

  const fixture = fakeTransportFactory()
  const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
  await session.subscribe('gesture', () => {})
  fixture.transports[0].emit('gesture', gesture(2))
  fixture.transports[0].emit('gesture', gesture(1))
  await waitFor(() => session.snapshot().status === 'faulted', 'invalid sequence did not fault')
  assert.equal(session.snapshot().lastErrorCode, 'SCENE_SESSION_INVALID_EVENT')
})

test('scene session fails closed on malformed and flooding transport output', async () => {
  for (const code of ['AOS_INVALID_NDJSON', 'AOS_EVENT_RATE_LIMIT']) {
    const fixture = fakeTransportFactory({
      async send() {
        throw Object.assign(new Error('unsafe transport output'), { code })
      },
    })
    const session = createDesktopWorldSceneSession({ ...identity, connect: fixture.connect })
    await assert.rejects(session.inspect(), { code: 'SCENE_SESSION_FAULTED' })
    assert.equal(session.snapshot().status, 'faulted')
    assert.equal(session.snapshot().lastErrorCode, code)
    assert.equal(fixture.transports.length, 1)
  }
})
