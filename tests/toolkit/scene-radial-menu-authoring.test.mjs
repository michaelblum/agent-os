import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCENE_RADIAL_MENU_AUTHORING_CONTRACT_ID,
  compileSceneRadialMenuDefinition,
  validateSceneRadialMenuAuthoringDefinition,
} from '../../packages/toolkit/scene/radial-menu.js'

function definition(overrides = {}) {
  return {
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'example.radial.main',
    close_on_select: true,
    geometry: {
      orientation: 'trigger-vector',
      menuRadius: 1.8,
      handoffRadius: 2.25,
      reentryRadius: 1.85,
    },
    scene: {
      radius: 116,
      spreadDegrees: 120,
      startAngle: -90,
      style: {
        activeColor: '#ffffff',
        fillColor: '#201b2f',
        itemRadius: 24,
        opacity: 0.94,
      },
    },
    defaults: {
      item: {
        action: 'default-action',
        role: 'menuitem',
      },
      three: {
        item: {
          hover: {
            transform: {
              scale: { from: 1, to: 1.4 },
              rotate: { spin: { axis: 'y', rate: 1.25 } },
            },
          },
        },
      },
    },
    items: [
      {
        id: 'inspect',
        label: 'Inspect',
        action: 'inspect',
        color: '#9b7cff',
        geometry: { type: 'procedural', implementation: 'example.radial.inspect' },
        effects: [{ ref: 'example.effect.halo', enabled: true }],
      },
      {
        id: 'disabled',
        label: 'Unavailable',
        action: 'disabled-action',
        disabled: true,
      },
      {
        id: 'hidden',
        label: 'Hidden action',
        action: 'hidden-action',
        hidden: true,
      },
    ],
    ...overrides,
  }
}

test('radial-menu authoring compiles one definition into strict runtime, logical, and visual projections', () => {
  const source = definition()
  const compiled = compileSceneRadialMenuDefinition(source)

  assert.equal(compiled.contract, SCENE_RADIAL_MENU_AUTHORING_CONTRACT_ID)
  assert.deepEqual(compiled.parameters, {
    menuId: 'example.radial.main',
    items: [
      { id: 'inspect', label: 'Inspect', color: '#9b7cff', disabled: false },
      { id: 'disabled', label: 'Unavailable', disabled: true },
    ],
    closeOnSelect: true,
    radius: 116,
    spreadDegrees: 120,
    startAngle: -90,
    style: {
      activeColor: '#ffffff',
      fillColor: '#201b2f',
      itemRadius: 24,
      opacity: 0.94,
    },
  })
  assert.deepEqual(compiled.runtimeProjection.items, [
    { id: 'inspect', color: '#9b7cff', disabled: false },
    { id: 'disabled', color: '#9b7cff', disabled: true },
  ])
  assert.deepEqual(compiled.gestureProjection, {
    orientation: 'trigger-vector',
    menuRadius: 1.8,
    handoffRadius: 2.25,
    reentryRadius: 1.85,
  })
  assert.equal(JSON.stringify(compiled.parameters).includes('inspect-action'), false)
  assert.equal(compiled.logicalItems.find((item) => item.id === 'inspect')?.action, 'inspect')
  assert.equal(compiled.logicalItems.find((item) => item.id === 'hidden')?.hidden, true)
  assert.equal(compiled.visualDefinition.items[0].geometry.implementation, 'example.radial.inspect')
  assert.equal(compiled.visualDefinition.items[0].effects[0].ref, 'example.effect.halo')
  assert.equal(compiled.visualDefinition.items[0].action, undefined)
  assert.equal(compiled.visualDefinition.defaults.item.action, undefined)
  assert.equal(compiled.visualDefinition.defaults.item.role, undefined)
  assert.equal(JSON.stringify(compiled.visualDefinition).includes('action_payload'), false)
  assert.deepEqual(
    compiled.visualDefinition.items[0].three.item.hover.transform.scale,
    { from: 1, to: 1.4 },
  )
  assert.equal(source.items[0].three, undefined, 'compilation must not mutate the source definition')
})

