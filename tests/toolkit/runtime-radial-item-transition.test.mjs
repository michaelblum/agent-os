import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET,
  RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION,
  normalizeRadialItemActivationTransition,
  radialItemActivationTransitionPreset,
  resolveRadialItemActivationTransition,
} from '../../packages/toolkit/runtime/radial-item-transition.js'

test('radial item activation transition preset defines vanilla 3D lifecycle slots', () => {
  const transition = radialItemActivationTransitionPreset()

  assert.equal(transition.schema_version, RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION)
  assert.equal(transition.preset, DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET)
  assert.equal(transition.item.focus.mode, 'item-center')
  assert.equal(transition.item.focus.zoom, 'fit-item')
  assert.equal(transition.item.hold, true)
  assert.equal(transition.menu.hold_active_item, true)
  assert.deepEqual(transition.menu.fade, { from: 1, to: 0.18 })
  assert.equal(transition.surface.fade, 'in')
  assert.equal(transition.cancel.item.focus, 'restore')
})

test('radial item activation transitions deep-merge item overrides', () => {
  const transition = resolveRadialItemActivationTransition({
    id: 'wiki-graph',
    activationTransition: {
      preset: 'wiki-brain-zoom-dissolve',
      item: {
        focus: {
          mode: 'fill-camera',
          scale: 1,
        },
        dissolve: true,
        duration_ms: 460,
      },
      menu: {
        dissolve: true,
        fade: { to: 0 },
      },
      surface: {
        starts: 'with-item',
      },
    },
  })

  assert.equal(transition.item_id, 'wiki-graph')
  assert.equal(transition.preset, 'wiki-brain-zoom-dissolve')
  assert.equal(transition.item.focus.mode, 'fill-camera')
  assert.equal(transition.item.focus.zoom, 'fit-item')
  assert.equal(transition.item.focus.scale, 1)
  assert.equal(transition.item.dissolve, true)
  assert.equal(transition.item.duration_ms, 460)
  assert.equal(transition.menu.dissolve, true)
  assert.deepEqual(transition.menu.fade, { from: 1, to: 0 })
  assert.equal(transition.surface.starts, 'with-item')
  assert.equal(transition.cancel.item.focus, 'restore')
})

test('radial item activation transitions are detached from preset mutation', () => {
  const transition = radialItemActivationTransitionPreset()
  transition.item.focus.mode = 'mutated'

  assert.equal(radialItemActivationTransitionPreset().item.focus.mode, 'item-center')
})

test('radial item activation transition can be explicitly disabled', () => {
  assert.equal(resolveRadialItemActivationTransition({
    id: 'plain-label',
    activationTransition: false,
  }), null)
})

test('normalizing radial item activation transition clamps duration fields', () => {
  const transition = normalizeRadialItemActivationTransition({
    item: { duration_ms: -10 },
    menu: { duration_ms: '25' },
  })

  assert.equal(transition.item.duration_ms, 0)
  assert.equal(transition.menu.duration_ms, 25)
})
