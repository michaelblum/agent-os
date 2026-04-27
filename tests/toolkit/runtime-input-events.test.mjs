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

test('normalizeCanvasInputMessage adapts raw v2 pointer coordinates for current routers', () => {
  assert.deepEqual(
    normalizeCanvasInputMessage({
      input_schema_version: 2,
      type: 'right_mouse_down',
      event_kind: 'pointer',
      phase: 'down',
      sequence: { source: 'daemon', value: 12 },
      gesture_id: 'g-12',
      native: { x: 10, y: 20 },
      desktop_world: { x: 110, y: 220 },
      coordinate_authority: 'daemon',
      button: 'right',
      buttons: { left: false, right: true, middle: false, other_pressed: [] },
    }),
    {
      input_schema_version: 2,
      type: 'right_mouse_down',
      event_kind: 'pointer',
      phase: 'down',
      sequence: { source: 'daemon', value: 12 },
      gesture_id: 'g-12',
      native: { x: 10, y: 20 },
      desktop_world: { x: 110, y: 220 },
      coordinate_authority: 'daemon',
      button: 'right',
      buttons: { left: false, right: true, middle: false, other_pressed: [] },
      x: 110,
      y: 220,
      envelopeType: null,
      eventKind: 'pointer',
      coordinateAuthority: 'daemon',
      gestureId: 'g-12',
      captureId: null,
      deliveryRole: null,
      sourceEvent: null,
    },
  )
})

test('normalizeCanvasInputMessage unwraps v2 input_event envelopes', () => {
  const normalized = normalizeCanvasInputMessage({
    type: 'input_event',
    payload: {
      input_schema_version: 2,
      type: 'scroll_wheel',
      event_kind: 'scroll',
      phase: 'scroll',
      native: { x: 20, y: 40 },
      scroll: { dx: 0, dy: -4, unit: 'point' },
    },
  })

  assert.equal(normalized.type, 'scroll_wheel')
  assert.equal(normalized.x, 20)
  assert.equal(normalized.y, 40)
  assert.equal(normalized.eventKind, 'scroll')
  assert.equal(normalized.envelopeType, 'input_event')
})

test('normalizeCanvasInputMessage preserves routed delivery metadata', () => {
  const normalized = normalizeCanvasInputMessage({
    routed_schema_version: 1,
    type: 'left_mouse_dragged',
    event_kind: 'pointer',
    delivery_role: 'captured',
    sequence: { source: 'daemon', value: 18 },
    gesture_id: 'g-18',
    desktop_world: { x: 320, y: 410 },
    coordinate_authority: 'toolkit',
    region_id: 'avatar',
    capture_id: 'cap-18',
    source_event: 'daemon:18',
  })

  assert.equal(normalized.type, 'left_mouse_dragged')
  assert.equal(normalized.x, 320)
  assert.equal(normalized.y, 410)
  assert.equal(normalized.envelopeType, 'aos_routed_input')
  assert.equal(normalized.deliveryRole, 'captured')
  assert.equal(normalized.captureId, 'cap-18')
})
