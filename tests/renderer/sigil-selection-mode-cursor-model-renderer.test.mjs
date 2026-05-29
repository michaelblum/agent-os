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

  clone() {
    return new FakeMaterial({ ...this, clonedFrom: this })
  }

  copy(source) {
    Object.assign(this, source)
    this.copiedFrom = source
    return this
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

class FakeSprite extends FakeObject3D {
  constructor(material) {
    super()
    this.material = material
  }
}

const FakeTHREE = {
  Group: FakeObject3D,
  Mesh: FakeMesh,
  Sprite: FakeSprite,
  LineSegments: FakeMesh,
  BufferGeometry: FakeBufferGeometry,
  Float32BufferAttribute: class {
    constructor(array, itemSize) {
      this.array = array
      this.itemSize = itemSize
    }
  },
  MeshPhongMaterial: FakeMaterial,
  SpriteMaterial: FakeMaterial,
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
  AdditiveBlending: 'AdditiveBlending',
}

function avatarSource({
  version = 'avatar:v1',
  primaryMaterial = new FakeMaterial({ name: 'avatar-core', color: '#112233', opacity: 0.55 }),
  edgeMaterial = new FakeMaterial({ name: 'avatar-edge', color: '#778899', opacity: 0.8 }),
  skin = 'none',
  colors = {
    face: ['#bc13fe', '#4a2b6e'],
    edge: ['#bc13fe', '#4a2b6e'],
    aura: ['#bc13fe', '#2a1b3d'],
  },
  auraDescriptor = {
    enabled: true,
    reach: 1.2,
    intensity: 1.4,
    pulseRate: 0.006,
    wobble: { count: 1 },
  },
  phenomenaDescriptor = {},
  trailDescriptor = {},
} = {}) {
  return {
    appearanceSource: 'current_live_sigil_avatar',
    materialSource: 'current_avatar_render_model',
    effectsSource: 'current_avatar_effect_descriptors',
    version,
    geometryType: 20,
    skin,
    primaryMaterial,
    edgeMaterial,
    colors,
    colorRamp: {
      face: colors.face,
      edge: colors.edge,
      aura: colors.aura,
    },
    auraDescriptor,
    phenomenaDescriptor,
    trailDescriptor,
  }
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
      source: 'avatar_render_state',
      appearance_source: 'current_live_sigil_avatar',
      material_source: 'current_avatar_render_model',
      shape: 'avatar_derived_triangular_pointer',
      hotspot: { kind: 'tip', x: cursor.x, y: cursor.y, local: { x: 0, y: 0, z: 0 } },
      geometry: {
        primitive: 'triangular_pyramid',
        length: 44,
        base: 44 / Math.sqrt(3),
        cross_section: 'equilateral_triangle',
        expected_depth_axis: 'screen_plane',
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
      },
      animation: { axis: 'scene_z', rotation_speed: 0.01, session_vitality_multiplier: 1 },
      cursor_overrides: { geometry: true, orientation: true, hotspot: true, scale: true, visibility: true, single_axis_rotation: true },
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
    getAvatarRenderSource: () => avatarSource(),
  })

  const snapshot = renderer.update(modelOverlay(), { time: 12 })

  assert.equal(selectionCursorShouldUseCanvasProjection({ model_kind: 'sigil_model' }), false)
  assert.equal(sceneAdds.length, 1)
  assert.equal(sceneAdds[0].userData.object_id, 'selection-mode.cursor.model-root')
  assert.equal(snapshot.visible, true)
  assert.equal(snapshot.model_kind, 'sigil_model')
  assert.equal(snapshot.source, 'avatar_render_state')
  assert.equal(snapshot.appearance_source, 'current_live_sigil_avatar')
  assert.equal(snapshot.material_source, 'current_avatar_render_model')
  assert.deepEqual(snapshot.cursor_overrides, ['geometry', 'orientation', 'hotspot', 'scale', 'visibility', 'single_axis_rotation'])
  assert.equal(snapshot.object_id, 'selection-mode.cursor.sigil-model')
  assert.equal(snapshot.hotspot_aligned, true)
  assert.deepEqual(snapshot.scene_position, { x: 10, y: -8, z: 0 })
  assert.equal(snapshot.trail_count, 2)

  const root = renderer.root
  const primary = root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  assert.ok(primary)
  assert.equal(primary.userData.model_kind, 'sigil_model')
  assert.equal(primary.userData.geometry, 'triangular_pyramid')
  assert.equal(primary.userData.long_axis, 'screen_north_west')
  assert.equal(primary.userData.material_source, 'current_avatar_render_model')
  assert.equal(primary.children[0].children[0].geometry.userData.depth_semantics, 'screen_plane_pointer')
})

