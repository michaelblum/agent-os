import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldSceneInteractionRuntime,
} from '../../packages/toolkit/components/desktop-world-stage/scene-interaction-runtime.js'
import { createDesktopWorldSceneOperationCoordinator } from '../../packages/toolkit/components/desktop-world-stage/scene-operation-coordinator.js'
import { canonicalInputRegionEvent } from '../lib/input-event-fixtures.mjs'

function sceneWithObjects(id, objects) {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id,
    revision: 1,
    rootObjectId: 'root',
    objects: [
      { id: 'root', parentId: null, kind: 'group', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
      ...objects.map(({ id: objectId, position }) => ({
        id: objectId,
        parentId: 'root',
        kind: 'mesh',
        transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        geometryId: null,
        materialId: null,
        components: [],
      })),
    ],
    resources: [],
    metadata: {},
  }
}

function scene(id, objectId, position = [100, 200, 0]) {
  return sceneWithObjects(id, [{ id: objectId, position }])
}

function interactionsForObjects(objectIds) {
  return {
    contract: 'aos.scene.cartridge.interactions.v1',
    schemaVersion: 1,
    affordances: objectIds.map((objectId) => ({
      id: `${objectId}-hit`,
      objectId,
      geometry: { kind: 'rect', width: 80, height: 60, offset: [0, 0] },
      enabled: true,
      priority: 100,
      consumePolicy: 'captured',
      metadata: {},
    })),
    interactions: objectIds.map((objectId) => ({
      id: `${objectId}-drag`,
      affordanceId: `${objectId}-hit`,
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
      response: { implementation: 'aos.scene.response.translate', parameters: { axis: 'both' } },
    })),
  }
}

function interaction(objectId) {
  return interactionsForObjects([objectId])
}

function pointerEffectInteraction(objectId) {
  const value = interaction(objectId)
  value.interactions[0].nativeEffect = {
    implementation: 'aos.scene.effect.desktop-ripple',
    trigger: { input: 'pointer_down' },
    parameters: {
      amplitude: 24,
      decay: 2.5,
      durationMs: 900,
      frequency: 0.04,
      radius: 1_800,
      speed: 900,
    },
  }
  return value
}

