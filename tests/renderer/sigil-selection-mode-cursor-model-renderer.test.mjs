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

  const snapshot = renderer.update({
    visible: true,
    active: true,
    cursor: { x: 100, y: 80, valid: true },
    cursorGlyph: {
      model_kind: 'sigil_model',
      source: 'sigil_avatar',
      shape: 'three_sided_pyramid_prism',
      hotspot: { kind: 'tip', x: 100, y: 80, local: { x: 0, y: 0 } },
      geometry: { primitive: 'triangular_prism', length: 44, base: 22 },
      animation: { rotation_speed: 0.01, session_vitality_multiplier: 1 },
      color: { aura_primary: '#5efcd2', aura_secondary: '#8eddff' },
      aura: { core: '#071318', primary: '#5efcd2', secondary: '#8eddff', highlight: '#ffffff' },
    },
    cursorTrail: {
      timing: { repeatCount: 2, duration: 0.22, delay: 0, repeatDuration: 2, trailMode: 'fade', lag: 0.05, scale: 1.5 },
    },
  }, { time: 12 })

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
  assert.equal(primary.userData.geometry, 'triangular_prism')
  assert.equal(primary.children[0].children[0].geometry.userData.depth_semantics, 'mesh_volume')
})
