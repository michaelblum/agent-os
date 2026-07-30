import assert from 'node:assert/strict'
import test from 'node:test'

import * as THREE from '../../packages/toolkit/vendor/three/three.module.min.js'
import {
  createDesktopWorldSceneRenderCoordinator,
} from '../../packages/toolkit/components/desktop-world-stage/scene-render-coordinator.js'

function renderer() {
  const calls = []
  return {
    calls,
    autoClear: true,
    outputColorSpace: null,
    info: {
      autoReset: true,
      reset() { calls.push({ kind: 'reset' }) },
    },
    clear(...args) { calls.push({ args, kind: 'clear' }) },
    clearDepth() { calls.push({ kind: 'clearDepth' }) },
    render(scene, camera) { calls.push({ camera, kind: 'render', scene }) },
  }
}

function mounted(key, renderPass, { overlay = false } = {}) {
  return {
    key,
    resource: key,
    renderPass,
    rendering: null,
    suspended: false,
    projection: {
      object: new THREE.Group(),
      ...(overlay ? { overlayObject: new THREE.Group() } : {}),
    },
  }
}

const perspective = Object.freeze({
  kind: 'perspective_resource',
  camera: Object.freeze({
    far: 10_000,
    fovYDegrees: 36,
    near: 0.1,
    targetZ: 0,
  }),
})

test('one renderer composites perspective resources beneath the orthographic overlay', () => {
  const host = renderer()
  const coordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: host })
  const topology = [
    { display_id: 1, dw_bounds: [0, 0, 1_440, 900] },
    { display_id: 2, dw_bounds: [1_440, 0, 1_920, 1_080] },
  ]
  assert.equal(coordinator.updateSegment(topology[0], topology), true)
  const body = mounted('companion/main', perspective, { overlay: true })
  const overlay = mounted('annotation/main', { kind: 'orthographic_overlay' })
  coordinator.attach(body)
  coordinator.attach(overlay)
  const resources = new Map([[body.key, body], [overlay.key, overlay]])

  assert.equal(host.autoClear, false)
  assert.equal(host.outputColorSpace, THREE.SRGBColorSpace)
  assert.equal(body.rendering.camera.isPerspectiveCamera, true)
  assert.equal(body.projection.overlayObject.parent, coordinator.overlayScene)
  coordinator.render(resources)

  const renders = host.calls.filter((entry) => entry.kind === 'render')
  assert.equal(renders.length, 2)
  assert.equal(renders[0].scene, body.rendering.scene)
  assert.equal(renders[1].scene, coordinator.overlayScene)
  assert.equal(renders[1].camera.isOrthographicCamera, true)
})

test('perspective resources use identical global cameras and complementary segment views', () => {
  const topology = [
    { display_id: 1, dw_bounds: [-1_200, 0, 1_200, 900] },
    { display_id: 2, dw_bounds: [0, -180, 1_920, 1_080] },
  ]
  const leftCoordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: renderer() })
  const rightCoordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: renderer() })
  leftCoordinator.updateSegment(topology[0], topology)
  rightCoordinator.updateSegment(topology[1], topology)
  const left = mounted('companion/main', perspective)
  const right = mounted('companion/main', perspective)
  leftCoordinator.attach(left)
  rightCoordinator.attach(right)

  assert.deepEqual(left.rendering.camera.position.toArray(), right.rendering.camera.position.toArray())
  assert.equal(left.rendering.camera.fov, right.rendering.camera.fov)
  assert.deepEqual(left.rendering.cameraProjection.worldBounds, right.rendering.cameraProjection.worldBounds)
  assert.notDeepEqual(left.rendering.cameraProjection.viewOffset, right.rendering.cameraProjection.viewOffset)
})

test('an existing perspective resource rejects an incompatible topology change', () => {
  const coordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: renderer() })
  const topology = [{ display_id: 1, dw_bounds: [0, 0, 1_440, 900] }]
  assert.equal(coordinator.updateSegment(topology[0], topology), true)
  const resource = mounted('companion/main', perspective)
  coordinator.attach(resource)
  const resources = new Map([[resource.key, resource]])

  const movedTopology = [{ display_id: 2, dw_bounds: [1_440, 0, 1_920, 1_080] }]
  assert.equal(coordinator.updateSegment(topology[0], movedTopology), true)
  assert.equal(coordinator.refresh(resources), false)
  assert.deepEqual(resource.rendering.cameraProjection.worldBounds, [0, 0, 1_440, 900])
})

test('initial perspective admission reports a render-pass configuration failure', () => {
  const coordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: renderer() })
  const topology = [{ display_id: 1, dw_bounds: [0, 0, 1_440, 900] }]
  assert.equal(coordinator.updateSegment(topology[0], topology), true)
  const clipped = mounted('companion/main', {
    kind: 'perspective_resource',
    camera: { far: 10, fovYDegrees: 36, near: 0.1, targetZ: 0 },
  })

  assert.throws(
    () => coordinator.attach(clipped),
    (error) => error?.code === 'SCENE_RENDER_PASS_CONFIGURATION_FAILED',
  )
  assert.equal(clipped.rendering, null)
})

test('one hundred perspective attachment cycles leave no pass-owned object behind', () => {
  const host = renderer()
  const coordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer: host })
  const topology = [{ display_id: 1, dw_bounds: [0, 0, 1_440, 900] }]
  coordinator.updateSegment(topology[0], topology)
  const baselineOverlayChildren = coordinator.overlayScene.children.length

  for (let index = 0; index < 100; index += 1) {
    const resource = mounted(`fixture/${index}`, perspective, { overlay: true })
    coordinator.attach(resource)
    const privateScene = resource.rendering.scene
    assert.equal(privateScene.children.length, 1)
    coordinator.detach(resource)
    assert.equal(privateScene.children.length, 0)
    assert.equal(resource.projection.object.parent, null)
    assert.equal(resource.projection.overlayObject.parent, null)
  }

  assert.equal(coordinator.overlayScene.children.length, baselineOverlayChildren)
})