function harness({
  applyThenRejectAffordance = null,
  applyThenRejectUpdateAffordance = null,
  deferThenResolveUpdateAffordance = null,
  deferThenRejectUpdateAffordance = null,
  deferAffordance = null,
  deferRegistrationNumber = null,
  failAffordance = null,
  rejectPlay = false,
  rejectReplacementCommit = false,
  rejectDisableAffordance = null,
  rejectResume = false,
  remove = async () => {},
  scheduleTimer = undefined,
  spatialAnimation = false,
} = {}) {
  const resources = new Map()
  const regions = new Map()
  const calls = []
  const dispatchedScenes = []
  const emittedEvents = []
  const removalAttempts = new Map()
  let registrationCount = 0
  let replacementCommitCount = 0
  let releaseRegistration = null
  let markRegistrationStarted = null
  let markUpdateStarted = null
  let rejectDeferredUpdate = null
  let releaseDeferredUpdate = null
  const registrationStarted = new Promise((resolve) => { markRegistrationStarted = resolve })
  const deferredRegistration = new Promise((resolve) => { releaseRegistration = resolve })
  const updateStarted = new Promise((resolve) => { markUpdateStarted = resolve })
  const deferredUpdate = new Promise((resolve, reject) => { rejectDeferredUpdate = reject })
  const deferredUpdateSuccess = new Promise((resolve) => { releaseDeferredUpdate = resolve })
  const outlet = {
    apply(message) {
      const key = message.payload.lease_key
      const op = message.payload.operation?.op ?? 'release'
      calls.push(['outlet', op])
      if (op === 'release' || op === 'remove' || op === 'close') resources.delete(key)
      else if (op === 'mount') resources.set(key, {
        document: message.payload.operation.document,
        extension: message.payload.operation.extension ?? null,
        playGeneration: 0,
        suspended: false,
      })
      else if (op === 'play') {
        if (rejectPlay) throw new Error('fixture play failure')
        const mounted = resources.get(key)
        if (mounted) mounted.playGeneration += 1
      }
      else if (op === 'suspend' || op === 'resume') {
        if (op === 'resume' && rejectResume) throw new Error('fixture resume failure')
        resources.get(key).suspended = op === 'suspend'
      }
      return true
    },
    applyInteractionResponse(key) {
      dispatchedScenes.push(resources.get(key)?.document?.id ?? null)
      return { applied: true, revision: 1 }
    },
    configuration(key) { return resources.get(key) ?? null },
    document(key) { return resources.get(key)?.document ?? null },
    animationGeneration(key) { return resources.get(key)?.playGeneration ?? null },
    hasInteractionAnimation() { return spatialAnimation },
    interactionDocument(key) { return resources.get(key)?.document ?? null },
    nextAnimationGeneration(key) {
      const mounted = resources.get(key)
      return mounted ? mounted.playGeneration + 1 : null
    },
    proveFramebuffer(key, input) {
      calls.push(['prove', key, input])
      return {
        extension_digest: input.expectedDigest,
        passed: true,
        pixels_persisted: false,
        pixels_returned: false,
        proof_id: input.proofId,
        readback_duration_ms: 1,
        resource_revision: input.expectedRevision,
      }
    },
    releaseAll() {
      resources.clear()
      return true
    },
    resume() { calls.push(['outlet-stage', 'resume']); return true },
    suspend() { calls.push(['outlet-stage', 'suspend']); return true },
    prepareReplacement(message) {
      const key = message.payload.lease_key
      const previous = resources.get(key) ?? null
      const document = message.payload.operation.document
      let pending = true
      return {
        document,
        assertCurrent() {
          assert.equal(pending, true)
          assert.equal(resources.get(key) ?? null, previous)
          return true
        },
        commit() {
          this.assertCurrent()
          replacementCommitCount += 1
          resources.set(key, {
            document,
            extension: message.payload.operation.extension ?? previous?.extension ?? null,
            playGeneration: previous?.playGeneration ?? 0,
            suspended: false,
          })
          if (rejectReplacementCommit && replacementCommitCount > 1) {
            throw new Error('fixture replacement commit failure')
          }
          pending = false
          return true
        },
        rollback() {
          if (!pending) return false
          pending = false
          return true
        },
      }
    },
  }
  const interactions = createDesktopWorldSceneInteractionRuntime({
    outlet,
    emitEvent: (event) => emittedEvents.push(event),
    registerRegion: async (payload) => {
      registrationCount += 1
      calls.push(['register', payload.metadata.scene_affordance, payload.id])
      if (payload.metadata.scene_affordance === failAffordance) throw new Error('registration unavailable')
      regions.set(payload.id, payload)
      if (payload.metadata.scene_affordance === applyThenRejectAffordance) {
        throw new Error('registration acknowledgement unavailable')
      }
      if (payload.metadata.scene_affordance === deferAffordance
        && (deferRegistrationNumber === null || registrationCount === deferRegistrationNumber)) {
        markRegistrationStarted()
        await deferredRegistration
      }
    },
    updateRegion: async (payload) => {
      if (payload.enabled === false
        && payload.metadata.scene_affordance === rejectDisableAffordance) {
        throw new Error('disable acknowledgement unavailable')
      }
      regions.set(payload.id, payload)
      if (payload.metadata.scene_affordance === applyThenRejectUpdateAffordance) {
        throw new Error('update acknowledgement unavailable')
      }
      if (payload.metadata.scene_affordance === deferThenRejectUpdateAffordance) {
        markUpdateStarted()
        await deferredUpdate
      }
    },
    removeRegion: async (id) => {
      const attempt = (removalAttempts.get(id) ?? 0) + 1
      removalAttempts.set(id, attempt)
      calls.push(['remove', id])
      await remove({ attempt, id, payload: regions.get(id) ?? null })
      regions.delete(id)
    },
    replaceRegionGeneration: async ({ activate, retire }) => {
      const next = new Map(regions)
      for (const payload of activate) {
        calls.push(['replace-activate', payload.metadata.scene_affordance, payload.id])
        next.set(payload.id, payload)
        if (payload.metadata.scene_affordance === deferThenRejectUpdateAffordance) {
          markUpdateStarted()
          await deferredUpdate
        }
        if (payload.metadata.scene_affordance === deferThenResolveUpdateAffordance) {
          markUpdateStarted()
          await deferredUpdateSuccess
        }
        if (payload.metadata.scene_affordance === applyThenRejectUpdateAffordance) {
          regions.clear()
          for (const [id, entry] of next) regions.set(id, entry)
          throw new Error('activation acknowledgement unavailable')
        }
      }
      for (const id of retire) {
        const attempt = (removalAttempts.get(id) ?? 0) + 1
        removalAttempts.set(id, attempt)
        calls.push(['replace-retire', id])
        await remove({ attempt, id, payload: regions.get(id) ?? null })
        next.delete(id)
      }
      regions.clear()
      for (const [id, entry] of next) regions.set(id, entry)
    },
    scheduleFrame(callback) { callback() },
    ...(scheduleTimer ? { scheduleTimer } : {}),
  })
  return {
    calls,
    dispatchedScenes,
    emittedEvents,
    interactions,
    outlet,
    regions,
    registrationStarted,
    rejectDeferredUpdate,
    releaseDeferredUpdate,
    releaseRegistration,
    updateStarted,
    coordinator: createDesktopWorldSceneOperationCoordinator({ outlet, interactions }),
  }
}

