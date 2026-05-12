import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyDesktopWorldStageMessage,
  createDesktopWorldStageState,
  desktopWorldStageRegistry,
  desktopWorldStageSnapshot,
  normalizeStageLayer,
  renderDesktopWorldStageLayers,
  stageLayerList,
} from '../../packages/toolkit/components/desktop-world-stage/model.js'

test('normalizeStageLayer accepts array and object frame shapes', () => {
  assert.deepEqual(normalizeStageLayer({
    id: 'outline',
    frame: [10.4, 20.6, 320.2, 180.8],
  }).frame, [10.4, 20.6, 320.2, 180.8])

  assert.deepEqual(normalizeStageLayer({
    id: 'rect',
    bounds: { x: 4, y: 5, width: 6, height: 7 },
  }).frame, [4, 5, 6, 7])

  assert.equal(normalizeStageLayer({ frame: [0, 0, 1, 1] }), null)
})

test('stage messages upsert, remove, replace, and clear visual layers', () => {
  const state = createDesktopWorldStageState()

  assert.equal(applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layer.upsert',
    payload: {
      id: 'panel-outline',
      kind: 'outline',
      frame: [700, 40, 420, 260],
      label: 'Target display',
      style: { color: 'rgba(122, 241, 255, 0.9)' },
    },
  }), true)
  assert.equal(state.layers.size, 1)
  assert.equal(desktopWorldStageSnapshot(state).version, 1)

  assert.equal(applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layers.replace',
    payload: { layers: [{ id: 'a', frame: [0, 0, 10, 10] }, { id: 'b', frame: [10, 0, 10, 10], zIndex: -1 }] },
  }), true)
  assert.deepEqual(stageLayerList(state).map((layer) => layer.id), ['b', 'a'])

  assert.equal(applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layer.remove',
    payload: { id: 'b' },
  }), true)
  assert.deepEqual(stageLayerList(state).map((layer) => layer.id), ['a'])

  assert.equal(applyDesktopWorldStageMessage(state, { type: 'desktop_world_stage.clear' }), true)
  assert.equal(stageLayerList(state).length, 0)
})

test('desktopWorldStageRegistry publishes inspector-only layer snapshots across mutations', () => {
  const state = createDesktopWorldStageState()

  applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layer.upsert',
    payload: {
      id: 'chip',
      kind: 'chip',
      label: 'Panel chip',
      frame: [10, 20, 140, 28],
      metadata: {
        toolkit_affordance_id: 'chip',
        owner_canvas_id: 'panel-a',
      },
    },
  })
  let registry = desktopWorldStageRegistry(state, { canvasId: 'aos-desktop-world-stage' })
  assert.equal(registry.type, 'canvas_object.registry')
  assert.equal(registry.canvas_id, 'aos-desktop-world-stage')
  assert.equal(registry.objects.length, 1)
  assert.equal(registry.objects[0].capabilities.length, 0)
  assert.equal(registry.objects[0].metadata.inspector_only, true)
  assert.equal(registry.objects[0].metadata.stage_layer_id, 'chip')
  assert.equal(registry.objects[0].metadata.toolkit_affordance_id, 'chip')

  applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layers.replace',
    payload: { layers: [{ id: 'outline', frame: [0, 0, 10, 10] }] },
  })
  registry = desktopWorldStageRegistry(state)
  assert.deepEqual(registry.objects.map((object) => object.metadata.stage_layer_id), ['outline'])

  applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layer.remove',
    payload: { id: 'outline' },
  })
  assert.deepEqual(desktopWorldStageRegistry(state).objects, [])

  applyDesktopWorldStageMessage(state, {
    type: 'desktop_world_stage.layer.upsert',
    payload: { id: 'fresh', frame: [0, 0, 10, 10] },
  })
  applyDesktopWorldStageMessage(state, { type: 'desktop_world_stage.clear' })
  assert.deepEqual(desktopWorldStageRegistry(state).objects, [])
})

test('renderDesktopWorldStageLayers emits click-through DesktopWorld-positioned markup', () => {
  const state = createDesktopWorldStageState({
    layers: [{
      id: 'panel-outline',
      kind: 'outline',
      label: '<panel>',
      frame: [700.2, 40.8, 420.1, 260.9],
      style: {
        color: 'red;position:fixed',
        fill: 'rgba(10, 20, 30, 0.2)',
        strokeWidth: 3,
      },
    }],
  })

  const html = renderDesktopWorldStageLayers(state)

  assert.match(html, /data-layer-id="panel-outline"/)
  assert.match(html, /left:700px/)
  assert.match(html, /top:41px/)
  assert.match(html, /width:420px/)
  assert.match(html, /height:261px/)
  assert.match(html, /--stage-color:rgba\(122, 241, 255, 0.95\)/)
  assert.match(html, /--stage-fill:rgba\(10, 20, 30, 0.2\)/)
  assert.match(html, /&lt;panel&gt;/)
})
