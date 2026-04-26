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