function regionIdFor(regions, affordanceId, { exclude = null } = {}) {
  return [...regions.entries()]
    .find(([id, payload]) => id !== exclude && payload.metadata.scene_affordance === affordanceId)?.[0] ?? null
}

function pointerDown(regionId) {
  return canonicalInputRegionEvent({
    regionId,
    ownerCanvasId: 'aos-desktop-world-stage',
    type: 'left_mouse_down',
    phase: 'down',
    deliveryRole: 'owned',
    x: 100,
    y: 200,
    sequenceValue: 1,
    gestureId: 'replacement-race',
  })
}

function pointerDrag(regionId, sequenceValue = 2) {
  return canonicalInputRegionEvent({
    regionId,
    ownerCanvasId: 'aos-desktop-world-stage',
    type: 'left_mouse_dragged',
    phase: 'drag',
    deliveryRole: 'captured',
    x: 140,
    y: 230,
    sequenceValue,
    gestureId: 'replacement-race',
  })
}

function mount(key, document, interactions, extension = null) {
  return {
    type: 'desktop_world_stage.scene.operation',
    payload: {
      lease_key: key,
      owner: 'example.consumer',
      resource: 'companion/main',
      operation: {
        op: 'mount',
        document,
        ...(interactions === undefined ? {} : { interactions }),
        ...(extension ? { extension } : {}),
      },
    },
  }
}

function transact(key, document, interactions) {
  const message = mount(key, document, interactions)
  message.payload.operation.op = 'transact'
  return message
}

function suspendOrResume(key, op) {
  return {
    type: 'desktop_world_stage.scene.operation',
    payload: { lease_key: key, operation: { op } },
  }
}

function prove(key, proofId = 'capture-overlay-visible') {
  return {
    type: 'desktop_world_stage.scene.operation',
    payload: {
      lease_key: key,
      operation: {
        expectedExtensionDigest: 'a'.repeat(64),
        expectedRevision: 1,
        op: 'prove',
        proofId,
      },
    },
  }
}

test('framebuffer proof stays on the scene coordinator owner path with no caller pixel predicate', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  const result = await fixture.coordinator.apply(prove(key))

  assert.equal(result.applied, true)
  assert.equal(result.op, 'prove')
  assert.equal(result.proof.proof_id, 'capture-overlay-visible')
  assert.deepEqual(fixture.calls, [[
    'prove',
    key,
    {
      expectedDigest: 'a'.repeat(64),
      expectedRevision: 1,
      proofId: 'capture-overlay-visible',
    },
  ]])
  assert.equal(Object.hasOwn(result.proof, 'pixels'), false)
})

test('failed resume recovery remounts the exact trusted projection extension', async () => {
  const key = 'example.consumer::companion/main'
  const extension = {
    ownerId: 'example.consumer',
    id: 'companion-renderer',
    digest: 'a'.repeat(64),
    sceneAbi: 'aos.scene.projection.v1',
    threeRevision: '183',
  }
  const fixture = harness({ rejectResume: true })
  await fixture.coordinator.apply(mount(
    key,
    scene('extension-scene', 'body'),
    interaction('body'),
    extension,
  ))
  await fixture.coordinator.apply(suspendOrResume(key, 'suspend'))

  await assert.rejects(
    fixture.coordinator.apply(suspendOrResume(key, 'resume')),
    /fixture resume failure/u,
  )

  assert.deepEqual(fixture.outlet.configuration(key).extension, extension)
  assert.equal(fixture.outlet.document(key).id, 'extension-scene')
})

test('visual-only transactions retain the live input generation without native region churn', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'body'), interaction('body')))
  const originalRegion = regionIdFor(fixture.regions, 'body-hit')
  const nativeCallsBefore = fixture.calls.filter(([kind]) => (
    kind === 'register' || kind === 'replace-activate' || kind === 'replace-retire' || kind === 'remove'
  )).length

  await fixture.coordinator.apply(transact(key, scene('next-visual-scene', 'body'), interaction('body')))

  assert.equal(fixture.outlet.document(key).id, 'next-visual-scene')
  assert.deepEqual([...fixture.regions.keys()], [originalRegion])
  assert.equal(fixture.interactions.handleInput(pointerDown(originalRegion)), true)
  assert.equal(fixture.interactions.handleInput(pointerDrag(originalRegion)), true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'next-visual-scene')
  assert.equal(fixture.calls.filter(([kind]) => (
    kind === 'register' || kind === 'replace-activate' || kind === 'replace-retire' || kind === 'remove'
  )).length, nativeCallsBefore)
})

