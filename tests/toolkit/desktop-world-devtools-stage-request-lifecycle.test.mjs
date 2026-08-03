import assert from 'node:assert/strict'
import test from 'node:test'

import { createDesktopWorldDevToolsRequestLifecycle } from '../../packages/toolkit/components/desktop-world-stage/devtools-request-lifecycle.js'
import { createDesktopWorldDevToolsStageProbe } from '../../packages/toolkit/scene/desktop-world-devtools.js'

function deferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

function identity(topologyGeneration, displayId = 'main', displayIndex = 0) {
  return { canvasGeneration: 3, topologyGeneration, displayId, displayIndex }
}

function stageFacts(current) {
  return {
    status: 'available',
    world: {
      displays: [{ id: current.displayId, index: current.displayIndex, bounds: [0, 0, 100, 100], scaleFactor: 1 }],
      nodes: [],
      hitRegions: [],
      affordances: [],
      gestures: [],
      routes: [],
    },
    resources: [],
    interactions: [],
  }
}

function harness(options = {}) {
  const emitted = []
  let current = identity(4)
  const probe = createDesktopWorldDevToolsStageProbe({
    emit: (snapshot, metadata) => emitted.push({ snapshot, metadata }),
    getPerformanceDisplay: () => ({
      displayId: current.displayId,
      displayIndex: current.displayIndex,
    }),
    getStageFacts: () => stageFacts(current),
    getStageIdentity: () => ({
      canvasGeneration: current.canvasGeneration,
      topologyGeneration: current.topologyGeneration,
    }),
  })
  const requests = createDesktopWorldDevToolsRequestLifecycle({
    getIdentity: () => current,
    probe,
    ...options,
  })
  probe.configure({ enabled: true })
  requests.configure({ enabled: true })
  requests.identityReady(current)
  return {
    emitted,
    probe,
    requests,
    setIdentity(next) { current = next },
  }
}

test('correlated stage request waits for queued topology reconfiguration and emits exactly once', async () => {
  const testHarness = harness()
  const reconfiguration = deferred()
  const next = identity(5)
  testHarness.setIdentity(next)
  testHarness.requests.identityChanging(next)
  const queued = reconfiguration.promise.then(() => {
    testHarness.requests.identityReady(next, () => {
      testHarness.probe.recordEvent({ kind: 'topology.changed' })
    })
  })

  assert.equal(testHarness.requests.request('refresh-closed'), true)
  assert.equal(testHarness.emitted.length, 0, 'closed identity published a premature snapshot')
  reconfiguration.resolve()
  await queued

  assert.deepEqual(testHarness.emitted.map(({ metadata }) => metadata), [
    { request_id: 'refresh-closed' },
  ])
  assert.equal(testHarness.emitted[0].snapshot.topologyGeneration, 5)
  assert.equal(testHarness.emitted[0].snapshot.events.at(-1).kind, 'topology.changed')
  assert.equal(testHarness.requests.request('refresh-closed'), true)
  assert.equal(testHarness.emitted.length, 1, 'duplicate request ID emitted twice')
})

test('topology replacement retires pending requests bound to the superseded identity', () => {
  const testHarness = harness()
  const replaced = identity(5)
  testHarness.setIdentity(replaced)
  testHarness.requests.identityChanging(replaced)
  assert.equal(testHarness.requests.request('refresh-replaced'), true)

  const successor = identity(6)
  testHarness.setIdentity(successor)
  testHarness.requests.identityChanging(successor)
  assert.equal(testHarness.requests.state().pendingRequestCount, 0)
  assert.equal(testHarness.requests.identityReady(successor), true)
  assert.equal(testHarness.requests.request('refresh-replaced'), true)
  assert.equal(testHarness.emitted.length, 0)
})

test('pending request admission is bounded, deduplicated, and cleared by disable and disposal', () => {
  const testHarness = harness({ handledRequestLimit: 4, pendingRequestLimit: 2 })
  const next = identity(5)
  testHarness.setIdentity(next)
  testHarness.requests.identityChanging(next)

  assert.equal(testHarness.requests.request('refresh-a'), true)
  assert.equal(testHarness.requests.request('refresh-a'), true)
  assert.equal(testHarness.requests.request('refresh-b'), true)
  assert.equal(testHarness.requests.request('refresh-overflow'), false)
  assert.equal(testHarness.requests.state().pendingRequestCount, 2)
  assert.equal(testHarness.requests.identityReady(next), true)
  assert.deepEqual(testHarness.emitted.map(({ metadata }) => metadata.request_id), ['refresh-a', 'refresh-b'])

  const later = identity(6)
  testHarness.setIdentity(later)
  testHarness.requests.identityChanging(later)
  assert.equal(testHarness.requests.request('refresh-disabled'), true)
  testHarness.probe.configure({ enabled: false })
  testHarness.requests.configure({ enabled: false })
  assert.equal(testHarness.requests.state().pendingRequestCount, 0)

  testHarness.probe.configure({ enabled: true })
  testHarness.requests.configure({ enabled: true })
  assert.equal(testHarness.requests.identityReady(later), true)
  assert.equal(testHarness.requests.request('refresh-disabled'), true)
  assert.equal(testHarness.emitted.length, 2)
  testHarness.requests.identityChanging(later)
  assert.equal(testHarness.requests.request('refresh-disposed'), true)
  assert.equal(testHarness.requests.dispose(), true)
  assert.equal(testHarness.requests.identityReady(later), false)
  assert.equal(testHarness.requests.state().pendingRequestCount, 0)
  assert.equal(testHarness.emitted.length, 2)
})
