import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSceneInteractionVisualController,
  resolveSceneAimVisualStyle,
  resolveSceneRadialVisualStyle,
} from '../../packages/toolkit/scene/scene-interaction-visual.js'

function aimEvent(phase, {
  at = 0,
  origin = { x: 100, y: 200 },
  pointer = { x: 300, y: 200 },
  position = [300, 200, 0],
  route = 'line',
} = {}) {
  return {
    frame: { phase, origin, current: pointer, timing: { t: at } },
    interaction: {
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
      response: { implementation: 'aos.scene.response.aim-commit', parameters: { route } },
    },
    response: {
      kind: 'aim_commit',
      objectId: 'body',
      origin,
      pointer,
      position,
      angle: Math.atan2(pointer.y - origin.y, pointer.x - origin.x),
      distance: Math.hypot(pointer.x - origin.x, pointer.y - origin.y),
      route,
    },
  }
}

function radialEvent(phase, selectionIndex = 0, origin = { x: 8, y: 8 }) {
  return {
    frame: {
      phase,
      origin,
      current: origin,
      radial: { angle: -Math.PI / 2, distance: 80, itemCount: 4, selectionIndex },
      timing: { t: 10 },
    },
    interaction: {
      recognizer: {
        implementation: 'aos.scene.gesture.radial',
        parameters: { items: [{ id: 'top' }, { id: 'right', disabled: true }, { id: 'bottom' }, { id: 'left' }], radius: 50 },
      },
      response: { implementation: 'aos.scene.response.signal-graph', parameters: { signalId: 'selection' } },
    },
    response: { kind: 'signal_graph', signals: [{ signalId: 'selection', value: selectionIndex }] },
    topology: { displays: [{ displayId: 1, index: 0, bounds: [0, 0, 400, 300] }] },
  }
}

test('aim visual styles are deterministic and bounded', () => {
  const style = resolveSceneAimVisualStyle({
    route: 'wormhole',
    durationMs: 900,
    easing: 'ease_out_quart',
    arrow: { color: '#123456', trailCount: 8 },
    wormhole: { color: '#abcdef', ringRadius: 120 },
  })
  assert.equal(style.route, 'wormhole')
  assert.equal(style.durationMs, 900)
  assert.equal(style.easing, 'ease_out_quart')
  assert.equal(style.arrow.color, '#123456')
  assert.equal(style.arrow.trailCount, 8)
  assert.equal(style.wormhole.ringRadius, 120)
  assert.equal(resolveSceneAimVisualStyle({ durationMs: Infinity }).durationMs, 220)
})

test('aim preview keeps the object stationary and Escape removes it without a route', () => {
  const frames = []
  const controller = createSceneInteractionVisualController({ onFrame(model) { frames.push({ arrow: model.arrow.visible, route: model.route.active }) } })
  assert.equal(controller.apply(aimEvent('start')).accepted, true)
  assert.equal(controller.apply(aimEvent('update', { pointer: { x: 100, y: 80 }, position: [100, 80, 0] })).routeStarted, false)
  assert.deepEqual(controller.snapshot().arrow.origin, [100, 200])
  assert.deepEqual(controller.snapshot().arrow.pointer, [100, 80])
  controller.apply(aimEvent('cancel'))
  assert.deepEqual(controller.snapshot().route, { active: false, kind: 'line', objectId: null, position: [0, 0, 0], progress: 0 })
  assert.deepEqual(frames.at(-1), { arrow: false, route: false })
})

test('gesture updates reuse resolved visual styles instead of allocating per frame', () => {
  const styles = []
  const controller = createSceneInteractionVisualController({ onFrame(model) { styles.push(model.arrow.style) } })
  controller.apply(aimEvent('start'))
  controller.apply(aimEvent('update', { pointer: { x: 220, y: 260 } }))
  controller.apply(aimEvent('update', { pointer: { x: 240, y: 280 } }))
  assert.equal(styles[0], styles[1])
  assert.equal(styles[1], styles[2])
})

test('fixed-clock line routes preserve horizontal, vertical, and diagonal vectors', () => {
  for (const destination of [[300, 200, 0], [100, 400, 0], [300, 400, 0]]) {
    const controller = createSceneInteractionVisualController()
    const pointer = { x: destination[0], y: destination[1] }
    assert.equal(controller.apply(aimEvent('end', { at: 100, pointer, position: destination })).routeStarted, true)
    controller.tick(210)
    assert.deepEqual(controller.snapshot().route.position.map(Math.round), [
      Math.round((100 + destination[0]) / 2),
      Math.round((200 + destination[1]) / 2),
      0,
    ])
    controller.tick(320)
    assert.equal(controller.snapshot().route.active, false)
    assert.deepEqual(controller.snapshot().route.position, destination)
  }
})

test('route visuals retain world coordinates separately from parent-local commits', () => {
  const controller = createSceneInteractionVisualController()
  controller.apply(aimEvent('end', {
    at: 0,
    origin: { x: 110, y: 220 },
    pointer: { x: 300, y: 400 },
    position: [200, 200, 0],
  }))
  controller.tick(110)
  assert.deepEqual(controller.snapshot().route.position, [205, 310, 0])
})

test('wormhole route exposes bounded entry, travel, flash, and rebound phases', () => {
  let model
  const controller = createSceneInteractionVisualController({ onFrame(value) { model = value } })
  controller.apply(aimEvent('end', { at: 0, route: 'wormhole' }))
  controller.tick(198)
  assert.ok(model.route.scale <= 0.09)
  assert.ok(model.route.opacity <= 0.13)
  assert.ok(model.route.originRing > 0)
  controller.tick(702)
  assert.ok(model.route.flash > 0)
  assert.ok(model.route.destinationRing > 0)
  controller.tick(900)
  assert.equal(model.route.active, false)
  assert.equal(model.route.scale, 1)
  assert.deepEqual([...model.route.position], [300, 200, 0])
})

test('radial menus place item zero at top and clamp the menu inside its display', () => {
  let model
  const controller = createSceneInteractionVisualController({ onFrame(value) { model = value } })
  controller.apply(radialEvent('start'))
  assert.equal(model.radial.visible, true)
  assert.equal(model.radial.itemCount, 4)
  assert.deepEqual([...model.radial.center], [74, 74])
  assert.deepEqual([...model.radial.positions.slice(0, 2)].map(Math.round), [74, 24])
  assert.equal(model.radial.selectionIndex, 0)
  assert.equal(model.radial.disabled[1], 1)
  controller.apply(radialEvent('cancel'))
  assert.equal(model.radial.visible, false)
})

test('radial style resolution caps descriptors and suspend pauses route time', () => {
  const style = resolveSceneRadialVisualStyle({ items: 99 })
  assert.equal(style.items.length, 32)
  const controller = createSceneInteractionVisualController()
  controller.apply(aimEvent('end', { at: 0 }))
  controller.tick(50)
  const before = controller.snapshot().route.progress
  controller.suspend(50)
  assert.equal(controller.tick(1000), false)
  controller.resume(1000)
  controller.tick(1000)
  assert.equal(controller.snapshot().route.progress, before)
  controller.tick(1050)
  assert.ok(controller.snapshot().route.progress > before)
  assert.equal(controller.dispose(), true)
  assert.equal(controller.dispose(), false)
})