test('visual-only pointer-effect revisions retain regions while canonical authorization advances', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  const interactions = pointerEffectInteraction('body')
  const mounted = await fixture.coordinator.apply(mount(
    key,
    { ...scene('old-scene', 'body'), revision: 1 },
    interactions,
  ))
  const originalRegion = regionIdFor(fixture.regions, 'body-hit')
  assert.equal(fixture.regions.get(originalRegion).metadata.scene_revision, '1')
  assert.equal(fixture.regions.get(originalRegion).metadata.scene_input_generation, mounted.inputGeneration)
  const nativeCallsBefore = fixture.calls.filter(([kind]) => (
    kind === 'register' || kind === 'replace-activate' || kind === 'replace-retire' || kind === 'remove'
  )).length

  const transacted = await fixture.coordinator.apply(transact(
    key,
    { ...scene('next-visual-scene', 'body'), revision: 2 },
    interactions,
  ))

  const currentRegion = regionIdFor(fixture.regions, 'body-hit')
  assert.equal(currentRegion, originalRegion)
  assert.equal(fixture.regions.get(currentRegion).metadata.scene_revision, '1')
  assert.equal(transacted.inputGeneration, mounted.inputGeneration)
  assert.equal(fixture.calls.filter(([kind]) => (
    kind === 'register' || kind === 'replace-activate' || kind === 'replace-retire' || kind === 'remove'
  )).length, nativeCallsBefore)
  assert.equal(fixture.interactions.handleInput(pointerDown(currentRegion)), true)
  assert.equal(fixture.interactions.handleInput(pointerDrag(currentRegion)), true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'next-visual-scene')
  assert.equal(fixture.emittedEvents.length, 2)
  assert.ok(fixture.emittedEvents.every((event) => (
    event.input_generation === mounted.inputGeneration
    && event.event.input_generation === undefined
  )))
})

test('failed visual-only commit retires the retained input generation with the scene', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ rejectReplacementCommit: true })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'body'), interaction('body')))

  await assert.rejects(
    fixture.coordinator.apply(transact(key, scene('next-visual-scene', 'body'), interaction('body'))),
    /fixture replacement commit failure/u,
  )

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
})

test('stage fault retirement closes visual and input ownership as one aggregate', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(key, scene('faulted-scene', 'body'), interaction('body')))

  assert.equal(await fixture.coordinator.failClosed('SCENE_EXTENSION_TICK_FAILED'), true)
  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
  await assert.rejects(
    fixture.coordinator.apply(mount(key, scene('late-scene', 'body'), interaction('body'))),
    /coordinator is closed/u,
  )
})

test('stage retirement rolls back an uncommitted visual and input candidate', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  await fixture.coordinator.prepare(
    'pending-at-disposal',
    mount(key, scene('candidate-scene', 'candidate-body'), interaction('candidate-body')),
  )

  await fixture.coordinator.failClosed('stage_disposed')

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
})

test('stage suspension keeps mounts inert until visual and input state resume together', async () => {
  const firstKey = 'example.consumer::companion/main'
  const secondKey = 'example.consumer::tool/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(firstKey, scene('first-scene', 'first-body'), interaction('first-body')))
  const firstRegion = regionIdFor(fixture.regions, 'first-body-hit')
  assert.ok(fixture.regions.size > 0)

  await fixture.coordinator.suspend()
  assert.equal(fixture.regions.size, 0)
  const dispatchesAtSuspend = fixture.dispatchedScenes.length
  assert.equal(fixture.coordinator.handleInput(pointerDown(firstRegion)), true)
  assert.equal(fixture.dispatchedScenes.length, dispatchesAtSuspend)
  await fixture.coordinator.apply(mount(secondKey, scene('second-scene', 'second-body'), interaction('second-body')))
  assert.equal(fixture.regions.size, 0)

  await fixture.coordinator.resume()
  assert.equal(regionIdFor(fixture.regions, 'first-body-hit') !== null, true)
  assert.equal(regionIdFor(fixture.regions, 'second-body-hit') !== null, true)
  assert.deepEqual(
    fixture.calls.filter(([kind]) => kind === 'outlet-stage'),
    [['outlet-stage', 'suspend'], ['outlet-stage', 'resume']],
  )
})

