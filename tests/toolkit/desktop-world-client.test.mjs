import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneClient,
  listDesktopWorldResources,
  replayDesktopWorldSceneEvents,
  selectDesktopWorldResourceSnapshot,
} from '../../packages/toolkit/scene/desktop-world-client.js'

function stage() {
  return {
    contract: 'aos.desktop-world.devtools.stage.v1', sequence: 4, status: 'available',
    world: {
      displays: [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }],
      nodes: [{ id: 'body', resourceId: 'companion/main', position: [10, 20, 0] }, { id: 'other', resourceId: 'demo/item', position: [30, 40, 0] }],
      hitRegions: [], affordances: [], gestures: [], routes: [],
    },
    resources: [
      { id: 'companion/main', owner: 'example', sceneId: 'companion', revision: 2 },
      { id: 'demo/item', owner: 'example', sceneId: 'demo', revision: 1 },
    ],
    interactions: [], performance: {}, events: [],
  }
}

function devtoolsSnapshot() {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v1',
    schemaVersion: 1,
    session: {
      id: 'devtools-1', revision: 1, activeTab: 'world', selectedResource: null,
      filters: { query: '', eventKinds: [], errorsOnly: false }, recording: false, host: null,
    },
    stage: stage(),
  }
}

function gesture(phase, sequence, response = { kind: 'signal_graph', signals: [] }) {
  return {
    contract: 'aos.scene.event.v1', schemaVersion: 1, type: 'gesture', sequence,
    stageId: 'desktop-world/main', ownerId: 'example', resourceId: 'companion/main',
    affordanceId: 'body-aim', interactionId: 'aim-commit',
    gesture: {
      id: 'drag-1', kind: 'drag', phase, pointerSessionId: 'pointer-1',
      cancellationReason: phase === 'cancel' ? 'escape' : null,
    },
    coordinates: {
      origin: { x: 10, y: 20 }, previous: { x: 10, y: 20 }, current: { x: 30, y: 40 },
      desktopWorld: { x: 30, y: 40 }, native: { x: 30, y: 860 },
      delta: { x: 20, y: 20 }, totalDelta: { x: 20, y: 20 },
    },
    topology: null, response, at: sequence * 10,
  }
}

test('resource list and inspection remain bounded to the requested resource', () => {
  const listed = listDesktopWorldResources(stage())
  assert.deepEqual(listed.resources.map((entry) => entry.id), ['companion/main', 'demo/item'])
  const selected = selectDesktopWorldResourceSnapshot(stage(), 'companion/main')
  assert.deepEqual(selected.resources.map((entry) => entry.id), ['companion/main'])
  assert.deepEqual(selected.world.nodes.map((entry) => entry.id), ['body'])
  assert.throws(() => selectDesktopWorldResourceSnapshot(stage(), 'missing/item'), { code: 'SCENE_RESOURCE_NOT_FOUND' })
})

test('deterministic replay enforces sequence and complete gesture lifecycles', () => {
  const summary = replayDesktopWorldSceneEvents([
    gesture('start', 1),
    gesture('update', 2),
    gesture('end', 3, {
      kind: 'aim_commit', objectId: 'body', origin: { x: 10, y: 20 }, pointer: { x: 300, y: 400 },
      position: [300, 400, 0], angle: 0.92, distance: 478, route: 'line',
    }),
  ])
  assert.equal(summary.completedGestures, 1)
  assert.deepEqual(summary.finalPositions['companion/main'], [300, 400, 0])
  assert.throws(() => replayDesktopWorldSceneEvents([gesture('update', 1)]), { code: 'SCENE_REPLAY_LIFECYCLE_INVALID' })
  assert.throws(() => replayDesktopWorldSceneEvents([gesture('start', 2), gesture('end', 1)]), { code: 'SCENE_REPLAY_SEQUENCE_INVALID' })
  assert.throws(() => replayDesktopWorldSceneEvents([gesture('start', 1)]), { code: 'SCENE_REPLAY_INCOMPLETE' })
  assert.throws(() => replayDesktopWorldSceneEvents([
    gesture('start', 1),
    { ...gesture('end', 2), interactionId: 'changed-interaction' },
  ]), { code: 'SCENE_REPLAY_LIFECYCLE_INVALID' })
  assert.throws(() => replayDesktopWorldSceneEvents([{ ...gesture('end', 1), coordinates: undefined }]), { code: 'INVALID_SCENE_REPLAY_EVENT' })
  assert.throws(() => replayDesktopWorldSceneEvents([{ ...gesture('end', 1), productText: 'must not pass' }]), { code: 'INVALID_SCENE_REPLAY_EVENT' })
})

test('transport-injected client emits familiar scene actions without owning a socket', async () => {
  const requests = []
  const subscriptions = []
  const client = createDesktopWorldSceneClient({
    request(value) {
      requests.push(value)
      if (value.action === 'devtools_open') return { session: { session: { id: 'devtools-1', revision: 1 } } }
      if (value.action === 'devtools_status') return { session: devtoolsSnapshot() }
      return value
    },
    subscribe(value) { subscriptions.push(value); return value },
  })
  await client.list()
  await client.inspect('companion/main')
  await client.perf('companion/main')
  client.monitor('companion/main', { follow: true, action: 'must-not-win', data: {} })
  await client.devtools.open({ resource: 'companion/main' })
  await client.devtools.update('devtools-1', 2, { recording: true })
  await client.devtools.close('devtools-1', 3)

  assert.deepEqual(requests.map((entry) => entry.action), [
    'devtools_open', 'devtools_status', 'devtools_close',
    'devtools_open', 'devtools_status', 'devtools_close',
    'devtools_open', 'devtools_status', 'devtools_close',
    'devtools_open', 'devtools_update', 'devtools_close',
  ])
  assert.equal(subscriptions[0].action, 'devtools_monitor')
  assert.equal(subscriptions[0].data.resource, 'companion/main')
})
