import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GENERIC_SCENE_IMPLEMENTATIONS,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
} from '../../packages/toolkit/scene/index.js'

let allocations = 0

class Vector {
  constructor() { this.x = 0; this.y = 0; this.z = 0 }
  set(x, y, z) { this.x = x; this.y = y; this.z = z }
  setScalar(value) { this.set(value, value, value) }
}
class Node {
  constructor() { allocations += 1; this.children = []; this.position = new Vector(); this.rotation = new Vector(); this.scale = new Vector(); this.visible = true }
  add(...children) { this.children.push(...children) }
  clear() { this.children = [] }
  traverse(callback) { callback(this); for (const child of this.children) { if (child.traverse) child.traverse(callback); else callback(child) } }
  getObjectByName(name) { if (this.name === name) return this; for (const child of this.children) { const found = child.getObjectByName?.(name); if (found) return found } return null }
}
class Disposable { constructor(options = {}) { allocations += 1; Object.assign(this, options); this.disposeCount = 0 } dispose() { this.disposed = true; this.disposeCount += 1 } }
class Mesh extends Node { constructor(geometry, material) { super(); this.geometry = geometry; this.material = material } }
class Points extends Mesh {}
class Sprite extends Mesh { constructor(material) { super(null, material) } }
class BufferGeometry extends Disposable {
  constructor() { super(); this.attributes = {} }
  setAttribute(name, attribute) { this.attributes[name] = attribute }
}
class BufferAttribute { constructor(array, itemSize) { allocations += 1; this.array = array; this.itemSize = itemSize } }
class EdgesGeometry extends Disposable { constructor(source, thresholdAngle) { super(); this.source = source; this.thresholdAngle = thresholdAngle } }
class DataTexture extends Disposable { constructor(data, width, height) { super(); this.data = data; this.width = width; this.height = height } }

