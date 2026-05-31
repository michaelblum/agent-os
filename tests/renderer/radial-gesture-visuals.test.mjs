import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

  setScalar(value) {
    this.x = value
    this.y = value
    this.z = value
    return this
  }

  copy(value) {
    this.x = value.x
    this.y = value.y
    this.z = value.z
    return this
  }

  set(x, y, z) {
    this.x = x
    this.y = y
    this.z = z
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
    this.isColor = true
  }

  clone() {
    return new Color(this.value)
  }

  copy(value) {
    this.value = value.value
    return this
  }

  lerp() {
    return this
  }
}

class Object3D {
  constructor() {
    this.children = []
    this.position = new Vector3()
    this.scale = new Vector3(1, 1, 1)
    this.visible = true
    this.userData = {}
    this.rotation = {
      x: 0,
      y: 0,
      z: 0,
      copy(value) { this.x = value.x; this.y = value.y; this.z = value.z; return this },
      set(x, y, z) { this.x = x; this.y = y; this.z = z },
    }
  }

  add(...children) {
    this.children.push(...children)
  }

  remove(child) {
    this.children = this.children.filter((entry) => entry !== child)
  }

  traverse(visit) {
    visit(this)
    for (const child of this.children) child.traverse?.(visit)
  }
}

class Geometry {}
class Material {
  constructor(options = {}) {
    Object.assign(this, options)
    this.userData = {}
    this.opacity = options.opacity ?? 1
  }
}
class BufferGeometry extends Geometry {
  setFromPoints(points) {
    this.points = points
    return this
  }
}
class LineBasicMaterial extends Material {}
class MeshPhongMaterial extends Material {}
class Mesh extends Object3D {
  constructor(geometry, material) {
    super()
    this.geometry = geometry
    this.material = material
  }
}
class Line extends Mesh {}
class LineSegments extends Mesh {}

globalThis.THREE = {
  Box3,
  BoxGeometry: Geometry,
  BufferGeometry,
  Color,
  DodecahedronGeometry: Geometry,
  DoubleSide: 2,
  EdgesGeometry: Geometry,
  Group: Object3D,
  IcosahedronGeometry: Geometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshPhongMaterial,
  OctahedronGeometry: Geometry,
  TorusGeometry: Geometry,
  Vector3,
}