test('Selection Mode cursor geometry has apex hotspot at origin and base down/right in screen projection', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  renderer.update(modelOverlay(), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const geometry = primary.children[0].children[0].geometry
  const vertices = geometryVertices(geometry)
  const base = geometry.userData.equilateral_base_vertex_indices.map((index) => vertices[index])
  const baseCentroid = base.reduce((acc, vertex) => ({
    x: acc.x + vertex.x / base.length,
    y: acc.y + vertex.y / base.length,
    z: acc.z + vertex.z / base.length,
  }), { x: 0, y: 0, z: 0 })
  const sides = [
    distance(base[0], base[1]),
    distance(base[1], base[2]),
    distance(base[2], base[0]),
  ]

  assert.equal(geometry.userData.primitive, 'triangular_pyramid')
  assert.equal(geometry.userData.long_axis, 'screen_north_west')
  assert.equal(geometry.userData.base_screen_quadrant, 'down_right')
  assert.deepEqual(geometry.userData.hotspot_local, { x: 0, y: 0, z: 0 })
  assert.deepEqual(vertices[0], { x: 0, y: 0, z: 0 })
  assert.ok(baseCentroid.x > 0)
  assert.ok(baseCentroid.y < 0)
  assert.ok(distance(vertices[0], baseCentroid) > 1.8)
  assert.ok(sides.every((side) => Math.abs(side - sides[0]) < 0.000001))
})

test('Selection Mode primary and trail instances reuse the same avatar-derived pointer geometry family', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  renderer.update(modelOverlay({ repeatCount: 3 }), { time: 12 })
  const geometryFamilies = renderer.root.children.map((child) => child.userData.geometry_family)
  assert.deepEqual(geometryFamilies, [
    'selection_mode_avatar_derived_pointer',
    'selection_mode_avatar_derived_pointer',
    'selection_mode_avatar_derived_pointer',
    'selection_mode_avatar_derived_pointer',
  ])
})

test('Selection Mode pointer derives materials from the live avatar render source', () => {
  const firstCore = new FakeMaterial({ name: 'avatar-core-v1', color: '#112233', opacity: 0.6 })
  const firstEdge = new FakeMaterial({ name: 'avatar-edge-v1', color: '#778899', opacity: 0.7 })
  const secondCore = new FakeMaterial({ name: 'avatar-core-v2', color: '#aabbcc', opacity: 0.4 })
  const secondEdge = new FakeMaterial({ name: 'avatar-edge-v2', color: '#ddeeff', opacity: 0.5 })
  let source = avatarSource({ version: 'v1', primaryMaterial: firstCore, edgeMaterial: firstEdge })
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => source,
  })

  renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const core = primary.children[0].children[0]
  const edge = primary.children[0].children[1]

  assert.equal(core.material.copiedFrom, firstCore)
  assert.equal(edge.material.copiedFrom, firstEdge)
  assert.equal(primary.userData.material_source, 'current_avatar_render_model')

  source = avatarSource({ version: 'v2', primaryMaterial: secondCore, edgeMaterial: secondEdge, skin: 'plasma' })
  renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12.016 })

  assert.equal(core.material.copiedFrom, secondCore)
  assert.equal(edge.material.copiedFrom, secondEdge)
  assert.equal(primary.userData.skin, 'plasma')
})

