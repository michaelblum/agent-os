import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopWorldStageDisposer,
  createDesktopWorldStageFaultRetirement,
  createDesktopWorldStageStartupGate,
  handleDesktopWorldStageLifecycle,
} from '../../packages/toolkit/components/desktop-world-stage/lifecycle.js'

test('DesktopWorld stage acknowledges renderer suspend and resume lifecycle messages', () => {
  const completed = []
  const transitions = []
  const complete = (action) => completed.push(action)
  const outlet = {
    suspend() { transitions.push('suspend'); return true },
    resume() { transitions.push('resume'); return true },
  }

  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'suspend' }, complete, outlet), true)
  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'resume' }, complete, outlet), true)
  assert.deepEqual(transitions, ['suspend', 'resume'])
  assert.deepEqual(completed, ['suspend', 'resume'])
})

test('DesktopWorld stage ignores unrelated and unsupported lifecycle messages', () => {
  const completed = []
  const complete = (action) => completed.push(action)

  assert.equal(handleDesktopWorldStageLifecycle({ type: 'canvas_lifecycle', action: 'resume' }, complete), false)
  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'reload' }, complete), false)
  assert.equal(handleDesktopWorldStageLifecycle(null, complete), false)
  assert.deepEqual(completed, [])
})

test('DesktopWorld stage fails closed when an accepted lifecycle message has no completion sink', () => {
  assert.throws(
    () => handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'resume' }),
    /requires a callback/,
  )
})

test('DesktopWorld stage does not acknowledge a rejected renderer lifecycle transition', () => {
  const completed = []
  assert.throws(
    () => handleDesktopWorldStageLifecycle(
      { type: 'lifecycle', action: 'resume' },
      (action) => completed.push(action),
      { resume: () => false },
    ),
    /resume was rejected/u,
  )
  assert.deepEqual(completed, [])
})

test('DesktopWorld stage acknowledges an asynchronous aggregate only after it settles', async () => {
  const completed = []
  let release
  const transition = new Promise((resolve) => { release = resolve })
  const result = handleDesktopWorldStageLifecycle(
    { type: 'lifecycle', action: 'suspend' },
    (action) => completed.push(action),
    { suspend: () => transition },
  )

  assert.deepEqual(completed, [])
  release(true)
  assert.equal(await result, true)
  assert.deepEqual(completed, ['suspend'])
})

test('DesktopWorld stage disposal is idempotent and reports unsettled cleanup', async () => {
  const calls = []
  const dispose = createDesktopWorldStageDisposer({
    operations: { async failClosed() { calls.push('operations') } },
    surface: { stop: () => calls.push('surface') },
    devtools: { dispose: () => calls.push('devtools') },
    interactions: {
      cancelAll: () => calls.push('cancel'),
      async dispose() { calls.push('interactions') },
    },
    outlet: { dispose: () => false },
  })
  const first = dispose()
  assert.equal(dispose(), first)
  await assert.rejects(first, /stage disposal failed/u)
  assert.deepEqual(calls, ['operations', 'surface', 'devtools', 'cancel', 'interactions'])
})

test('DesktopWorld stage fault retirement publishes once and serializes complete cleanup', async () => {
  const calls = []
  let releaseCleanup
  const cleanupGate = new Promise((resolve) => { releaseCleanup = resolve })
  const retire = createDesktopWorldStageFaultRetirement({
    cleanup: async (fault) => {
      calls.push(`cleanup:${fault.code}`)
      await cleanupGate
    },
    publish: (fault) => calls.push(`publish:${fault.code}`),
    record: (fault) => calls.push(`record:${fault.code}`),
    schedule: (work) => {
      calls.push('schedule')
      return Promise.resolve().then(work)
    },
  })

  const first = retire({ code: 'SCENE_NATIVE_DPR_UNSUPPORTED' })
  assert.equal(retire({ code: 'SCENE_SEGMENT_FAILED' }), first)
  await Promise.resolve()
  assert.deepEqual(calls, [
    'record:SCENE_NATIVE_DPR_UNSUPPORTED',
    'schedule',
    'publish:SCENE_NATIVE_DPR_UNSUPPORTED',
    'cleanup:SCENE_NATIVE_DPR_UNSUPPORTED',
  ])

  releaseCleanup()
  assert.equal(await first, true)
})

test('DesktopWorld stage fault retirement still cleans up when publication fails', async () => {
  let cleaned = false
  const retire = createDesktopWorldStageFaultRetirement({
    cleanup: async () => { cleaned = true },
    publish: () => { throw new Error('bridge unavailable') },
    record: () => {},
    schedule: (work) => Promise.resolve().then(work),
  })

  await assert.rejects(
    retire({ code: 'SCENE_SEGMENT_CONFIGURATION_FAILED' }),
    /fault retirement failed/u,
  )
  assert.equal(cleaned, true)
})

test('DesktopWorld stage startup cannot publish ready after a deferred fault', async () => {
  let generation = 0
  let state = 'active'
  let releaseRegistration
  const registration = new Promise((resolve) => { releaseRegistration = resolve })
  const isCurrent = createDesktopWorldStageStartupGate(() => ({ generation, state }))
  const emitted = []
  const startup = (async () => {
    await registration
    if (isCurrent()) emitted.push('ready')
  })()

  generation += 1
  state = 'faulted'
  releaseRegistration()
  await startup
  assert.deepEqual(emitted, [])
})
