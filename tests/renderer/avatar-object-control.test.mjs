import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SIGIL_RADIAL_ITEMS } from '../../apps/sigil/renderer/live-modules/radial-gesture-menu.js'
import {
  AVATAR_AURA_OBJECT_ID,
  AVATAR_LIGHTNING_OBJECT_ID,
  AVATAR_MAGNETIC_OBJECT_ID,
  AVATAR_OMEGA_OBJECT_ID,
  AVATAR_OMEGA_TESSERON_OBJECT_ID,
  AVATAR_PHENOMENA_OBJECT_ID,
  AVATAR_PRIMARY_OBJECT_ID,
  AVATAR_PRIMARY_TESSERON_OBJECT_ID,
  AVATAR_ROOT_OBJECT_ID,
  AVATAR_TRAIL_OBJECT_ID,
  AVATAR_TRAVEL_OBJECT_ID,
  applyAvatarObjectEffectsPatch,
  applyAvatarObjectTransformPatch,
  buildAvatarObjectRegistry,
} from '../../apps/sigil/renderer/live-modules/avatar-object-control.js'
import {
  AGENT_TERMINAL_MODEL_OBJECT_ID,
  WIKI_BRAIN_GROUP_OBJECT_ID,
} from '../../apps/sigil/renderer/live-modules/radial-object-control.js'

function rendererState(overrides = {}) {
  return {
    z_depth: 1.2,
    appScale: 0.75,
    currentGeometryType: 12,
    stellationFactor: 0.25,
    currentOpacity: 0.45,
    currentEdgeOpacity: 0.8,
    currentSkin: 'none',
    tesseron: {
      enabled: true,
      proportion: 0.42,
      matchMother: true,
      child: {
        opacity: 0.25,
        edgeOpacity: 1,
        maskEnabled: true,
        interiorEdges: true,
        specular: true,
      },
    },
    isAuraEnabled: true,
    auraIntensity: 1.4,
    auraReach: 1.8,
    wobbleCount: 3,
    isPulsarEnabled: true,
    pulsarRayCount: 4,
    isAccretionEnabled: true,
    accretionDiskCount: 2,
    isGammaEnabled: true,
    gammaRayCount: 5,
    isNeutrinosEnabled: true,
    neutrinoJetCount: 6,
    turbState: {
      p: { val: 0.2, spd: 1, mod: 'random' },
      a: { val: 0.1, spd: 1, mod: 'uniform' },
      g: { val: 0.3, spd: 0.55, mod: 'random' },
      n: { val: 0.4, spd: 1, mod: 'uniform' },
    },
    isTrailEnabled: true,
    trailLength: 8,
    trailOpacity: 0.6,
    trailFadeMs: 640,
    trailStyle: 'omega',
    isLightningEnabled: true,
    lightningBoltLength: 100,
    lightningFrequency: 3,
    lightningBrightness: 1.2,
    isMagneticEnabled: true,
    magneticTentacleCount: 9,
    magneticTentacleSpeed: 1.5,
    magneticWander: 2.5,
    transitionFastTravelEffect: 'wormhole',
    fastTravelLineRepeatCount: 12,
    wormholeObjectEnabled: true,
    isOmegaEnabled: true,
    omegaGeometryType: 8,
    omegaStellationFactor: 0.1,
    omegaTesseron: {
      enabled: true,
      proportion: 0.33,
      matchMother: false,
      child: {
        opacity: 0.2,
        edgeOpacity: 0.6,
        maskEnabled: true,
        interiorEdges: true,
        specular: false,
      },
    },
    omegaScale: 2.25,
    omegaOpacity: 0.35,
    omegaEdgeOpacity: 0.55,
    omegaSkin: 'none',
    omegaGhostCount: 13,
    omegaGhostDuration: 2.5,
    omegaInterDimensional: true,
    radialGestureMenu: {
      items: structuredClone(DEFAULT_SIGIL_RADIAL_ITEMS),
    },
    ...overrides,
  }
}

function byId(registry, id) {
  const object = registry.objects.find((entry) => entry.object_id === id)
  assert.ok(object, `missing object ${id}`)
  return object
}

