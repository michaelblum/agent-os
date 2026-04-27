import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMessage } from '../../apps/sigil/renderer/live-modules/input-message.js'

test('normalizeMessage unwraps legacy input_event payload type and coordinates', () => {
  const msg = normalizeMessage({
    type: 'input_event',
    payload: {
      type: 'left_mouse_down',
      x: 120,
      y: 240,
    },
  })

  assert.equal(msg.type, 'left_mouse_down')
  assert.equal(msg.envelope_type, 'input_event')
  assert.equal(msg.x, 120)
  assert.equal(msg.y, 240)
})

test('normalizeMessage preserves non-input envelope type precedence', () => {
  const msg = normalizeMessage({
    type: 'canvas_message',
    id: 'outer-id',
    payload: {
      type: 'left_mouse_down',
      id: 'payload-id',
      x: 120,
    },
  })

  assert.equal(msg.type, 'canvas_message')
  assert.equal(msg.id, 'outer-id')
  assert.equal(msg.x, 120)
  assert.equal(msg.envelope_type, undefined)
})
