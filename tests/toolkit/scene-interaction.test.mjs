import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_EVENT_CONTRACT_ID,
  createSceneEventEnvelope,
  createSceneGestureArena,
  resolveSceneAffordanceFrame,
  resolveSceneGestureResponse,
  validateSceneAffordanceDescriptor,
  validateSceneInteractionDocument,
} from '../../packages/toolkit/scene/index.js'

const document = {
  contract: 'aos.scene.document.v1',
  schemaVersion: 1,
  id: 'samples/interactions',
  revision: 1,
  rootObjectId: 'root',
  objects: [
    { id: 'root', parentId: null, kind: 'group', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
    { id: 'body', parentId: 'root', kind: 'mesh', transform: { position: [100, 200, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, visible: true, geometryId: null, materialId: null, components: [] },
  ],
  resources: [],
  metadata: {},
}

const affordance = {
  id: 'body',
  objectId: 'body',
  geometry: { kind: 'rect', width: 80, height: 60, offset: [10, -10] },
  enabled: true,
  priority: 100,
  consumePolicy: 'captured',
  metadata: { label: 'Body' },
}

function interaction(id, recognizer, response, parameters = {}) {
  return {
    id,
    affordanceId: 'body',
    recognizer: { implementation: recognizer, parameters },
    response: { implementation: response, parameters: {} },
  }
}

function pointer(type, x, y, sequence = 1) {
  const phase = type === 'left_mouse_down' ? 'down' : type === 'left_mouse_up' ? 'up' : type === 'pointer_cancel' ? 'cancel' : 'drag'
  return {
    routed_schema_version: 1,
    event_kind: type === 'pointer_cancel' ? 'cancel' : 'pointer',
    type,
    phase,
    delivery_role: 'captured',
    sequence: { source: 'daemon', value: sequence },
    gesture_id: 'gesture-1',
    capture_id: 'capture-1',
    desktop_world: { x, y },
    coordinate_authority: 'daemon',
    source_origin: 'daemon',
    source_event: type,
    region_id: 'scene:body',
    owner_canvas_id: 'aos-desktop-world-stage',
    button: 'left',
    buttons: { left: phase !== 'up', right: false, middle: false, other_pressed: [] },
    ...(type === 'pointer_cancel' ? { cancel_reason: 'pointer_cancelled' } : {}),
  }
}

test('scene affordances validate bounded owner-scoped geometry and resolve object-relative frames', () => {
  assert.deepEqual(validateSceneAffordanceDescriptor(affordance, { objectIds: new Set(['root', 'body']) }), { ok: true, errors: [] })
  assert.deepEqual(resolveSceneAffordanceFrame(document, affordance), [70, 160, 80, 60])

  const invalid = structuredClone(affordance)
  invalid.objectId = 'missing'
  invalid.geometry.width = 5000
  invalid.consumePolicy = 'product_magic'
  const result = validateSceneAffordanceDescriptor(invalid, { objectIds: new Set(['root', 'body']) })
  assert.equal(result.ok, false)
  for (const code of ['unknown_affordance_object', 'invalid_affordance_extent', 'invalid_consume_policy']) {
    assert.ok(result.errors.some((error) => error.code === code), code)
  }
})

test('scene affordance frames and drag deltas honor nested world transforms', () => {
  const transformed = structuredClone(document)
  transformed.objects[0].transform = {
    position: [100, 50, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [2, 1, 1],
  }
  transformed.objects[1].transform.position = [10, 0, 0]
  const nestedAffordance = {
    ...affordance,
    geometry: { kind: 'rect', width: 20, height: 10, offset: [0, 0] },
  }

  const frame = resolveSceneAffordanceFrame(transformed, nestedAffordance)
  assert.ok(Math.abs(frame[0] - 95) < 1e-9)
  assert.ok(Math.abs(frame[1] - 50) < 1e-9)
  assert.ok(Math.abs(frame[2] - 10) < 1e-9)
  assert.ok(Math.abs(frame[3] - 40) < 1e-9)

  const translated = resolveSceneGestureResponse({
    document: transformed,
    affordance: nestedAffordance,
    interaction: interaction('move', 'aos.scene.gesture.drag', 'aos.scene.response.translate'),
    frame: {
      origin: { x: 100, y: 70 },
      current: { x: 100, y: 90 },
      total_delta: { x: 0, y: 20 },
    },
  })
  assert.ok(Math.abs(translated.position[0] - 20) < 1e-9)
  assert.ok(Math.abs(translated.position[1]) < 1e-9)
})

test('scene interaction parameters reject unknown, executable, and unbounded implementation values', () => {
  const candidate = {
    contract: 'aos.scene.cartridge.interactions.v1',
    schemaVersion: 1,
    affordances: [affordance],
    interactions: [interaction('drag-body', 'aos.scene.gesture.drag', 'aos.scene.response.aim-commit', {
      callback: 'javascript:run()',
      threshold: 500,
    })],
  }
  candidate.interactions[0].response.parameters = { easing: 'spring', route: 'teleport', secretMode: true }

  const result = validateSceneInteractionDocument(candidate, { scene: document })
  assert.equal(result.ok, false)
  for (const code of ['unknown_field', 'executable_field', 'remote_runtime_value', 'invalid_recognizer_threshold', 'invalid_aim_route', 'invalid_route_easing']) {
    assert.ok(result.errors.some((error) => error.code === code), code)
  }
})

test('gesture arena deterministically claims drag and coalesces updates without dropping terminal frames', () => {
  const callbacks = []
  const frames = []
  const arena = createSceneGestureArena({
    affordance,
    interactions: [interaction('drag-body', 'aos.scene.gesture.drag', 'aos.scene.response.translate', { threshold: 4 })],
    scheduleFrame(callback) { callbacks.push(callback) },
    onFrame(frame) { frames.push(frame) },
  })

  arena.handle(pointer('left_mouse_down', 100, 200), { now: 0 })
  arena.handle(pointer('left_mouse_dragged', 110, 200, 2), { now: 10 })
  arena.handle(pointer('left_mouse_dragged', 140, 220, 3), { now: 12 })
  assert.equal(callbacks.length, 1)
  callbacks.shift()()
  arena.handle(pointer('left_mouse_up', 150, 220, 4), { now: 20 })

  assert.deepEqual(frames.map((frame) => frame.phase), ['start', 'update', 'end'])
  assert.deepEqual(frames[1].current, { x: 140, y: 220 })
  assert.deepEqual(frames[2].total_delta, { x: 50, y: 20 })
  assert.equal(arena.snapshot().active, false)
})

test('gesture release preserves its terminal pointer when the render-cadence update is still pending', () => {
  const callbacks = []
  const frames = []
  const arena = createSceneGestureArena({
    affordance,
    interactions: [interaction('drag-body', 'aos.scene.gesture.drag', 'aos.scene.response.translate', { threshold: 4 })],
    scheduleFrame(callback) { callbacks.push(callback) },
    onFrame(frame) { frames.push(frame) },
  })

  arena.handle(pointer('left_mouse_down', 100, 200), { now: 0 })
  arena.handle(pointer('left_mouse_dragged', 140, 220, 2), { now: 10 })
  arena.handle(pointer('left_mouse_up', 150, 230, 3), { now: 12 })
  callbacks.splice(0).forEach((callback) => callback())

  assert.deepEqual(frames.map((frame) => frame.phase), ['start', 'update', 'end'])
  assert.deepEqual(frames[1].current, { x: 140, y: 220 })
  assert.deepEqual(frames[2].current, { x: 150, y: 230 })
  assert.deepEqual(frames[2].total_delta, { x: 50, y: 30 })
})

test('gesture arbitration uses explicit priority while tap owns a below-threshold release', () => {
  const winners = []
  const arena = createSceneGestureArena({
    affordance,
    interactions: [
      interaction('drag-body', 'aos.scene.gesture.drag', 'aos.scene.response.translate', { priority: 10, threshold: 4 }),
      interaction('radial-body', 'aos.scene.gesture.radial', 'aos.scene.response.signal-graph', { priority: 20, threshold: 4 }),
      interaction('tap-body', 'aos.scene.gesture.tap', 'aos.scene.response.signal-graph', { threshold: 4 }),
    ],
    scheduleFrame(callback) { callback() },
    onFrame(frame) { if (frame.phase === 'start') winners.push(frame.interactionId) },
  })

  arena.handle(pointer('left_mouse_down', 100, 200), { now: 0 })
  arena.handle(pointer('left_mouse_dragged', 110, 200, 2), { now: 10 })
  arena.handle(pointer('left_mouse_up', 110, 200, 3), { now: 20 })
  arena.handle(pointer('left_mouse_down', 100, 200, 4), { now: 30 })
  arena.handle(pointer('left_mouse_up', 101, 200, 5), { now: 40 })

  assert.deepEqual(winners, ['radial-body', 'tap-body'])
})

test('long press is clock-driven and Escape cancellation preserves the accepted lifecycle', () => {
  const frames = []
  const timers = []
  const arena = createSceneGestureArena({
    affordance,
    interactions: [interaction('hold-body', 'aos.scene.gesture.long-press', 'aos.scene.response.signal-graph', { holdMs: 500, threshold: 4 })],
    scheduleFrame(callback) { callback() },
    scheduleTimer(callback, delay) { timers.push({ callback, delay }); return timers.length },
    cancelTimer() {},
    onFrame(frame) { frames.push(frame) },
  })
  arena.handle(pointer('left_mouse_down', 100, 200), { now: 0 })
  assert.equal(timers[0].delay, 500)
  assert.equal(arena.tick(499), false)
  assert.equal(arena.tick(500), true)
  arena.cancel('escape', 510)
  assert.deepEqual(frames.map((frame) => frame.phase), ['start', 'cancel'])
  assert.equal(frames[1].cancelReason, 'escape')
})

test('generic responses keep aim-and-commit stationary and translate only when selected', () => {
  const frame = {
    origin: { x: 100, y: 200 },
    current: { x: 140, y: 180 },
    total_delta: { x: 40, y: -20 },
  }
  const aimed = resolveSceneGestureResponse({
    document,
    affordance,
    interaction: interaction('aim', 'aos.scene.gesture.drag', 'aos.scene.response.aim-commit'),
    frame,
  })
  const translated = resolveSceneGestureResponse({
    document,
    affordance,
    interaction: interaction('move', 'aos.scene.gesture.drag', 'aos.scene.response.translate'),
    frame,
  })
  assert.equal(aimed.kind, 'aim_commit')
  assert.equal(aimed.distance, Math.hypot(40, -20))
  assert.deepEqual(aimed.position, [140, 180, 0])
  assert.deepEqual(document.objects[1].transform.position, [100, 200, 0])
  assert.deepEqual(translated.position, [140, 180, 0])
})

test('scene event envelopes carry stable lease identity without product semantics', () => {
  const envelope = createSceneEventEnvelope({
    identity: { stageId: 'desktop-world/main', ownerId: 'example.consumer', resourceId: 'companion/main' },
    frame: {
      affordanceId: 'body', interactionId: 'aim', gesture_id: 'g1', gesture_type: 'drag', phase: 'update',
      pointer: { capture_id: 'c1' }, origin: { x: 1, y: 2 }, previous: { x: 3, y: 4 }, current: { x: 5, y: 6 },
      coordinates: { desktop_world: { x: 5, y: 6 } }, delta: { x: 2, y: 2 }, total_delta: { x: 4, y: 4 }, cancelReason: null,
    },
    response: {
      kind: 'aim_commit', objectId: 'body', origin: { x: 1, y: 2 }, pointer: { x: 5, y: 6 },
      position: [5, 6, 0],
      angle: Math.PI / 4, distance: Math.hypot(4, 4), route: 'line', applied: false, revision: 1,
    },
    sequence: 7,
    topology: { displays: [{ displayId: 1, index: 0, bounds: [0, 0, 1440, 900] }] },
    at: 100,
  })
  assert.equal(envelope.contract, SCENE_EVENT_CONTRACT_ID)
  assert.equal(envelope.ownerId, 'example.consumer')
  assert.equal(envelope.gesture.pointerSessionId, 'c1')
  assert.deepEqual(envelope.coordinates.totalDelta, { x: 4, y: 4 })
  assert.equal(JSON.stringify(envelope).includes('Sigil'), false)
})
