import assert from 'node:assert/strict'
import test from 'node:test'

import { applyDesktopWorldSceneOperation } from '../../packages/toolkit/components/desktop-world-stage/scene-extension-operation.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function mount(extension = null) {
  return {
    payload: {
      owner: 'io.ch-osctrl.sigil',
      operation: {
        op: 'mount',
        ...(extension ? { extension } : {}),
      },
    },
  }
}

test('extension admission completes before atomic scene replacement starts', async () => {
  const loading = deferred()
  const calls = []
  const message = mount({ ownerId: 'io.ch-osctrl.sigil' })
  const result = applyDesktopWorldSceneOperation({
    extensionLoader: {
      ensure(reference) {
        calls.push(['ensure', reference])
        return loading.promise
      },
    },
    message,
    operations: {
      apply(value) {
        calls.push(['apply', value])
        return { applied: true }
      },
    },
  })
  await Promise.resolve()
  assert.deepEqual(calls, [['ensure', message.payload.operation.extension]])
  loading.resolve()
  assert.deepEqual(await result, { applied: true })
  assert.deepEqual(calls, [
    ['ensure', message.payload.operation.extension],
    ['apply', message],
  ])
})

test('failed extension admission has zero scene replacement effects', async () => {
  let applyCount = 0
  await assert.rejects(
    applyDesktopWorldSceneOperation({
      extensionLoader: { ensure: async () => { throw new Error('not installed') } },
      message: mount({ ownerId: 'io.ch-osctrl.sigil' }),
      operations: { apply() { applyCount += 1 } },
    }),
    /not installed/,
  )
  assert.equal(applyCount, 0)
})

test('owner mismatch is rejected before extension loading or scene replacement', async () => {
  let ensureCount = 0
  let applyCount = 0
  const message = mount({ ownerId: 'io.example.other' })
  await assert.rejects(
    applyDesktopWorldSceneOperation({
      extensionLoader: { ensure() { ensureCount += 1 } },
      message,
      operations: { apply() { applyCount += 1 } },
    }),
    (error) => error.code === 'SCENE_EXTENSION_OWNER_MISMATCH',
  )
  assert.equal(ensureCount, 0)
  assert.equal(applyCount, 0)
})

test('generic and non-mount operations preserve the existing operation path', async () => {
  let ensureCount = 0
  const extensionLoader = { ensure() { ensureCount += 1 } }
  const operations = { apply: (message) => ({ message }) }
  const generic = mount()
  const transaction = { payload: { operation: { op: 'transact' } } }
  assert.deepEqual(
    await applyDesktopWorldSceneOperation({ extensionLoader, message: generic, operations }),
    { message: generic },
  )
  assert.deepEqual(
    await applyDesktopWorldSceneOperation({ extensionLoader, message: transaction, operations }),
    { message: transaction },
  )
  assert.equal(ensureCount, 0)
})

test('barrier preparation admits extension bytes once before commit', async () => {
  const calls = []
  const message = mount({ ownerId: 'io.ch-osctrl.sigil' })
  message.payload.operation_id = 'operation-one'
  message.payload.barrier_phase = 'prepare'
  const operations = {
    apply() { throw new Error('unexpected direct apply') },
    prepare(id, value) {
      calls.push(['prepare', id, value])
      return { applied: true, candidateFingerprint: 'candidate' }
    },
    commit(id) {
      calls.push(['commit', id])
      return { applied: true, candidateFingerprint: 'candidate' }
    },
  }
  const extensionLoader = {
    ensure(reference) {
      calls.push(['ensure', reference])
      return Promise.resolve()
    },
  }

  assert.deepEqual(
    await applyDesktopWorldSceneOperation({ extensionLoader, message, operations }),
    { applied: true, candidateFingerprint: 'candidate' },
  )
  const commit = structuredClone(message)
  commit.payload.barrier_phase = 'commit'
  assert.deepEqual(
    await applyDesktopWorldSceneOperation({ extensionLoader, message: commit, operations }),
    { applied: true, candidateFingerprint: 'candidate' },
  )
  assert.deepEqual(calls.map(([name]) => name), ['ensure', 'prepare', 'commit'])
})
