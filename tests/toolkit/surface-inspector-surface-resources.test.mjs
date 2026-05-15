import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyInputRegionMessage,
  applyStageLayerRegistryMessage,
  buildSurfaceResourceSnapshot,
  createSurfaceResourceState,
} from '../../packages/toolkit/components/surface-inspector/surface-resources.js'

const canvases = [{ id: 'panel-a' }, { id: 'aos-desktop-world-stage' }]

test('normalizes input-region snapshot, register, update, and remove events', () => {
  const state = createSurfaceResourceState()

  assert.equal(applyInputRegionMessage(state, {
    type: 'input_region.snapshot',
    regions: [{
      id: 'chip:restore',
      owner_canvas_id: 'panel-a',
      semantic_label: 'restore',
      consume_policy: 'down_only',
      coordinate_space: 'native',
      frame: [10, 20, 120, 28],
      metadata: { toolkit_affordance_id: 'chip' },
    }],
  }), true)
  assert.equal(buildSurfaceResourceSnapshot(state, { canvases }).inputRegions[0].semanticLabel, 'restore')

  assert.equal(applyInputRegionMessage(state, {
    type: 'input_region',
    action: 'registered',
    region: {
      id: 'chip:close',
      owner_canvas_id: 'panel-a',
      semantic_label: 'close',
      consume_policy: 'down_only',
      frame: [120, 20, 30, 28],
      metadata: { toolkit_affordance_id: 'chip' },
    },
  }), true)
  assert.equal(buildSurfaceResourceSnapshot(state, { canvases }).counts.inputRegions, 2)

  assert.equal(applyInputRegionMessage(state, {
    type: 'input_region',
    action: 'updated',
    region: {
      id: 'chip:close',
      owner_canvas_id: 'panel-a',
      semantic_label: 'close updated',
      consume_policy: 'always',
      frame: [122, 20, 30, 28],
      metadata: { toolkit_affordance_id: 'chip' },
    },
  }), true)
  const updated = buildSurfaceResourceSnapshot(state, { canvases }).inputRegions.find((region) => region.id === 'chip:close')
  assert.equal(updated.semanticLabel, 'close updated')
  assert.equal(updated.consumePolicy, 'always')

  assert.equal(applyInputRegionMessage(state, {
    type: 'input_region',
    action: 'removed',
    region: { id: 'chip:restore' },
  }), true)
  assert.deepEqual(buildSurfaceResourceSnapshot(state, { canvases }).inputRegions.map((region) => region.id), ['chip:close'])
})

test('normalizes stage-layer registry publication and correlates StageAffordance metadata', () => {
  const state = createSurfaceResourceState()
  applyStageLayerRegistryMessage(state, {
    type: 'canvas_object.registry',
    canvas_id: 'aos-desktop-world-stage',
    objects: [{
      object_id: 'desktop_world_stage.layer:chip',
      name: 'Mail',
      kind: 'desktop_world_stage.layer',
      metadata: {
        inspector_surface_resource_type: 'desktop_world_stage_layer',
        stage_layer_id: 'chip',
        stage_layer_kind: 'chip',
        frame: [10, 20, 140, 28],
        zIndex: 20000,
        toolkit_affordance_id: 'chip',
        owner_canvas_id: 'panel-a',
      },
    }],
  })
  applyInputRegionMessage(state, {
    type: 'input_region.snapshot',
    regions: [{
      id: 'chip:restore',
      owner_canvas_id: 'panel-a',
      semantic_label: 'restore',
      consume_policy: 'down_only',
      frame: [10, 20, 110, 28],
      metadata: { toolkit_affordance_id: 'chip' },
    }],
  })

  const snapshot = buildSurfaceResourceSnapshot(state, { canvases })
  assert.equal(snapshot.counts.stageLayers, 1)
  assert.equal(snapshot.counts.inputRegions, 1)
  assert.equal(snapshot.counts.affordances, 1)
  assert.deepEqual(snapshot.affordances[0].stageLayerIds, ['chip'])
  assert.deepEqual(snapshot.affordances[0].inputRegionIds, ['chip:restore'])
  assert.deepEqual(snapshot.affordances[0].statuses, ['active'])
})

test('infers owner-missing and stale status buckets deterministically', () => {
  const state = createSurfaceResourceState()
  applyStageLayerRegistryMessage(state, {
    type: 'canvas_object.registry',
    canvas_id: 'aos-desktop-world-stage',
    objects: [{
      object_id: 'desktop_world_stage.layer:ghost',
      kind: 'desktop_world_stage.layer',
      metadata: {
        inspector_surface_resource_type: 'desktop_world_stage_layer',
        stage_layer_id: 'ghost',
        owner_canvas_id: 'removed-panel',
        frame: [0, 0, 10, 10],
      },
    }],
  })
  applyInputRegionMessage(state, {
    type: 'input_region.snapshot',
    regions: [{
      id: 'orphan-region',
      owner_canvas_id: 'removed-panel',
      semantic_label: 'restore',
      enabled: false,
      frame: [0, 0, 10, 10],
    }],
  })

  const snapshot = buildSurfaceResourceSnapshot(state, { canvases })
  assert.deepEqual(snapshot.stageLayers[0].statuses, ['active', 'stage_layer_without_region', 'orphaned_owner_missing'])
  assert.deepEqual(snapshot.inputRegions[0].statuses, ['active', 'region_without_stage_layer', 'cleanup_suspect', 'orphaned_owner_missing'])
  assert.equal(snapshot.counts.staleOrSuspicious, 2)
})

test('does not couple resources with similar ids but no shared affordance metadata', () => {
  const state = createSurfaceResourceState()
  applyStageLayerRegistryMessage(state, {
    type: 'canvas_object.registry',
    canvas_id: 'aos-desktop-world-stage',
    objects: [{
      object_id: 'desktop_world_stage.layer:chip',
      kind: 'desktop_world_stage.layer',
      metadata: {
        inspector_surface_resource_type: 'desktop_world_stage_layer',
        stage_layer_id: 'chip',
        owner_canvas_id: 'panel-a',
        frame: [0, 0, 10, 10],
      },
    }],
  })
  applyInputRegionMessage(state, {
    type: 'input_region.snapshot',
    regions: [{
      id: 'chip:restore',
      owner_canvas_id: 'panel-a',
      semantic_label: 'restore',
      frame: [0, 0, 10, 10],
    }],
  })

  const snapshot = buildSurfaceResourceSnapshot(state, { canvases })
  assert.equal(snapshot.counts.affordances, 0)
  assert.ok(snapshot.stageLayers[0].statuses.includes('stage_layer_without_region'))
  assert.ok(snapshot.inputRegions[0].statuses.includes('region_without_stage_layer'))
})
