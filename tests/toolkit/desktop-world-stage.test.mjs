import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyDesktopWorldStageMessage,
  createDesktopWorldStageState,
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
