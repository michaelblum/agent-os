import assert from 'node:assert/strict'
import test from 'node:test'

import * as THREE from '../../packages/toolkit/vendor/three/three.module.min.js'
import { createDesktopWorldSceneInteractionThree } from '../../packages/toolkit/components/desktop-world-stage/scene-interaction-three.js'

function harness() {
  const scene = new THREE.Scene()
  const root = new THREE.Group()
  const body = new THREE.Group()
  body.name = 'body'
  body.position.set(100, 200, 0)
  root.add(body)
  const projection = {
    object: root,
    setObjectPosition(id, position) {
      const object = root.getObjectByName(id)
      if (!object) return false
      object.position.set(...position)
      return true
    },
  }
  return { body, projection, scene }
}

function aim(phase, at, destination = [300, 200, 0], route = 'line') {
  const origin = { x: 100, y: 200 }
  const pointer = { x: destination[0], y: destination[1] }
  return {
    frame: { phase, origin, current: pointer, timing: { t: at } },
    interaction: {
      recognizer: { implementation: 'aos.scene.gesture.drag', parameters: { threshold: 4 } },
      response: { implementation: 'aos.scene.response.aim-commit', parameters: { route } },
    },
    response: {
      kind: 'aim_commit', objectId: 'body', origin, pointer, position: destination,
      angle: Math.atan2(pointer.y - origin.y, pointer.x - origin.x),
      distance: Math.hypot(pointer.x - origin.x, pointer.y - origin.y), route,
    },
  }
}

test('Three interaction adapter uses the stage clock and keeps aim preview stationary', () => {
  const { body, projection, scene } = harness()
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection })
  visuals.apply(aim('start', 0))
  visuals.apply(aim('update', 10, [300, 400, 0]))
  assert.deepEqual(body.position.toArray(), [100, 200, 0])
  assert.equal(visuals.snapshot().arrow.visible, true)
  assert.equal(visuals.snapshot().hasOwnFrameLoop, false)
  assert.equal(scene.getObjectByName('aos.scene.interaction.visuals') !== undefined, true)
})

test('route projection spans both axes and restores object scale at completion', () => {
  const { body, projection, scene } = harness()
  let renderAt = 100
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection, now: () => renderAt })
  visuals.apply(aim('end', 100, [300, 400, 0], 'wormhole'))
  renderAt = 550
  visuals.tick(renderAt)
  assert.ok(body.position.x > 100 && body.position.x < 300)
  assert.ok(body.position.y > 200 && body.position.y < 400)
  assert.ok(body.scale.x < 1)
  renderAt = 1000
  visuals.tick(renderAt)
  assert.deepEqual(body.position.toArray(), [300, 400, 0])
  assert.deepEqual(body.scale.toArray(), [1, 1, 1])
  assert.equal(visuals.snapshot().route.active, false)
})

test('nested objects animate in parent space while route visuals remain in world space', () => {
  const { body, projection, scene } = harness()
  projection.object.position.set(100, 200, 0)
  body.position.set(10, 20, 0)
  let renderAt = 0
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection, now: () => renderAt })
  const event = aim('end', 0, [200, 200, 0])
  event.response.origin = { x: 110, y: 220 }
  event.response.pointer = { x: 300, y: 400 }
  event.response.angle = Math.atan2(180, 190)
  event.response.distance = Math.hypot(190, 180)
  visuals.apply(event)
  renderAt = 110
  visuals.tick(renderAt)
  assert.deepEqual(body.position.toArray(), [105, 110, 0])
  assert.deepEqual(visuals.snapshot().route.position, [205, 310, 0])
  renderAt = 220
  visuals.tick(renderAt)
  assert.deepEqual(body.position.toArray(), [200, 200, 0])
})

test('canceling an active route restores the committed destination and object scale', () => {
  const { body, projection, scene } = harness()
  let renderAt = 0
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection, now: () => renderAt })
  visuals.apply(aim('end', 0, [300, 400, 0], 'wormhole'))
  renderAt = 450
  visuals.tick(renderAt)
  assert.ok(body.scale.x < 1)
  assert.equal(visuals.cancel(), true)
  assert.deepEqual(body.position.toArray(), [300, 400, 0])
  assert.deepEqual(body.scale.toArray(), [1, 1, 1])
})

test('a completed route cannot overwrite a later unrelated object move', () => {
  const { body, projection, scene } = harness()
  let renderAt = 0
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection, now: () => renderAt })
  visuals.apply(aim('end', 0, [300, 400, 0]))
  renderAt = 220
  visuals.tick(renderAt)
  body.position.set(40, 50, 0)
  visuals.apply(aim('start', 300, [500, 500, 0]))
  assert.deepEqual(body.position.toArray(), [40, 50, 0])
})

