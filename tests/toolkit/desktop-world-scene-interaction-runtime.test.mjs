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
  applyResponse = (event) => ({ ...event.response, applied: true, revision: 1 }),
  scheduleTimer = (callback, delay) => setTimeout(callback, delay),
} = {}) {
  const calls = []
  const responses = []
  const events = []
  const regionRegistrations = []
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
    registerRegion: async (payload) => {
      calls.push(['register', payload.id])
      regionRegistrations.push(structuredClone(payload))
      await register(payload)
    },
    updateRegion: async (payload) => {
      calls.push(['update', payload.id])
      regionUpdates.push(structuredClone(payload))
      await update(payload)
    },
    removeRegion: async (id) => { calls.push(['remove', id]); await remove(id) },
    scheduleFrame(callback) { callback() },
    scheduleTimer,
    emitEvent(event) { events.push(event) },
  })
  return {
    calls,
    events,
    outlet,
    regionRegistrations,
    regionUpdates,
    responses,
    runtime,
    setAnimationGeneration(value) { animationGeneration = value },
    setInteractionDocument(value) { interactionDocument = value },
  }
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

  await assert.rejects(settling, /animated input-region settlement failed/u)
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
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 3)

  runtime.handleInput(routed(bodyRegion, 'left_mouse_down', 100, 200, 5))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_dragged', 250, 350, 6))
  runtime.handleInput(routed(bodyRegion, 'left_mouse_up', 250, 350, 7))
  assert.equal(events.at(-1).event.response.kind, 'aim_commit')
  assert.equal(events.at(-1).event.gesture.phase, 'end')
})

test('Escape dismisses an open radial menu and removes every temporary item region', async () => {
  const { calls, events, regionRegistrations, runtime } = harness()
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
  assert.deepEqual(
    regionRegistrations
      .filter((payload) => payload.id.includes(':menu:'))
      .map((payload) => payload.metadata.cancel_key),
    ['Escape', 'Escape'],
  )
  assert.equal(runtime.handleInput(escapeKey(3)), true)
  await runtime.dispose()

  assert.deepEqual(runtime.snapshot(key).radialMenus, [])
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 2)
  assert.deepEqual(events.slice(-2).map(({ event }) => [event.gesture.phase, event.response.action]), [
    ['start', 'cancel'],
    ['cancel', 'cancel'],
  ])
  assert.equal(events.at(-1).event.gesture.cancellationReason, 'escape')
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
  assert.ok(events.some(({ event }) => event.response.action === 'cancel'))
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
  assert.equal(menuRegistrations, 2)
  assert.equal(menuRemovals, 2)
  assert.equal(calls.filter(([kind, id]) => kind === 'register' && id.includes(':menu:')).length, 2)
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
  assert.equal(menuRegistrations, 1)
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 4)

  failRemoval = false
  await runtime.dispose()
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 5)
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
  assert.equal(calls.filter(([kind, id]) => kind === 'remove' && id.includes(':menu:')).length, 2)
})

test('a rejected radial-menu visual does not acquire temporary input regions', async () => {
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
  assert.equal(calls.filter(([kind, id]) => kind === 'register' && id.includes(':menu:')).length, 0)
  assert.equal(events.at(-1).event.response.applied, false)
  await runtime.dispose()
})
