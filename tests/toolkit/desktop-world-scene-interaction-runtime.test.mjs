import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneInteractionRuntime,
  sceneAffordanceRegionId,
} from '../../packages/toolkit/components/desktop-world-stage/scene-interaction-runtime.js'
import { replayDesktopWorldSceneEvents } from '../../packages/toolkit/scene/desktop-world-client.js'
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
  replace = null,
  applyResponse = (event) => ({ ...event.response, applied: true, revision: 1 }),
  onEmit = null,
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  const calls = []
  const responses = []
  const events = []
  const regionUpdates = []
  let interactionDocument = document
  let animationGeneration = 1
  const outlet = {
    document: () => document,
    interactionDocument: () => interactionDocument,
    animationGeneration: () => animationGeneration,
    applyInteractionResponse(_key, event) {
      responses.push(event)
      return applyResponse(event)
    },
  }
  const runtime = createDesktopWorldSceneInteractionRuntime({
    outlet,
    isPrimary: () => primary,
    topology: () => ({ displays: [{ displayId: 1, index: 0, bounds: [0, 0, 1000, 800] }] }),
    registerRegion: async (payload) => { calls.push(['register', payload.id]); await register(payload) },
    updateRegion: async (payload) => {
      calls.push(['update', payload.id])
      regionUpdates.push(structuredClone(payload))
      await update(payload)
    },
    removeRegion: async (id) => { calls.push(['remove', id]); await remove(id) },
    replaceRegionGeneration: async ({ activate, retire }) => {
      if (replace) return replace({ activate, retire, calls, regionUpdates })
      for (const payload of activate) await update(payload)
      for (const id of retire) await remove(id)
      for (const payload of activate) {
        calls.push(['update', payload.id])
        regionUpdates.push(structuredClone(payload))
      }
      for (const id of retire) calls.push(['remove', id])
    },
    scheduleFrame(callback) { callback() },
    scheduleTimer,
    emitEvent(event) {
      events.push(event)
      onEmit?.(event)
    },
  })
  return {
    calls,
    events,
    outlet,
    regionUpdates,
    responses,
    runtime,
    setAnimationGeneration(value) { animationGeneration = value },
    setInteractionDocument(value) { interactionDocument = value },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((accept) => { resolve = accept })
  return { promise, resolve }
}

function routed(regionId, type, x, y, sequenceValue) {
  return canonicalInputRegionEvent({
    regionId,
    ownerCanvasId: 'aos-desktop-world-stage',
    type,
    phase: type === 'left_mouse_down'
      ? 'down'
      : type === 'left_mouse_up'
        ? 'up'
        : type === 'mouse_moved'
          ? 'move'
          : 'drag',
    deliveryRole: type === 'left_mouse_down' ? 'owned' : 'captured',
    x,
    y,
    sequenceValue,
    gestureId: 'gesture-1',
  })
}

