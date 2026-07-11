import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import * as runtimeFacade from '../../packages/toolkit/runtime/index.js'
import { parseCanonicalInputEvent } from '../../packages/toolkit/runtime/input-event-schema.js'
import {
  createCanvasOriginInputEvent,
  isCanvasInputEventType,
  normalizeCanvasInputMessage,
  normalizeCanvasOriginInputMessage,
} from '../../packages/toolkit/runtime/input-events.js'

const fixtureRoot = new URL('../../shared/schemas/fixtures/input-event-v2/', import.meta.url)

async function inputFixtures(kind) {
  const directory = new URL(`${kind}/`, fixtureRoot)
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
  return Promise.all(names.map(async (name) => ({
    name,
    payload: JSON.parse(await readFile(new URL(name, directory), 'utf8')),
  })))
}

function clone(value) {
  return structuredClone(value)
}

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

test('normalizeCanvasInputMessage rejects unversioned raw input names', () => {
  assert.equal(normalizeCanvasInputMessage({ type: 'mouse_moved', x: 120, y: 340 }), null)
})

test('normalizeCanvasInputMessage rejects retired input_event wrappers', () => {
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_event',
    payload: { type: 'mouse_moved', x: 120, y: 340 },
  }), null)
})

test('canonical parser matches every frozen valid and invalid schema fixture', async () => {
  for (const fixture of await inputFixtures('valid')) {
    assert.equal(parseCanonicalInputEvent(fixture.payload), fixture.payload, fixture.name)
    assert.ok(normalizeCanvasInputMessage(fixture.payload), fixture.name)
  }
  for (const fixture of await inputFixtures('invalid')) {
    assert.throws(() => parseCanonicalInputEvent(fixture.payload), undefined, fixture.name)
    assert.throws(() => normalizeCanvasInputMessage(fixture.payload), undefined, fixture.name)
  }
})

test('canonical parser rejects schema-invalid scalar, enum, identity, and nested values', async () => {
  const raw = (await inputFixtures('valid')).find((fixture) => fixture.name === 'pointer-left-down.json').payload
  const routed = (await inputFixtures('valid')).find((fixture) => fixture.name === 'routed-captured-drag.json').payload
  const cases = [
    ['raw sequence source', () => { const value = clone(raw); value.sequence.source = 'legacy'; return value }],
    ['raw sequence value', () => { const value = clone(raw); value.sequence.value = -1; return value }],
    ['raw sequence fields', () => { const value = clone(raw); value.sequence.legacy = true; return value }],
    ['raw coordinate authority', () => { const value = clone(raw); value.coordinate_authority = 'webview'; return value }],
    ['raw source origin', () => { const value = clone(raw); value.source_origin = 'bridge'; return value }],
    ['raw device', () => { const value = clone(raw); value.device = 'trackpad'; return value }],
    ['raw button', () => { const value = clone(raw); value.button = 'primary'; return value }],
    ['raw display id', () => { const value = clone(raw); value.display_id = 0; return value }],
    ['raw topology', () => { const value = clone(raw); value.topology_version = -1; return value }],
    ['raw timestamp', () => { const value = clone(raw); value.timestamp_monotonic_ms = Infinity; return value }],
    ['raw gesture id', () => { const value = clone(raw); value.gesture_id = ''; return value }],
    ['raw point fields', () => { const value = clone(raw); value.native.legacy = 1; return value }],
    ['raw buttons fields', () => { const value = clone(raw); value.buttons.legacy = true; return value }],
    ['routed delivery role', () => { const value = clone(routed); value.delivery_role = 'legacy'; return value }],
    ['routed coordinate authority', () => { const value = clone(routed); value.coordinate_authority = 'webview'; return value }],
    ['routed source origin', () => { const value = clone(routed); value.source_origin = 'bridge'; return value }],
    ['routed sequence source', () => { const value = clone(routed); value.sequence.source = 'legacy'; return value }],
    ['routed point fields', () => { const value = clone(routed); value.desktop_world.legacy = 1; return value }],
    ['routed button', () => { const value = clone(routed); value.button = 'primary'; return value }],
    ['routed capture id', () => { const value = clone(routed); value.capture_id = ''; return value }],
    ['routed owner id', () => { const value = clone(routed); value.owner_canvas_id = ''; return value }],
  ]
  for (const [name, create] of cases) {
    assert.throws(() => parseCanonicalInputEvent(create()), undefined, name)
  }
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

test('normalizeCanvasInputMessage rejects input_event wrappers around canonical payloads', () => {
  assert.equal(normalizeCanvasInputMessage({
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
  }), null)
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
    owner_canvas_id: 'example-control',
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
  assert.equal(normalized.ownerCanvasId, 'example-control')
  assert.equal(normalized.sourceOrigin, 'daemon')
  assert.deepEqual(normalized.sourceSequence, { source: 'daemon', value: 18 })
  assert.deepEqual(normalized.inputIdentity, inputIdentity({
    sourceOrigin: 'daemon',
    ownerCanvasId: 'example-control',
    regionId: 'avatar',
    deliveryRole: 'captured',
    envelopeType: 'aos_routed_input',
  }))
})

test('normalizeCanvasInputMessage unwraps input_region.event routed payloads', () => {
  const normalized = normalizeCanvasInputMessage({
    type: 'input_region.event',
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

test('normalizeCanvasInputMessage rejects noncanonical input_region.event shapes', () => {
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_region.event',
    region_id: 'menu-hit',
    owner_canvas_id: 'panel',
    phase: 'down',
  }), null)

  const routedInput = {
    routed_schema_version: 1,
    event_kind: 'pointer',
    type: 'left_mouse_down',
    phase: 'down',
    delivery_role: 'owned',
    sequence: { source: 'daemon', value: 34 },
    gesture_id: 'g-34',
    desktop_world: { x: 44, y: 55 },
    coordinate_authority: 'daemon',
    source_origin: 'daemon',
    source_event: 'daemon:34',
    region_id: 'menu-hit',
    owner_canvas_id: 'panel',
    button: 'left',
    buttons: { left: true, right: false, middle: false, other_pressed: [] },
  }
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_region.event',
    payload: { routed_input: routedInput },
  }), null)
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_region.event',
    data: { routed_input: routedInput },
  }), null)
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_region.event',
    routed_input: routedInput,
    region_id: 'menu-hit',
  }), null)
  assert.equal(normalizeCanvasInputMessage({
    type: 'input_region.event',
    routed_input: routedInput,
    phase: 'down',
  }), null)
})

