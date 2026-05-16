import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('normalizeMessage preserves raw child hit-area canvas_message until parent resolution', () => {
  const msg = normalizeMessage({
    type: 'canvas_message',
    id: 'sigil-hit-avatar-main',
    payload: {
      source: 'sigil-hit',
      source_origin: 'canvas',
      source_canvas_id: 'sigil-hit-avatar-main',
      owner_canvas_id: 'avatar-main',
      source_event: 'scroll_wheel',
      kind: 'scroll_wheel',
      pointer_id: 1,
      screenX: 100,
      screenY: 200,
      offsetX: 10,
      offsetY: 20,
      dx: 0,
      dy: -24,
    },
  })

  assert.equal(msg.type, 'canvas_message')
  assert.equal(msg.id, 'sigil-hit-avatar-main')
  assert.equal(msg.payload.kind, 'scroll_wheel')
  assert.equal(msg.payload.source_canvas_id, 'sigil-hit-avatar-main')
  assert.equal(msg.payload.owner_canvas_id, 'avatar-main')
  assert.equal(msg.payload.offsetX, 10)
  assert.equal(msg.payload.offsetY, 20)
  assert.equal(msg.payload.dx, 0)
  assert.equal(msg.payload.dy, -24)
  assert.equal(msg.envelope_type, undefined)
})

test('normalizeMessage preserves radial semantic canvas_message behavior', () => {
  const msg = normalizeMessage({
    type: 'canvas_message',
    id: 'sigil-radial-menu',
    payload: {
      source: 'sigil-radial-menu-surface',
      source_origin: 'canvas',
      source_canvas_id: 'sigil-radial-menu',
      owner_canvas_id: 'avatar-main',
      source_event: 'radial_item_click',
      kind: 'radial_item_click',
      itemId: 'open-terminal',
    },
  })

  assert.equal(msg.type, 'canvas_message')
  assert.equal(msg.id, 'sigil-radial-menu')
  assert.equal(msg.payload.kind, 'radial_item_click')
  assert.equal(msg.payload.itemId, 'open-terminal')
  assert.equal(msg.envelope_type, undefined)
})

test('normalizeMessage delegates canvas-origin child input identity to toolkit normalization', () => {
  const msg = normalizeMessage({
    type: 'canvas_message',
    id: 'child-hit',
    payload: {
      source_origin: 'canvas',
      source_canvas_id: 'child-hit',
      owner_canvas_id: 'avatar-main',
      kind: 'left_mouse_down',
      offsetX: 10,
      offsetY: 12,
      desktop_world: { x: 110, y: 212 },
    },
  })

  assert.equal(msg.type, 'left_mouse_down')
  assert.equal(msg.envelope_type, 'aos_routed_input')
  assert.equal(msg.sourceOrigin, 'canvas')
  assert.equal(msg.sourceCanvasId, 'child-hit')
  assert.equal(msg.ownerCanvasId, 'avatar-main')
  assert.equal(msg.sourceEvent, 'left_mouse_down')
  assert.deepEqual(msg.childLocal, { x: 10, y: 12 })
})

test('Sigil live child input path does not reintroduce private hit-target flags', async () => {
  const [main, menu] = await Promise.all([
    readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../../apps/sigil/context-menu/menu.js', import.meta.url), 'utf8'),
  ])

  assert.match(main, /hitTarget\.ensureCreated\(\)\s*\n\s*\.then\(\(\) => \{\s*\n\s*syncHitTargetToAvatar\(\);/s)
  assert.match(main, /radialTargetSurface\.ensureCreated\(\)\s*\n\s*\.then\(\(\) => \{\s*\n\s*syncRadialTargetSurface\(\);/s)
  assert.doesNotMatch(main, /fromHitTarget/)
  assert.doesNotMatch(menu, /assumeInside/)
})