function escapeKey(sequenceValue) {
  return {
    input_schema_version: 2,
    event_kind: 'key',
    type: 'key_down',
    timestamp_monotonic_ms: sequenceValue,
    sequence: { source: 'daemon', value: sequenceValue },
    key: { physical_key_code: 53, logical: 'Escape', repeat: false, is_printable: false },
    modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
  }
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

test('stage resume keeps input admission closed until every region is restored', async () => {
  const secondRegistration = deferred()
  let resumeMode = false
  let resumeRegistrations = 0
  const fixture = harness({
    async register() {
      if (!resumeMode) return
      resumeRegistrations += 1
      if (resumeRegistrations === 2) await secondRegistration.promise
    },
  })
  const firstKey = 'example.consumer::companion/first'
  const secondKey = 'example.consumer::companion/second'
  const firstRegion = sceneAffordanceRegionId('example.consumer', 'companion/first', 'body-hit')
  await fixture.runtime.mount({ key: firstKey, owner: 'example.consumer', resource: 'companion/first', document, interactions })
  await fixture.runtime.mount({ key: secondKey, owner: 'example.consumer', resource: 'companion/second', document, interactions })
  await fixture.runtime.suspendStage()

  resumeMode = true
  const resuming = fixture.runtime.resumeStage()
  while (resumeRegistrations < 2) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(fixture.runtime.handleInput(routed(firstRegion, 'left_mouse_down', 100, 200, 1)), true)
  assert.equal(fixture.responses.length, 0)
  assert.equal(fixture.events.length, 0)

  secondRegistration.resolve()
  await resuming
  fixture.runtime.handleInput(routed(firstRegion, 'left_mouse_down', 100, 200, 2))
  fixture.runtime.handleInput(routed(firstRegion, 'left_mouse_up', 110, 210, 3))
  assert.deepEqual(fixture.events.map(({ event }) => event.gesture.phase), ['start', 'update', 'end'])
})

test('buffered event delivery failure is diagnostic and never rolls back committed input', async () => {
  let deliveryAttempts = 0
  const fixture = harness({
    onEmit() {
      deliveryAttempts += 1
      if (deliveryAttempts === 1) throw new Error('transport unavailable')
    },
  })
  const key = 'example.consumer::companion/main'
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  const replacement = await fixture.runtime.prepareReplacement({
    key,
    owner: 'example.consumer',
    resource: 'companion/main',
    document: { ...document, revision: 2 },
    interactions,
  })
  await replacement.activate()
  const candidateRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit', 'r1')
  fixture.runtime.handleInput(routed(candidateRegion, 'left_mouse_down', 100, 200, 1))
  fixture.runtime.handleInput(routed(candidateRegion, 'left_mouse_dragged', 120, 220, 2))
  fixture.runtime.handleInput(routed(candidateRegion, 'left_mouse_up', 120, 220, 3))
  replacement.commit(() => {})

  assert.equal(await replacement.settle(), true)
  assert.equal(deliveryAttempts, 3)
  assert.equal(fixture.runtime.snapshot(key).leases[0].regionSyncErrorCode, 'SCENE_EVENT_DELIVERY_FAILED')
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

test('completed spatial animation settles a fresh native-region generation at the terminal pose', async () => {
  const fixture = harness()
  const key = 'example.consumer::companion/main'
  const oldRegionId = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const moved = structuredClone(document)
  moved.objects[1].transform.position = [500, 400, 0]
  moved.objects[1].transform.scale = [2, 2, 2]
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  assert.equal(await fixture.runtime.quiesceAnimation(key, 1), true)
  fixture.setInteractionDocument(moved)
  assert.equal(await fixture.runtime.settleAnimationGeometry(key, 1), true)

  const terminalRegionId = fixture.runtime.snapshot(key).leases[0].regions[0]
  assert.notEqual(terminalRegionId, oldRegionId)
  assert.match(terminalRegionId, /:generation:r\d+$/u)
  assert.deepEqual(fixture.regionUpdates.at(-1).frame, [420, 340, 160, 120])
  assert.deepEqual(fixture.runtime.devtoolsSnapshot().hitRegions[0].frame, [420, 340, 160, 120])
  fixture.runtime.handleInput(routed(terminalRegionId, 'left_mouse_down', 500, 400, 1))
  fixture.runtime.handleInput(routed(terminalRegionId, 'left_mouse_dragged', 520, 420, 2))
  assert.deepEqual(fixture.responses.map(({ frame }) => frame.phase), ['start', 'update'])
})

test('terminal animation regions remain staged together when one activation fails', async () => {
  let releaseActivation
  let markActivationStarted
  let candidateUpdates = 0
  const activationStarted = new Promise((resolve) => { markActivationStarted = resolve })
  const activationGate = new Promise((resolve) => { releaseActivation = resolve })
  const fixture = harness({
    update: async (payload) => {
      if (!payload.id.includes(':generation:') || payload.enabled !== true) return
      candidateUpdates += 1
      if (candidateUpdates === 1) {
        markActivationStarted()
        await activationGate
      }
      if (candidateUpdates === 2) throw new Error('fixture second activation failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const twoObjectDocument = structuredClone(document)
  twoObjectDocument.objects.push({
    id: 'badge',
    parentId: 'root',
    kind: 'mesh',
    transform: { position: [200, 260, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    visible: true,
    geometryId: null,
    materialId: null,
    components: [],
  })
  const twoObjectInteractions = structuredClone(interactions)
  twoObjectInteractions.affordances.push({
    ...twoObjectInteractions.affordances[0],
    id: 'badge-hit',
    objectId: 'badge',
  })
  twoObjectInteractions.interactions.push({
    ...twoObjectInteractions.interactions[0],
    id: 'drag-badge',
    affordanceId: 'badge-hit',
  })
  const moved = structuredClone(twoObjectDocument)
  moved.objects[1].transform.position = [500, 400, 0]
  moved.objects[2].transform.position = [620, 440, 0]
  fixture.setInteractionDocument(twoObjectDocument)
  await fixture.runtime.mount({
    key,
    owner: 'example.consumer',
    resource: 'companion/main',
    document: twoObjectDocument,
    interactions: twoObjectInteractions,
  })
  await fixture.runtime.quiesceAnimation(key, 1)
  fixture.setInteractionDocument(moved)
  const settling = fixture.runtime.settleAnimationGeometry(key, 1)
  await activationStarted
  const candidateRegionId = fixture.runtime.snapshot(key).leases[0].regions[0]

  fixture.runtime.handleInput(routed(candidateRegionId, 'left_mouse_down', 500, 400, 1))
  assert.deepEqual(fixture.responses, [])
  releaseActivation()

  await assert.rejects(settling, /fixture second activation failure/u)
  assert.equal(candidateUpdates, 2)
  assert.deepEqual(fixture.runtime.snapshot(key).leases, [])
  assert.deepEqual(fixture.responses, [])
})

test('terminal preparation failure releases the quiesced interaction lease', async () => {
  const fixture = harness({
    register: async (payload) => {
      if (payload.id.includes(':generation:')) throw new Error('fixture candidate registration failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const moved = structuredClone(document)
  moved.objects[1].transform.position = [500, 400, 0]
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  await fixture.runtime.quiesceAnimation(key, 1)
  fixture.setInteractionDocument(moved)

  await assert.rejects(
    fixture.runtime.settleAnimationGeometry(key, 1),
    /fixture candidate registration failure/u,
  )

  assert.deepEqual(fixture.runtime.snapshot(key).leases, [])
  assert.deepEqual(fixture.runtime.devtoolsSnapshot().hitRegions, [])
})

test('retired-region cleanup blocks new animation generations without allocation growth', async () => {
  let allowCleanup = false
  const fixture = harness({
    remove: async () => {
      if (!allowCleanup) throw new Error('fixture cleanup failure')
    },
    scheduleTimer: () => ({ unref() {} }),
  })
  const key = 'example.consumer::companion/main'
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  await assert.rejects(fixture.runtime.quiesceAnimation(key, 1), /cleanup failed/u)
  await assert.rejects(fixture.runtime.quiesceAnimation(key, 2), /cleanup is still pending/u)
  await assert.rejects(fixture.runtime.quiesceAnimation(key, 3), /cleanup is still pending/u)
  assert.equal(fixture.calls.filter(([kind]) => kind === 'register').length, 1)
  assert.equal(fixture.runtime.snapshot(key).leases[0].registered, 0)
  assert.equal(fixture.runtime.snapshot(key).leases[0].animationQuiesced, true)

  allowCleanup = true
  fixture.setAnimationGeneration(4)
  const moved = structuredClone(document)
  moved.objects[1].transform.position = [500, 400, 0]
  fixture.setInteractionDocument(moved)
  assert.equal(await fixture.runtime.quiesceAnimation(key, 4), true)
  assert.equal(await fixture.runtime.settleAnimationGeometry(key, 4), true)
  assert.equal(fixture.calls.filter(([kind]) => kind === 'register').length, 2)
  assert.equal(fixture.runtime.snapshot(key).leases[0].registered, 1)
})

test('stale animation generations cannot settle input regions for a newer play', async () => {
  const fixture = harness()
  const key = 'example.consumer::companion/main'
  const moved = structuredClone(document)
  moved.objects[1].transform.position = [500, 400, 0]
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  await fixture.runtime.quiesceAnimation(key, 1)
  fixture.setInteractionDocument(moved)
  fixture.setAnimationGeneration(2)

  assert.equal(await fixture.runtime.settleAnimationGeometry(key, 1), false)
  assert.equal(fixture.runtime.snapshot(key).leases[0].registered, 0)
  assert.equal(fixture.runtime.snapshot(key).leases[0].animationReady, false)

  await fixture.runtime.quiesceAnimation(key, 2)
  assert.equal(await fixture.runtime.settleAnimationGeometry(key, 2), true)
  assert.deepEqual(fixture.runtime.devtoolsSnapshot().hitRegions[0].frame, [460, 370, 80, 60])
})

test('terminal animation geometry settles after a suspended resource resumes', async () => {
  const fixture = harness()
  const key = 'example.consumer::companion/main'
  const moved = structuredClone(document)
  moved.objects[1].transform.position = [500, 400, 0]
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })
  await fixture.runtime.quiesceAnimation(key, 1)
  fixture.setInteractionDocument(moved)
  await fixture.runtime.suspend(key)

  assert.equal(await fixture.runtime.settleAnimationGeometry(key, 1), false)
  assert.equal(fixture.runtime.snapshot(key).leases[0].animationReady, true)
  assert.equal(fixture.runtime.snapshot(key).leases[0].registered, 0)

  assert.equal(await fixture.runtime.resume(key), true)
  assert.equal(fixture.runtime.snapshot(key).leases[0].suspended, false)
  assert.equal(fixture.runtime.snapshot(key).leases[0].animationQuiesced, false)
  assert.deepEqual(fixture.runtime.devtoolsSnapshot().hitRegions[0].frame, [460, 370, 80, 60])
})

test('repeated animation settlement retains exactly one interaction generation', async () => {
  const fixture = harness()
  const key = 'example.consumer::companion/main'
  await fixture.runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions })

  for (let generation = 1; generation <= 100; generation += 1) {
    const moved = structuredClone(document)
    moved.objects[1].transform.position = [100 + generation, 200 + generation, 0]
    fixture.setAnimationGeneration(generation)
    fixture.setInteractionDocument(moved)
    assert.equal(await fixture.runtime.quiesceAnimation(key, generation), true)
    assert.equal(await fixture.runtime.settleAnimationGeometry(key, generation), true)
  }

  const snapshot = fixture.runtime.snapshot(key)
  assert.equal(snapshot.leases.length, 1)
  assert.equal(snapshot.leases[0].registered, 1)
  assert.equal(snapshot.leases[0].animationQuiesced, false)
  assert.equal(fixture.runtime.devtoolsSnapshot().hitRegions.length, 1)
  assert.equal(fixture.calls.filter(([kind]) => kind === 'register').length, 101)
  assert.equal(fixture.calls.filter(([kind]) => kind === 'remove').length, 100)
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

test('tap-open radial menu coexists with aim-and-commit drag and cleans temporary item regions', async () => {
  const { calls, events, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [
    {
      ...menuInteractions.interactions[0],
      id: 'aim-body',
      response: { implementation: 'aos.scene.response.aim-commit', parameters: { route: 'line' } },
    },
    {
      id: 'open-menu',
      affordanceId: 'body-hit',
      recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
      response: {
        implementation: 'aos.scene.response.radial-menu',
        parameters: {
          closeOnSelect: true,
          items: [
            { id: 'inspect', color: '#9b7cff' },
            { id: 'annotate', color: '#53f5d7' },
            { id: 'settings', color: '#f2f5ff' },
          ],
          menuId: 'companion-menu',
          radius: 100,
          spreadDegrees: 120,
          startAngle: -150,
          style: { activeColor: '#ffffff', fillColor: '#201b2f', itemRadius: 20, opacity: 0.94 },
        },
      },
    },
  ]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })

  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 101, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const opened = runtime.snapshot(key).radialMenus[0]
  assert.equal(opened.menuId, 'companion-menu')
  assert.equal(opened.regions.length, 3)
  assert.equal(runtime.devtoolsSnapshot().hitRegions.length, 4)
  const firstRegion = opened.regions[0]
  const [left, top, width, height] = firstRegion.frame
  runtime.handleInput(routed(firstRegion.id, 'left_mouse_down', left + width / 2, top + height / 2, 3))
  runtime.handleInput(routed(firstRegion.id, 'left_mouse_up', left + width / 2, top + height / 2, 4))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(events.map(({ event }) => [event.gesture.phase, event.response.kind, event.response.action ?? null]), [
    ['start', 'radial_menu', 'open'],
    ['update', 'radial_menu', 'open'],
    ['end', 'radial_menu', 'open'],
    ['start', 'radial_menu', 'focus'],
    ['end', 'radial_menu', 'select'],
  ])
  assert.deepEqual(events.map(({ event }) => event.sequence), [1, 2, 3, 4, 5])
  assert.equal(events.at(-1).event.response.itemId, 'inspect')
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 4)

  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 5))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_dragged', 250, 350, 6))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 250, 350, 7))
  assert.equal(events.at(-1).event.response.kind, 'aim_commit')
  assert.equal(events.at(-1).event.gesture.phase, 'end')
})

test('radial-menu pointer movement emits focus and blur without requiring a press', async () => {
  const registered = []
  const { events, runtime } = harness({
    register: async (payload) => { registered.push(structuredClone(payload)) },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        items: [{ id: 'inspect' }, { id: 'annotate' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const opened = runtime.snapshot(key).radialMenus[0]
  const item = opened.regions[0]
  const [left, top, width, height] = item.frame
  runtime.handleInput(routed(item.id, 'mouse_moved', left + width / 2, top + height / 2, 3))
  const backdrop = registered.find((region) => (
    region.id.includes(':menu:') && region.metadata?.scene_radial_outside === 'true'
  ))
  assert.ok(backdrop)
  runtime.handleInput(routed(backdrop.id, 'mouse_moved', 900, 700, 4))

  assert.deepEqual(events.slice(-2).map(({ event }) => [
    event.gesture.phase,
    event.response.action,
    event.response.itemId ?? null,
  ]), [
    ['start', 'focus', 'inspect'],
    ['end', 'blur', null],
  ])
  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  await runtime.dispose()
})

test('radial-menu hover and press lifecycles replay without shared or orphaned gesture IDs', async () => {
  const { events, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const item = runtime.snapshot(key).radialMenus[0].regions[0]
  const [left, top, width, height] = item.frame
  const x = left + width / 2
  const y = top + height / 2
  runtime.handleInput(routed(item.id, 'mouse_moved', x, y, 3))
  runtime.handleInput(routed(item.id, 'left_mouse_down', x, y, 4))
  runtime.handleInput(routed(item.id, 'left_mouse_up', x, y, 5))
  await new Promise((resolve) => setImmediate(resolve))

  const lifecycle = events
    .map(({ event }) => event)
    .filter((event) => ['focus', 'select', 'blur'].includes(event.response.action))
  assert.deepEqual(lifecycle.map((event) => [event.response.action, event.gesture.phase]), [
    ['focus', 'start'],
    ['focus', 'start'],
    ['select', 'end'],
    ['blur', 'end'],
  ])
  assert.equal(lifecycle[0].gesture.id, lifecycle[3].gesture.id)
  assert.equal(lifecycle[1].gesture.id, lifecycle[2].gesture.id)
  assert.notEqual(lifecycle[0].gesture.id, lifecycle[1].gesture.id)
  assert.equal(replayDesktopWorldSceneEvents(events.map(({ event }) => event)).status, 'ok')
  await runtime.dispose()
})

test('non-closing selection and pointer cancellation restore the current hover visual', async () => {
  const { events, responses, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { closeOnSelect: false, items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const item = runtime.snapshot(key).radialMenus[0].regions[0]
  const [left, top, width, height] = item.frame
  const x = left + width / 2
  const y = top + height / 2
  runtime.handleInput(routed(item.id, 'mouse_moved', x, y, 3))
  runtime.handleInput(routed(item.id, 'left_mouse_down', x, y, 4))
  runtime.handleInput(routed(item.id, 'left_mouse_up', x, y, 5))
  assert.deepEqual(responses.slice(-3).map(({ response }) => response.action), ['select', 'open', 'focus'])
  const eventsAfterSelection = events.length
  runtime.handleInput(routed(item.id, 'mouse_moved', x, y, 6))
  assert.equal(events.length, eventsAfterSelection)

  runtime.handleInput(routed(item.id, 'left_mouse_down', x, y, 7))
  runtime.handleInput(canonicalInputRegionEvent({
    regionId: item.id,
    ownerCanvasId: 'aos-desktop-world-stage',
    type: 'left_mouse_dragged',
    phase: 'cancel',
    deliveryRole: 'captured',
    x,
    y,
    sequenceValue: 8,
    gestureId: 'gesture-1',
    extra: { event_kind: 'cancel', cancel_reason: 'pointer_cancelled' },
  }))
  assert.deepEqual(responses.slice(-3).map(({ response }) => response.action), ['cancel', 'open', 'focus'])
  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  await runtime.dispose()
})

test('Escape during a pressed radial item completes both hover and press lifecycles', async () => {
  const { events, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const item = runtime.snapshot(key).radialMenus[0].regions[0]
  const [left, top, width, height] = item.frame
  const x = left + width / 2
  const y = top + height / 2
  runtime.handleInput(routed(item.id, 'mouse_moved', x, y, 3))
  runtime.handleInput(routed(item.id, 'left_mouse_down', x, y, 4))
  runtime.handleInput(escapeKey(5))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  const lifecycle = events
    .map(({ event }) => event)
    .filter((event) => ['focus', 'blur', 'cancel'].includes(event.response.action))
  assert.deepEqual(lifecycle.map((event) => [event.response.action, event.gesture.phase]), [
    ['focus', 'start'],
    ['focus', 'start'],
    ['blur', 'end'],
    ['cancel', 'cancel'],
  ])
  assert.equal(lifecycle[0].gesture.id, lifecycle[2].gesture.id)
  assert.equal(lifecycle[1].gesture.id, lifecycle[3].gesture.id)
  assert.equal(replayDesktopWorldSceneEvents(events.map(({ event }) => event)).status, 'ok')
  await runtime.dispose()
})

test('every lifecycle close completes active radial hover and press gestures', async () => {
  const cases = [
    ['resource suspend', (runtime, key) => runtime.suspend(key)],
    ['topology change', (runtime) => runtime.topologyChanged()],
    ['stage suspend', (runtime) => runtime.suspendStage()],
    ['resource release', (runtime, key) => runtime.release(key)],
    ['stage disposal', (runtime) => runtime.dispose()],
  ]
  for (const [label, closeRuntime] of cases) {
    const { events, runtime } = harness()
    const key = 'example.consumer::companion/main'
    const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
    const menuInteractions = structuredClone(interactions)
    menuInteractions.interactions = [{
      id: 'open-menu',
      affordanceId: 'body-hit',
      recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
      response: {
        implementation: 'aos.scene.response.radial-menu',
        parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
      },
    }]
    await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
    runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
    runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
    await new Promise((resolve) => setImmediate(resolve))

    const item = runtime.snapshot(key).radialMenus[0].regions[0]
    const [left, top, width, height] = item.frame
    const x = left + width / 2
    const y = top + height / 2
    runtime.handleInput(routed(item.id, 'mouse_moved', x, y, 3))
    runtime.handleInput(routed(item.id, 'left_mouse_down', x, y, 4))
    await closeRuntime(runtime, key)

    assert.doesNotThrow(
      () => replayDesktopWorldSceneEvents(events.map(({ event }) => event)),
      label,
    )
    if (label !== 'stage disposal') await runtime.dispose()
  }
})

test('radial-menu regions remain inactive until one atomic generation replacement activates every item', async () => {
  const activation = deferred()
  const replacementStarted = deferred()
  const registered = []
  let activated = []
  const { events, responses, runtime } = harness({
    register: async (payload) => { registered.push(structuredClone(payload)) },
    replace: async ({ activate }) => {
      activated = structuredClone(activate)
      replacementStarted.resolve()
      await activation.promise
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        items: [{ id: 'inspect' }, { id: 'annotate' }, { id: 'settings' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await replacementStarted.promise

  const temporary = registered.filter((payload) => payload.id.includes(':menu:'))
  assert.equal(temporary.length, 4)
  assert.ok(temporary.every((payload) => payload.enabled === false && payload.consume_policy === 'never'))
  assert.equal(activated.length, 4)
  assert.equal(activated.filter((payload) => payload.metadata.scene_radial_outside !== 'true').length, 3)
  assert.ok(activated.filter((payload) => payload.metadata.scene_radial_outside !== 'true')
    .every((payload) => payload.enabled === true && payload.consume_policy === 'captured'))
  assert.equal(activated.find((payload) => payload.metadata.scene_radial_outside === 'true')?.consume_policy, 'never')
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(runtime.handleInput(routed(activated[0].id, 'left_mouse_down', 100, 100, 3)), true)
  assert.equal(events.some(({ event }) => event.response.action === 'focus'), false)
  assert.equal(responses.some(({ frame, response }) => frame.phase === 'end' && response.action === 'open'), false)

  activation.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  const visualOpen = responses.find(({ frame, response }) => frame.phase === 'end' && response.action === 'open')
  assert.ok(visualOpen)
  assert.equal(responses.filter(({ frame, response }) => frame.phase === 'end' && response.action === 'open').length, 1)
  assert.ok(Object.isFrozen(visualOpen.radialLayout))
  assert.ok(Object.isFrozen(visualOpen.radialLayout.items))
  const itemRegions = activated.filter((payload) => payload.metadata.scene_radial_outside !== 'true')
  assert.deepEqual(visualOpen.radialLayout.items.map(({ center }) => [center.x, center.y]), itemRegions.map(({ frame }) => [
    frame[0] + frame[2] / 2,
    frame[1] + frame[3] / 2,
  ]))
  await runtime.dispose()
})

test('radial-menu activation buffers input delivered before native replacement acknowledgement', async () => {
  let runtime
  let handledDuringAcknowledgement = []
  let observedDuringAcknowledgement = []
  const result = harness({
    replace: async ({ activate }) => {
      const item = activate.find((payload) => (
        payload.id.includes(':menu:') && payload.metadata?.scene_radial_outside !== 'true'
      ))
      if (!item) return
      const [left, top, width, height] = item.frame
      handledDuringAcknowledgement = [
        runtime.handleInput(routed(item.id, 'left_mouse_down', left + width / 2, top + height / 2, 3)),
        runtime.handleInput(routed(item.id, 'left_mouse_up', left + width / 2, top + height / 2, 4)),
      ]
      observedDuringAcknowledgement = result.events
        .filter(({ event }) => ['focus', 'select'].includes(event.response.action))
    },
  })
  runtime = result.runtime
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        closeOnSelect: false,
        items: [{ id: 'inspect' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(handledDuringAcknowledgement, [true, true])
  assert.deepEqual(observedDuringAcknowledgement, [])
  assert.deepEqual(result.events
    .filter(({ event }) => ['focus', 'select'].includes(event.response.action))
    .map(({ event }) => event.response.action), ['focus', 'select'])
  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  await runtime.dispose()
})

test('radial-menu activation fails closed when acknowledgement input exceeds its bound', async () => {
  let runtime
  let injected = false
  const result = harness({
    replace: async ({ activate, calls, retire }) => {
      if (retire.length > 0) {
        for (const id of retire) calls.push(['remove', id])
        return
      }
      const item = activate.find((payload) => (
        payload.id.includes(':menu:') && payload.metadata?.scene_radial_outside !== 'true'
      ))
      if (!item || injected) return
      injected = true
      const [left, top, width, height] = item.frame
      for (let index = 0; index < 65; index += 1) {
        assert.equal(runtime.handleInput(routed(
          item.id,
          'left_mouse_dragged',
          left + width / 2,
          top + height / 2,
          3 + index,
        )), true)
      }
    },
  })
  runtime = result.runtime
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(result.responses.some(({ radialLayout, response }) => (
    response.action === 'open' && radialLayout !== undefined
  )), false)
  assert.ok(result.calls.some(([kind, id]) => kind === 'remove' && id.includes(':menu:')))
  await runtime.dispose()
})

test('radial-menu activation fails closed on reentrant visual-commit input overflow', async () => {
  let activeItem = null
  let injected = false
  let runtime
  const handledDuringVisualCommit = []
  const result = harness({
    applyResponse: (event) => {
      if (event.radialLayout && activeItem && !injected) {
        injected = true
        const [left, top, width, height] = activeItem.frame
        for (let index = 0; index < 65; index += 1) {
          handledDuringVisualCommit.push(runtime.handleInput(routed(
            activeItem.id,
            'left_mouse_dragged',
            left + width / 2,
            top + height / 2,
            3 + index,
          )))
        }
      }
      return { ...event.response, applied: true, revision: 1 }
    },
    replace: async ({ activate, calls, retire }) => {
      if (retire.length > 0) {
        for (const id of retire) calls.push(['remove', id])
        return
      }
      activeItem = activate.find((payload) => (
        payload.id.includes(':menu:') && payload.metadata?.scene_radial_outside !== 'true'
      )) ?? null
    },
  })
  runtime = result.runtime
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(handledDuringVisualCommit.length, 65)
  assert.ok(handledDuringVisualCommit.every(Boolean))
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(result.events.some(({ event }) => ['focus', 'select'].includes(event.response.action)), false)
  assert.ok(result.calls.some(([kind, id]) => kind === 'remove' && id.includes(':menu:')))
  assert.equal(runtime.handleInput(routed(activeItem.id, 'left_mouse_down', 100, 100, 70)), false)
  await runtime.dispose()
})

test('radial-menu activation cannot commit after a reentrant visual close', async () => {
  let activeItem = null
  let closedDuringVisualCommit = false
  let runtime
  const result = harness({
    applyResponse: (event) => {
      if (event.radialLayout && !closedDuringVisualCommit) {
        closedDuringVisualCommit = runtime.handleInput(escapeKey(3))
      }
      return { ...event.response, applied: true, revision: 1 }
    },
    replace: async ({ activate, calls, retire }) => {
      if (retire.length > 0) {
        for (const id of retire) calls.push(['remove', id])
        return
      }
      activeItem = activate.find((payload) => (
        payload.id.includes(':menu:') && payload.metadata?.scene_radial_outside !== 'true'
      )) ?? null
    },
  })
  runtime = result.runtime
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(closedDuringVisualCommit, true)
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.ok(result.calls.some(([kind, id]) => kind === 'remove' && id.includes(':menu:')))
  assert.equal(runtime.handleInput(routed(activeItem.id, 'left_mouse_down', 100, 100, 4)), false)
  await runtime.dispose()
})

test('every enabled radial-menu item dispatches selection after atomic activation', async () => {
  const { events, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        closeOnSelect: false,
        items: [{ id: 'inspect' }, { id: 'annotate' }, { id: 'settings' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const regions = runtime.snapshot(key).radialMenus[0].regions
  regions.forEach((region, index) => {
    const [left, top, width, height] = region.frame
    runtime.handleInput(routed(region.id, 'left_mouse_down', left + width / 2, top + height / 2, 10 + index * 2))
    runtime.handleInput(routed(region.id, 'left_mouse_up', left + width / 2, top + height / 2, 11 + index * 2))
  })

  assert.deepEqual(events
    .filter(({ event }) => event.response.action === 'select')
    .map(({ event }) => event.response.itemId), ['inspect', 'annotate', 'settings'])
  await runtime.dispose()
})

test('a non-consuming display backdrop dismisses a radial menu on click-away', async () => {
  const registered = []
  const { events, runtime } = harness({
    register: async (payload) => { registered.push(structuredClone(payload)) },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  const backdrop = registered.find((payload) => payload.metadata?.scene_radial_outside === 'true')
  assert.ok(backdrop)
  assert.equal(backdrop.consume_policy, 'never')
  assert.deepEqual(backdrop.frame, [0, 0, 1000, 800])
  assert.equal(runtime.handleInput(routed(backdrop.id, 'left_mouse_down', 800, 700, 3)), true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(events.at(-1).event.response.action, 'cancel')
  assert.equal(events.at(-1).event.gesture.cancellationReason, 'pointer_cancelled')
  await runtime.dispose()
})

test('Escape dismisses an open radial menu and removes every temporary item region', async () => {
  const { calls, events, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        items: [{ id: 'inspect' }, { id: 'annotate' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  assert.equal(runtime.handleInput(escapeKey(3)), true)
  await runtime.dispose()

  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 3)
  assert.deepEqual(events.slice(-2).map(({ event }) => [event.gesture.phase, event.response.action]), [
    ['start', 'cancel'],
    ['cancel', 'cancel'],
  ])
  assert.equal(events.at(-1).event.gesture.cancellationReason, 'escape')
})

test('Escape dismisses an all-disabled radial menu without an item hit region', async () => {
  const { calls, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        items: [{ id: 'inspect', disabled: true }, { id: 'annotate', disabled: true }],
        menuId: 'disabled-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  const temporaryRegions = calls.filter(([kind, id]) => kind === 'register' && id.includes(':menu:'))
  assert.equal(temporaryRegions.length, 1)
  assert.match(temporaryRegions[0][1], /:outside:display:/u)
  assert.equal(runtime.handleInput(escapeKey(3)), true)
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  await runtime.dispose()
})

test('reopening a radial menu closes the old lease before rendering the replacement', async () => {
  const { events, responses, runtime } = harness()
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }, { id: 'annotate' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 110, 210, 3))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 110, 210, 4))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  assert.equal(responses.at(-1).response.action, 'open')
  assert.equal(events.at(-1).event.response.action, 'open')
  assert.equal(events.at(-1).event.gesture.phase, 'end')
  await runtime.dispose()
})

test('late stale-region cleanup cannot close or overwrite a replacement radial menu', async () => {
  let releaseOldRegistration
  const oldRegistration = new Promise((resolve) => { releaseOldRegistration = resolve })
  let menuRegistrations = 0
  let menuRemovals = 0
  const { calls, runtime } = harness({
    register: async (payload) => {
      if (!payload.id.includes(':menu:')) return
      menuRegistrations += 1
      if (menuRegistrations === 1) await oldRegistration
    },
    remove: async (id) => {
      if (!id.includes(':menu:')) return
      menuRemovals += 1
      if (menuRemovals === 1) throw new Error('fixture stale cleanup failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 110, 210, 3))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 110, 210, 4))
  releaseOldRegistration()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(runtime.snapshot(key).radialMenus.length, 1)
  assert.equal(runtime.snapshot(key).radialMenus[0].regions.length, 1)
  assert.equal(menuRegistrations, 3)
  assert.equal(menuRemovals, 2)
  assert.equal(calls.filter(([kind, id]) => kind === 'register' && id.includes(':menu:')).length, 3)
  await runtime.dispose()
})

test('persistent stale-region cleanup failure blocks replacement activation until teardown can recover', async () => {
  let failRemoval = true
  let menuRegistrations = 0
  const { calls, runtime } = harness({
    register: async (payload) => {
      if (payload.id.includes(':menu:')) menuRegistrations += 1
    },
    remove: async (id) => {
      if (failRemoval && id.includes(':menu:')) throw new Error('fixture persistent cleanup failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 110, 210, 3))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 110, 210, 4))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(menuRegistrations, 2)
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 8)

  failRemoval = false
  await runtime.dispose()
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 10)
})

test('failed radial retirement keeps product art visible but removes input dispatch until cleanup succeeds', async () => {
  let failRemoval = true
  const { events, responses, runtime } = harness({
    replace: async ({ retire }) => {
      if (retire.length > 0) throw new Error('fixture generation retirement failure')
    },
    remove: async (id) => {
      if (failRemoval && id.includes(':menu:')) throw new Error('fixture region cleanup failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  const menuRegion = runtime.snapshot(key).radialMenus[0].regions[0]

  assert.equal(runtime.handleInput(escapeKey(3)), true)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(runtime.handleInput(routed(menuRegion.id, 'left_mouse_down', 100, 100, 4)), true)
  assert.equal(events.some(({ event }) => ['focus', 'select'].includes(event.response.action)), false)
  assert.equal(responses.at(-1).response.action, 'open')

  failRemoval = false
  await runtime.dispose()
  assert.equal(responses.at(-1).response.action, 'cancel')
})

test('a selected menu keeps product art visible until its native generation retires', async () => {
  let failRemoval = true
  const { events, responses, runtime } = harness({
    replace: async ({ retire }) => {
      if (retire.length > 0 && failRemoval) throw new Error('fixture generation retirement failure')
    },
    remove: async (id) => {
      if (failRemoval && id.includes(':menu:')) throw new Error('fixture region cleanup failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { closeOnSelect: true, items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  const menuRegion = runtime.snapshot(key).radialMenus[0].regions[0]
  const [left, top, width, height] = menuRegion.frame

  runtime.handleInput(routed(menuRegion.id, 'left_mouse_down', left + width / 2, top + height / 2, 3))
  runtime.handleInput(routed(menuRegion.id, 'left_mouse_up', left + width / 2, top + height / 2, 4))
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(events.at(-1).event.response.action, 'select')
  assert.notEqual(responses.at(-1).response.action, 'select')
  assert.notEqual(responses.at(-1).response.action, 'cancel')
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])

  failRemoval = false
  await runtime.dispose()
  assert.equal(responses.at(-1).response.action, 'cancel')
})

test('partial radial-menu registration failure rolls back every accepted temporary region', async () => {
  let registrationCount = 0
  const { calls, runtime } = harness({
    register: async () => {
      registrationCount += 1
      if (registrationCount === 4) throw new Error('fixture registration failure')
    },
  })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: {
        items: [{ id: 'inspect' }, { id: 'annotate' }, { id: 'settings' }],
        menuId: 'companion-menu',
      },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))
  await runtime.dispose()

  assert.equal(registrationCount, 4)
  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 3)
})

test('a rejected radial-menu visual retires its temporary input generation before cancellation', async () => {
  const { calls, events, runtime } = harness({ applyResponse: () => ({ applied: false, revision: 1 }) })
  const key = 'example.consumer::companion/main'
  const bodyRegion = sceneAffordanceRegionId('example.consumer', 'companion/main', 'body-hit')
  const menuInteractions = structuredClone(interactions)
  menuInteractions.interactions = [{
    id: 'open-menu',
    affordanceId: 'body-hit',
    recognizer: { implementation: 'aos.scene.gesture.tap', parameters: { button: 0, threshold: 4 } },
    response: {
      implementation: 'aos.scene.response.radial-menu',
      parameters: { items: [{ id: 'inspect' }], menuId: 'companion-menu' },
    },
  }]
  await runtime.mount({ key, owner: 'example.consumer', resource: 'companion/main', document, interactions: menuInteractions })
  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 1))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 100, 200, 2))
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(calls.filter(([kind, id]) => kind === 'register' && id.includes(':menu:')).length, 2)
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 2)
  assert.equal(events.at(-1).event.response.action, 'cancel')
  assert.equal(events.at(-1).event.response.applied, false)
  await runtime.dispose()
})