function assertRegistryContractShape(registry) {
  assert.equal(registry.type, 'canvas_object.registry')
  assert.equal(registry.schema_version, '2026-05-03')
  assert.equal(registry.canvas_id, 'avatar-main')
  assert.ok(Array.isArray(registry.objects))
  for (const object of registry.objects) {
    assert.equal(typeof object.object_id, 'string', object.object_id)
    assert.equal(typeof object.name, 'string', object.object_id)
    assert.ok(['three.object3d', 'canvas.object', 'dom.element', 'custom'].includes(object.kind), object.object_id)
    assert.ok(Array.isArray(object.capabilities), object.object_id)
    assert.ok(object.capabilities.length > 0, object.object_id)
    assert.deepEqual(object.units, {
      position: 'scene',
      scale: 'multiplier',
      rotation: 'degrees',
    }, object.object_id)
    for (const key of ['position', 'scale', 'rotation_degrees']) {
      assert.equal(typeof object.transform[key].x, 'number', `${object.object_id}.${key}.x`)
      assert.equal(typeof object.transform[key].y, 'number', `${object.object_id}.${key}.y`)
      assert.equal(typeof object.transform[key].z, 'number', `${object.object_id}.${key}.z`)
    }
    assert.equal(typeof object.visible, 'boolean', object.object_id)
    assert.equal(object.metadata.owner, 'sigil', object.object_id)
    assert.equal(object.metadata.subject, 'avatar-main', object.object_id)
    assert.ok(object.metadata.source || object.metadata.source_refs, object.object_id)
  }
}

test('avatar object registry publishes valid avatar-main root and renderer state mappings', () => {
  const registry = buildAvatarObjectRegistry(rendererState(), {
    canvasId: 'avatar-main',
    avatarPos: { x: 42, y: -7, z: 3 },
    avatarVisible: true,
  })

  assertRegistryContractShape(registry)

  const root = byId(registry, AVATAR_ROOT_OBJECT_ID)
  assert.equal(root.name, 'Sigil Avatar')
  assert.deepEqual(root.transform.position, { x: 42, y: -7, z: 3 })
  assert.deepEqual(root.transform.scale, { x: 0.8999999999999999, y: 0.8999999999999999, z: 0.8999999999999999 })
  assert.equal(root.metadata.control_domain, 'object-graph')
  assert.equal(root.metadata.source_refs.position, 'liveJs.avatarPos')

  const primary = byId(registry, AVATAR_PRIMARY_OBJECT_ID)
  assert.equal(primary.parent_object_id, AVATAR_ROOT_OBJECT_ID)
  assert.equal(primary.metadata.role, 'primary-shape')
  assert.equal(primary.metadata.geometry_type, 12)
  assert.match(primary.descriptors.geometry, /Primary polyhedron geometry 12/)
  assert.deepEqual(
    Object.fromEntries(primary.controls.animation_effects.map((control) => [control.id, control.value])),
    {
      'shape.type': 12,
      'shape.stellation': 0.25,
      'material.opacity': 0.45,
      'material.edgeOpacity': 0.8,
    },
  )
})

test('avatar object registry covers primary tesseron, phenomena, trails, and travel effects', () => {
  const registry = buildAvatarObjectRegistry(rendererState(), { canvasId: 'avatar-main' })

  const primaryTesseron = byId(registry, AVATAR_PRIMARY_TESSERON_OBJECT_ID)
  assert.equal(primaryTesseron.parent_object_id, AVATAR_PRIMARY_OBJECT_ID)
  assert.deepEqual(primaryTesseron.transform.scale, { x: 0.42, y: 0.42, z: 0.42 })
  assert.deepEqual(primaryTesseron.controls.animation_effects.map((control) => control.id), [
    'tesseron.proportion',
    'tesseron.matchMother',
  ])

  const aura = byId(registry, AVATAR_AURA_OBJECT_ID)
  assert.equal(aura.visible, true)
  assert.equal(aura.metadata.source_refs.intensity, 'state.auraIntensity')
  assert.equal(aura.controls.animation_effects.find((control) => control.id === 'aura.intensity').value, 1.4)

  const phenomena = byId(registry, AVATAR_PHENOMENA_OBJECT_ID)
  assert.equal(phenomena.visible, true)
  assert.deepEqual(
    Object.fromEntries(phenomena.controls.animation_effects.map((control) => [control.id, control.value])),
    {
      'phenomena.pulsar.count': 4,
      'phenomena.accretion.count': 2,
      'phenomena.gamma.count': 5,
      'phenomena.neutrino.count': 6,
    },
  )

  const lightning = byId(registry, AVATAR_LIGHTNING_OBJECT_ID)
  assert.equal(lightning.visible, true)
  assert.equal(lightning.metadata.source_refs.frequency, 'state.lightningFrequency')
  assert.equal(lightning.controls.animation_effects.find((control) => control.id === 'lightning.length').value, 100)

  const magnetic = byId(registry, AVATAR_MAGNETIC_OBJECT_ID)
  assert.equal(magnetic.visible, true)
  assert.equal(magnetic.metadata.source_refs.tentacles, 'state.magneticTentacleCount')
  assert.equal(magnetic.controls.animation_effects.find((control) => control.id === 'magnetic.tentacleCount').value, 9)

  const trail = byId(registry, AVATAR_TRAIL_OBJECT_ID)
  assert.equal(trail.visible, true)
  assert.equal(trail.controls.animation_effects.find((control) => control.id === 'trails.count').value, 8)

  const travel = byId(registry, AVATAR_TRAVEL_OBJECT_ID)
  assert.equal(travel.visible, true)
  assert.equal(travel.metadata.source_refs.wormhole, 'state.wormhole*')
})

