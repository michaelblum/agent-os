import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCanvasInputEventType,
  normalizeCanvasInputMessage,
} from '../../packages/toolkit/runtime/input-events.js'

test('isCanvasInputEventType recognizes daemon raw input event names', () => {
  assert.equal(isCanvasInputEventType('mouse_moved'), true)
  assert.equal(isCanvasInputEventType('left_mouse_down'), true)
  assert.equal(isCanvasInputEventType('canvas_lifecycle'), false)
  assert.equal(isCanvasInputEventType(''), false)
})

test('normalizeCanvasInputMessage preserves raw daemon-delivered input messages', () => {
  assert.deepEqual(
    normalizeCanvasInputMessage({ type: 'mouse_moved', x: 120, y: 340 }),
    {
      type: 'mouse_moved',
      x: 120,
      y: 340,
      envelopeType: null,
    },
  )
})

test('normalizeCanvasInputMessage unwraps input_event payload envelopes', () => {
  assert.deepEqual(
    normalizeCanvasInputMessage({
      type: 'input_event',
      payload: { type: 'mouse_moved', x: 120, y: 340 },
    }),
    {
      type: 'mouse_moved',
      payload: { type: 'mouse_moved', x: 120, y: 340 },
      x: 120,
      y: 340,
      envelopeType: 'input_event',
    },
  )
})