function play(key, operationId = null) {
  return {
    type: 'desktop_world_stage.scene.operation',
    payload: {
      lease_key: key,
      ...(operationId === null ? {} : { operation_id: operationId }),
      operation: { op: 'play', animationId: 'entrance' },
    },
  }
}

test('spatial play quiesces native input before visual animation starts', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ spatialAnimation: true })
  await fixture.coordinator.apply(mount(key, scene('animated-scene', 'body'), interaction('body')))
  const regionId = regionIdFor(fixture.regions, 'body-hit')

  assert.deepEqual(await fixture.coordinator.apply(play(key)), {
    applied: true,
    inputGeneration: 'direct-play-1',
    op: 'play',
  })

  const removalIndex = fixture.calls.findIndex(([kind, id]) => kind === 'remove' && id === regionId)
  const playIndex = fixture.calls.findIndex(([kind, op]) => kind === 'outlet' && op === 'play')
  assert.ok(removalIndex >= 0 && removalIndex < playIndex)
  assert.equal(fixture.regions.has(regionId), false)
  assert.equal(fixture.interactions.snapshot(key).leases[0].animationGeneration, 1)
  assert.equal(fixture.interactions.snapshot(key).leases[0].animationQuiesced, true)
})

test('spatial play preserves its shared input identity through signals and terminal geometry', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ spatialAnimation: true })
  await fixture.coordinator.apply(mount(key, scene('animated-scene', 'body'), interaction('body')))

  assert.deepEqual(await fixture.coordinator.apply(play(key, 'shared-play-operation')), {
    applied: true,
    inputGeneration: 'shared-play-operation',
    op: 'play',
  })
  const signaled = await fixture.coordinator.apply({
    type: 'desktop_world_stage.scene.operation',
    payload: { lease_key: key, operation: { op: 'signal', signalId: 'presence', value: 0.5 } },
  })
  assert.equal(signaled.inputGeneration, 'shared-play-operation')
  assert.equal(await fixture.interactions.settleAnimationGeometry(key, 1), true)

  const terminalRegion = regionIdFor(fixture.regions, 'body-hit')
  assert.match(terminalRegion, /:generation:shared-play-operation$/u)
  assert.equal(
    fixture.regions.get(terminalRegion).metadata.scene_input_generation,
    'shared-play-operation',
  )
  assert.equal(fixture.interactions.handleInput(pointerDown(terminalRegion)), true)
  assert.equal(fixture.interactions.handleInput(pointerDrag(terminalRegion)), true)
  assert.ok(fixture.emittedEvents.length > 0 && fixture.emittedEvents.every((event) => (
    event.input_generation === 'shared-play-operation'
  )))
})

test('nonspatial play leaves native input active', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  const mounted = await fixture.coordinator.apply(
    mount(key, scene('material-scene', 'body'), interaction('body')),
  )
  const regionId = regionIdFor(fixture.regions, 'body-hit')

  assert.deepEqual(await fixture.coordinator.apply(play(key)), {
    applied: true,
    inputGeneration: mounted.inputGeneration,
    op: 'play',
  })

  assert.equal(fixture.calls.some(([kind, id]) => kind === 'remove' && id === regionId), false)
  assert.equal(fixture.regions.has(regionId), true)
  assert.equal(fixture.interactions.handleInput(pointerDown(regionId)), true)
})

test('failed spatial play restores the authored native input region', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ rejectPlay: true, spatialAnimation: true })
  await fixture.coordinator.apply(mount(key, scene('animated-scene', 'body'), interaction('body')))
  const regionId = regionIdFor(fixture.regions, 'body-hit')

  await assert.rejects(fixture.coordinator.apply(play(key)), /fixture play failure/u)

  assert.equal(fixture.regions.has(regionId), true)
  assert.equal(fixture.interactions.snapshot(key).leases[0].animationGeneration, null)
  assert.equal(fixture.interactions.snapshot(key).leases[0].animationQuiesced, false)
  assert.equal(fixture.interactions.handleInput(pointerDown(regionId)), true)
})

test('failed interaction registration restores the prior scene document and regions', async () => {
  const key = 'example.consumer::companion/main'
  const oldScene = scene('old-scene', 'old-body')
  const oldInteractions = interaction('old-body')
  const nextScene = scene('next-scene', 'next-body')
  const nextInteractions = interaction('next-body')
  const { coordinator, interactions, outlet } = harness({ failAffordance: 'next-body-hit' })

  await coordinator.apply(mount(key, oldScene, oldInteractions))
  await assert.rejects(coordinator.apply(mount(key, nextScene, nextInteractions)), /registration unavailable/u)

  assert.equal(outlet.document(key).id, 'old-scene')
  assert.equal(interactions.configuration(key).interactions.affordances[0].id, 'old-body-hit')
})