const THREE = {
  AdditiveBlending: 2,
  RGBAFormat: 1,
  UnsignedByteType: 1,
  SRGBColorSpace: 'srgb',
  LinearFilter: 1,
  Group: Node,
  Mesh,
  Points,
  Sprite,
  LineSegments: Mesh,
  BoxGeometry: Disposable,
  SphereGeometry: Disposable,
  TetrahedronGeometry: Disposable,
  OctahedronGeometry: Disposable,
  IcosahedronGeometry: Disposable,
  TorusGeometry: Disposable,
  TorusKnotGeometry: Disposable,
  EdgesGeometry,
  BufferGeometry,
  BufferAttribute,
  DataTexture,
  MeshStandardMaterial: Disposable,
  MeshBasicMaterial: Disposable,
  LineBasicMaterial: Disposable,
  PointsMaterial: Disposable,
  SpriteMaterial: Disposable,
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

function richDocument() {
  const input = document()
  input.resources.push(
    { id: 'edges', kind: 'geometry', implementation: GENERIC_SCENE_IMPLEMENTATIONS.edgesGeometry, parameters: { primitive: 'box', size: 1, thresholdAngle: 1 }, asset: null },
    { id: 'segments', kind: 'geometry', implementation: GENERIC_SCENE_IMPLEMENTATIONS.segmentGeometry, parameters: { segments: [[-1, -1, -1, -0.5, -0.5, -0.5]] }, asset: null },
    { id: 'line', kind: 'material', implementation: GENERIC_SCENE_IMPLEMENTATIONS.lineMaterial, parameters: { color: '#ffffff' }, asset: null },
    {
      id: 'aura', kind: 'effect', implementation: GENERIC_SCENE_IMPLEMENTATIONS.radialAura,
      parameters: {
        targetObjectId: 'main', primaryColor: '#9b7cff', secondaryColor: '#28154f',
        reach: 0.75, intensity: 1, pulseHz: 1, wobbleCount: 4, wobbleRadius: 0.62,
        wobbleScaleX: 0.66, wobbleScaleY: 0.48, wobbleAmplitude: 0.14,
        wobbleSpeed: 0.65, wobbleOpacity: 0.32,
      },
      asset: null,
    },
  )
  input.objects.push(
    {
      id: 'edge-object', parentId: 'main', kind: 'line', visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      geometryId: 'edges', materialId: 'line', components: [],
    },
    {
      id: 'segment-object', parentId: 'main', kind: 'line', visible: true,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      geometryId: 'segments', materialId: 'line', components: [],
    },
  )
  return input
}

test('generic registry validates implementation parameter bounds', () => {
  const registry = createGenericSceneImplementationRegistry()
  const valid = document()
  assert.equal(registry.validateDocument({ ...valid, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} }).ok, true)
  valid.resources[0].parameters.primitive = 'executable'
  const invalid = registry.validateDocument({ ...valid, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.mismatched[0].reason, 'unsupported_primitive')

  const rich = richDocument()
  const richInput = { ...rich, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} }
  assert.equal(registry.validateDocument(richInput).ok, true)
  rich.resources.find((resource) => resource.id === 'segments').parameters.segments = Array.from({ length: 65 }, () => [0, 0, 0, 1, 1, 1])
  assert.equal(registry.validateDocument(richInput).mismatched[0].reason, 'segment_count_out_of_bounds')
  rich.resources.find((resource) => resource.id === 'segments').parameters.segments = [[0, 0, 0, 1, 1, 1]]
  rich.resources.find((resource) => resource.id === 'aura').parameters.wobbleCount = 25
  assert.equal(registry.validateDocument(richInput).mismatched[0].reason, 'radial_aura_wobble_count_out_of_bounds')

  const narrow = richDocument()
  narrow.resources.find((resource) => resource.id === 'aura').parameters.wobbleScaleX = 0.01
  assert.equal(registry.validateDocument({ ...narrow, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} }).mismatched[0].reason, 'radial_aura_wobble_scale_out_of_bounds')
  const wide = richDocument()
  wide.resources.find((resource) => resource.id === 'aura').parameters.wobbleScaleY = 4
  assert.equal(registry.validateDocument({ ...wide, contract: 'aos.scene.document.v1', schemaVersion: 1, revision: 1, rootObjectId: 'main', metadata: {} }).mismatched[0].reason, 'radial_aura_wobble_scale_out_of_bounds')
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

test('generic projection renders clean edges, explicit segments, and one bounded clock-driven radial field', () => {
  const projection = createGenericThreeSceneProjection({ THREE, document: richDocument() })
  const edge = projection.object.getObjectByName('edge-object')
  const segment = projection.object.getObjectByName('segment-object')
  const outer = projection.object.getObjectByName('aura/reach')
  const core = projection.object.getObjectByName('aura/core')
  const wobbles = projection.object.getObjectByName('aura/wobbles')

  assert.ok(edge.geometry instanceof EdgesGeometry)
  assert.equal(edge.geometry.source.disposed, true)
  assert.deepEqual([...segment.geometry.attributes.position.array], [-1, -1, -1, -0.5, -0.5, -0.5])
  assert.equal(wobbles.children.length, 4)
  assert.equal(wobbles.children[0].geometry, wobbles.children[1].geometry)
  assert.equal(wobbles.children[0].material, wobbles.children[2].material)
  projection.tick(0)
  const initialScale = outer.scale.x
  const beforeTick = allocations
  assert.equal(projection.tick(250), 1)
  assert.equal(allocations, beforeTick)
  assert.notEqual(outer.scale.x, initialScale)
  assert.ok(core.scale.x > 0)

  projection.dispose()
  assert.equal(edge.geometry.disposed, true)
  assert.equal(segment.geometry.disposed, true)
  assert.equal(outer.material.map.disposed, true)
  assert.equal(core.material.map.disposed, true)
  assert.equal(wobbles.children[0].geometry.disposeCount, 1)
  assert.equal(wobbles.children[0].material.disposeCount, 1)
})

test('direct generic projection caps explicit segments even when registry validation is bypassed', () => {
  const input = richDocument()
  input.resources.find((resource) => resource.id === 'segments').parameters.segments = Array.from(
    { length: 1_000 },
    () => [1e9, -1e9, 0, 1, 1, 1],
  )
  const projection = createGenericThreeSceneProjection({ THREE, document: input })
  const segment = projection.object.getObjectByName('segment-object')
  assert.equal(segment.geometry.attributes.position.array.length, 64 * 6)
  assert.deepEqual([...segment.geometry.attributes.position.array.slice(0, 2)], [10_000, -10_000])
  projection.dispose()
})

test('direct generic projection rejects aggregate effects before allocating Three resources', () => {
  const input = richDocument()
  const template = input.resources.find((resource) => resource.id === 'aura')
  input.resources.push(...Array.from({ length: 32 }, (_, index) => ({
    ...structuredClone(template),
    id: `aura-${index}`,
  })))
  const before = allocations
  assert.throws(
    () => createGenericThreeSceneProjection({ THREE, document: input }),
    /effect budget exceeded/u,
  )
  assert.equal(allocations, before)
})
