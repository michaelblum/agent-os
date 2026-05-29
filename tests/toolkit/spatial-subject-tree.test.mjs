import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assertSpatialSubjectTreeShape,
  buildSpatialSubjectTree,
  createSpatialSubjectPath,
  normalizeSpatialSubjectTree,
} from '../../packages/toolkit/workbench/spatial-subject-tree.js'

const topology = {
  schema: 'spatial-topology',
  version: '0.2.0',
  timestamp: '2026-05-09T12:00:00.000Z',
  desktop_world_bounds: { x: 0, y: 0, width: 1512, height: 982 },
  displays: [
    {
      display_id: 1,
      ordinal: 1,
      label: 'Built-in Display',
      desktop_world_bounds: { x: 0, y: 0, width: 1512, height: 982 },
      windows: [
        {
          window_id: 1001,
          title: 'Employer Brand Audit',
          app_pid: 4242,
          app_name: 'AOS',
          bundle_id: 'dev.agent-os',
          desktop_world_bounds: { x: 100, y: 80, width: 900, height: 620 },
          is_on_screen: true,
        },
      ],
    },
  ],
}

test('createSpatialSubjectPath emits stable neutral path strings', () => {
  assert.equal(
    createSpatialSubjectPath([
      { kind: 'desktop_world' },
      { kind: 'display', id: 1 },
      { kind: 'window', id: 1001 },
      { kind: 'canvas', id: 'brand-audit' },
      { kind: 'surface', id: 'comparative-audit' },
      { kind: 'semantic_target', id: 'primary-cta' },
    ]),
    'desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit/target:primary-cta',
  )
})