test('failed first activation leaves no scene or interaction lease', async () => {
  const key = 'example.consumer::companion/main'
  const { coordinator, interactions, outlet } = harness({ failAffordance: 'next-body-hit' })

  await assert.rejects(coordinator.apply(mount(key, scene('next-scene', 'next-body'), interaction('next-body'))), /registration unavailable/u)

  assert.equal(outlet.document(key), null)
  assert.equal(interactions.configuration(key), null)
})

test('a replacement mount without interactions deliberately retires old hit regions', async () => {
  const key = 'example.consumer::companion/main'
  const { coordinator, interactions, outlet } = harness()
  await coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))

  await coordinator.apply(mount(key, scene('static-scene', 'static-body')))

  assert.equal(outlet.document(key).id, 'static-scene')
  assert.equal(interactions.configuration(key), null)
})

test('replacement keeps the old scene and input aggregate active until deferred registration commits', async () => {
  const key = 'example.consumer::companion/main'
  const oldScene = scene('old-scene', 'old-body')
  const nextScene = scene('next-scene', 'next-body')
  const fixture = harness({ deferAffordance: 'next-body-hit' })
  await fixture.coordinator.apply(mount(key, oldScene, interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')

  const replacing = fixture.coordinator.apply(mount(key, nextScene, interaction('next-body')))
  await fixture.registrationStarted
  const nextRegion = regionIdFor(fixture.regions, 'next-body-hit')

  assert.equal(fixture.outlet.document(key).id, 'old-scene')
  assert.equal(fixture.interactions.configuration(key).interactions.affordances[0].id, 'old-body-hit')
  assert.equal(fixture.regions.has(oldRegion), true)
  assert.equal(fixture.regions.get(nextRegion).enabled, false)
  assert.equal(fixture.coordinator.handleInput(pointerDown(oldRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDown(nextRegion)), true)

  fixture.releaseRegistration()
  await replacing
  assert.equal(fixture.outlet.document(key).id, 'next-scene')
  assert.equal(fixture.regions.has(oldRegion), false)
  assert.equal(fixture.regions.has(nextRegion), true)
  assert.equal(fixture.regions.get(nextRegion).enabled, true)
  assert.equal(fixture.coordinator.handleInput(pointerDown(nextRegion)), true)
})

test('reused affordance IDs keep candidate native regions isolated until the aggregate commits', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ deferAffordance: 'body-hit', deferRegistrationNumber: 2 })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'body'), interaction('body')))
  const oldRegion = regionIdFor(fixture.regions, 'body-hit')

  const replacing = fixture.coordinator.apply(mount(
    key,
    scene('next-scene', 'body', [500, 200, 0]),
    interaction('body'),
  ))
  await fixture.registrationStarted
  const candidateRegion = regionIdFor(fixture.regions, 'body-hit', { exclude: oldRegion })

  assert.notEqual(candidateRegion, oldRegion)
  assert.deepEqual(fixture.regions.get(oldRegion).frame, [60, 170, 80, 60])
  assert.deepEqual(fixture.regions.get(candidateRegion).frame, [460, 170, 80, 60])
  assert.equal(fixture.regions.get(candidateRegion).enabled, false)
  assert.equal(fixture.outlet.document(key).id, 'old-scene')
  assert.equal(fixture.coordinator.handleInput(pointerDown(oldRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(oldRegion)), true)
  assert.ok(fixture.dispatchedScenes.length > 0)
  assert.ok(fixture.dispatchedScenes.every((id) => id === 'old-scene'))
  const dispatchedBeforeCandidate = fixture.dispatchedScenes.length
  assert.equal(fixture.coordinator.handleInput(pointerDown(candidateRegion)), true)
  assert.equal(fixture.dispatchedScenes.length, dispatchedBeforeCandidate)

  fixture.releaseRegistration()
  await replacing
  assert.equal(fixture.regions.has(oldRegion), false)
  assert.equal(fixture.regions.get(candidateRegion).enabled, true)
  assert.equal(fixture.coordinator.handleInput(pointerDown(candidateRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(candidateRegion, 3)), true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'next-scene')
})