test('Selection Mode pointer renders current avatar aura/effect descriptors at pointer scale', () => {
  let source = avatarSource({
    version: 'effects:v1',
    colors: {
      face: ['#112233', '#445566'],
      edge: ['#778899', '#aabbcc'],
      aura: ['#ddeeff', '#001122'],
    },
    auraDescriptor: {
      enabled: true,
      reach: 1.7,
      intensity: 1.4,
      pulseRate: 0.006,
      wobble: { count: 3 },
    },
    phenomenaDescriptor: {
      pulsar: { enabled: true, count: 4 },
    },
  })
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => source,
  })

  const firstSnapshot = renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const spin = primary.children.find((child) => child.name.endsWith('.spin'))
  const effects = primary.children.find((child) => child.name.endsWith('.effects'))
  const core = spin.children[0]
  const glow = effects.children.find((child) => child.name.endsWith('.glow'))
  const auraCore = effects.children.find((child) => child.name.endsWith('.core'))

  assert.equal(firstSnapshot.effects_source, 'current_avatar_effect_descriptors')
  assert.deepEqual(firstSnapshot.effect_families, ['aura_glow', 'pulsar'])
  assert.deepEqual(firstSnapshot.pointer_effects.rendered, ['aura_glow', 'aura_core'])
  assert.equal(firstSnapshot.pointer_effects.aura.primary, '#ddeeff')
  assert.equal(firstSnapshot.pointer_effects.aura.reach, 1.7)
  assert.equal(firstSnapshot.resolved_visual.primary, '#112233')
  assert.equal(core.geometry.userData.vertex_color_source, 'current_avatar_color_ramp')
  assert.deepEqual(core.geometry.userData.vertex_color_pair, ['#112233', '#445566'])
  assert.equal(glow.material.color, '#ddeeff')
  assert.equal(auraCore.material.color, '#001122')
  assert.equal(effects.visible, true)

  const warmMaterials = firstSnapshot.resource_counts.materials_created
  renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12.016 })
  assert.equal(renderer.snapshot().resource_counts.materials_created, warmMaterials)

  source = avatarSource({
    version: 'effects:v2',
    colors: {
      face: ['#224466', '#6688aa'],
      edge: ['#99aabb', '#ccddee'],
      aura: ['#ff00aa', '#440022'],
    },
    auraDescriptor: {
      enabled: true,
      reach: 2.1,
      intensity: 1.8,
      pulseRate: 0.008,
      wobble: { count: 2 },
    },
  })
  const changedSnapshot = renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12.032 })

  assert.equal(changedSnapshot.pointer_effects.aura.primary, '#ff00aa')
  assert.equal(changedSnapshot.resolved_visual.primary, '#224466')
  assert.equal(glow.material.color, '#ff00aa')
})

test('Selection Mode pointer caps and softens avatar-derived trail echoes', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  const snapshot = renderer.update(modelOverlay({ repeatCount: 14 }), { time: 12 })
  const trails = renderer.root.children.filter((child) => String(child.userData.object_id || '').startsWith('selection-mode.cursor.trail-model'))

  assert.equal(snapshot.requested_trail_count, 14)
  assert.equal(snapshot.trail_count, 8)
  assert.equal(snapshot.trail_policy.max_visible_instances, 8)
  assert.equal(trails.length, 8)
  assert.ok(trails.every((trail) => trail.children.find((child) => child.name.endsWith('.effects'))))
})

test('Selection Mode pointer locks root orientation and animates only the screen-plane z axis', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const spin = primary.children[0]

  assert.equal(primary.rotation.x, 0)
  assert.equal(primary.rotation.y, 0)
  assert.equal(primary.rotation.z, 0)
  assert.equal(spin.rotation.x, 0)
  assert.equal(spin.rotation.y, 0)
  assert.notEqual(spin.rotation.z, 0)
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
    getAvatarRenderSource: () => avatarSource(),
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
  const stableAvatarSource = avatarSource()
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
    getAvatarRenderSource: () => stableAvatarSource,
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
