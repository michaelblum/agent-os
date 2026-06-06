import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GESTURE_FRAME_SCHEMA,
  GESTURE_FRAME_SCHEMA_VERSION,
  bindDomPointerGesture,
  createPointerGestureStream,
} from '../../packages/toolkit/runtime/gesture-stream.js'
import { createDocument, patchSpreadSupport } from './zag-adapter-test-utils.mjs'

test('createPointerGestureStream normalizes canvas input into drag gesture frames', () => {
  const stream = createPointerGestureStream({
    kind: 'drag',
    axis: 'x',
    semantic: { targetId: 'slider:scale', action: 'set-value', kind: 'slider' },
    source: { origin: 'daemon', ownerCanvasId: 'avatar-main', sourceCanvasId: 'avatar-hit' },
  })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_down',
    gesture_id: 'g1',
    capture_id: 'c1',
    desktop_world: { x: 10, y: 20 },
  }, { now: 1000 })
  stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_dragged',
    gesture_id: 'g1',
    capture_id: 'c1',
    desktop_world: { x: 30, y: 25 },
  }, { now: 1016 })
  stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_up',
    gesture_id: 'g1',
    capture_id: 'c1',
    desktop_world: { x: 50, y: 20 },
  }, { now: 1032 })

  assert.deepEqual(frames.map((frame) => frame.type), [
    'gesture.drag.start',
    'gesture.drag.move',
    'gesture.drag.end',
  ])
  assert.equal(frames[0].schema, GESTURE_FRAME_SCHEMA)
  assert.equal(frames[0].schema_version, GESTURE_FRAME_SCHEMA_VERSION)
  assert.equal(frames[0].gesture_id, 'g1')
  assert.equal(frames[0].transaction_id, 'g1')
  assert.equal(frames[0].pointer.capture_id, 'c1')
  assert.equal(frames[0].source.owner_canvas_id, 'avatar-main')
  assert.equal(frames[0].source.source_canvas_id, 'avatar-hit')
  assert.deepEqual(frames[1].delta, { x: 20, y: 5 })
  assert.deepEqual(frames[2].total_delta, { x: 40, y: 0 })
  assert.equal(frames[2].semantic_target.id, 'slider:scale')
  assert.equal(frames[2].semantic_action, 'set-value')
  assert.equal(stream.snapshot().active, null)
})

test('createPointerGestureStream ignores orphan canvas move before a start', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  const orphan = stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_dragged',
    desktop_world: { x: 10, y: 20 },
  }, { now: 1000 })
  const start = stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_down',
    desktop_world: { x: 15, y: 25 },
  }, { now: 1016 })

  assert.equal(orphan, null)
  assert.equal(start?.type, 'gesture.drag.start')
  assert.deepEqual(frames.map((frame) => frame.type), ['gesture.drag.start'])
  assert.equal(stream.snapshot().active?.gestureId, start.gesture_id)
  assert.deepEqual(stream.snapshot().active?.origin, { x: 15, y: 25 })
})

test('createPointerGestureStream ignores orphan canvas terminal frames', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  const end = stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_up',
    desktop_world: { x: 10, y: 20 },
  }, { now: 1000 })
  const cancel = stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'pointer_cancel',
    desktop_world: { x: 10, y: 20 },
  }, { now: 1016 })

  assert.equal(end, null)
  assert.equal(cancel, null)
  assert.deepEqual(frames, [])
  assert.equal(stream.snapshot().active, null)
})

test('createPointerGestureStream publishes cancel before destroying an active stream', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  stream.handleCanvasInput({
    routed_schema_version: 1,
    type: 'left_mouse_down',
    desktop_world: { x: 1, y: 2 },
  }, { now: 1000 })
  stream.destroy()

  assert.deepEqual(frames.map((frame) => frame.type), [
    'gesture.drag.start',
    'gesture.drag.cancel',
  ])
  assert.equal(frames[1].phase, 'cancel')
  assert.equal(frames[1].raw_event_type, 'pointer_cancel')
  assert.deepEqual(frames[1].current, { x: 1, y: 2 })
  assert.equal(stream.snapshot().active, null)
})

