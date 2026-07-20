import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERIC_SCENE_IMPLEMENTATIONS,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
} from '../../packages/toolkit/scene/index.js'

class Vector {
  constructor() { this.x = 0; this.y = 0; this.z = 0 }
  set(x, y, z) { this.x = x; this.y = y; this.z = z }
}
class Node {
  constructor() { this.children = []; this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(); this.visible = true }
  add(child) { this.children.push(child) }
  clear() { this.children = [] }
  traverse(callback) { callback(this); for (const child of this.children) child.traverse?.(callback) ?? callback(child) }
  getObjectByName(name) { if (this.name === name) return this; for (const child of this.children) { const found = child.getObjectByName?.(name); if (found) return found } return null }
}
class Disposable { dispose() { this.disposed = true } }
class Mesh extends Node { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material } }
class Points extends Mesh {}

const THREE = {
  Group: Node,
  Mesh,
  Points,
  LineSegments: Mesh,
  BoxGeometry: Disposable,
  SphereGeometry: Disposable,
  TetrahedronGeometry: Disposable,
  OctahedronGeometry: Disposable,
  IcosahedronGeometry: Disposable,
  TorusGeometry: Disposable,
  TorusKnotGeometry: Disposable,
  BufferGeometry: class extends Disposable { setAttribute() {} },
  BufferAttribute: class {},
  MeshStandardMaterial: Disposable,
  LineBasicMaterial: Disposable,
  PointsMaterial: Disposable,
}

function document() {
  return {
    id: 'example/main',
    objects: [{
      id: 'main', parentId: null, kind: 'mesh', visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      geometryId: 'geometry', materialId: 'material', components: [],
    }],
    resources: [
      { id: 'geometry', kind: 'geometry', implementation: GENERIC_SCENE_IMPLEMENTATIONS.primitiveGeometry, parameters: { primitive: 'box', size: 1 }, asset: null },
      { id: 'material', kind: 'material', implementation: GENERIC_SCENE_IMPLEMENTATIONS.surfaceMaterial, parameters: { color: '#ffffff' }, asset: null },
    ],
  }
}

test('generic registry validates implementation parameter bounds', () => {
  const registry = createGenericSceneImplementationRegistry()
  const valid = document()
  assert.equal(registry.validateDocument({ ...valid, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} }).ok, true)
  valid.resources[0].parameters.primitive = 'executable'
  const invalid = registry.validateDocument({ ...valid, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.mismatched[0].reason, 'unsupported_primitive')
})

test('generic Three projection builds and disposes a bounded object tree', () => {
  const projection = createGenericThreeSceneProjection({ THREE, document: document() })
  assert.equal(projection.object.children.length, 1)
  const mesh = projection.object.children[0]
  assert.equal(projection.applySignal({ objectId: 'main', target: 'scale.x' }, 1.5), true)
  assert.equal(mesh.scale.x, 1.5)
  projection.suspend()
  assert.equal(projection.object.visible, false)
  projection.resume()
  assert.equal(projection.object.visible, true)
  projection.dispose()
  assert.equal(mesh.geometry.disposed, true)
  assert.equal(mesh.material.disposed, true)
})

test('animation and signals target the declared object when its id matches the scene document id', () => {
  const input = document()
  input.id = 'main'
  const projection = createGenericThreeSceneProjection({ THREE, document: input })
  const wrapper = projection.object
  const mesh = wrapper.children[0]

  assert.equal(projection.applyAnimation({ objectId: 'main', target: 'position.x' }, 42), true)
  assert.equal(projection.applySignal({ objectId: 'main', target: 'scale.x' }, 1.5), true)
  assert.equal(wrapper.position.x, 0)
  assert.equal(wrapper.scale.x, 0)
  assert.equal(mesh.position.x, 42)
  assert.equal(mesh.scale.x, 1.5)

  projection.dispose()
})