const {
  DEFAULT_RADIAL_ITEM_MOTION,
  createSigilRadialGestureVisuals,
  normalizeModelScene,
  radialItemExpansionCenter,
  radialGlyphActivationState,
  radialDismissExpansionState,
  radialOpenExpansionState,
  resolveRadialItemFacesCamera,
  resolveNestedFiberBloomTransform,
  resolveNestedFiberStemTransform,
  resolveNestedFractalPulse,
  resolveNestedFractalTreeTransform,
  resolveNestedTreeTransform,
  resolveRadialItemModelTransform,
  resolveRadialItemModelVisibility,
  resolveRadialHoverScale,
  resolveRadialHoverSpin,
  resolveRadialHoverSpinSpeed,
  resolveRadialHoverRotationDegrees,
  resolveRadialItemMotion,
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

test('resolveNestedFractalPulse preserves node-travel spark controls with bounded fallbacks', () => {
  assert.deepEqual(resolveNestedFractalPulse({}).tailSteps, [0, 0.07, 0.14, 0.21, 0.28, 0.35])
  assert.equal(resolveNestedFractalPulse({}).dotSizePx, 5)
  assert.equal(resolveNestedFractalPulse({ fractalPulse: { intensity: 4, dotSizePx: 0 } }).intensity, 3)
  assert.equal(resolveNestedFractalPulse({ fractalPulse: { intensity: 4, dotSizePx: 0 } }).dotSizePx, 0.5)
  assert.deepEqual(
    resolveNestedFractalPulse({ fractalPulse: { tailSteps: [0, '0.2', 'bad'], tailAlphas: [] } }).tailSteps,
    [0, 0.2]
  )
})

test('resolveRadialItemModelTransform normalizes generic 3D item model controls', () => {
  const item = {
    geometry: {
      modelTransform: {
        position: [0.1, -0.2, 0.3],
        scale: 1.25,
        rotation: { y: 45 },
      },
      visibility: {
        model: false,
      },
    },
  }

  assert.deepEqual(resolveRadialItemModelTransform(item), {
    position: { x: 0.1, y: -0.2, z: 0.3 },
    scale: { x: 1.25, y: 1.25, z: 1.25 },
    rotationDegrees: { x: 0, y: 45, z: 0 },
  })
  assert.equal(resolveRadialItemModelVisibility(item), false)
  assert.equal(resolveRadialItemModelVisibility({ geometry: {} }), true)
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

test('radialOpenExpansionState expands avatar-click menus for the configured duration', () => {
  const radial = {
    origin: { x: 10, y: 20 },
    openAnimation: {
      trigger: 'avatar-click',
      startedAt: 5,
      durationMs: 333,
      easing: 'linear',
    },
  }

  assert.deepEqual(radialOpenExpansionState(radial, { time: 5 }), {
    active: true,
    progress: 0,
    rawProgress: 0,
    durationMs: 333,
  })
  assert.ok(Math.abs(radialOpenExpansionState(radial, { time: 5.1665 }).progress - 0.5) < 1e-6)
  assert.deepEqual(radialOpenExpansionState(radial, { time: 6 }), {
    active: false,
    progress: 1,
    rawProgress: 1,
    durationMs: 333,
  })
})

test('radialItemExpansionCenter lerps radial items out from the avatar origin', () => {
  const radial = { origin: { x: 10, y: 20 } }
  const item = { center: { x: 110, y: 220 } }

  assert.deepEqual(radialItemExpansionCenter(radial, item, 0), { x: 10, y: 20 })
  assert.deepEqual(radialItemExpansionCenter(radial, item, 0.25), { x: 35, y: 70 })
  assert.deepEqual(radialItemExpansionCenter(radial, item, 1), item.center)
})

test('radialDismissExpansionState reverses the open animation over its duration', () => {
  const radial = {
    origin: { x: 10, y: 20 },
    dismissAnimation: {
      startedAt: 5,
      durationMs: 333,
      easing: 'linear',
    },
  }

  assert.deepEqual(radialDismissExpansionState(radial, { time: 5 }), {
    active: true,
    progress: 1,
    rawProgress: 0,
    durationMs: 333,
  })
  assert.ok(Math.abs(radialDismissExpansionState(radial, { time: 5.1665 }).progress - 0.5) < 1e-6)
  assert.deepEqual(radialDismissExpansionState(radial, { time: 6 }), {
    active: false,
    progress: 0,
    rawProgress: 1,
    durationMs: 333,
  })
})

test('resolveRadialHoverSpinSpeed uses geometry override and clamps negative values', () => {
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: 0 } }, { nativeGeometry: true }), 0)
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: -2 } }, { nativeGeometry: true }), 0)
  assert.equal(resolveRadialHoverSpinSpeed({ geometry: { hoverSpinSpeed: 0.25 } }, { nativeGeometry: false }), 0.25)
  assert.equal(resolveRadialHoverSpinSpeed({}, { nativeGeometry: true }), DEFAULT_RADIAL_ITEM_MOTION.modelHoverSpinSpeed)
  assert.equal(resolveRadialHoverSpinSpeed({}, { nativeGeometry: false }), DEFAULT_RADIAL_ITEM_MOTION.shapeHoverSpinSpeed)
})

test('resolveRadialItemMotion allows menu-level defaults and item-level overrides', () => {
  assert.deepEqual(
    resolveRadialItemMotion({}, { nativeGeometry: true, itemMotion: { modelHoverSpinSpeed: 0 } }),
    { hoverSpinSpeed: 0 }
  )
  assert.deepEqual(
    resolveRadialItemMotion({}, { nativeGeometry: false, itemMotion: { shapeHoverSpinSpeed: 0.2 } }),
    { hoverSpinSpeed: 0.2 }
  )
  assert.deepEqual(
    resolveRadialItemMotion({ geometry: { itemMotion: { hoverSpinSpeed: 0.4 } } }, {
      nativeGeometry: true,
      itemMotion: { modelHoverSpinSpeed: 0 },
    }),
    { hoverSpinSpeed: 0.4 }
  )
})

