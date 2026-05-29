import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selectionCursorShouldUseCanvasProjection } from '../../apps/sigil/renderer/live-modules/interaction-overlay.js'
import { createSelectionModeCursorModelRenderer } from '../../apps/sigil/renderer/live-modules/selection-mode-cursor-model-renderer.js'

class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }

  copy(other) {
    this.x = other.x
    this.y = other.y
    this.z = other.z
    return this
  }

  distanceTo(other) {
    return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z)
  }
}

class FakeObject3D {
  constructor() {
    this.children = []
    this.position = new FakeVector3()
    this.rotation = { x: 0, y: 0, z: 0 }
    this.scale = {
      x: 1,
      y: 1,
      z: 1,
      set(x, y, z) {
        this.x = x
        this.y = y
        this.z = z
      },
      setScalar(value) {
        this.x = value
        this.y = value
        this.z = value
      },
    }
    this.userData = {}
    this.visible = true
    this.name = ''
  }

  add(child) {
    this.children.push(child)
  }
}

class FakeBufferGeometry {
  constructor() {
    this.attributes = {}
    this.index = null
    this.userData = {}
    this.disposed = false
  }

  setAttribute(name, value) {
    this.attributes[name] = value
    return this
  }

  setIndex(value) {
    this.index = value
    return this
  }

  computeVertexNormals() {
    this.normalsComputed = true
  }

  dispose() {
    this.disposed = true
  }
}

class FakeMaterial {
  constructor(options = {}) {
    Object.assign(this, options)
    this.disposed = false
  }

  dispose() {
    this.disposed = true
  }
}

class FakeMesh extends FakeObject3D {
  constructor(geometry, material) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

const FakeTHREE = {
  Group: FakeObject3D,
  Mesh: FakeMesh,
  LineSegments: FakeMesh,
  BufferGeometry: FakeBufferGeometry,
  Float32BufferAttribute: class {
    constructor(array, itemSize) {
      this.array = array
      this.itemSize = itemSize
    }
  },
  MeshPhongMaterial: FakeMaterial,
  LineBasicMaterial: FakeMaterial,
  EdgesGeometry: class {
    constructor(geometry) {
      this.source = geometry
    }
  },
  Color: class {
    constructor(value) {
      this.value = value
    }
  },
  Vector3: FakeVector3,
  DoubleSide: 'DoubleSide',
}

function modelOverlay({
  repeatCount = 2,
  cursor = { x: 100, y: 80, valid: true },
} = {}) {
  return {
    visible: true,
    active: true,
    cursor,
    cursorGlyph: {
      model_kind: 'sigil_model',
      source: 'sigil_avatar',
      shape: 'depth_aligned_three_sided_sigil_cursor',
      hotspot: { kind: 'tip', x: cursor.x, y: cursor.y, local: { x: 0, y: 0, z: 0 } },
      geometry: {
        primitive: 'triangular_pyramid',
        length: 44,
        base: 44 / Math.sqrt(3),
        cross_section: 'equilateral_triangle',
        expected_depth_axis: 'z',
        long_axis: 'scene_depth_z',
      },
      animation: { rotation_speed: 0.01, session_vitality_multiplier: 1 },
      color: { aura_primary: '#5efcd2', aura_secondary: '#8eddff' },
      aura: { core: '#071318', primary: '#5efcd2', secondary: '#8eddff', highlight: '#ffffff' },
    },
    cursorTrail: {
      timing: { repeatCount, duration: 0.22, delay: 0, repeatDuration: 2, trailMode: 'fade', lag: 0.05, scale: 1.5 },
    },
  }
}

function geometryVertices(geometry) {
  const attr = geometry.attributes.position
  const values = Array.from(attr.array)
  const vertices = []
  for (let i = 0; i < values.length; i += attr.itemSize) {
    vertices.push({ x: values[i], y: values[i + 1], z: values[i + 2] })
  }
  return vertices
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

test('Selection Mode sigil_model cursor is consumed by a Three.js model renderer', () => {
  const sceneAdds = []
  const scene = {
    add(object) {
      sceneAdds.push(object)
    },
    remove() {},
  }
  const renderer = createSelectionModeCursorModelRenderer({
    scene,
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
  })

  const snapshot = renderer.update(modelOverlay(), { time: 12 })

  assert.equal(selectionCursorShouldUseCanvasProjection({ model_kind: 'sigil_model' }), false)
  assert.equal(sceneAdds.length, 1)
  assert.equal(sceneAdds[0].userData.object_id, 'selection-mode.cursor.model-root')
  assert.equal(snapshot.visible, true)
  assert.equal(snapshot.model_kind, 'sigil_model')
  assert.equal(snapshot.source, 'sigil_avatar')
  assert.equal(snapshot.object_id, 'selection-mode.cursor.sigil-model')
  assert.equal(snapshot.hotspot_aligned, true)
  assert.deepEqual(snapshot.scene_position, { x: 10, y: -8, z: 0 })
  assert.equal(snapshot.trail_count, 2)

  const root = renderer.root
  const primary = root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  assert.ok(primary)
  assert.equal(primary.userData.model_kind, 'sigil_model')
  assert.equal(primary.userData.geometry, 'triangular_pyramid')
  assert.equal(primary.userData.long_axis, 'scene_depth_z')
  assert.equal(primary.children[0].children[0].geometry.userData.depth_semantics, 'scene_depth_axis')
})

test('Selection Mode cursor geometry is equilateral and depth-aligned to the scene z axis', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
  })

