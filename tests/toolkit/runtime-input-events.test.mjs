import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as runtimeFacade from '../../packages/toolkit/runtime/index.js'
import {
  createCanvasOriginInputEvent,
  isCanvasInputEventType,
  normalizeCanvasInputMessage,
  normalizeCanvasOriginInputMessage,
} from '../../packages/toolkit/runtime/input-events.js'

function inputIdentity(overrides = {}) {
  return {
    sourceOrigin: null,
    sourceCanvasId: null,
    ownerCanvasId: null,
    regionId: null,
    deliveryRole: null,
    envelopeType: null,
    ...overrides,
  }
}

test('runtime facade keeps the input identity projector private', () => {
  assert.equal(runtimeFacade.normalizeCanvasInputMessage, normalizeCanvasInputMessage)
  assert.equal(Object.hasOwn(runtimeFacade, 'projectInputIdentity'), false)
})

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
      inputIdentity: inputIdentity(),
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
      inputIdentity: inputIdentity({ envelopeType: 'input_event' }),
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
      device: 'mouse',
      timestamp_monotonic_ms: 1000,
      sequence: { source: 'daemon', value: 12 },
      gesture_id: 'g-12',
      native: { x: 10, y: 20 },
      desktop_world: { x: 110, y: 220 },
      coordinate_authority: 'daemon',
      display_id: 1,
      topology_version: 4,
      button: 'right',
      buttons: { left: false, right: true, middle: false, other_pressed: [] },
      modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
    }),
    {
      input_schema_version: 2,
      type: 'right_mouse_down',
      event_kind: 'pointer',
      phase: 'down',
      device: 'mouse',
      timestamp_monotonic_ms: 1000,
      sequence: { source: 'daemon', value: 12 },
      gesture_id: 'g-12',
      native: { x: 10, y: 20 },
      desktop_world: { x: 110, y: 220 },
      coordinate_authority: 'daemon',
      display_id: 1,
      topology_version: 4,
      button: 'right',
      buttons: { left: false, right: true, middle: false, other_pressed: [] },
      modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
      x: 110,
      y: 220,
      envelopeType: null,
      eventKind: 'pointer',
      coordinateAuthority: 'daemon',
      gestureId: 'g-12',
      captureId: null,
      deliveryRole: null,
      regionId: null,
      ownerCanvasId: null,
      sourceCanvasId: null,
      sourceOrigin: null,
      sourceSequence: { source: 'daemon', value: 12 },
      sourceEvent: null,
      inputIdentity: inputIdentity(),
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
      device: 'mouse',
      timestamp_monotonic_ms: 1000,
      sequence: { source: 'daemon', value: 13 },
      native: { x: 20, y: 40 },
      display_id: 1,
      topology_version: 4,
      scroll: { dx: 0, dy: -4, unit: 'point' },
      modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
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
    phase: 'drag',
    delivery_role: 'captured',
    sequence: { source: 'daemon', value: 18 },
    gesture_id: 'g-18',
    desktop_world: { x: 320, y: 410 },
    coordinate_authority: 'toolkit',
    source_origin: 'daemon',
    region_id: 'avatar',
    owner_canvas_id: 'avatar-main',
    capture_id: 'cap-18',
    source_event: 'daemon:18',
    source_sequence: { source: 'daemon', value: 18 },
    button: 'left',
    buttons: { left: true, right: false, middle: false, other_pressed: [] },
  })

  assert.equal(normalized.type, 'left_mouse_dragged')
  assert.equal(normalized.x, 320)
  assert.equal(normalized.y, 410)
  assert.equal(normalized.envelopeType, 'aos_routed_input')
  assert.equal(normalized.deliveryRole, 'captured')
  assert.equal(normalized.captureId, 'cap-18')
  assert.equal(normalized.regionId, 'avatar')
  assert.equal(normalized.ownerCanvasId, 'avatar-main')
  assert.equal(normalized.sourceOrigin, 'daemon')
  assert.deepEqual(normalized.sourceSequence, { source: 'daemon', value: 18 })
  assert.deepEqual(normalized.inputIdentity, inputIdentity({
    sourceOrigin: 'daemon',
    ownerCanvasId: 'avatar-main',
    regionId: 'avatar',
    deliveryRole: 'captured',
    envelopeType: 'aos_routed_input',
  }))
})