test('normalizeSpatialSubjectTree builds paths, parent links, and DesktopWorld rects from parent transforms', () => {
  const tree = normalizeSpatialSubjectTree({
    created_at: '2026-05-09T12:00:00.000Z',
    nodes: [
      {
        id: 'desktop-world',
        parent_id: null,
        kind: 'desktop_world',
        label: 'DesktopWorld',
        bounds: { desktop_world: { x: 0, y: 0, width: 500, height: 300 } },
        state: 'visible',
        adapter: { id: 'spatial-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
        capabilities: { hit_test: true, inspect_children: true },
      },
      {
        id: 'display:1',
        parent_id: 'desktop-world',
        kind: 'display',
        label: 'Display 1',
        bounds: { parent_local: { x: 20, y: 10, width: 300, height: 200 } },
        state: 'visible',
        adapter: { id: 'spatial-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
        capabilities: { hit_test: true, inspect_children: true },
      },
      {
        id: 'target:cta',
        parent_id: 'display:1',
        kind: 'semantic_target',
        label: 'CTA',
        bounds: { parent_local: { x: 5, y: 7, width: 30, height: 12 } },
        state: 'visible',
        adapter: { id: 'aos-semantic-targets', type: 'aos_canvas', confidence: 0.8, freshness: 'snapshot', child_discovery: 'complete' },
        capabilities: { hit_test: true, annotate: true, action: true },
      },
    ],
  })

  assertSpatialSubjectTreeShape(tree)
  assert.equal(tree.nodes[2].path, 'desktop-world/display:1/target:cta')
  assert.deepEqual(tree.nodes[2].bounds.desktop_world, { x: 25, y: 17, width: 30, height: 12 })
  assert.equal(tree.nodes[2].transforms[0].status, 'available')
})

test('buildSpatialSubjectTree maps topology, canvas, targets, and projections into one tree', () => {
  const tree = buildSpatialSubjectTree({
    spatial_topology: topology,
    canvases: [
      {
        id: 'brand-audit',
        window_id: 1001,
        at: [100, 80, 900, 620],
      },
    ],
    surfaces: [
      {
        id: 'comparative-audit',
        canvas_id: 'brand-audit',
        adapter_id: 'employer-brand-surface',
        adapter_type: 'employer_brand',
        source_path: 'Employer_Brand_Audit/report.md',
        subject_id: 'employer-brand-comparative-audit',
        bounds: { x: 24, y: 44, width: 852, height: 540 },
      },
    ],
    semantic_targets: [
      {
        canvas_id: 'brand-audit',
        surface: 'comparative-audit',
        id: 'primary-cta',
        ref: 'button-primary-cta',
        role: 'button',
        name: 'Primary CTA',
        do_target: 'canvas:brand-audit/button-primary-cta',
        bounds: { x: 48, y: 80, width: 160, height: 36 },
      },
      {
        canvas_id: 'brand-audit',
        surface: 'comparative-audit',
        id: 'evidence-card',
        role: 'region',
        name: 'Evidence Card',
        bounds: { x: 48, y: 148, width: 360, height: 180 },
      },
    ],
    annotation_projections: [
      {
        annotation_id: 'ann-cta-copy',
        surface_id: 'comparative-audit',
        status: 'resolved',
        anchor_type: 'semantic_target',
        confidence: 0.78,
        rects: [{ x: 48, y: 80, width: 160, height: 36 }],
      },
    ],
  })

  assertSpatialSubjectTreeShape(tree)
  const target = tree.nodes.find((node) => node.id === 'target:primary-cta')
  const projection = tree.nodes.find((node) => node.id === 'annotation:ann-cta-copy')

  assert.equal(target.parent_id, 'surface:comparative-audit')
  assert.equal(
    target.path,
    'desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit/target:primary-cta',
  )
  assert.deepEqual(target.bounds.desktop_world, { x: 172, y: 204, width: 160, height: 36 })
  assert.equal(target.capabilities.action, true)
  assert.deepEqual(projection.bounds.viewport_local, { x: 48, y: 80, width: 160, height: 36 })
  assert.equal(projection.adapter.child_discovery, 'unsupported')
})

test('buildSpatialSubjectTree normalizes canvas frames through DesktopWorld contract', () => {
  const tree = buildSpatialSubjectTree({
    spatial_topology: {
      schema: 'spatial-topology',
      version: '0.2.0',
      timestamp: '2026-05-09T12:00:00.000Z',
      desktop_world_bounds: { x: 0, y: 0, width: 1719, height: 982 },
      displays: [
        {
          display_id: 'left',
          native_bounds: { x: -207, y: 0, w: 207, h: 900 },
          native_visible_bounds: { x: -207, y: 0, w: 207, h: 900 },
          desktop_world_bounds: { x: 0, y: 0, width: 207, height: 900 },
        },
        {
          display_id: 'main',
          is_main: true,
          native_bounds: { x: 0, y: 0, w: 1512, h: 982 },
          native_visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
          desktop_world_bounds: { x: 207, y: 0, width: 1512, height: 982 },
          windows: [
            {
              window_id: 1001,
              title: 'Main Window',
              desktop_world_bounds: { x: 207, y: 0, width: 1512, height: 982 },
              is_on_screen: true,
            },
          ],
        },
      ],
    },
    canvases: [
      { id: 'native-canvas', window_id: 1001, at: [120, 120, 360, 260] },
      {
        id: 'resolved-desktop-world-canvas',
        window_id: 1001,
        at: [120, 120, 360, 260],
        atResolved: [327, 120, 360, 260],
        at_resolved_coordinate_space: 'desktop_world',
      },
      {
        id: 'ambiguous-canvas',
        window_id: 1001,
        at: [120, 120, 360, 260],
        atResolved: [500, 120, 360, 260],
      },
    ],
  })

  const byId = new Map(tree.nodes.map((node) => [node.id, node]))
  assert.deepEqual(byId.get('canvas:native-canvas').bounds.desktop_world, { x: 327, y: 120, width: 360, height: 260 })
  assert.deepEqual(byId.get('canvas:resolved-desktop-world-canvas').bounds.desktop_world, { x: 327, y: 120, width: 360, height: 260 })
  assert.equal(byId.get('canvas:ambiguous-canvas').bounds.desktop_world, undefined)
})