test('radial renderer is bounded and uses one preallocated item pool', () => {
  const { projection, scene } = harness()
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection })
  const radial = {
    frame: { phase: 'start', origin: { x: 100, y: 100 }, current: { x: 100, y: 20 }, radial: { angle: -Math.PI / 2, distance: 80, itemCount: 4, selectionIndex: 0 }, timing: { t: 0 } },
    interaction: { recognizer: { implementation: 'aos.scene.gesture.radial', parameters: { items: 4 } }, response: { implementation: 'aos.scene.response.signal-graph', parameters: { signalId: 'selection' } } },
    response: { kind: 'signal_graph', signals: [{ signalId: 'selection', value: 0 }] },
    topology: { displays: [{ displayId: 1, index: 0, bounds: [0, 0, 800, 600] }] },
  }
  visuals.apply(radial)
  assert.deepEqual(visuals.snapshot().allocations, { geometries: 9, materials: 42, radialItems: 32 })
  assert.equal(visuals.snapshot().radial.itemCount, 4)
  assert.equal(visuals.snapshot().radial.visible, true)
})

test('historical aim rendering uses the route vector for glow, dashes, head, and reticles', () => {
  const { projection, scene } = harness()
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection })
  const event = aim('start', 0)
  event.interaction.response.parameters = {
    route: 'line',
    arrow: {
      dashGap: 7, dashLength: 10, dashSpeed: 42, glowWidth: 7,
      headLengthDistanceFactor: 0.11, headLengthMax: 24, headLengthMin: 12,
      headWingRadians: Math.PI * 0.78, originInset: 72, originRingRadius: 32,
      pulseHz: 8 / (Math.PI * 2), reticlePulse: 3, reticleRadius: 13,
      trailCount: 0,
    },
  }
  visuals.apply(event)
  visuals.tick(0)

  const dash = scene.getObjectByName('aos.scene.interaction.arrow.dash')
  const glow = scene.getObjectByName('aos.scene.interaction.arrow.glow')
  const head = scene.getObjectByName('aos.scene.interaction.arrow.head')
  const originRing = scene.getObjectByName('aos.scene.interaction.arrow.origin-ring')
  const reticle = scene.getObjectByName('aos.scene.interaction.arrow.reticle')
  assert.deepEqual(Array.from(dash.geometry.getAttribute('position').array), [172, 200, 100, 300, 200, 100])
  assert.deepEqual(Array.from(dash.geometry.getAttribute('lineDistance').array), [0, 128])
  assert.equal(glow.geometry.getAttribute('position').array[0], 172)
  assert.equal(head.geometry.getAttribute('position').array[0], 300)
  assert.equal(head.geometry.getAttribute('position').array[1], 200)
  assert.equal(originRing.scale.x, 32)
  assert.equal(reticle.scale.x, 14.5)

  visuals.tick(250)
  assert.deepEqual(Array.from(dash.geometry.getAttribute('lineDistance').array), [-10.5, 117.5])
})

test('100 preview and route cycles do not allocate additional GPU resources', () => {
  const { projection, scene } = harness()
  let renderAt = 0
  const visuals = createDesktopWorldSceneInteractionThree({
    THREE,
    scene,
    projection,
    now: () => renderAt,
  })
  const allocations = visuals.snapshot().allocations
  for (let index = 0; index < 100; index += 1) {
    renderAt = index * 300
    visuals.apply(aim('start', index * 300))
    renderAt += 10
    visuals.apply(aim('update', index * 300 + 10, [200, 300, 0]))
    renderAt += 10
    visuals.apply(aim('end', index * 300 + 20, [200, 300, 0]))
    renderAt = index * 300 + 240
    visuals.tick(renderAt)
  }
  assert.deepEqual(visuals.snapshot().allocations, allocations)
  assert.equal(visuals.snapshot().route.active, false)
})

test('suspension hides the shared group and disposal is idempotent', () => {
  const { projection, scene } = harness()
  const visuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection })
  const group = scene.getObjectByName('aos.scene.interaction.visuals')
  assert.equal(visuals.suspend(10), true)
  assert.equal(group.visible, false)
  assert.equal(visuals.resume(20), true)
  assert.equal(group.visible, true)
  assert.equal(visuals.dispose(), true)
  assert.equal(scene.getObjectByName('aos.scene.interaction.visuals'), undefined)
  assert.equal(visuals.dispose(), false)
})

test('suspension excludes hidden time from an active route', () => {
  const { projection, scene } = harness()
  let renderAt = 0
  const visuals = createDesktopWorldSceneInteractionThree({
    THREE,
    scene,
    projection,
    now: () => renderAt,
  })
  visuals.apply(aim('end', 0, [300, 400, 0]))
  renderAt = 10
  visuals.tick(renderAt)
  const before = visuals.snapshot().route.progress

  visuals.suspend(renderAt)
  renderAt = 5_010
  visuals.resume(renderAt)
  visuals.tick(renderAt)

  assert.equal(visuals.snapshot().route.progress, before)
  assert.equal(visuals.snapshot().route.active, true)
})
