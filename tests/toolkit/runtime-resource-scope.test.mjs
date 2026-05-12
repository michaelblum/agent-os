import test from 'node:test'
import assert from 'node:assert/strict'

import { createResourceScope } from '../../packages/toolkit/runtime/resource-scope.js'
import { createResourceScope as createResourceScopeFromIndex } from '../../packages/toolkit/runtime/index.js'

test('resource scope tracks owned resources and cleans up idempotently', async () => {
  const calls = []
  const scope = createResourceScope({
    id: 'scope-a',
    ownerCanvasId: 'panel-a',
  })

  scope.addChildCanvas('child-a', {
    remove: (resource) => calls.push(['child', resource.id]),
  })
  scope.addStageLayer('layer-a', {
    remove: (resource) => calls.push(['layer', resource.id]),
  })
  scope.addInputRegion('region-a', {
    remove: (resource) => calls.push(['region', resource.id]),
  })
  scope.addSubscription(['canvas_lifecycle', 'canvas_lifecycle'])
  scope.addCleanup('custom-a', () => calls.push(['cleanup', 'custom-a']))

  assert.deepEqual(scope.getState().childCanvasIds, ['child-a'])
  assert.deepEqual(scope.getState().stageLayerIds, ['layer-a'])
  assert.deepEqual(scope.getState().inputRegionIds, ['region-a'])
  assert.deepEqual(scope.getState().subscriptionEvents, ['canvas_lifecycle'])
  assert.equal(scope.getState().active, true)

  const cleanupState = await scope.cleanup()
  const duplicateCleanupState = await scope.cleanup()

  assert.deepEqual(calls, [
    ['region', 'region-a'],
    ['layer', 'layer-a'],
    ['child', 'child-a'],
    ['cleanup', 'custom-a'],
  ])
  assert.equal(cleanupState.cleanupComplete, true)
  assert.equal(cleanupState.active, false)
  assert.equal(cleanupState.cleanupStatus.removedInputRegions, true)
  assert.equal(cleanupState.cleanupStatus.removedStageLayers, true)
  assert.equal(cleanupState.cleanupStatus.removedChildCanvases, true)
  assert.equal(cleanupState.cleanupStatus.retainedSubscriptions, true)
  assert.equal(cleanupState.cleanupStatus.unsubscribed, false)
  assert.deepEqual(cleanupState.subscriptionEventsRetained, ['canvas_lifecycle'])
  assert.deepEqual(cleanupState.subscriptionEventsUnsubscribed, [])
  assert.deepEqual(duplicateCleanupState, cleanupState)
  assert.deepEqual(cleanupState.childCanvasIds, ['child-a'])
  assert.deepEqual(cleanupState.stageLayerIds, ['layer-a'])
  assert.deepEqual(cleanupState.inputRegionIds, ['region-a'])
})

test('resource scope only unsubscribes exclusive subscriptions', async () => {
  const calls = []
  const scope = createResourceScope({ id: 'scope-a', ownerCanvasId: 'panel-a' })

  scope.addSubscription('shared_event', {
    unsubscribe: (events) => calls.push(['shared', events]),
  })
  scope.addSubscription(['exclusive_event'], {
    exclusive: true,
    unsubscribe: (events) => calls.push(['exclusive', events]),
  })

  const cleanupState = await scope.cleanup()

  assert.deepEqual(calls, [
    ['exclusive', ['exclusive_event']],
  ])
  assert.equal(cleanupState.cleanupStatus.retainedSubscriptions, true)
  assert.equal(cleanupState.cleanupStatus.unsubscribed, true)
  assert.deepEqual(cleanupState.subscriptionEventsRetained, ['shared_event'])
  assert.deepEqual(cleanupState.subscriptionEventsUnsubscribed, ['exclusive_event'])
})

test('resource scope bridge handlers become inactive after cleanup', async () => {
  const received = []
  let installed = null
  const scope = createResourceScope({ id: 'scope-a', ownerCanvasId: 'panel-a' })

  const installedResult = scope.addBridgeHandler((handler) => {
    installed = handler
  }, (message) => {
    received.push(message.type)
  })

  assert.equal(installedResult, true)
  installed({ type: 'before_cleanup' })
  await scope.cleanup()
  installed({ type: 'after_cleanup' })

  assert.deepEqual(received, ['before_cleanup'])
  assert.equal(scope.getState().bridgeHandlerCount, 1)
  assert.equal(scope.getState().active, false)
})

test('runtime public index exports resource scope helper', () => {
  assert.equal(createResourceScopeFromIndex, createResourceScope)
})
