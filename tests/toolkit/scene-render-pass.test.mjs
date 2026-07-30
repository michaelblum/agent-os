import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from '../../packages/toolkit/vendor/three/three.module.min.js'

import {
  DEFAULT_SCENE_RENDER_PASS,
  derivePerspectiveResourceCamera,
  resolveSceneRenderPass,
  validateSceneDocument,
  validateSceneRenderPass,
} from '../../packages/toolkit/scene/index.js'

function scene(renderPass) {
  return {
    contract: 'aos.scene.document.v1',
    schemaVersion: 1,
    id: 'example/main',
    revision: 1,
    rootObjectId: 'root',
    objects: [{
      id: 'root',
      parentId: null,
      kind: 'group',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      visible: true,
      geometryId: null,
      materialId: null,
      components: [],
    }],
    resources: [],
    metadata: {},
    ...(renderPass === undefined ? {} : { renderPass }),
  }
}

const camera = Object.freeze({
  fovYDegrees: 36,
  near: 0.1,
  far: 10_000,
  targetZ: 0,
})

test('scene documents default to the existing orthographic overlay pass', () => {
  assert.equal(validateSceneDocument(scene()).ok, true)
  assert.deepEqual(resolveSceneRenderPass(scene()), DEFAULT_SCENE_RENDER_PASS)
})

test('perspective resource profiles are explicit and bounded', () => {
  const pass = { kind: 'perspective_resource', camera }
  assert.equal(validateSceneRenderPass(pass).ok, true)
  assert.equal(validateSceneDocument(scene(pass)).ok, true)
  assert.equal(validateSceneRenderPass({ ...pass, camera: { ...camera, fovYDegrees: 180 } }).ok, false)
  assert.equal(validateSceneRenderPass({ ...pass, camera: { ...camera, far: 0.05 } }).ok, false)
  assert.equal(validateSceneRenderPass({ kind: 'orthographic_overlay', camera }).ok, false)
})

test('perspective segments share one global camera and use disjoint view offsets', () => {
  const topology = [
    { display_id: 1, dw_bounds: [0, 0, 1_440, 900] },
    { display_id: 2, dw_bounds: [1_440, -180, 1_920, 1_080] },
  ]
  const left = derivePerspectiveResourceCamera(topology, topology[0], camera)
  const right = derivePerspectiveResourceCamera(topology, topology[1], camera)

  assert.deepEqual(left.position, right.position)
  assert.deepEqual(left.target, right.target)
  assert.deepEqual(left.worldBounds, [0, -180, 3_360, 1_080])
  assert.deepEqual(right.worldBounds, left.worldBounds)
  assert.deepEqual(left.viewOffset, {
    fullWidth: 3_360,
    fullHeight: 1_080,
    offsetX: 0,
    offsetY: 180,
    width: 1_440,
    height: 900,
  })
  assert.deepEqual(right.viewOffset, {
    fullWidth: 3_360,
    fullHeight: 1_080,
    offsetX: 1_440,
    offsetY: 0,
    width: 1_920,
    height: 1_080,
  })
  assert.deepEqual(left.up, [0, -1, 0])
})

test('perspective projection preserves DesktopWorld rightward and downward axes', () => {
  const topology = [{ display_id: 1, dw_bounds: [0, 0, 1_200, 800] }]
  const projection = derivePerspectiveResourceCamera(topology, topology[0], camera)
  const perspective = new THREE.PerspectiveCamera(
    projection.fovYDegrees,
    projection.aspect,
    projection.near,
    projection.far,
  )
  perspective.position.set(...projection.position)
  perspective.up.set(...projection.up)
  perspective.lookAt(...projection.target)
  perspective.setViewOffset(
    projection.viewOffset.fullWidth,
    projection.viewOffset.fullHeight,
    projection.viewOffset.offsetX,
    projection.viewOffset.offsetY,
    projection.viewOffset.width,
    projection.viewOffset.height,
  )
  perspective.updateProjectionMatrix()
  perspective.updateMatrixWorld(true)

  const center = new THREE.Vector3(600, 400, 0).project(perspective)
  const right = new THREE.Vector3(700, 400, 0).project(perspective)
  const down = new THREE.Vector3(600, 500, 0).project(perspective)
  assert.ok(right.x > center.x)
  assert.ok(down.y < center.y)
})

test('perspective derivation rejects incomplete topology without inventing a view', () => {
  assert.equal(derivePerspectiveResourceCamera([], { dw_bounds: [0, 0, 100, 100] }, camera), null)
  assert.equal(derivePerspectiveResourceCamera(
    [{ dw_bounds: [0, 0, 100, 100] }],
    { dw_bounds: [0, 0, 0, 100] },
    camera,
  ), null)
  assert.equal(derivePerspectiveResourceCamera(
    [
      { display_id: 1, dw_bounds: [0, 0, 100, 100] },
      { display_id: 2, dw_bounds: [100, 0, 0, 100] },
    ],
    { display_id: 1, dw_bounds: [0, 0, 100, 100] },
    camera,
  ), null)
  assert.equal(derivePerspectiveResourceCamera(
    [{ display_id: 1, dw_bounds: [0, 0, 100, 100] }],
    { display_id: 2, dw_bounds: [0, 0, 100, 100] },
    camera,
  ), null)
  assert.equal(derivePerspectiveResourceCamera(
    [{ display_id: 1, dw_bounds: [0, 0, 100, 100] }],
    { display_id: 1, dw_bounds: [1, 0, 100, 100] },
    camera,
  ), null)
})

test('perspective derivation rejects a target plane outside the camera frustum', () => {
  const topology = [{ display_id: 1, dw_bounds: [0, 0, 1_200, 900] }]
  assert.equal(derivePerspectiveResourceCamera(
    topology,
    topology[0],
    { ...camera, far: 1_000 },
  ), null)
  assert.equal(derivePerspectiveResourceCamera(
    [{ display_id: 1, dw_bounds: [0, 0, 10, 10] }],
    { display_id: 1, dw_bounds: [0, 0, 10, 10] },
    { ...camera, near: 20 },
  ), null)
})