test('avatar object registry maps omega secondary shape and omega tesseron when enabled', () => {
  const registry = buildAvatarObjectRegistry(rendererState(), { canvasId: 'avatar-main' })

  const omega = byId(registry, AVATAR_OMEGA_OBJECT_ID)
  assert.equal(omega.parent_object_id, AVATAR_ROOT_OBJECT_ID)
  assert.equal(omega.metadata.role, 'omega-shape')
  assert.equal(omega.metadata.geometry_type, 8)
  assert.deepEqual(omega.transform.scale, { x: 2.25, y: 2.25, z: 2.25 })
  assert.equal(omega.controls.animation_effects.find((control) => control.id === 'omega.ghostCount').value, 13)
  assert.equal(omega.controls.animation_effects.find((control) => control.id === 'omega.interDimensional').value, true)

  const omegaTesseron = byId(registry, AVATAR_OMEGA_TESSERON_OBJECT_ID)
  assert.equal(omegaTesseron.parent_object_id, AVATAR_OMEGA_OBJECT_ID)
  assert.deepEqual(omegaTesseron.transform.scale, { x: 0.33, y: 0.33, z: 0.33 })
})

test('avatar object registry keeps radial object coverage under avatar root without changing radial builder behavior', () => {
  const registry = buildAvatarObjectRegistry(rendererState(), { canvasId: 'avatar-main' })

  const wikiBrain = byId(registry, WIKI_BRAIN_GROUP_OBJECT_ID)
  assert.equal(wikiBrain.parent_object_id, AVATAR_ROOT_OBJECT_ID)
  assert.equal(wikiBrain.metadata.editor, '3d-radial-item')
  assert.equal(wikiBrain.metadata.control_domain, 'object-effect')

  const terminal = byId(registry, AGENT_TERMINAL_MODEL_OBJECT_ID)
  assert.equal(terminal.parent_object_id, AVATAR_ROOT_OBJECT_ID)
  assert.equal(terminal.metadata.item_id, 'agent-terminal')
})

test('avatar object registry omits unsupported tesseron and disabled omega nodes', () => {
  const registry = buildAvatarObjectRegistry(rendererState({
    currentGeometryType: 91,
    omegaGeometryType: 91,
    isOmegaEnabled: false,
  }), { canvasId: 'avatar-main' })

  assert.equal(registry.objects.some((object) => object.object_id === AVATAR_PRIMARY_TESSERON_OBJECT_ID), false)
  assert.equal(registry.objects.some((object) => object.object_id === AVATAR_OMEGA_OBJECT_ID), false)
  assert.equal(registry.objects.some((object) => object.object_id === AVATAR_OMEGA_TESSERON_OBJECT_ID), false)
})

test('avatar object registry rejects stale cursor patches after cursor removal', () => {
  const registry = buildAvatarObjectRegistry(rendererState(), { canvasId: 'avatar-main' })
  const deletedCursorPrefix = ['selection-mode', 'cursor'].join('.') + '.'
  const deletedCursorObjectId = ['selection-mode', 'cursor', 'sigil-model'].join('.')

  assert.equal(
    registry.objects.some((object) => String(object.object_id || '').startsWith(deletedCursorPrefix)),
    false,
  )

  const transform = applyAvatarObjectTransformPatch(rendererState(), {
    type: 'canvas_object.transform.patch',
    request_id: 'rotate-cursor',
    target: { canvas_id: 'avatar-main', object_id: deletedCursorObjectId },
    patch: { rotation_degrees: { x: 12, z: 36 } },
  }, { canvasId: 'avatar-main' })
  assert.equal(transform.status, 'stale')
  assert.equal(transform.reason, 'unknown_object')

  const effects = applyAvatarObjectEffectsPatch(rendererState(), {
    type: 'canvas_object.effects.patch',
    request_id: 'shape-cursor',
    target: { canvas_id: 'avatar-main', object_id: deletedCursorObjectId },
    patch: {
      controls: {
        [['cursor', 'prism', 'topRadius'].join('.')]: 0.2,
        [['cursor', 'prism', 'height'].join('.')]: 3.2,
      },
    },
  }, { canvasId: 'avatar-main' })
  assert.equal(effects.status, 'stale')
  assert.equal(effects.reason, 'unknown_object')
})