test('createPointerGestureStream does not publish cancel when destroying an idle stream', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  stream.destroy()

  assert.deepEqual(frames, [])
  assert.equal(stream.snapshot().active, null)
})

test('createPointerGestureStream ignores orphan DOM pointer move before a start', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  const orphan = stream.handleDomEvent({ type: 'pointermove', pointerId: 7, clientX: 10, clientY: 20 }, { now: 1000 })
  const start = stream.handleDomEvent({ type: 'pointerdown', pointerId: 7, clientX: 15, clientY: 25 }, { now: 1016 })

  assert.equal(orphan, null)
  assert.equal(start?.type, 'gesture.drag.start')
  assert.deepEqual(frames.map((frame) => frame.type), ['gesture.drag.start'])
  assert.equal(stream.snapshot().active?.pointerId, 7)
  assert.deepEqual(stream.snapshot().active?.origin, { x: 15, y: 25 })
})

test('bindDomPointerGesture owns DOM capture, document listeners, and cleanup', () => {
  const document = createDocument()
  const element = patchSpreadSupport(document.createElement('div'))
  const frames = []
  const captured = []
  const released = []

  element.dataset.semanticTargetId = 'opacity'
  element.setPointerCapture = (pointerId) => captured.push(pointerId)
  element.releasePointerCapture = (pointerId) => released.push(pointerId)
  document.body.appendChild(element)

  const cleanup = bindDomPointerGesture(element, {
    semantic: { targetId: 'opacity', action: 'set-value', kind: 'slider' },
    onFrame(frame) {
      frames.push(frame)
    },
  })

  element.dispatchEvent({ type: 'pointerdown', pointerId: 7, clientX: 10, clientY: 20, currentTarget: element, preventDefault() {} })
  document.dispatchEvent({ type: 'pointermove', pointerId: 7, clientX: 30, clientY: 20, preventDefault() {} })
  document.dispatchEvent({ type: 'pointerup', pointerId: 7, clientX: 40, clientY: 20, preventDefault() {} })
  cleanup()

  assert.deepEqual(captured, [7])
  assert.deepEqual(released, [7])
  assert.deepEqual(frames.map((frame) => frame.phase), ['start', 'move', 'end'])
  assert.deepEqual(frames[1].coordinates.dom_client, { x: 30, y: 20 })
  assert.equal(frames[0].semantic_target.id, 'opacity')
  assert.equal(frames[0].source.origin, 'dom')
})

test('bindDomPointerGesture ignores mouse fallback start while a pointer gesture is active', () => {
  const document = createDocument()
  const element = patchSpreadSupport(document.createElement('div'))
  const frames = []
  document.body.appendChild(element)

  const cleanup = bindDomPointerGesture(element, {
    onFrame(frame) {
      frames.push(frame)
    },
  })

  element.dispatchEvent({ type: 'pointerdown', pointerId: 7, clientX: 10, clientY: 20, currentTarget: element, preventDefault() {} })
  element.dispatchEvent({ type: 'mousedown', clientX: 10, clientY: 20, currentTarget: element, preventDefault() {} })
  document.dispatchEvent({ type: 'pointerup', pointerId: 7, clientX: 40, clientY: 20, preventDefault() {} })
  cleanup()

  assert.deepEqual(frames.map((frame) => frame.type), [
    'gesture.drag.start',
    'gesture.drag.end',
  ])
})

test('createPointerGestureStream does not double-cancel when explicit cleanup cancel precedes destroy', () => {
  const stream = createPointerGestureStream({ kind: 'drag' })
  const frames = []
  stream.subscribe((frame) => frames.push(frame))

  stream.handleDomEvent({ type: 'pointerdown', pointerId: 7, clientX: 10, clientY: 20 }, { now: 1000 })
  stream.cancel('destroyed', {}, { now: 1016 })
  stream.destroy()

  assert.deepEqual(frames.map((frame) => frame.type), [
    'gesture.drag.start',
    'gesture.drag.cancel',
  ])
})