test('atomic native generation replacement keeps old input live and replays candidate input after commit', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ deferThenResolveUpdateAffordance: 'next-body-hit' })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')

  const replacing = fixture.coordinator.apply(mount(
    key,
    scene('next-scene', 'next-body', [500, 200, 0]),
    interaction('next-body'),
  ))
  await fixture.updateStarted
  const candidateRegion = regionIdFor(fixture.regions, 'next-body-hit')

  assert.equal(fixture.regions.get(oldRegion).enabled, true)
  assert.equal(fixture.regions.get(candidateRegion).enabled, false)
  assert.equal(fixture.coordinator.handleInput(pointerDown(oldRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(oldRegion)), true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'old-scene')
  const beforeCandidate = fixture.dispatchedScenes.length
  assert.equal(fixture.coordinator.handleInput(pointerDown(candidateRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(candidateRegion, 3)), true)
  assert.equal(fixture.dispatchedScenes.length, beforeCandidate)

  fixture.releaseDeferredUpdate()
  await replacing

  assert.equal(fixture.regions.has(oldRegion), false)
  assert.equal(fixture.regions.get(candidateRegion).enabled, true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'next-scene')
})

test('failed candidate input replay retires both visual and interaction state', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ deferThenResolveUpdateAffordance: 'next-body-hit' })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))

  const replacing = fixture.coordinator.apply(mount(
    key,
    scene('next-scene', 'next-body', [500, 200, 0]),
    interaction('next-body'),
  ))
  await fixture.updateStarted
  const candidateRegion = regionIdFor(fixture.regions, 'next-body-hit')
  assert.equal(fixture.coordinator.handleInput(pointerDown(candidateRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(candidateRegion)), true)
  const malformed = pointerDrag(candidateRegion, 3)
  assert.equal(fixture.coordinator.handleInput(malformed), true)
  delete malformed.routed_input

  fixture.releaseDeferredUpdate()
  await assert.rejects(replacing, /input-region settlement failed/u)

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
  assert.deepEqual(fixture.emittedEvents, [])
})

test('applied-then-rejected candidate registration is journaled before transport acknowledgement', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ applyThenRejectAffordance: 'next-body-hit' })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')

  await assert.rejects(
    fixture.coordinator.apply(mount(key, scene('next-scene', 'next-body'), interaction('next-body'))),
    /registration acknowledgement unavailable/u,
  )

  assert.equal(fixture.outlet.document(key).id, 'old-scene')
  assert.equal(fixture.interactions.configuration(key).interactions.affordances[0].id, 'old-body-hit')
  assert.deepEqual([...fixture.regions.keys()], [oldRegion])
})

test('applied-then-rejected candidate activation fails closed without retaining either generation', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ applyThenRejectUpdateAffordance: 'next-body-hit' })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))

  await assert.rejects(
    fixture.coordinator.apply(mount(key, scene('next-scene', 'next-body'), interaction('next-body'))),
    /activation acknowledgement unavailable/u,
  )

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
})

test('candidate generation remains staged until every region activation settles', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({ deferThenRejectUpdateAffordance: 'next-b-hit' })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))

  const replacing = fixture.coordinator.apply(mount(
    key,
    sceneWithObjects('next-scene', [
      { id: 'next-a', position: [200, 200, 0] },
      { id: 'next-b', position: [400, 200, 0] },
    ]),
    interactionsForObjects(['next-a', 'next-b']),
  ))
  await fixture.updateStarted
  const firstCandidate = regionIdFor(fixture.regions, 'next-a-hit')
  const secondCandidate = regionIdFor(fixture.regions, 'next-b-hit')

  assert.equal(fixture.regions.get(firstCandidate).enabled, false)
  assert.equal(fixture.regions.get(secondCandidate).enabled, false)
  const dispatchedBeforeCandidate = fixture.dispatchedScenes.length
  assert.equal(fixture.coordinator.handleInput(pointerDown(firstCandidate)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(firstCandidate)), true)
  assert.equal(fixture.dispatchedScenes.length, dispatchedBeforeCandidate)

  const rejection = assert.rejects(replacing, /second activation acknowledgement unavailable/u)
  fixture.rejectDeferredUpdate(new Error('second activation acknowledgement unavailable'))
  await rejection

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.deepEqual([...fixture.regions.keys()], [])
  assert.equal(fixture.dispatchedScenes.includes('next-scene'), false)
})