test('resolveRadialHoverConfig reads data-driven scale and wheel spin axes', async () => {
  const { DEFAULT_SIGIL_RADIAL_ITEMS } = await import('../../apps/sigil/renderer/radial-menu-defaults.js')
  const context = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'context-menu')
  const reticle = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'annotation-mode')
  const terminal = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'agent-terminal')

  assert.deepEqual(resolveRadialHoverScale(context), { from: 1, to: 2 })
  assert.deepEqual(resolveRadialHoverScale(terminal), { from: 1, to: 2 })
  assert.deepEqual(resolveRadialHoverSpin(context, { nativeGeometry: true }), { axis: 'z', rate: 1.45 })
  assert.deepEqual(resolveRadialHoverSpin(reticle, { nativeGeometry: false }), { axis: 'z', rate: 0.35 })
  assert.equal(resolveRadialItemFacesCamera(context), false)
  assert.equal(resolveRadialItemFacesCamera(reticle), true)
  assert.deepEqual(resolveRadialHoverRotationDegrees(context), { x: 0.12, y: 0, z: 0.055 })
})

test('camera-facing reticle keeps its face toward the viewer instead of radial-angle yaw', async () => {
  const { DEFAULT_SIGIL_RADIAL_ITEMS } = await import('../../apps/sigil/renderer/radial-menu-defaults.js')
  const reticle = DEFAULT_SIGIL_RADIAL_ITEMS.find((item) => item.id === 'annotation-mode')
  const scene = new Object3D()
  const visuals = createSigilRadialGestureVisuals({
    scene,
    projectPoint: () => new Vector3(0, 0, 0),
    projectRadius: () => 0.3,
  })

  visuals.update({
    phase: 'radial',
    menuProgress: 1,
    origin: { x: 0, y: 0 },
    pointer: { x: 0, y: 0 },
    activeItemId: 'annotation-mode',
    items: [{
      ...reticle,
      angle: 270,
      center: { x: 0, y: 0 },
      hitRadius: 20,
      visualRadius: 20,
    }],
  }, { time: 0 })

  const glyph = visuals.group.children[0]
  assert.equal(glyph.userData.facesCamera, true)
  assert.equal(glyph.rotation.x, 0)
  assert.equal(glyph.rotation.y, 0)
  assert.ok(glyph.rotation.z > 0)
})

test('closing radial visuals reverse their ingress animation before disappearing', () => {
  const scene = new Object3D()
  const visuals = createSigilRadialGestureVisuals({
    scene,
    projectPoint: (point) => new Vector3(point.x, point.y, 0),
    projectRadius: () => 0.3,
  })
  const item = {
    id: 'test-item',
    center: { x: 100, y: 0 },
    hitRadius: 20,
    visualRadius: 20,
    geometry: { type: 'glyph' },
  }
  const radial = {
    phase: 'closing',
    origin: { x: 0, y: 0 },
    pointer: { x: 0, y: 0 },
    menuProgress: 1,
    openAnimation: {
      startedAt: 0,
      durationMs: 333,
      easing: 'linear',
    },
    dismissAnimation: {
      startedAt: 0,
      durationMs: 333,
      easing: 'linear',
    },
    items: [item],
  }

  visuals.update(radial, { time: 0 })
  const glyph = visuals.group.children[0]
  assert.equal(visuals.group.visible, true)
  const initialScale = glyph.scale.x

  visuals.update(radial, { time: 0.1665 })
  const halfwayScale = glyph.scale.x
  assert.ok(halfwayScale < initialScale)
  assert.ok(halfwayScale > 0)

  visuals.update(radial, { time: 0.333 })
  assert.equal(visuals.group.visible, false)
})

test('Sigil radial item modules own fallback glyph creation hooks', async () => {
  const { resolveSigilRadialItemModule } = await import('../../apps/sigil/renderer/radial-menu/item-registry.js')
  const moduleDef = resolveSigilRadialItemModule({ id: 'context-menu' })
  const glyph = moduleDef.createGlyph()

  assert.equal(moduleDef.ref, 'sigil.radial.geometry.context-menu')
  assert.ok(glyph.children.length >= 3)
})