test('normalizeCanvasInputMessage validates direct routed input_region.event claims', () => {
  assert.throws(
    () => normalizeCanvasInputMessage({
      type: 'input_region.event',
      routed_input: {
        routed_schema_version: 1,
        event_kind: 'pointer',
        type: 'left_mouse_down',
      },
    }),
    /canonical input payload is not schema-valid/,
  )
})

test('createCanvasOriginInputEvent builds stable child canvas source identity', () => {
  const event = createCanvasOriginInputEvent({
    type: 'canvas_message',
    id: 'example-hit-control',
    payload: {
      source_origin: 'canvas',
      source_canvas_id: 'example-hit-control',
      owner_canvas_id: 'example-control',
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
  assert.equal(event.source_canvas_id, 'example-hit-control')
  assert.equal(event.owner_canvas_id, 'example-control')
  assert.equal(event.region_id, 'example-hit-control')
  assert.equal(event.source_event, 'left_mouse_dragged')
  assert.deepEqual(event.source_sequence, {
    source: 'toolkit',
    value: 'example-hit-control:example-control:9:left',
  })
  assert.equal(event.gesture_id, 'canvas:example-hit-control:example-control:9:left')
  assert.equal(event.capture_id, 'canvas:example-hit-control:example-control:9:left:capture')
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

test('createCanvasOriginInputEvent requires and preserves canonical other-button identity', () => {
  const base = {
    type: 'canvas_message',
    id: 'other-button-hit',
    payload: {
      source_canvas_id: 'other-button-hit',
      owner_canvas_id: 'owner-canvas',
      kind: 'other_mouse_down',
    },
  }
  assert.equal(createCanvasOriginInputEvent(base, { desktopWorld: { x: 3, y: 5 } }), null)
  assert.equal(createCanvasOriginInputEvent({
    ...base,
    payload: { ...base.payload, button: 'other' },
  }, { desktopWorld: { x: 3, y: 5 } }), null)

  const event = createCanvasOriginInputEvent({
    ...base,
    payload: { ...base.payload, button: 4 },
  }, {
    desktopWorld: { x: 3, y: 5 },
  })

  assert.equal(event.button, 'other:4')
  assert.deepEqual(event.buttons.other_pressed, [4])
  assert.equal(event.source_sequence.value, 'other-button-hit:owner-canvas:mouse:other:4')
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
    /canonical input payload is not schema-valid/,
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
    /canonical input payload is not schema-valid/,
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
    /canonical input payload is not schema-valid/,
  )
})

test('normalizeCanvasInputMessage leaves identity-only child canvas envelopes unresolved', () => {
  const normalized = normalizeCanvasInputMessage({
    type: 'canvas_message',
    id: 'example-hit-control',
    payload: {
      source: 'example-hit',
      source_origin: 'canvas',
      source_canvas_id: 'example-hit-control',
      owner_canvas_id: 'example-control',
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