test('radial-menu authoring keeps stage projection explicit instead of treating renderer units as pixels', () => {
  const source = definition({
    geometry: {
      menuRadius: 1.8,
      spreadDegrees: 88,
      startAngle: -45,
    },
  })
  delete source.scene
  const compiled = compileSceneRadialMenuDefinition(source)

  assert.equal(compiled.parameters.radius, 108)
  assert.equal(compiled.parameters.spreadDegrees, 88)
  assert.equal(compiled.parameters.startAngle, -45)
})

test('radial-menu authoring fails closed before producing a runtime payload', () => {
  const unknownProjection = validateSceneRadialMenuAuthoringDefinition(definition({
    scene: { radius: 100, productAction: 'open-settings' },
  }))
  assert.equal(unknownProjection.ok, false)
  assert.equal(unknownProjection.errors[0].code, 'unknown_scene_projection_field')

  assert.throws(() => compileSceneRadialMenuDefinition(definition({
    items: [
      { id: 'duplicate', label: 'First' },
      { id: 'duplicate', label: 'Second' },
    ],
  })), (error) => {
    assert.equal(error.code, 'SCENE_RADIAL_MENU_AUTHORING_INVALID')
    assert.equal(error.errors.some(({ code }) => code === 'invalid_radial_item'), true)
    return true
  })

  assert.throws(() => compileSceneRadialMenuDefinition(definition({
    items: [{ id: 'unsafe item', label: 'Unsafe' }],
  })), /canonical/u)
})

test('radial-menu authoring bounds cyclic, deep, and flooding definitions before resolution', () => {
  const cyclic = definition()
  cyclic.self = cyclic
  assert.equal(
    validateSceneRadialMenuAuthoringDefinition(cyclic).errors[0].code,
    'radial_menu_definition_cycle',
  )

  const deep = definition()
  let cursor = deep.items[0]
  for (let index = 0; index < 40; index += 1) {
    cursor.nested = {}
    cursor = cursor.nested
  }
  assert.equal(
    validateSceneRadialMenuAuthoringDefinition(deep).errors[0].code,
    'radial_menu_depth_limit',
  )

  const flooding = definition({
    items: Array.from({ length: 33 }, (_, index) => ({
      id: `item-${index}`,
      label: `Item ${index}`,
    })),
  })
  assert.equal(
    validateSceneRadialMenuAuthoringDefinition(flooding).errors[0].code,
    'radial_menu_item_limit',
  )

  assert.equal(validateSceneRadialMenuAuthoringDefinition(definition(), {
    base: flooding,
  }).errors[0].path, 'options.base.items')

  const mergedFlooding = definition({
    extends: 'example.base',
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `override-${index}`,
      label: `Override ${index}`,
    })),
  })
  const base = definition({
    id: 'example.radial.base',
    items: Array.from({ length: 20 }, (_, index) => ({
      id: `base-${index}`,
      label: `Base ${index}`,
    })),
  })
  assert.equal(validateSceneRadialMenuAuthoringDefinition(mergedFlooding, {
    allowExtends: { 'example.base': base },
  }).errors[0].code, 'radial_menu_item_limit')

  const mergedBytes = definition({
    extends: 'example.large-base',
    overrideVisualData: 'o'.repeat(140 * 1024),
  })
  const largeBase = definition({
    id: 'example.radial.large-base',
    baseVisualData: 'b'.repeat(140 * 1024),
  })
  assert.equal(validateSceneRadialMenuAuthoringDefinition(mergedBytes, {
    allowExtends: { 'example.large-base': largeBase },
  }).errors[0].code, 'radial_menu_byte_limit')
})

test('radial-menu authoring rejects executable and unresolved inherited data', () => {
  const executable = definition()
  executable.items[0].geometry.factory = () => ({})
  assert.equal(
    validateSceneRadialMenuAuthoringDefinition(executable).errors[0].code,
    'invalid_radial_menu_definition',
  )

  assert.equal(validateSceneRadialMenuAuthoringDefinition(definition({
    extends: 'missing.base',
  })).errors[0].code, 'unknown_radial_menu_base')

  const accessor = definition()
  Object.defineProperty(accessor.items[0], 'computed', {
    enumerable: true,
    get() {
      throw new Error('must not execute')
    },
  })
  assert.equal(
    validateSceneRadialMenuAuthoringDefinition(accessor).errors[0].code,
    'invalid_radial_menu_definition',
  )
})