test('wiki brain item module owns effect update hook', async () => {
  const { resolveSigilRadialItemModule } = await import('../../apps/sigil/renderer/radial-menu/item-registry.js')
  const moduleDef = resolveSigilRadialItemModule({ id: 'wiki-graph' })
  const calls = []
  const makeObject = () => ({
    visible: true,
    position: { set() {} },
    scale: { set() {} },
    rotation: { set() {} },
    traverse() {},
  })
  const glyph = {
    userData: {
      modelHost: makeObject(),
      radialEffectConfig: {
        kind: 'nested-neural-tree',
        holdExitDirection: 'outward',
        shellOpacity: { rest: 0.75, active: 0.26, held: 0.75 },
        visibility: {},
      },
      radialEffectState: {
        activation: 0,
        treeProgress: 0,
        fractalTreeProgress: 0,
        heldProgress: 0,
        shellOpacity: 0.75,
      },
      radialEffectTree: makeObject(),
      radialEffectComposite: makeObject(),
      radialEffectFiberStem: makeObject(),
      radialEffectFiberBloom: makeObject(),
      radialEffectFractalTree: makeObject(),
    },
  }
  const helpers = {
    DEFAULT_NESTED_TREE_EFFECT: { visibility: {} },
    DEFAULT_RADIAL_ITEM_MODEL_TRANSFORM: {},
    applyObjectTransform() {},
    applyNestedShellTransform() {},
    applyNestedFiberStemTransform() {},
    applyNestedFiberBloomTransform() {},
    applyNestedFractalTreeTransform() {},
    radialItemPointerMetrics: () => ({ relation: 'inside' }),
    updateFiberTree: (...args) => calls.push(['fiber', args[1]]),
    updateFractalTree: (...args) => calls.push(['fractal', args[1]]),
  }

  const state = moduleDef.updateEffect(glyph, { id: 'wiki-graph' }, {
    active: false,
    visualRadial: { pointer: { x: 0, y: 0 } },
    progress: 1,
    dt: 0.016,
  }, helpers)

  assert.equal(moduleDef.ref, 'sigil.radial.geometry.wiki-brain')
  assert.equal(state.kind, 'nested-neural-tree')
  assert.ok(state.activation > 0)
  assert.deepEqual(calls.map(([kind]) => kind), ['fiber', 'fractal'])
})

test('radial visuals does not own wiki brain effect implementation names', async () => {
  const source = await readFile('apps/sigil/renderer/live-modules/radial-gesture-visuals.js', 'utf8')
  for (const name of [
    'createNestedNeuralTreeEffect',
    'updateNestedNeuralTreeEffect',
    'createFractalBrainTreeEffect',
    'updateFractalBrainTreeEffect',
    'fractalPulseSparkPosition',
    'spawnFractalPulse',
  ]) {
    assert.equal(source.includes(name), false, `${name} should stay item-owned`)
  }
})

test('default radial geometry derives from resolved Sigil JSON', async () => {
  const state = (await import('../../apps/sigil/renderer/state.js')).default
  const { DEFAULT_APPEARANCE } = await import('../../apps/sigil/renderer/appearance.js')
  const { RESOLVED_SIGIL_RADIAL_MENU, normalizeSigilRadialGestureMenu } = await import('../../apps/sigil/renderer/radial-menu-defaults.js')
  const keys = ['deadZoneRadius', 'itemRadius', 'itemHitRadius', 'itemVisualRadius', 'menuRadius', 'handoffRadius', 'reentryRadius', 'spreadDegrees', 'startAngle', 'orientation']
  const expected = Object.fromEntries(keys.map((key) => [key, RESOLVED_SIGIL_RADIAL_MENU.geometry[key]]))

  assert.deepEqual(Object.fromEntries(keys.map((key) => [key, state.radialGestureMenu[key]])), expected)
  assert.deepEqual(Object.fromEntries(keys.map((key) => [key, DEFAULT_APPEARANCE.interaction.radialGestureMenu[key]])), expected)
  assert.equal(normalizeSigilRadialGestureMenu({ itemRadius: 9 }).itemRadius, 9)
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