test('normalizeCanvasInputMessage unwraps input_region.event routed payloads', () => {
  const normalized = normalizeCanvasInputMessage({
    type: 'input_region.event',
    region_id: 'menu-hit',
    owner_canvas_id: 'panel',
    routed_input: {
      routed_schema_version: 1,
      event_kind: 'pointer',
      type: 'left_mouse_dragged',
      phase: 'drag',
      delivery_role: 'captured',
      sequence: { source: 'daemon', value: 33 },
      gesture_id: 'g-32',
      desktop_world: { x: 44, y: 55 },
      coordinate_authority: 'daemon',
      source_origin: 'daemon',
      source_event: 'daemon:33',
      source_sequence: { source: 'daemon', value: 33 },
      region_id: 'menu-hit',
      owner_canvas_id: 'panel',
      capture_id: 'daemon:32:menu-hit',
      button: 'left',
      buttons: { left: true, right: false, middle: false, other_pressed: [] },
    },
  })

  assert.equal(normalized.type, 'left_mouse_dragged')
  assert.equal(normalized.inputRegionEventType, 'input_region.event')
  assert.equal(normalized.envelopeType, 'input_region.event')
  assert.equal(normalized.x, 44)
  assert.equal(normalized.y, 55)
  assert.equal(normalized.deliveryRole, 'captured')
  assert.equal(normalized.regionId, 'menu-hit')
  assert.equal(normalized.ownerCanvasId, 'panel')
  assert.equal(normalized.captureId, 'daemon:32:menu-hit')
  assert.equal(normalized.sourceEvent, 'daemon:33')
  assert.deepEqual(normalized.inputIdentity, inputIdentity({
    sourceOrigin: 'daemon',
    ownerCanvasId: 'panel',
    regionId: 'menu-hit',
    deliveryRole: 'captured',
    envelopeType: 'input_region.event',
  }))
})

test('createCanvasOriginInputEvent builds stable child canvas source identity', () => {
  const event = createCanvasOriginInputEvent({
    type: 'canvas_message',
    id: 'sigil-hit-avatar-main',
    payload: {
      source_origin: 'canvas',
      source_canvas_id: 'sigil-hit-avatar-main',
      owner_canvas_id: 'avatar-main',
      kind: 'left_mouse_dragged',
      pointer_id: 9,
      offsetX: 12,
      offsetY: 18,
      screenX: 112,
      screenY: 118,
    },
  }, {
    desktopWorld: { x: 300, y: 410 },
  })

  assert.equal(event.routed_schema_version, 1)
  assert.equal(event.type, 'left_mouse_dragged')
  assert.equal(event.source_origin, 'canvas')
  assert.equal(event.source_canvas_id, 'sigil-hit-avatar-main')
  assert.equal(event.owner_canvas_id, 'avatar-main')
  assert.equal(event.region_id, 'sigil-hit-avatar-main')
  assert.equal(event.source_event, 'left_mouse_dragged')
  assert.deepEqual(event.source_sequence, {
    source: 'toolkit',
    value: 'sigil-hit-avatar-main:avatar-main:9:left',
  })
  assert.equal(event.gesture_id, 'canvas:sigil-hit-avatar-main:avatar-main:9:left')
  assert.equal(event.capture_id, 'canvas:sigil-hit-avatar-main:avatar-main:9:left:capture')
  assert.deepEqual(event.desktop_world, { x: 300, y: 410 })
  assert.equal(Object.hasOwn(event, 'child_local'), false)
  assert.equal(event.coordinate_authority, 'toolkit')
})

test('createCanvasOriginInputEvent builds canonical routed cancel events', () => {
  const event = createCanvasOriginInputEvent({
    type: 'canvas_message',
    id: 'hit-child',
    payload: {
      source_origin: 'canvas',
      source_canvas_id: 'hit-child',
      owner_canvas_id: 'owner-canvas',
      kind: 'pointer_cancel',
      cancel_reason: 'surface_removed',
    },
  }, {
    desktopWorld: { x: 3, y: 5 },
  })

  assert.equal(event.routed_schema_version, 1)
  assert.equal(event.event_kind, 'cancel')
  assert.equal(event.phase, 'cancel')
  assert.equal(event.cancel_reason, 'surface_removed')
  assert.equal(event.region_id, 'hit-child')
  assert.equal(event.owner_canvas_id, 'owner-canvas')
  assert.equal(Object.hasOwn(event, 'button'), false)
  assert.equal(Object.hasOwn(event, 'buttons'), false)
})