  renderer.update(modelOverlay(), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const geometry = primary.children[0].children[0].geometry
  const vertices = geometryVertices(geometry)
  const zValues = vertices.map((vertex) => vertex.z)
  const base = geometry.userData.equilateral_base_vertex_indices.map((index) => vertices[index])
  const sides = [
    distance(base[0], base[1]),
    distance(base[1], base[2]),
    distance(base[2], base[0]),
  ]

  assert.equal(geometry.userData.primitive, 'triangular_pyramid')
  assert.equal(geometry.userData.long_axis, 'scene_depth_z')
  assert.deepEqual(geometry.userData.hotspot_local, { x: 0, y: 0, z: 0 })
  assert.ok(Math.max(...zValues) - Math.min(...zValues) > 0.9)
  assert.ok(sides.every((side) => Math.abs(side - sides[0]) < 0.000001))
  assert.equal(new Set(base.map((vertex) => vertex.z)).size, 1)
})

test('Selection Mode primary and trail instances reuse the same depth cursor geometry family', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
  })

  renderer.update(modelOverlay({ repeatCount: 3 }), { time: 12 })
  const geometryFamilies = renderer.root.children.map((child) => child.userData.geometry_family)
  assert.deepEqual(geometryFamilies, [
    'selection_mode_depth_aligned_triangular_cursor',
    'selection_mode_depth_aligned_triangular_cursor',
    'selection_mode_depth_aligned_triangular_cursor',
    'selection_mode_depth_aligned_triangular_cursor',
  ])
})

test('Selection Mode cursor model hides stale objects when cursor projection fails', () => {
  const scene = {
    add() {},
    remove() {},
  }
  const renderer = createSelectionModeCursorModelRenderer({
    scene,
    THREE: FakeTHREE,
    projectPoint: (point) => {
      if (point.valid === false) return null
      return new FakeVector3(point.x / 10, -point.y / 10, 0)
    },
    projectRadius: (_point, radius) => radius / 10,
  })
  const overlay = modelOverlay()

  renderer.update(overlay, { time: 12 })
  const root = renderer.root
  const primary = root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const trails = root.children.filter((child) => String(child.userData.object_id || '').startsWith('selection-mode.cursor.trail-model'))
  assert.equal(root.visible, true)
  assert.equal(primary.visible, true)
  assert.equal(trails.length, 2)
  assert.equal(trails.every((trail) => trail.visible), true)

  const blockedSnapshot = renderer.update({
    ...overlay,
    cursor: { x: 100, y: 80, valid: false },
  }, { time: 13 })

  assert.equal(blockedSnapshot.visible, false)
  assert.equal(blockedSnapshot.hotspot_aligned, false)
  assert.equal(blockedSnapshot.trail_count, 0)
  assert.equal(blockedSnapshot.scene_position, null)
  assert.equal(blockedSnapshot.blocker_reason, 'invalid_cursor')
  assert.equal(root.visible, false)
  assert.equal(primary.visible, false)
  assert.equal(trails.every((trail) => trail.visible === false), true)
})

test('Selection Mode cursor model reuses objects and bounded resources after warmup', () => {
  const scene = {
    children: [],
    add(object) {
      this.children.push(object)
    },
    remove() {},
  }
  const renderer = createSelectionModeCursorModelRenderer({
    scene,
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
  })
  const overlay = modelOverlay({ repeatCount: 4 })

  renderer.update(overlay, { time: 12 })
  const warmSnapshot = renderer.snapshot()
  renderer.update(overlay, { time: 12.016 })
  renderer.update(overlay, { time: 12.032 })
  const steadySnapshot = renderer.snapshot()

  assert.equal(steadySnapshot.resource_counts.scene_adds, warmSnapshot.resource_counts.scene_adds)
  assert.equal(steadySnapshot.resource_counts.model_instances_created, warmSnapshot.resource_counts.model_instances_created)
  assert.equal(steadySnapshot.resource_counts.trail_instances_created, warmSnapshot.resource_counts.trail_instances_created)
  assert.equal(steadySnapshot.resource_counts.geometries_created, warmSnapshot.resource_counts.geometries_created)
  assert.equal(steadySnapshot.resource_counts.materials_created, warmSnapshot.resource_counts.materials_created)
  assert.equal(steadySnapshot.object_counts.root_children, 5)
  assert.equal(steadySnapshot.object_counts.trail_instances, 4)
  assert.equal(steadySnapshot.object_counts.scene_children, 1)
  assert.equal(steadySnapshot.resource_counts.update_count, warmSnapshot.resource_counts.update_count + 2)
})
