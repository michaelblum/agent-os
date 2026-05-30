import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  avatarHoverDecorationVisible,
  selectionCursorShouldUseCanvasProjection,
} from '../../apps/sigil/renderer/live-modules/interaction-overlay.js'
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
  lightningDescriptor = {},
  magneticDescriptor = {},
} = {}) {
  return {
    appearanceSource: 'current_live_sigil_avatar',
    materialSource: 'current_avatar_render_model',
    effectsSource: 'current_avatar_effect_descriptors',
    version,
    geometryType: 93,
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
    lightningDescriptor,
    magneticDescriptor,
  }
}

function modelOverlay({
  repeatCount = 2,
  cursor = { x: 100, y: 80, valid: true },
  facesVisible = true,
  faceOpacity = 0.8,
  edgeOpacity = 0.8,
  tesseronEnabled = true,
  tesseronProportion = 0.5,
  repeatDuration = 2,
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
      shape: 'avatar_derived_prism_pointer',
      hotspot: { kind: 'tip', x: cursor.x, y: cursor.y, local: { x: 0, y: 0, z: 0 } },
      geometry: {
        primitive: 'prism',
        geometry_type: 93,
        top_radius: 0,
        bottom_radius: 0.8,
        height: 2,
        sides: 3,
        length: 44,
        base: 19.2,
        cross_section: 'triangular',
        expected_depth_axis: 'screen_plane',
        long_axis: 'screen_north_west',
        base_screen_quadrant: 'down_right',
        faces_visible: facesVisible,
        face_opacity: faceOpacity,
        edge_opacity: edgeOpacity,
        tesseron_enabled: tesseronEnabled,
        tesseron_proportion: tesseronProportion,
        tesseron_match_mother: true,
        orientation_degrees: { x: 0, y: 0, z: 45 },
        spin_axis: 'local_y',
      },
      animation: { axis: 'local_y', rotation_speed: 0.1, rotation_started_at_ms: 0, session_vitality_multiplier: 1 },
      cursor_overrides: { geometry: true, orientation: true, hotspot: true, scale: true, visibility: true, single_axis_rotation: true },
    },
    cursorTrail: {
      timing: { repeatCount, duration: 0.22, delay: 0, repeatDuration, trailMode: 'fade', lag: 0.05, scale: 1.5 },
    },
  }
}

function warmCursorGhosts(renderer, {
  repeatCount = 4,
  steps = 6,
  startTime = 12,
  dt = 0.7,
  x = 100,
  y = 80,
  repeatDuration = 2,
} = {}) {
  let snapshot = null
  for (let index = 0; index < steps; index += 1) {
    snapshot = renderer.update(modelOverlay({
      repeatCount,
      repeatDuration,
      cursor: { x: x + index * 24, y, valid: true },
    }), { time: startTime + index * dt })
  }
  return snapshot
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

function assertPointClose(actual, expected, epsilon = 0.000001) {
  assert.ok(Math.abs(actual.x - expected.x) <= epsilon, `expected x ${actual.x} near ${expected.x}`)
  assert.ok(Math.abs(actual.y - expected.y) <= epsilon, `expected y ${actual.y} near ${expected.y}`)
  assert.ok(Math.abs(actual.z - expected.z) <= epsilon, `expected z ${actual.z} near ${expected.z}`)
}

function descendants(object) {
  const result = []
  for (const child of object?.children || []) {
    result.push(child, ...descendants(child))
  }
  return result
}

function descendantByName(object, suffix) {
  return descendants(object).find((child) => child.name.endsWith(suffix))
}

function pointerParts(object) {
  return {
    composition: descendantByName(object, '.composition'),
    modelGroup: descendantByName(object, '.centered-model'),
    spin: descendantByName(object, '.spin'),
    core: descendantByName(object, '.core'),
    edge: descendantByName(object, '.edges'),
    childEdges: descendantByName(object, '.tesseron.child.edges'),
    links: descendantByName(object, '.tesseron.links'),
    effects: descendantByName(object, '.effects'),
  }
}

function pointerEffects(object) {
  const effects = descendantByName(object, '.effects')
  return {
    group: effects,
    glow: effects.children.find((child) => child.name.endsWith('.glow')),
    core: effects.children.find((child) => child.name.endsWith('.core')),
    rotatingCore: effects.children.find((child) => child.name.endsWith('.rotating-core')),
    lightning: effects.children.find((child) => child.name.endsWith('.lightning')),
    magnetic: effects.children.find((child) => child.name.endsWith('.magnetic')),
  }
}

function materialBearingDescendants(object) {
  return descendants(object).filter((child) => child.material)
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
  assert.equal(snapshot.trail_count, 0)

  const root = renderer.root
  const primary = root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  assert.ok(primary)
  assert.equal(primary.userData.model_kind, 'sigil_model')
  assert.equal(primary.userData.geometry, 'prism')
  assert.equal(primary.userData.geometry_type, 93)
  assert.equal(primary.userData.long_axis, 'screen_north_west')
  assert.equal(primary.userData.spin_axis, 'local_y')
  assert.equal(primary.userData.material_source, 'current_avatar_render_model')
  assert.equal(pointerParts(primary).core.geometry.userData.depth_semantics, 'screen_plane_pointer')
})

