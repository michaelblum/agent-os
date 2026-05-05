import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createRadialActivationTransitionController,
  radialActivationTransitionDuration,
  radialActivationTransitionFrame,
  transitionRadialSnapshot,
} from '../../apps/sigil/renderer/live-modules/radial-activation-transition.js'

const wikiItem = {
  id: 'wiki-graph',
  label: 'Wiki Graph',
  action: 'wikiGraph',
  center: { x: 160, y: 120 },
}

const transition = {
  preset: 'wiki-brain-zoom-dissolve',
  item: {
    focus: { mode: 'fill-camera' },
    dissolve: true,
    duration_ms: 460,
  },
  menu: {
    dissolve: true,
    fade: { from: 1, to: 0 },
    duration_ms: 320,
  },
  surface: {
    fade: 'in',
    opacity: { from: 0, to: 1 },
    duration_ms: 320,
  },
}

test('radial activation transition duration uses the longest declared slot', () => {
  assert.equal(radialActivationTransitionDuration(transition), 460)
})

test('transitionRadialSnapshot keeps committed item geometry alive for visuals', () => {
  const radial = transitionRadialSnapshot({
    phase: 'committed',
    activeItemId: 'wiki-graph',
    pointer: { x: 0, y: 0 },
    menuProgress: 0.6,
    committed: {
      type: 'item',
      itemId: 'wiki-graph',
      item: wikiItem,
    },
    items: [wikiItem],
  })

  assert.equal(radial.phase, 'radial')
  assert.equal(radial.activeItemId, 'wiki-graph')
  assert.deepEqual(radial.pointer, wikiItem.center)
  assert.equal(radial.menuProgress, 1)
  assert.equal(radial.committed, null)
})

test('radialActivationTransitionFrame computes item dissolve and surface fade', () => {
  const frame = radialActivationTransitionFrame({
    activation: {
      id: 'activation-1',
      transition,
    },
    item_id: 'wiki-graph',
    started_at: 10,
    duration_ms: 460,
    radial: { phase: 'radial', activeItemId: 'wiki-graph', items: [wikiItem] },
  }, 10.46)

  assert.equal(frame.completed, true)
  assert.equal(frame.item_id, 'wiki-graph')
  assert.equal(frame.preset, 'wiki-brain-zoom-dissolve')
  assert.equal(frame.item.opacity, 0)
  assert.equal(frame.menu.opacity, 0)
  assert.equal(frame.surface.opacity, 1)
})

test('radial activation transition controller starts, ticks, and clears', () => {
  let time = 2
  const controller = createRadialActivationTransitionController({ now: () => time })
  const started = controller.start({
    id: 'activation-2',
    item: wikiItem,
    transition,
  }, {
    phase: 'committed',
    activeItemId: 'wiki-graph',
    committed: {
      type: 'item',
      itemId: 'wiki-graph',
      item: wikiItem,
    },
    items: [wikiItem],
  })

  assert.equal(started.progress, 0)
  assert.equal(started.radial.phase, 'radial')
  time = 2.23
  assert.equal(controller.tick().completed, false)
  time = 2.461
  assert.equal(controller.tick().completed, true)
  controller.clear()
  assert.equal(controller.tick(), null)
})