test('normalizeCanvasInputMessage rejects incomplete version-claiming payloads', () => {
  assert.throws(
    () => normalizeCanvasInputMessage({
      input_schema_version: 2,
      event_kind: 'scroll',
      type: 'scroll_wheel',
      phase: 'scroll',
      sequence: { source: 'daemon', value: 1 },
    }),
    /input-event-v2 payload missing required field/,
  )

  assert.throws(
    () => normalizeCanvasInputMessage({
      routed_schema_version: 1,
      event_kind: 'pointer',
      type: 'left_mouse_down',
      delivery_role: 'owned',
      sequence: { source: 'toolkit', value: 'owned-1' },
      gesture_id: 'g-owned-1',
      desktop_world: { x: 1, y: 2 },
      coordinate_authority: 'toolkit',
      source_origin: 'canvas',
      source_event: 'left_mouse_down',
      phase: 'down',
      button: 'left',
      buttons: { left: true, right: false, middle: false, other_pressed: [] },
    }),
    /routed-v1 input payload missing required field/,
  )

  assert.throws(
    () => normalizeCanvasInputMessage({
      routed_schema_version: 1,
      event_kind: 'pointer',
      type: 'left_mouse_down',
      delivery_role: 'owned',
      sequence: { source: 'toolkit', value: 'owned-2' },
      gesture_id: 'g-owned-2',
      desktop_world: { x: 1, y: 2 },
      coordinate_authority: 'toolkit',
      source_origin: 'canvas',
      source_event: { type: 'left_mouse_down' },
      region_id: 'region',
      owner_canvas_id: 'owner',
      phase: 'down',
      button: 'left',
      buttons: { left: true, right: false, middle: false, other_pressed: [] },
    }),
    /source_event object must be a raw input-event-v2 payload/,
  )
})

test('normalizeCanvasInputMessage leaves identity-only child canvas envelopes unresolved', () => {
  const normalized = normalizeCanvasInputMessage({
    type: 'canvas_message',
    id: 'sigil-hit-avatar-main',
    payload: {
      source: 'sigil-hit',
      source_origin: 'canvas',
      source_canvas_id: 'sigil-hit-avatar-main',
      owner_canvas_id: 'avatar-main',
      kind: 'left_mouse_down',
      pointer_id: 1,
      screenX: 100,
      screenY: 200,
      offsetX: 10,
      offsetY: 20,
    },
  })

  assert.equal(normalized, null)
})

test('normalizeCanvasOriginInputMessage exposes canvas-origin aliases for routers', () => {
  const normalized = normalizeCanvasOriginInputMessage({
    type: 'canvas_message',
    id: 'child-hit',
    payload: {
      source_origin: 'canvas',
      source_canvas_id: 'child-hit',
      owner_canvas_id: 'parent-canvas',
      kind: 'scroll_wheel',
      offsetX: 4,
      offsetY: 5,
      dx: 0,
      dy: -24,
    },
  }, {
    desktopWorld: { x: 44, y: 55 },
  })

  assert.equal(normalized.type, 'scroll_wheel')
  assert.equal(normalized.x, 44)
  assert.equal(normalized.y, 55)
  assert.equal(normalized.sourceOrigin, 'canvas')
  assert.equal(normalized.sourceCanvasId, 'child-hit')
  assert.equal(normalized.ownerCanvasId, 'parent-canvas')
  assert.equal(normalized.sourceEvent, 'scroll_wheel')
  assert.equal(normalized.coordinateAuthority, 'toolkit')
  assert.deepEqual(normalized.sourceSequence, {
    source: 'toolkit',
    value: 'child-hit:parent-canvas:mouse:none',
  })
  assert.deepEqual(normalized.desktop_world, { x: 44, y: 55 })
  assert.deepEqual(normalized.childLocal, { x: 4, y: 5 })
  assert.deepEqual(normalized.scroll, { dx: 0, dy: -24, unit: 'point' })
  assert.deepEqual(normalized.inputIdentity, inputIdentity({
    sourceOrigin: 'canvas',
    sourceCanvasId: 'child-hit',
    ownerCanvasId: 'parent-canvas',
    regionId: 'child-hit',
    deliveryRole: 'owned',
    envelopeType: 'aos_routed_input',
  }))
})
