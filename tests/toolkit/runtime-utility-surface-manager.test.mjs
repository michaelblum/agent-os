import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createUtilitySurfaceManager } from '../../packages/toolkit/runtime/utility-surface-manager.js'

function configFor(kind) {
  return {
    id: `tool-${kind}`,
    url: `aos://toolkit/${kind}.html`,
    frame: [10, 20, 300, 200],
  }
}

function fakeHost(calls = []) {
  return {
    canvasCreate(payload) {
      calls.push(['create', payload])
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      calls.push(['update', payload])
    },
    canvasSuspend(id) {
      calls.push(['suspend', id])
      return Promise.resolve()
    },
    canvasResume(id) {
      calls.push(['resume', id])
      return Promise.resolve()
    },
  }
}

test('UtilitySurfaceManager creates, suspends, and resumes visible surfaces', async () => {
  const calls = []
  const hooks = []
  const manager = createUtilitySurfaceManager({
    host: fakeHost(calls),
    resolveConfig: configFor,
    onCreate: ({ config }) => hooks.push(['create', config.id]),
    onSuspend: ({ config }) => hooks.push(['suspend', config.id]),
    onResume: ({ config }) => hooks.push(['resume', config.id]),
  })

  assert.deepEqual(await manager.toggle('console'), {
    id: 'tool-console',
    frame: [10, 20, 300, 200],
    created: true,
  })
  assert.equal(manager.isVisible('tool-console'), true)
  assert.deepEqual(await manager.toggle('console'), { id: 'tool-console', suspended: true })
  assert.equal(manager.isVisible('tool-console'), false)
  assert.deepEqual(await manager.toggle('console'), {
    id: 'tool-console',
    frame: [10, 20, 300, 200],
    created: false,
    recovered: false,
  })

  assert.deepEqual(calls.map((call) => call[0]), ['create', 'suspend', 'update', 'resume'])
  assert.deepEqual(hooks, [
    ['create', 'tool-console'],
    ['suspend', 'tool-console'],
    ['resume', 'tool-console'],
  ])
})

test('UtilitySurfaceManager recovers duplicate create with update and resume', async () => {
  const calls = []
  const manager = createUtilitySurfaceManager({
    host: {
      canvasCreate(payload) {
        calls.push(['create', payload])
        return Promise.reject(new Error('DUPLICATE: exists'))
      },
      canvasUpdate(payload) {
        calls.push(['update', payload])
      },
      canvasResume(id) {
        calls.push(['resume', id])
        return Promise.resolve()
      },
      canvasSuspend() {
        return Promise.resolve()
      },
    },
    resolveConfig: configFor,
    logger: { warn() {} },
  })

  const result = await manager.ensureVisible('inspector')

  assert.deepEqual(result, {
    id: 'tool-inspector',
    frame: [10, 20, 300, 200],
    created: false,
    recovered: true,
  })
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'update', 'resume'])
  assert.equal(manager.isVisible('tool-inspector'), true)
})

test('UtilitySurfaceManager recovers duplicate toggle and prewarm creates only as collisions', async () => {
  const calls = []
  const manager = createUtilitySurfaceManager({
    host: {
      canvasCreate(payload) {
        calls.push(['create', payload])
        return Promise.reject(new Error('ID_COLLISION: exists'))
      },
      canvasUpdate(payload) {
        calls.push(['update', payload])
      },
      canvasResume(id) {
        calls.push(['resume', id])
        return Promise.resolve()
      },
      canvasSuspend(id) {
        calls.push(['suspend', id])
        return Promise.resolve()
      },
    },
    resolveConfig: configFor,
    logger: { warn() {} },
  })

  assert.deepEqual(await manager.toggle('monitor'), {
    id: 'tool-monitor',
    frame: [10, 20, 300, 200],
    created: false,
    recovered: true,
  })
  assert.equal(manager.isVisible('tool-monitor'), true)
  manager.handleLifecycle({ action: 'removed', canvas_id: 'tool-monitor' })

  assert.deepEqual(await manager.prewarm('monitor'), {
    id: 'tool-monitor',
    frame: [10, 20, 300, 200],
    created: false,
    recovered: true,
  })
  assert.equal(manager.isVisible('tool-monitor'), false)
  assert.deepEqual(calls.map((call) => call[0]), [
    'create',
    'update',
    'resume',
    'create',
    'update',
    'suspend',
  ])
})

test('UtilitySurfaceManager does not recover non-collision create failures', async () => {
  const calls = []
  const manager = createUtilitySurfaceManager({
    host: {
      canvasCreate(payload) {
        calls.push(['create', payload])
        return Promise.reject(new Error('IPC_UNAVAILABLE'))
      },
      canvasUpdate(payload) {
        calls.push(['update', payload])
      },
      canvasResume(id) {
        calls.push(['resume', id])
        return Promise.resolve()
      },
      canvasSuspend(id) {
        calls.push(['suspend', id])
        return Promise.resolve()
      },
    },
    resolveConfig: configFor,
    logger: { warn() {} },
  })

  await assert.rejects(() => manager.toggle('inspector'), /IPC_UNAVAILABLE/)
  await assert.rejects(() => manager.ensureVisible('inspector'), /IPC_UNAVAILABLE/)
  await assert.rejects(() => manager.prewarm('inspector'), /IPC_UNAVAILABLE/)
  assert.deepEqual(calls.map((call) => call[0]), ['create', 'create', 'create'])
  assert.equal(manager.current('tool-inspector'), null)
})

test('UtilitySurfaceManager dedupes concurrent ensureVisible calls', async () => {
  const calls = []
  let resolveCreate
  const manager = createUtilitySurfaceManager({
    host: {
      canvasCreate(payload) {
        calls.push(['create', payload])
        return new Promise((resolve) => {
          resolveCreate = resolve
        })
      },
      canvasUpdate() {},
      canvasResume() {
        return Promise.resolve()
      },
      canvasSuspend() {
        return Promise.resolve()
      },
    },
    resolveConfig: configFor,
  })

  const first = manager.ensureVisible('logs')
  const second = manager.ensureVisible('logs')
  assert.equal(first, second)
  resolveCreate({ id: 'tool-logs' })

  assert.deepEqual(await first, {
    id: 'tool-logs',
    frame: [10, 20, 300, 200],
    created: true,
  })
  assert.equal(calls.length, 1)
})

test('UtilitySurfaceManager updates state from lifecycle snapshots', () => {
  const changes = []
  const manager = createUtilitySurfaceManager({
    host: fakeHost(),
    resolveConfig: configFor,
    managedIds: ['tool-panel'],
    onChange: ({ id }) => changes.push(id),
  })

  assert.deepEqual(manager.handleLifecycle({
    type: 'canvas_lifecycle',
    canvas_id: 'other-panel',
    action: 'created',
  }), { handled: false, id: 'other-panel' })

  assert.equal(manager.handleLifecycle({
    type: 'canvas_lifecycle',
    canvas_id: 'tool-panel',
    action: 'created',
    at: [1, 2, 3, 4],
    suspended: false,
  }).handled, true)
  assert.deepEqual(manager.current('tool-panel'), {
    id: 'tool-panel',
    suspended: false,
    at: [1, 2, 3, 4],
  })
  assert.equal(manager.handleLifecycle({
    type: 'canvas_lifecycle',
    canvas_id: 'tool-panel',
    action: 'removed',
  }).handled, true)
  assert.equal(manager.current('tool-panel'), null)
  assert.deepEqual(changes, ['tool-panel', 'tool-panel'])
})
