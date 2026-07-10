import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizeMessage } from '../../apps/sigil/renderer/live-modules/input-message.js'

test('normalizeMessage delegates canonical raw v2 input to toolkit normalization', () => {
  const msg = normalizeMessage({
    input_schema_version: 2,
    event_kind: 'pointer',
    type: 'left_mouse_down',
    phase: 'down',
    device: 'mouse',
    timestamp_monotonic_ms: 1,
    sequence: { source: 'daemon', value: 1 },
    native: { x: 120, y: 240 },
    display_id: 1,
    topology_version: 1,
    button: 'left',
    buttons: { left: true, right: false, middle: false, other_pressed: [] },
    modifiers: { shift: false, ctrl: false, cmd: false, opt: false, fn: false, caps_lock: false },
  })

  assert.equal(msg.type, 'left_mouse_down')
  assert.equal(msg.input_schema_version, 2)
  assert.equal(msg.envelope_type, null)
  assert.equal(msg.x, 120)
  assert.equal(msg.y, 240)
})

test('normalizeMessage rejects retired input_event wrappers', () => {
  assert.equal(normalizeMessage({
    type: 'input_event',
    payload: { type: 'left_mouse_down', x: 120, y: 240 },
  }), null)
})

test('normalizeMessage rejects unversioned raw input names', () => {
  assert.equal(normalizeMessage({
    type: 'left_mouse_down',
    x: 120,
    y: 240,
  }), null)
})

test('normalizeMessage rejects noncanonical input region events', () => {
  assert.equal(normalizeMessage({
    type: 'input_region.event',
    region_id: 'legacy-region',
    phase: 'down',
  }), null)
})

test('Sigil global routing identifies input by canonical schema claims', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const classifier = main.match(/function isCanonicalInputMessage\(msg = \{\}\) \{[\s\S]*?\n\}/)?.[0] || ''
  const globalFilter = main.match(/function shouldProcessGlobalDaemonEvent\(msg = \{\}\) \{[\s\S]*?\n\}/)?.[0] || ''

  assert.match(classifier, /msg\.input_schema_version === 2/)
  assert.match(classifier, /msg\.routed_schema_version === 1/)
  assert.match(globalFilter, /isCanonicalInputMessage\(msg\)/)
  assert.doesNotMatch(globalFilter, /input_event/)
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
    readFile(new URL('../../apps/sigil/avatar-controls/surface.js', import.meta.url), 'utf8'),
  ])

  assert.match(main, /hitTarget\.ensureCreated\(\)\s*\n\s*\.then\(\(\) => \{\s*\n\s*syncHitTargetToAvatar\(\);/s)
  assert.match(main, /radialTargetSurface\.ensureCreated\(\)\s*\n\s*\.then\(\(\) => \{\s*\n\s*syncRadialTargetSurface\(\);/s)
  assert.doesNotMatch(main, /fromHitTarget/)
  assert.doesNotMatch(menu, /assumeInside/)
})

test('Sigil treats coalesced off-avatar press release travel as fast travel', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(main, /case 'PRESS':[\s\S]*distance\(x, y, liveJs\.mousedownPos\.x, liveJs\.mousedownPos\.y\) >= liveJs\.dragThreshold/)
  assert.match(main, /case 'PRESS':[\s\S]*if \(isOnAvatar\(x, y\)\) \{[\s\S]*setInteractionState\('IDLE', 'press-release-on-avatar'\)/)
  assert.match(main, /case 'PRESS':[\s\S]*queueFastTravel\(x, y\);[\s\S]*setInteractionState\('IDLE', 'press-release-fast-travel'\)/)
})

test('Sigil opens radial menu only after a full avatar click', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(main, /case 'PRESS':[\s\S]*if \(!isOnAvatar\(x, y\)\) \{[\s\S]*setInteractionState\('IDLE', 'press-release-off-avatar'\)/)
  assert.match(main, /case 'PRESS':[\s\S]*openRadialMenuFromClick\(x, y\);/)
  assert.match(main, /function radialClickTriggerLockPointer\(origin\)/)
  assert.match(main, /function openRadialMenuFromClick\(x, y[\s\S]*radialGestureMenu\.start\(origin, radialClickTriggerLockPointer\(origin\)\)/)
  const openFromClick = main.match(/function openRadialMenuFromClick\(x, y[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(openFromClick, /radialGestureMenu\.move\(origin\)/)
})

test('Sigil avatar drag releases on the avatar cancel fast travel', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(main, /case 'FAST_TRAVEL':[\s\S]*if \(isOnAvatar\(x, y\)\) \{[\s\S]*fastTravel\.clearGesture\('fast-travel-release-on-avatar'\)/)
  assert.match(main, /function handleMouseMove\(x, y\)[\s\S]*setInteractionState\('FAST_TRAVEL', 'press-drag-fast-travel'\)/)
  assert.doesNotMatch(main.match(/function handleMouseMove\(x, y\) \{[\s\S]*?\n\}/)?.[0] || '', /openRadialMenuFromClick/)
})

test('Sigil direct avatar drag feeds the fast-travel arrow overlay', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const overlay = await readFile(new URL('../../apps/sigil/renderer/live-modules/interaction-overlay.js', import.meta.url), 'utf8')

  assert.match(main, /function projectDirectFastTravelGesture\(\)/)
  assert.match(main, /function validDesktopWorldPoint\(point\)/)
  assert.match(main, /liveJs\.pointerPos = \{ x: msg\.x, y: msg\.y, valid: true \}/)
  assert.match(main, /fastTravelActive: !!liveJs\.travel \|\| liveJs\.currentState === 'FAST_TRAVEL'/)
  assert.match(main, /fastTravelGesture: projectDirectFastTravelGesture\(\)/)
  assert.match(overlay, /function fastTravelLineGesture\(snapshot = \{\}\)/)
  assert.match(overlay, /snapshot\.fastTravelGesture\?\.phase === 'fastTravel'/)
})

test('Sigil avatar input hit testing does not depend on render scale', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const match = main.match(/function isOnAvatar\(x, y\) \{([\s\S]*?)\n\}/)

  assert.ok(match, 'isOnAvatar function should exist')
  assert.match(match[1], /!liveJs\.avatarVisible \|\| !liveJs\.avatarPos\.valid/)
  assert.doesNotMatch(match[1], /appScale/)
})