test('avatar hover decoration requires current visible hover state', () => {
  assert.equal(avatarHoverDecorationVisible({
    avatarVisible: true,
    avatarHover: true,
    avatarHoverProgress: 0.8,
    avatarPos: { x: 12, y: 20, valid: true },
  }), true)
  assert.equal(avatarHoverDecorationVisible({
    avatarVisible: false,
    avatarHover: true,
    avatarHoverProgress: 0.8,
    avatarPos: { x: 12, y: 20, valid: true },
  }), false)
  assert.equal(avatarHoverDecorationVisible({
    avatarVisible: true,
    avatarHover: false,
    avatarHoverProgress: 0.8,
    avatarPos: { x: 12, y: 20, valid: true },
  }), false)
  assert.equal(avatarHoverDecorationVisible({
    avatarVisible: true,
    avatarHover: true,
    avatarHoverProgress: 0,
    avatarPos: { x: 12, y: 20, valid: true },
  }), false)
})

test('Selection Mode cursor geometry has prism tip hotspot and fixed northwest orientation', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  renderer.update(modelOverlay({ facesVisible: false, faceOpacity: 0 }), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const parts = pointerParts(primary)
  const spin = parts.spin
  const geometry = parts.core.geometry
  const vertices = geometryVertices(geometry)
  const base = geometry.userData.base_ring_indices.map((index) => vertices[index])
  const baseCentroid = base.reduce((acc, vertex) => ({
    x: acc.x + vertex.x / base.length,
    y: acc.y + vertex.y / base.length,
    z: acc.z + vertex.z / base.length,
  }), { x: 0, y: 0, z: 0 })
  const orientedBaseCentroid = {
    x: baseCentroid.x * Math.cos(primary.rotation.z) - baseCentroid.y * Math.sin(primary.rotation.z),
    y: baseCentroid.x * Math.sin(primary.rotation.z) + baseCentroid.y * Math.cos(primary.rotation.z),
    z: baseCentroid.z,
  }
  const sides = base.map((vertex, index) => distance(vertex, base[(index + 1) % base.length]))
  const apex = vertices[geometry.userData.top_ring_indices[0]]
  const childEdges = parts.childEdges
  const links = parts.links
  const childGeometry = childEdges.geometry.source || childEdges.geometry
  const childVertices = geometryVertices(childGeometry)
  const innerApex = childVertices[geometry.userData.top_ring_indices[0]]
  const linkVertices = geometryVertices(links.geometry)
  const effects = parts.effects

  assert.equal(geometry.userData.primitive, 'prism')
  assert.equal(geometry.userData.geometry_type, 93)
  assert.equal(geometry.userData.top_radius, 0)
  assert.equal(geometry.userData.bottom_radius, 0.8)
  assert.equal(geometry.userData.height, 2)
  assert.equal(geometry.userData.sides, 3)
  assert.deepEqual(geometry.userData.top_ring_indices, [0])
  assert.equal(geometry.userData.faces_visible, false)
  assert.equal(geometry.userData.face_opacity, 0)
  assert.equal(geometry.userData.edge_opacity, 0.8)
  assert.equal(geometry.userData.tesseron_enabled, true)
  assert.equal(geometry.userData.tesseron_proportion, 0.5)
  assert.equal(geometry.userData.long_axis, 'screen_north_west')
  assert.equal(geometry.userData.base_screen_quadrant, 'down_right')
  assert.deepEqual(geometry.userData.hotspot_local, { x: 0, y: 0, z: 0 })
  assert.deepEqual(geometry.userData.volume_center_local, { x: 0, y: -1, z: 0 })
  assert.ok(orientedBaseCentroid.x > 0)
  assert.ok(orientedBaseCentroid.y < 0)
  assert.deepEqual(apex, { x: 0, y: 0, z: 0 })
  assertPointClose(innerApex, { x: 0, y: -0.5, z: 0 })
  assert.equal(childGeometry.userData.tesseron_scale_origin, 'pointer_volume_center')
  assert.equal(links.geometry.userData.tesseron_scale_origin, 'pointer_volume_center')
  assert.equal(links.geometry.userData.link_count, 4)
  assertPointClose(linkVertices[0], apex)
  assertPointClose(linkVertices[1], innerApex)
  assert.deepEqual(primary.userData.source_volume_center_local, { x: 0, y: -1, z: 0 })
  assertPointClose(primary.userData.hotspot_local, { x: 0, y: 1, z: 0 })
  assert.deepEqual(parts.composition.userData.center_local, { x: 0, y: 0, z: 0 })
  assert.deepEqual(parts.composition.userData.source_volume_center_local, { x: 0, y: -1, z: 0 })
  assert.deepEqual(effects.userData.center_local, { x: 0, y: 0, z: 0 })
  assert.deepEqual(effects.userData.source_volume_center_local, { x: 0, y: -1, z: 0 })
  assert.equal(effects.userData.anchor, 'pointer_volume_center')
  assertPointClose(effects.position, { x: 0, y: 0, z: 0 })
  assertPointClose(parts.modelGroup.position, { x: 0, y: 1, z: 0 })
  assert.ok(distance(apex, baseCentroid) > 1.8)
  assert.ok(sides.every((side) => Math.abs(side - sides[0]) < 0.000001))
  assert.equal(parts.core.visible, false)
  assert.equal(childEdges.visible, true)
  assert.equal(links.visible, true)
})

