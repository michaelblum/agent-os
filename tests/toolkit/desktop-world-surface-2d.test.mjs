import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DesktopWorldSurface2D } from '../../packages/toolkit/runtime/desktop-world-surface-2d.js'
import {
  createVisualObjectDescriptor,
} from '../../packages/toolkit/workbench/visual-object-contract.js'
import { applyVisualObjectControllerUpdate } from '../../packages/toolkit/workbench/visual-object-controller.js'

test('worldOrigin translates by negative segment DesktopWorld bounds', () => {
  const adapter = new DesktopWorldSurface2D({ canvasId: 'avatar' })
  adapter.segment = { dw_bounds: [1920, 40, 1920, 1080] }

  assert.deepEqual(adapter.worldOrigin(), { x: -1920, y: -40 })
})

test('applyWorldTransform writes a segment-local transform', () => {
  const adapter = new DesktopWorldSurface2D({ canvasId: 'avatar' })
  adapter.segment = { dw_bounds: [1920, 40, 1920, 1080] }
  const node = { style: {} }

  adapter.applyWorldTransform(node)

  assert.equal(node.style.transform, 'translate(-1920px, -40px)')
  assert.equal(node.style.transformOrigin, '0 0')
})

test('descriptor-addressed DesktopWorld transform updates the same 2D target node', () => {
  const descriptor = createVisualObjectDescriptor({
    id: 'desktop-world-stage-x',
    label: 'Stage x',
    kind: 'slider',
    technology: 'canvas-2d',
    state_path: 'desktop_world.stage.segment.dw_bounds.0',
    route: 'canvas_object.transform.patch',
    coerce: 'number',
    renderer_sync: ['applyWorldTransform'],
    group_key: 'desktop-world.stage',
    object_ids: ['desktop-world.stage.root'],
  })
  const state = {
    desktop_world: {
      stage: {
        segment: { dw_bounds: [1920, 40, 1920, 1080] },
      },
    },
  }
  const adapter = new DesktopWorldSurface2D({ canvasId: 'desktop-world-stage' })
  adapter.segment = state.desktop_world.stage.segment
  const node = { style: {} }

  adapter.applyWorldTransform(node)
  const beforeNode = node
  const result = applyVisualObjectControllerUpdate(descriptor, 3840, state, {
    routeHandlers: {
      'canvas_object.transform.patch': ({ mutation }) => {
        adapter.segment = state.desktop_world.stage.segment
        return mutation.state_path
      },
    },
    rendererSyncHandlers: {
      applyWorldTransform: () => adapter.applyWorldTransform(node),
    },
  })

  assert.equal(result.route, 'canvas_object.transform.patch')
  assert.equal(result.route_outcome.status, 'called')
  assert.deepEqual(result.sync_outcomes, [{ label: 'applyWorldTransform', status: 'called', value: undefined }])
  assert.equal(state.desktop_world.stage.segment.dw_bounds[0], 3840)
  assert.equal(node, beforeNode)
  assert.equal(node.style.transform, 'translate(-3840px, -40px)')
})
