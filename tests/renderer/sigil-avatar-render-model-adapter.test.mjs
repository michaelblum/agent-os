import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE,
  CURRENT_AVATAR_RENDER_MODEL_SOURCE,
  CURRENT_LIVE_SIGIL_AVATAR_SOURCE,
  currentAvatarRenderSource,
} from '../../apps/sigil/renderer/live-modules/avatar-render-model-adapter.js'

class FakeMaterial {
  constructor(name) {
    this.name = name
    this.cloneCount = 0
  }

  clone() {
    this.cloneCount += 1
    return new FakeMaterial(`${this.name}:clone`)
  }
}

function rendererState(overrides = {}) {
  const primaryMaterial = overrides.primaryMaterial || new FakeMaterial('primary')
  const edgeMaterial = overrides.edgeMaterial || new FakeMaterial('edge')
  return {
    currentGeometryType: 12,
    currentSkin: 'none',
    currentOpacity: 0.82,
    currentEdgeOpacity: 0.67,
    isSpecularEnabled: true,
    isMaskEnabled: false,
    isInteriorEdgesEnabled: true,
    coreMesh: { material: primaryMaterial },
    wireframeMesh: { material: edgeMaterial },
    skinMaterial: new FakeMaterial('skin'),
    polyGroup: { name: 'avatar-root', userData: { object_id: 'avatar.main' } },
    colors: {
      face: ['#112233', '#445566'],
      edge: ['#778899', '#aabbcc'],
      aura: ['#ddeeff', '#001122'],
      pulsar: ['#ffffff', '#112233'],
      accretion: ['#334455', '#667788'],
      gamma: ['#99aabb', '#ccddee'],
      neutrino: ['#102030', '#405060'],
      lightning: ['#abcdef', '#fedcba'],
      magnetic: ['#246810', '#121416'],
    },
    isAuraEnabled: true,
    auraReach: 1.7,
    auraIntensity: 1.4,
    auraPulseRate: 0.006,
    wobbleCount: 3,
    wobbleChaos: 0.42,
    isPulsarEnabled: true,
    pulsarRayCount: 4,
    isAccretionEnabled: true,
    accretionDiskCount: 2,
    isGammaEnabled: true,
    gammaRayCount: 5,
    isNeutrinosEnabled: true,
    neutrinoJetCount: 6,
    turbState: { p: { val: 0.3, spd: 1.2, mod: 'staggered' } },
    isTrailEnabled: true,
    trailStyle: 'line',
    trailLength: 8,
    trailOpacity: 0.62,
    trailFadeMs: 640,
    trailSprites: [{}, {}],
    isLightningEnabled: true,
    lightningFrequency: 3,
    isMagneticEnabled: true,
    magneticTentacleCount: 11,
    ...overrides,
  }
}

test('avatar render-model adapter exposes live avatar render state without cloning materials', () => {
  const state = rendererState()
  const source = currentAvatarRenderSource(state)

  assert.equal(source.source, 'avatar_render_state')
  assert.equal(source.appearanceSource, CURRENT_LIVE_SIGIL_AVATAR_SOURCE)
  assert.equal(source.materialSource, CURRENT_AVATAR_RENDER_MODEL_SOURCE)
  assert.equal(source.effectsSource, CURRENT_AVATAR_EFFECT_DESCRIPTORS_SOURCE)
  assert.equal(source.geometryType, 12)
  assert.equal(source.skin, 'none')
  assert.equal(source.primaryMaterialTemplate, state.coreMesh.material)
  assert.equal(source.edgeMaterialTemplate, state.wireframeMesh.material)
  assert.equal(source.primaryMaterial, state.coreMesh.material)
  assert.equal(source.edgeMaterial, state.wireframeMesh.material)
  assert.equal(state.coreMesh.material.cloneCount, 0)
  assert.equal(state.wireframeMesh.material.cloneCount, 0)
  assert.deepEqual(source.colorRamp.face, ['#112233', '#445566'])
  assert.equal(source.auraDescriptor.reach, 1.7)
  assert.equal(source.auraDescriptor.wobble.count, 3)
  assert.equal(source.phenomenaDescriptor.pulsar.count, 4)
  assert.equal(source.phenomenaDescriptor.accretion.count, 2)
  assert.equal(source.phenomenaDescriptor.gamma.count, 5)
  assert.equal(source.phenomenaDescriptor.neutrino.count, 6)
  assert.equal(source.trailDescriptor.style, 'line')
  assert.equal(source.trailDescriptor.spriteCount, 2)
  assert.equal(source.lightningDescriptor.frequency, 3)
  assert.equal(source.magneticDescriptor.tentacleCount, 11)
  assert.deepEqual(source.effectRootDescriptor, {
    source: 'state.polyGroup',
    objectId: 'avatar.main',
    kind: 'Object',
  })
})

test('avatar render-model identity changes for material and non-material effect inputs', () => {
  const primaryMaterial = new FakeMaterial('primary')
  const edgeMaterial = new FakeMaterial('edge')
  const first = currentAvatarRenderSource(rendererState({ primaryMaterial, edgeMaterial }))
  const changedAura = currentAvatarRenderSource(rendererState({
    primaryMaterial,
    edgeMaterial,
    auraReach: 2.2,
  }))
  const changedPhenomena = currentAvatarRenderSource(rendererState({
    primaryMaterial,
    edgeMaterial,
    pulsarRayCount: 7,
  }))

  assert.notEqual(changedAura.version, first.version)
  assert.notEqual(changedPhenomena.version, first.version)
})

test('avatar render-model source excludes Selection Mode cursor overrides', () => {
  const source = currentAvatarRenderSource(rendererState())

  assert.equal('cursor_overrides' in source, false)
  assert.equal('cursorOverrides' in source, false)
  assert.equal('hotspot' in source, false)
  assert.equal('scale' in source, false)
  assert.equal('visibility' in source, false)
  assert.equal('single_axis_rotation' in source, false)
})
