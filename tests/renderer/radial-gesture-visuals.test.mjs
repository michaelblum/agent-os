import { test } from 'node:test'
import assert from 'node:assert/strict'

class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  sub(value) {
    this.x -= value.x
    this.y -= value.y
    this.z -= value.z
    return this
  }

  multiplyScalar(value) {
    this.x *= value
    this.y *= value
    this.z *= value
    return this
  }

  toArray() {
    return [this.x, this.y, this.z]
  }
}

class Box3 {
  constructor() {
    this.min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    this.max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
  }

  setFromObject(object) {
    const sourceCenter = object.sourceCenter ?? new Vector3()
    const sourceSize = object.sourceSize ?? new Vector3()
    const center = new Vector3(
      object.position.x + (sourceCenter.x * object.scale.x),
      object.position.y + (sourceCenter.y * object.scale.y),
      object.position.z + (sourceCenter.z * object.scale.z),
    )
    const size = new Vector3(
      Math.abs(sourceSize.x * object.scale.x),
      Math.abs(sourceSize.y * object.scale.y),
      Math.abs(sourceSize.z * object.scale.z),
    )
    this.min = new Vector3(
      center.x - (size.x * 0.5),
      center.y - (size.y * 0.5),
      center.z - (size.z * 0.5),
    )
    this.max = new Vector3(
      center.x + (size.x * 0.5),
      center.y + (size.y * 0.5),
      center.z + (size.z * 0.5),
    )
    return this
  }

  getCenter(target) {
    target.x = (this.min.x + this.max.x) * 0.5
    target.y = (this.min.y + this.max.y) * 0.5
    target.z = (this.min.z + this.max.z) * 0.5
    return target
  }

  getSize(target) {
    target.x = this.max.x - this.min.x
    target.y = this.max.y - this.min.y
    target.z = this.max.z - this.min.z
    return target
  }
}

class Color {
  constructor(value) {
    this.value = value
  }
}

globalThis.THREE = { Box3, Color, Vector3 }

const {
  normalizeModelScene,
  radialGlyphActivationState,
  resolveNestedFiberBloomTransform,
  resolveNestedFiberStemTransform,
  resolveNestedFractalTreeTransform,
  resolveNestedTreeTransform,
  resolveRadialHoverSpinSpeed,
} = await import('../../apps/sigil/renderer/live-modules/radial-gesture-visuals.js')

test('resolveNestedFiberStemTransform anchors fiber roots toward the brain stem volume', () => {
  const transform = resolveNestedFiberStemTransform({})

  assert.deepEqual(transform.position, { x: 0.019, y: -0.017, z: -0.004 })
  assert.deepEqual(transform.scale, { x: 0.94, y: 1.94, z: 1.05 })
  assert.deepEqual(transform.rotationDegrees, { x: -7.5, y: -19, z: -23 })
})

test('resolveNestedFiberBloomTransform preserves legacy tree transform fallback', () => {
  const transform = resolveNestedFiberBloomTransform({})

  assert.deepEqual(transform.position, { x: 0, y: 0.033, z: 0 })
  assert.deepEqual(transform.scale, { x: 1.79, y: 1.22, z: 1.68 })
  assert.deepEqual(transform.rotationDegrees, { x: 0, y: 0, z: 0 })
  assert.deepEqual(resolveNestedTreeTransform({ treeTransform: { scale: 1.5 } }).scale, { x: 1.5, y: 1.5, z: 1.5 })
})

test('resolveNestedFractalTreeTransform fits the fractal roots inside the brain shell', () => {
  const transform = resolveNestedFractalTreeTransform({})

  assert.deepEqual(transform.position, { x: 0.02, y: -0.054, z: -0.006 })
  assert.deepEqual(transform.scale, { x: 1.85, y: 2.65, z: 2.61 })
  assert.deepEqual(transform.rotationDegrees, { x: -8, y: 86, z: 8 })
})

test('radialGlyphActivationState treats direct fast-travel hover as active', () => {
  const item = {
    id: 'wiki-graph',
    center: { x: 100, y: 0 },
    hitRadius: 12,
    visualRadius: 18,
  }
  const visualRadial = {
    phase: 'fastTravel',
    origin: { x: 0, y: 0 },
    pointer: { x: 100, y: 0 },
    activeItemId: null,
  }

  const state = radialGlyphActivationState({
    visualRadial,
    activeRadial: null,
    source: visualRadial,
    item,
  })

  assert.equal(state.active, true)
  assert.equal(state.directHover, true)
  assert.equal(state.selected, false)
  assert.equal(state.relation, 'inside')
})

test('radialGlyphActivationState ignores non-selected outward pointer travel', () => {
  const item = {
    id: 'wiki-graph',
    center: { x: 100, y: 0 },
    hitRadius: 12,
    visualRadius: 18,
  }
  const visualRadial = {
    phase: 'fastTravel',
    origin: { x: 0, y: 0 },
    pointer: { x: 140, y: 0 },
    activeItemId: null,
  }

  const state = radialGlyphActivationState({
    visualRadial,
    activeRadial: null,
    source: visualRadial,
    item,
  })

  assert.equal(state.active, false)
  assert.equal(state.directHover, false)
  assert.equal(state.selected, false)
  assert.equal(state.relation, 'outward')
})

test('resolveRadialHoverSpinSpeed uses geometry override and clamps negative values', () => {
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: 0 } }, { nativeGeometry: true }), 0)
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: -2 } }, { nativeGeometry: true }), 0)
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: 0.25 } }, { nativeGeometry: false }), 0.25)
  assert.equal(resolveRadialHoverSpinSpeed({}, { nativeGeometry: true }), 1.45)
  assert.equal(resolveRadialHoverSpinSpeed({}, { nativeGeometry: false }), 1.1)
})

test('normalizeModelScene centers models with geometry far from their origin', () => {
  const object = {
    position: new Vector3(0, 0, 0),
    scale: new Vector3(1, 1, 1),
    sourceCenter: new Vector3(-1.04, -31.01, -16.08),
    sourceSize: new Vector3(1.94, 1.54, 1.72),
    updateMatrixWorldCalled: false,
    updateMatrixWorld(force) {
      this.updateMatrixWorldCalled = force
    },
  }

  const radius = normalizeModelScene(object, 0.28)
  const box = new Box3().setFromObject(object)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())

  assert.equal(radius, 0.28)
  assert.equal(object.updateMatrixWorldCalled, true)
  assert.deepEqual(center.toArray().map((value) => Math.round(value * 1e9) / 1e9), [0, 0, 0])
  assert.ok(Math.max(size.x, size.y, size.z) <= 0.5600000001)
})