test('Selection Mode primary and trail instances reuse the same avatar-derived pointer geometry family', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  warmCursorGhosts(renderer, { repeatCount: 3, repeatDuration: 4.2, steps: 4, dt: 1.41 })
  const geometryFamilies = renderer.root.children.map((child) => child.userData.geometry_family)
  assert.ok(geometryFamilies.length >= 2)
  assert.ok(geometryFamilies.every((family) => family === 'selection_mode_avatar_prism_pointer'))
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
  const { core, edge } = pointerParts(primary)

  assert.equal(core.material.copiedFrom, firstCore)
  assert.equal(edge.material.copiedFrom, firstEdge)
  assert.equal(core.material.toneMapped, false)
  assert.equal(core.material.depthWrite, false)
  assert.equal(core.material.depthTest, false)
  assert.equal(edge.material.vertexColors, false)
  assert.equal(edge.material.toneMapped, false)
  assert.equal(edge.material.depthWrite, false)
  assert.equal(edge.material.depthTest, false)
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
    lightningDescriptor: {
      enabled: true,
      brightness: 1.2,
    },
    magneticDescriptor: {
      enabled: true,
      fieldEnabled: true,
      fieldStrength: 0.9,
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
  const { effects, core } = pointerParts(primary)
  const glow = effects.children.find((child) => child.name.endsWith('.glow'))
  const auraCore = effects.children.find((child) => child.name.endsWith('.core'))
  const rotatingCore = effects.children.find((child) => child.name.endsWith('.rotating-core'))
  const lightning = effects.children.find((child) => child.name.endsWith('.lightning'))
  const magnetic = effects.children.find((child) => child.name.endsWith('.magnetic'))

  assert.equal(firstSnapshot.effects_source, 'current_avatar_effect_descriptors')
  assert.deepEqual(firstSnapshot.effect_families, ['aura_glow', 'aura_core', 'aura_rotating_core', 'lightning', 'magnetic', 'pulsar'])
  assert.deepEqual(firstSnapshot.pointer_effects.rendered, ['aura_glow', 'aura_core', 'aura_rotating_core', 'lightning', 'magnetic'])
  assert.equal(firstSnapshot.pointer_effects.aura.primary, '#ddeeff')
  assert.equal(firstSnapshot.pointer_effects.aura.reach, 1.7)
  assert.equal(firstSnapshot.pointer_effects.lightning.enabled, true)
  assert.equal(firstSnapshot.pointer_effects.magnetic.enabled, true)
  assert.equal(firstSnapshot.resolved_visual.primary, '#112233')
  assert.equal(core.geometry.userData.vertex_color_source, 'current_avatar_color_ramp')
  assert.deepEqual(core.geometry.userData.vertex_color_pair, ['#112233', '#445566'])
  assert.equal(glow.material.color, '#ddeeff')
  assert.equal(auraCore.material.color, '#001122')
  assert.equal(rotatingCore.material.color, '#001122')
  assert.equal(lightning.visible, true)
  assert.equal(magnetic.visible, true)
  assert.ok(lightning.geometry.attributes.position.array.length > 6)
  assert.ok(magnetic.geometry.attributes.position.array.length > 6)
  assert.equal(glow.material.toneMapped, false)
  assert.equal(glow.material.depthTest, false)
  assert.equal(auraCore.material.toneMapped, false)
  assert.equal(auraCore.material.depthTest, false)
  assert.equal(rotatingCore.material.depthTest, false)
  assert.equal(lightning.material.depthTest, false)
  assert.equal(effects.visible, true)
  assert.ok(glow.material.opacity > 0.8)
  assert.ok(auraCore.material.opacity > 0.6)
  assert.ok(rotatingCore.rotation.y !== 0)

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

  const snapshot = warmCursorGhosts(renderer, { repeatCount: 14, repeatDuration: 4, steps: 9, dt: 0.51 })
  const trails = renderer.root.children.filter((child) => String(child.userData.object_id || '').startsWith('selection-mode.cursor.trail-model'))

  assert.equal(snapshot.requested_trail_count, 14)
  assert.ok(snapshot.trail_count > 0)
  assert.ok(snapshot.trail_count <= 8)
  assert.equal(snapshot.trail_policy.source, 'selection_mode_pointer_omega_interdimensional_ghost_policy')
  assert.equal(snapshot.trail_policy.max_visible_instances, 8)
  assert.equal(trails.length, snapshot.trail_count)
  assert.ok(trails.every((trail) => pointerParts(trail).effects))

  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const primaryEffects = pointerEffects(primary)
  const trailDistances = trails.map((trail) => distance(trail.position, primary.position))
  const trailGlowOpacities = trails.map((trail) => pointerEffects(trail).glow.material.opacity)
  const trailCoreOpacities = trails.map((trail) => pointerEffects(trail).core.material.opacity)

  assert.ok(trailDistances.every((value) => value > 0.01), 'inter-dimensional ghosts should be prior cursor compositions, not local offsets under the primary')
  assert.ok(trails.every((trail) => trail.userData.render_policy.applies_to === 'composition_tree'))
  assert.ok(trails.every((trail) => materialBearingDescendants(trail).every((child) => (
    child.frustumCulled === false
    && child.renderOrder >= 9999
    && child.material.depthTest === false
    && child.material.depthWrite === false
    && child.material.toneMapped === false
  ))))
  assert.ok(trailGlowOpacities.every((opacity) => opacity < primaryEffects.glow.material.opacity))
  assert.ok(trailCoreOpacities.every((opacity) => opacity < primaryEffects.core.material.opacity))
  assert.ok(Math.max(...trailGlowOpacities) > Math.min(...trailGlowOpacities))
  assert.ok(Math.max(...trailCoreOpacities) > Math.min(...trailCoreOpacities))
})

