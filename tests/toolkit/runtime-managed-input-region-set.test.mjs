import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createManagedInputRegionSet } from '../../packages/toolkit/runtime/managed-input-region-set.js'

function createHost({ rejectUpdateWithNotFound = false } = {}) {
  const calls = []
  return {
    calls,
    inputRegionRegister(payload) {
      calls.push({ method: 'register', payload })
      return Promise.resolve({ status: 'ok' })
    },
    inputRegionUpdate(payload) {
      calls.push({ method: 'update', payload })
      if (rejectUpdateWithNotFound) return Promise.reject(new Error('NOT_FOUND: missing'))
      return Promise.resolve({ status: 'ok' })
    },
    inputRegionRemove(id) {
      calls.push({ method: 'remove', id })
      return Promise.resolve()
    },
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

test('ManagedInputRegionSet registers, skips redundant sync, updates, and removes regions', () => {
  const host = createHost()
  let enabled = true
  let frame = [10, 20, 30, 40]
  const set = createManagedInputRegionSet({
    host,
    ownerCanvasId: () => 'owner-a',
    descriptors: [{
      key: 'primary',
      id: 'region-primary',
      enabled: () => enabled,
      frame: () => frame,
      semanticLabel: 'Primary generic region',
      priority: 50,
      metadata: { purpose: 'test-region' },
    }],
  })

  assert.equal(set.syncAll(), true)
  assert.equal(set.syncAll(), false)
  frame = [11, 20, 30, 40]
  assert.equal(set.sync('primary'), true)
  enabled = false
  assert.equal(set.sync('region-primary'), true)

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'update', 'remove'])
  assert.deepEqual(host.calls[0].payload, {
    id: 'region-primary',
    owner_canvas_id: 'owner-a',
    frame: [10, 20, 30, 40],
    coordinate_space: 'native',
    semantic_label: 'Primary generic region',
    priority: 50,
    consume_policy: 'captured',
    remove_on_owner_suspend: true,
    enabled: true,
    metadata: { purpose: 'test-region' },
  })
  assert.deepEqual(set.snapshot(), {
    ownerCanvasId: 'owner-a',
    regions: {
      primary: {
        id: 'region-primary',
        registered: false,
        frame: null,
      },
    },
  })
})

test('ManagedInputRegionSet uses custom payload factories and owner resolution', () => {
  const host = createHost()
  const set = createManagedInputRegionSet({
    host,
    ownerCanvasId: 'owner-b',
    descriptors: [{
      key: 'custom',
      id: 'region-custom',
      frame: () => [1, 2, 3, 4],
      payload: ({ frame, ownerCanvasId }) => ({
        id: 'region-custom',
        owner_canvas_id: ownerCanvasId,
        frame,
        coordinate_space: 'native',
        semantic_label: 'Custom',
        priority: 10,
        consume_policy: 'captured',
        remove_on_owner_suspend: true,
        enabled: true,
        metadata: { app: 'fixture' },
      }),
    }],
  })

  set.syncAll()

  assert.equal(set.currentOwnerCanvasId(), 'owner-b')
  assert.deepEqual(host.calls[0].payload.metadata, { app: 'fixture' })
  assert.deepEqual(set.snapshot().regions.custom.frame, [1, 2, 3, 4])
})

test('ManagedInputRegionSet retries register when update reports NOT_FOUND', async () => {
  const host = createHost({ rejectUpdateWithNotFound: true })
  let frame = [1, 2, 3, 4]
  const set = createManagedInputRegionSet({
    host,
    ownerCanvasId: () => 'owner-c',
    logger: { warn() {} },
    descriptors: [{
      key: 'retry',
      id: 'region-retry',
      frame: () => frame,
    }],
  })

  set.sync('retry')
  frame = [2, 2, 3, 4]
  set.sync('retry')
  await flushPromises()

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'update', 'register'])
  assert.deepEqual(host.calls[2].payload.frame, [2, 2, 3, 4])
})

test('ManagedInputRegionSet removes all descriptors and keeps snapshots keyed by descriptor', () => {
  const host = createHost()
  const set = createManagedInputRegionSet({
    host,
    ownerCanvasId: () => 'owner-d',
    descriptors: [
      { key: 'one', id: 'region-one', frame: () => [1, 1, 10, 10] },
      { key: 'two', id: 'region-two', frame: () => [2, 2, 10, 10] },
    ],
  })

  set.syncAll()
  assert.equal(set.removeAll(), true)

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'register', 'remove', 'remove'])
  assert.deepEqual(Object.keys(set.snapshot().regions), ['one', 'two'])
  assert.equal(set.snapshot().regions.one.registered, false)
  assert.equal(set.snapshot().regions.two.registered, false)
})
