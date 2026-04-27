import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createInteractionTrace } from '../../apps/sigil/renderer/live-modules/interaction-trace.js'

test('interaction trace arms, records, and stops a manual capture', () => {
  const trace = createInteractionTrace({ limit: 4 })

  const id = trace.arm('manual-repro')
  trace.record('input', { type: 'right_mouse_down', x: 10, y: 20 })
  trace.record('context-menu:open', { x: 10, y: 20 })
  const stopped = trace.stop('done')
  const snapshot = trace.snapshot()

  assert.equal(stopped.id, id)
  assert.equal(stopped.label, 'manual-repro')
  assert.equal(stopped.stopReason, 'done')
  assert.equal(stopped.count, 2)
  assert.equal(snapshot.capture, null)
  assert.equal(snapshot.latestCapture, null)
  assert.equal(snapshot.entries.length, 2)
})

test('interaction trace capture respects ring limit', () => {
  const trace = createInteractionTrace({ limit: 2 })

  trace.arm('manual-repro')
  trace.record('one')
  trace.record('two')
  trace.record('three')
  const stopped = trace.stop('done')

  assert.equal(stopped.count, 2)
  assert.deepEqual(stopped.entries.map((entry) => entry.stage), ['two', 'three'])
})
