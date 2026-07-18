import assert from 'node:assert/strict'
import test from 'node:test'

import { createDesktopWorldSceneInteractionRuntime } from '../../packages/toolkit/components/desktop-world-stage/scene-interaction-runtime.js'
import { createDesktopWorldSceneOperationCoordinator } from '../../packages/toolkit/components/desktop-world-stage/scene-operation-coordinator.js'

function scene(id, objectId) {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id,
    revision: 1,
    rootObjectId: 'root',
    objects: [
      { id: 'root', parentId: null, kind: 'group', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
      { id: objectId, parentId: 'root', kind: 'mesh', transform: { position: [100, 200, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
    ],
    resources: [],
    metadata: {},
  }
}

function interaction(objectId) {
  return {
    contract: 'aos.scene.cartridge.interactions.v1',
    schemaVersion: 1,
    affordances: [{
      id: `${objectId}-hit`,
      objectId,
      geometry: { kind: 'rect', width: 80, height: 60, offset: [0, 0] },
      enabled: true,
      priority: 100,
      consumePolicy: 'captured',
      metadata: {},
    }],
    interactions: [{
      id: `${objectId}-drag`,
      affordanceId: `${objectId}-hit`,
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
      response: { implementation: 'aos.scene.response.translate', parameters: { axis: 'both' } },
    }],
  }
}

function harness({ failAffordance = null } = {}) {
  const resources = new Map()
  const calls = []
  const outlet = {
    apply(message) {
      const key = message.payload.lease_key
      const op = message.payload.operation?.op ?? 'release'
      if (op === 'release' || op === 'remove' || op === 'close') resources.delete(key)
      else if (op === 'mount') resources.set(key, { document: message.payload.operation.document, suspended: false })
      else if (op === 'suspend' || op === 'resume') resources.get(key).suspended = op === 'suspend'
      return true
    },
    applyInteractionResponse() { return { applied: true, revision: 1 } },
    configuration(key) { return resources.get(key) ?? null },
    document(key) { return resources.get(key)?.document ?? null },
  }
  const interactions = createDesktopWorldSceneInteractionRuntime({
    outlet,
    registerRegion: async (payload) => {
      calls.push(['register', payload.metadata.scene_affordance])
      if (payload.metadata.scene_affordance === failAffordance) throw new Error('registration unavailable')
    },
    updateRegion: async () => {},
    removeRegion: async (id) => { calls.push(['remove', id]) },
    scheduleFrame(callback) { callback() },
  })
  return {
    calls,
    interactions,
    outlet,
    coordinator: createDesktopWorldSceneOperationCoordinator({ outlet, interactions }),
  }
}

function mount(key, document, interactions) {
  return {
    type: 'desktop_world_stage.scene.operation',
    payload: {
      lease_key: key,
      owner: 'example.consumer',
      resource: 'companion/main',
      operation: { op: 'mount', document, ...(interactions === undefined ? {} : { interactions }) },
    },
  }
}

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