test('failed retired-region settlement rejects and retries cleanup from a fail-closed scene', async () => {
  const key = 'example.consumer::companion/main'
  const scheduledCleanup = []
  let blockOldRemoval = true
  const fixture = harness({
    remove: async ({ payload }) => {
      if (blockOldRemoval && payload?.metadata.scene_affordance === 'old-body-hit') {
        throw new Error('retired region unavailable')
      }
    },
    scheduleTimer(callback) {
      scheduledCleanup.push(callback)
      return scheduledCleanup.length
    },
  })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')

  await assert.rejects(
    fixture.coordinator.apply(mount(key, scene('next-scene', 'next-body'), interaction('next-body'))),
    /cleanup both failed/u,
  )

  assert.equal(fixture.outlet.document(key), null)
  assert.equal(fixture.interactions.configuration(key), null)
  assert.equal(fixture.regions.get(oldRegion).enabled, false)
  assert.equal(fixture.regions.get(oldRegion).consume_policy, 'never')
  assert.equal(scheduledCleanup.length, 1)

  blockOldRemoval = false
  await scheduledCleanup.shift()()
  assert.deepEqual([...fixture.regions.keys()], [])
})

test('fail-closed rejects when a retired native region cannot be disabled or removed', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness({
    rejectDisableAffordance: 'body-hit',
    remove: async () => { throw new Error('region removal unavailable') },
  })
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'body'), interaction('body')))
  const regionId = regionIdFor(fixture.regions, 'body-hit')

  await assert.rejects(
    fixture.coordinator.failClosed('SCENE_SEGMENT_FAILED'),
    /cleanup errors/u,
  )

  assert.equal(fixture.regions.get(regionId).enabled, true)
  assert.notEqual(fixture.interactions.configuration(key), null)
  const dispatches = fixture.dispatchedScenes.length
  assert.equal(fixture.coordinator.handleInput(pointerDown(regionId)), false)
  assert.equal(fixture.dispatchedScenes.length, dispatches)
})

test('two-phase replacement keeps the old aggregate authoritative until commit', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')

  const prepared = await fixture.coordinator.prepare(
    'replacement-one',
    mount(key, scene('next-scene', 'next-body'), interaction('next-body')),
  )
  const candidateRegion = regionIdFor(fixture.regions, 'next-body-hit')
  assert.equal(typeof prepared.candidateFingerprint, 'string')
  assert.match(candidateRegion, /:generation:replacement-one$/u)
  assert.equal(fixture.outlet.document(key).id, 'old-scene')
  assert.equal(fixture.coordinator.handleInput(pointerDown(candidateRegion)), true)
  assert.equal(fixture.dispatchedScenes.includes('next-scene'), false)
  assert.equal(fixture.coordinator.handleInput(pointerDown(oldRegion)), true)
  assert.equal(fixture.coordinator.handleInput(pointerDrag(oldRegion)), true)
  assert.equal(fixture.dispatchedScenes.at(-1), 'old-scene')

  const committed = await fixture.coordinator.commit('replacement-one')
  assert.equal(committed.candidateFingerprint, prepared.candidateFingerprint)
  assert.equal(fixture.outlet.document(key).id, 'next-scene')
  assert.equal(fixture.interactions.configuration(key).interactions.affordances[0].id, 'next-body-hit')
})

test('candidate prepared while suspended registers input only after stage resume', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.suspend()
  await fixture.coordinator.prepare(
    'suspended-prepare',
    mount(key, scene('next-scene', 'next-body'), interaction('next-body')),
  )
  assert.equal(fixture.regions.size, 0)

  await fixture.coordinator.resume()
  await fixture.coordinator.commit('suspended-prepare')

  assert.notEqual(regionIdFor(fixture.regions, 'next-body-hit'), null)
})

test('candidate committed during suspension remains inert until stage resume', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.prepare(
    'suspended-commit',
    mount(key, scene('next-scene', 'next-body'), interaction('next-body')),
  )
  assert.notEqual(regionIdFor(fixture.regions, 'next-body-hit'), null)

  await fixture.coordinator.suspend()
  await fixture.coordinator.commit('suspended-commit')
  assert.equal(fixture.regions.size, 0)

  await fixture.coordinator.resume()
  assert.notEqual(regionIdFor(fixture.regions, 'next-body-hit'), null)
})

test('two-phase abort removes the candidate and preserves the old aggregate', async () => {
  const key = 'example.consumer::companion/main'
  const fixture = harness()
  await fixture.coordinator.apply(mount(key, scene('old-scene', 'old-body'), interaction('old-body')))
  const oldRegion = regionIdFor(fixture.regions, 'old-body-hit')
  await fixture.coordinator.prepare(
    'replacement-abort',
    mount(key, scene('next-scene', 'next-body'), interaction('next-body')),
  )

  await fixture.coordinator.abort('replacement-abort')

  assert.equal(fixture.outlet.document(key).id, 'old-scene')
  assert.equal(fixture.interactions.configuration(key).interactions.affordances[0].id, 'old-body-hit')
  assert.deepEqual([...fixture.regions.keys()], [oldRegion])
})
