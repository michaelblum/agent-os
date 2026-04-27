import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHitTargetController } from '../../apps/sigil/renderer/live-modules/hit-target.js'

test('Sigil hit target requests the above-menu window level', async () => {
  const calls = []
  const runtime = {
    canvasCreate(payload) {
      calls.push(payload)
      return Promise.resolve({ id: payload.id })
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-test',
    size: 80,
  })

  await hitTarget.ensureCreated()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].window_level, 'screen_saver')
  assert.equal(calls[0].interactive, true)
})

test('Sigil hit target parents to the current canvas id when available', async () => {
  globalThis.window = { __aosCanvasId: 'sigil-status-demo' }
  try {
    const calls = []
    const runtime = {
      canvasCreate(payload) {
        calls.push(payload)
        return Promise.resolve({ id: payload.id })
      },
    }
    const hitTarget = createHitTargetController({
      runtime,
      url: 'aos://sigil/renderer/hit-area.html',
      id: 'sigil-hit-status-demo',
      size: 80,
    })

    await hitTarget.ensureCreated()

    assert.equal(calls[0].parent, 'sigil-status-demo')
    assert.match(calls[0].url, /parent=sigil-status-demo/)
  } finally {
    delete globalThis.window
  }
})

test('Sigil hit target skips redundant frame updates', async () => {
  const creates = []
  const updates = []
  const runtime = {
    canvasCreate(payload) {
      creates.push(payload)
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      updates.push(payload)
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-test',
    size: 80,
  })

  await hitTarget.ensureCreated()
  hitTarget.sync({ x: 100, y: 100, valid: true }, true)
  hitTarget.sync({ x: 100, y: 100, valid: true }, true)
  hitTarget.syncFrame([60, 60, 80, 80], true)

  assert.equal(creates.length, 1)
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], { id: 'sigil-hit-test', frame: [60, 60, 80, 80] })
})