test('Selection Mode pointer fixes northwest orientation and spins only along its local length axis', () => {
  const renderer = createSelectionModeCursorModelRenderer({
    scene: { add() {}, remove() {} },
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  renderer.update(modelOverlay({ repeatCount: 0 }), { time: 12 })
  const primary = renderer.root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const { spin } = pointerParts(primary)

  assert.equal(primary.rotation.x, 0)
  assert.equal(primary.rotation.y, 0)
  assert.equal(primary.rotation.z, Math.PI / 4)
  assert.equal(spin.rotation.x, 0)
  assert.notEqual(spin.rotation.y, 0)
  assert.equal(spin.rotation.z, 0)
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

  warmCursorGhosts(renderer, { repeatCount: 2, repeatDuration: 3, steps: 3, dt: 1.51 })
  const root = renderer.root
  const primary = root.children.find((child) => child.userData.object_id === 'selection-mode.cursor.sigil-model')
  const trails = root.children.filter((child) => String(child.userData.object_id || '').startsWith('selection-mode.cursor.trail-model'))
  assert.equal(root.visible, true)
  assert.equal(primary.visible, true)
  assert.ok(trails.length > 0)
  assert.ok(trails.length <= 2)
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

  warmCursorGhosts(renderer, { repeatCount: 4, repeatDuration: 4, steps: 5, dt: 1.01 })
  const warmSnapshot = renderer.snapshot()
  renderer.update(modelOverlay({ repeatCount: 4, cursor: { x: 196, y: 80, valid: true } }), { time: 15.7 })
  renderer.update(modelOverlay({ repeatCount: 4, cursor: { x: 196, y: 80, valid: true } }), { time: 15.716 })
  const steadySnapshot = renderer.snapshot()

  assert.equal(steadySnapshot.resource_counts.scene_adds, warmSnapshot.resource_counts.scene_adds)
  assert.equal(steadySnapshot.resource_counts.model_instances_created, warmSnapshot.resource_counts.model_instances_created)
  assert.equal(steadySnapshot.resource_counts.trail_instances_created, warmSnapshot.resource_counts.trail_instances_created)
  assert.equal(steadySnapshot.resource_counts.geometries_created, warmSnapshot.resource_counts.geometries_created)
  assert.equal(steadySnapshot.resource_counts.materials_created, warmSnapshot.resource_counts.materials_created)
  assert.ok(steadySnapshot.object_counts.root_children >= 2)
  assert.ok(steadySnapshot.object_counts.root_children <= 5)
  assert.ok(steadySnapshot.object_counts.trail_instances > 0)
  assert.ok(steadySnapshot.object_counts.trail_instances <= 4)
  assert.equal(steadySnapshot.object_counts.scene_children, 1)
  assert.equal(steadySnapshot.resource_counts.update_count, warmSnapshot.resource_counts.update_count + 2)
})

test('Selection Mode cursor model disposes avatar-derived effect materials on destroy', () => {
  const scene = {
    children: [],
    removed: null,
    add(object) {
      this.children.push(object)
    },
    remove(object) {
      this.removed = object
      this.children = this.children.filter((child) => child !== object)
    },
  }
  const renderer = createSelectionModeCursorModelRenderer({
    scene,
    THREE: FakeTHREE,
    projectPoint: (point) => new FakeVector3(point.x / 10, -point.y / 10, 0),
    projectRadius: (_point, radius) => radius / 10,
    getAvatarRenderSource: () => avatarSource(),
  })

  warmCursorGhosts(renderer, { repeatCount: 3, repeatDuration: 4.2, steps: 4, dt: 1.41 })
  const effectMaterials = renderer.root.children.flatMap((child) => {
    const effects = pointerEffects(child)
    return [effects.glow.material, effects.core.material, effects.rotatingCore.material]
  })

  assert.ok(effectMaterials.length >= 6)
  assert.ok(effectMaterials.every((material) => material.disposed === false))

  renderer.destroy()

  assert.equal(scene.removed.userData.object_id, 'selection-mode.cursor.model-root')
  assert.ok(effectMaterials.every((material) => material.disposed === true))
})
