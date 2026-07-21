import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneClient,
  listDesktopWorldResources,
  replayDesktopWorldSceneEvents,
  selectDesktopWorldResourceSnapshot,
} from '../../packages/toolkit/scene/desktop-world-client.js'

function stage({ position = [10, 20, 0], sequence = 4 } = {}) {
  return {
    contract: 'aos.desktop-world.devtools.stage.v1', sequence, status: 'available',
    world: {
      displays: [{ id: 'main', index: 0, bounds: [0, 0, 1440, 900] }],
      nodes: [{ id: 'body', resourceId: 'companion/main', position }, { id: 'other', resourceId: 'demo/item', position: [30, 40, 0] }],
      hitRegions: [], affordances: [], gestures: [], routes: [],
    },
    resources: [
      { id: 'companion/main', owner: 'example', sceneId: 'companion', revision: 2 },
      { id: 'demo/item', owner: 'example', sceneId: 'demo', revision: 1 },
    ],
    interactions: [], performance: {}, events: [],
  }
}

function devtoolsSnapshot({
  stageSnapshotReady = true,
  stageSnapshotRevision = 1,
  stageValue = stage(),
} = {}) {
  return {
    contract: 'aos.desktop-world.devtools.snapshot.v1',
    schemaVersion: 1,
    stageSnapshotRevision,
    session: {
      id: 'devtools-1', revision: 1, activeTab: 'world', selectedResource: null,
      stageSnapshotReady,
      filters: { query: '', eventKinds: [], errorsOnly: false }, recording: false, host: null,
    },
    stage: stageValue,
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

test('deterministic replay accepts strict persistent radial-menu lifecycles', () => {
  const open = {
    kind: 'radial_menu', action: 'open', menuId: 'companion-menu', origin: { x: 10, y: 20 },
    items: [
      { id: 'inspect', color: '#9b7cff', disabled: false },
      { id: 'annotate', color: '#53f5d7', disabled: false },
    ],
    radius: 108, startAngle: -90, spreadDegrees: 120, closeOnSelect: true,
    style: { activeColor: '#ffffff', fillColor: '#201b2f', itemRadius: 20, opacity: 0.94 },
  }
  const summary = replayDesktopWorldSceneEvents([
    gesture('start', 1, open),
    gesture('end', 2, open),
    gesture('start', 3, { kind: 'radial_menu', action: 'focus', menuId: 'companion-menu', itemId: 'inspect', selectionIndex: 0 }),
    gesture('end', 4, { kind: 'radial_menu', action: 'select', menuId: 'companion-menu', itemId: 'inspect', selectionIndex: 0 }),
  ])
  assert.equal(summary.completedGestures, 2)
  assert.throws(() => replayDesktopWorldSceneEvents([
    gesture('start', 1, { kind: 'radial_menu', action: 'cancel', menuId: 'companion-menu', items: open.items }),
  ]), { code: 'INVALID_SCENE_REPLAY_EVENT' })
})

test('transport-injected client emits familiar scene actions without owning a socket', async () => {
  const requests = []
  const subscriptions = []
  let stageSnapshotRevision = 0
  const client = createDesktopWorldSceneClient({
    request(value) {
      requests.push(value)
      if (value.action === 'devtools_open' && value.data.headless === true) {
        return { session: devtoolsSnapshot({ stageSnapshotReady: false, stageSnapshotRevision }) }
      }
      if (value.action === 'devtools_open') return { session: devtoolsSnapshot({ stageSnapshotRevision }) }
      if (value.action === 'devtools_status') {
        stageSnapshotRevision += 1
        return { session: devtoolsSnapshot({ stageSnapshotRevision }) }
      }
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

test('headless inspection waits for its correlated refresh independent of other receipts and stage-local sequence', async () => {
  let statusCalls = 0
  const stale = devtoolsSnapshot({
    stageSnapshotReady: false,
    stageSnapshotRevision: 13,
    stageValue: stage({ position: [10, 20, 0], sequence: 99 }),
  })
  const fresh = devtoolsSnapshot({
    stageSnapshotReady: true,
    stageSnapshotRevision: 14,
    stageValue: stage({ position: [900, 600, 0], sequence: 1 }),
  })
  const client = createDesktopWorldSceneClient({
    request(value) {
      if (value.action === 'devtools_open') {
        return { session: stale }
      }
      if (value.action === 'devtools_status') {
        statusCalls += 1
        return { session: statusCalls === 1 ? stale : fresh }
      }
      if (value.action === 'devtools_close') return { status: 'ok' }
      throw new Error(`Unexpected action: ${value.action}`)
    },
  })

  const inspected = await client.inspect('companion/main')
  assert.equal(statusCalls, 2)
  assert.equal(inspected.sequence, 1)
  assert.deepEqual(inspected.world.nodes[0].position, [900, 600, 0])
})

test('headless inspection rejects malformed correlated freshness and still closes its session', async () => {
  const actions = []
  const client = createDesktopWorldSceneClient({
    request(value) {
      actions.push(value.action)
      if (value.action === 'devtools_open') return { session: devtoolsSnapshot({ stageSnapshotReady: false }) }
      if (value.action === 'devtools_status') {
        const snapshot = devtoolsSnapshot()
        return { session: { ...snapshot, session: { ...snapshot.session, stageSnapshotReady: null } } }
      }
      if (value.action === 'devtools_close') return { status: 'ok' }
      throw new Error(`Unexpected action: ${value.action}`)
    },
  })

  await assert.rejects(client.list(), { code: 'INVALID_DEVTOOLS_STAGE_FRESHNESS' })
  assert.deepEqual(actions, ['devtools_open', 'devtools_status', 'devtools_close'])
})

test('headless inspection times out and closes when its correlated refresh never arrives', async () => {
  let statusCalls = 0
  let closeCalls = 0
  const pending = devtoolsSnapshot({ stageSnapshotReady: false })
  const client = createDesktopWorldSceneClient({
    request(value) {
      if (value.action === 'devtools_open') return { session: pending }
      if (value.action === 'devtools_status') {
        statusCalls += 1
        return { session: pending }
      }
      if (value.action === 'devtools_close') {
        closeCalls += 1
        return { status: 'ok' }
      }
      throw new Error(`Unexpected action: ${value.action}`)
    },
  })

  await assert.rejects(client.list(), { code: 'SCENE_SNAPSHOT_TIMEOUT' })
  assert.equal(statusCalls, 20)
  assert.equal(closeCalls, 1)
})
