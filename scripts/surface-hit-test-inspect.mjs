#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertSurfaceHitTestInspectReportShape,
  buildSurfaceHitTestInspectReport,
  candidatesFromSpatialSubjectTree,
} from '../packages/toolkit/workbench/surface-hit-test-inspect.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const fixtureDir = path.join(repoRoot, 'docs/design/fixtures/surface-hit-test-inspect-v0')
const defaultOutput = path.join(fixtureDir, 'representative-surfaces.report.json')
const seedOutput = path.join(fixtureDir, 'representative-surfaces.verification-seeds.json')
const spatialTreePath = path.join(repoRoot, 'docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json')

const createdAt = '2026-05-09T12:00:00.000Z'

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function buildCases() {
  const spatialTree = readJson(spatialTreePath)
  const surfaceLocalCandidates = candidatesFromSpatialSubjectTree(spatialTree, {
    include_kinds: ['surface', 'semantic_target'],
    coordinate_space: 'parent_local',
  })
  const desktopWorldCandidates = candidatesFromSpatialSubjectTree(spatialTree, {
    include_kinds: ['display', 'window', 'canvas'],
    coordinate_space: 'desktop_world',
  })

  return [
    {
      case_id: 'aos-canvas-semantic-target-primary-cta',
      surface_class: 'aos_canvas_semantic_target',
      request: {
        surface_binding: {
          surface_id: 'comparative-audit',
          surface_type: 'generic_canvas',
          source_path: 'docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json',
          canvas_id: 'brand-audit',
          window_id: '1001',
          subject_id: 'primary-cta',
        },
        point: { x: 64, y: 92, coordinate_space: 'parent_local' },
        active_surface_path: 'desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit',
        requested_adapter_type: 'aos_semantic_targets',
        allowed_target_kinds: ['semantic_target'],
      },
      surface: {
        selected_surface_path: 'desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit',
        viewport: { width: 852, height: 540, view_mode: 'aos-canvas-structured-targets' },
        bounds: { parent_local: { x: 24, y: 44, width: 852, height: 540 } },
        content_fingerprint: 'spatial-subject-tree-v0:desktop-world-aos-canvas',
      },
      adapter_response: {
        adapter: { id: 'aos-semantic-targets', type: 'aos_canvas', fixture_only: false },
        candidates: surfaceLocalCandidates,
      },
      notes: ['Required passing AOS canvas/semantic target case; pointer is surface-local and selects Primary CTA.'],
    },
    {
      case_id: 'markdown-workbench-line-range',
      surface_class: 'markdown_workbench_text_range',
      request: {
        surface_binding: {
          surface_id: 'markdown-workbench',
          surface_type: 'markdown_workbench',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/markdown-workbench.fixture.md',
          subject_id: 'line-4',
        },
        point: { x: 96, y: 104, coordinate_space: 'document' },
        requested_adapter_type: 'markdown_workbench_line_rects',
        allowed_target_kinds: ['text_range'],
      },
      surface: {
        viewport: { width: 900, height: 640, scroll_y: 40, view_mode: 'source' },
        bounds: { document: { x: 0, y: 0, width: 900, height: 1400 } },
        content_fingerprint: 'sha256:markdown-workbench-fixture-v0',
      },
      adapter_response: {
        adapter: { id: 'markdown-workbench-line-rects', type: 'markdown_workbench', fixture_only: false },
        candidates: [
          {
            id: 'line-3',
            path: 'workbench:markdown/source:markdown-workbench.fixture.md/text:line-3',
            kind: 'text_range',
            label: 'Line 3',
            text: 'This line is above the chosen target.',
            bounds: { document: { x: 28, y: 76, width: 420, height: 20 } },
            text_range: { start_line: 3, end_line: 3, start_column: 1, end_column: 38 },
            confidence: 0.96,
            child_discovery: 'complete',
            capabilities: { hit_test: true, annotate: true, project_annotation: true },
          },
          {
            id: 'line-4',
            path: 'workbench:markdown/source:markdown-workbench.fixture.md/text:line-4',
            kind: 'text_range',
            label: 'Line 4',
            text: 'Use structured source and line rectangles for annotation.',
            bounds: { document: { x: 28, y: 96, width: 520, height: 20 } },
            text_range: { start_line: 4, end_line: 4, start_column: 1, end_column: 58 },
            confidence: 0.97,
            child_discovery: 'complete',
            capabilities: { hit_test: true, annotate: true, project_annotation: true },
          },
        ],
      },
      notes: ['Required passing Markdown Workbench class; no pixel inspection is used.'],
    },
    {
      case_id: 'browser-local-html-button',
      surface_class: 'browser_page_local_html',
      request: {
        surface_binding: {
          surface_id: 'local-browser-fixture',
          surface_type: 'browser_page',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/local-browser-fixture.html',
          subject_id: 'dom:#save-button',
          tab_id: 'local-fixture-tab',
        },
        point: { x: 146, y: 104, coordinate_space: 'viewport' },
        requested_adapter_type: 'local_dom_fixture',
        allowed_target_kinds: ['dom_element'],
      },
      surface: {
        viewport: { width: 800, height: 480, view_mode: 'local-html' },
        bounds: { viewport: { x: 0, y: 0, width: 800, height: 480 } },
        content_fingerprint: 'sha256:local-browser-fixture-v0',
      },
      adapter_response: {
        adapter: { id: 'local-dom-fixture', type: 'browser_dom', fixture_only: false },
        candidates: [
          {
            id: 'main',
            path: 'browser:local-fixture/dom:main',
            kind: 'dom_element',
            label: 'Main',
            role: 'main',
            bounds: { viewport: { x: 64, y: 48, width: 640, height: 280 } },
            selector_candidates: ['main'],
            confidence: 0.9,
            child_discovery: 'complete',
            capabilities: { hit_test: true, annotate: true, project_annotation: true },
          },
          {
            id: 'save-button',
            path: 'browser:local-fixture/dom:main/dom:save-button',
            kind: 'dom_element',
            label: 'Save',
            role: 'button',
            text: 'Save',
            bounds: { viewport: { x: 120, y: 88, width: 96, height: 34 } },
            selector_candidates: ['#save-button', 'button[data-testid="save"]'],
            confidence: 0.94,
            child_discovery: 'complete',
            capabilities: { hit_test: true, annotate: true, project_annotation: true },
          },
        ],
      },
      notes: ['Controlled local HTML fixture only; no arbitrary live websites are opened or browsed.'],
    },
    {
      case_id: 'mac-window-topology-canvas',
      surface_class: 'mac_window_topology',
      request: {
        surface_binding: {
          surface_id: 'desktop-world',
          surface_type: 'generic_canvas',
          source_path: 'docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json',
          window_id: '1001',
          canvas_id: 'brand-audit',
          subject_id: 'canvas:brand-audit',
        },
        point: { x: 160, y: 140, coordinate_space: 'desktop_world' },
        requested_adapter_type: 'spatial_topology',
        allowed_target_kinds: ['window', 'canvas'],
      },
      surface: {
        viewport: { width: 1512, height: 982, view_mode: 'desktop_world' },
        bounds: { desktop_world: { x: 0, y: 0, width: 1512, height: 982 } },
        content_fingerprint: 'spatial-subject-tree-v0:desktop-world-aos-canvas',
      },
      adapter_response: {
        adapter: { id: 'spatial-topology', type: 'spatial_topology', fixture_only: false },
        candidates: desktopWorldCandidates,
      },
      notes: ['Required passing Mac window/topology class; selects the AOS-owned canvas node from structured topology.'],
    },
    {
      case_id: 'generic-ax-element-fixture',
      surface_class: 'generic_ax_element',
      blockers: ['No deterministic live AOS generic AX adapter exists in this slice; live user-app AX harvesting is intentionally out of scope.'],
      request: {
        surface_binding: {
          surface_id: 'ax-fixture-window',
          surface_type: 'generic_canvas',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/generic-ax-element.fixture.json',
          window_id: 'ax-window-1',
          subject_id: 'ax:button-submit',
        },
        point: { x: 280, y: 196, coordinate_space: 'desktop_world' },
        requested_adapter_type: 'generic_ax_fixture',
        allowed_target_kinds: ['ax_element'],
      },
      surface: { viewport: { width: 800, height: 600, view_mode: 'desktop_world' }, adapter_fixture_only: true },
      adapter_response: {
        adapter: { id: 'generic-ax-fixture', type: 'generic_ax', fixture_only: true },
        candidates: [
          {
            id: 'ax:button-submit',
            path: 'desktop-world/display:1/window:ax-window-1/ax:button-submit',
            kind: 'ax_element',
            label: 'Submit',
            role: 'AXButton',
            bounds: { desktop_world: { x: 220, y: 180, width: 120, height: 32 } },
            confidence: 0.82,
            child_discovery: 'partial',
            capabilities: { hit_test: true, annotate: true, action: true, inspect_children: false },
            metadata: {
              subrole: null,
              title: 'Submit',
              description: 'Submit form',
              value: null,
              actions: ['AXPress'],
              center: { x: 280, y: 196 },
              source_app: { bundle_id: 'fixture.app', pid: 42420 },
            },
          },
        ],
      },
      notes: ['Pi-inspired metadata shape is represented as fixture data only; pi-computer-use is not imported or called.'],
    },
    {
      case_id: 'mermaid-svg-node-fixture',
      surface_class: 'mermaid_svg',
      blockers: ['No live Mermaid/SVG structured perception adapter is present yet.'],
      request: {
        surface_binding: {
          surface_id: 'mermaid-fixture',
          surface_type: 'mermaid_svg',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/mermaid-svg.fixture.svg',
          subject_id: 'svg:node-a',
        },
        point: { x: 80, y: 56, coordinate_space: 'viewport' },
        requested_adapter_type: 'svg_node_fixture',
        allowed_target_kinds: ['svg_node'],
      },
      surface: { viewport: { width: 640, height: 360, view_mode: 'svg' }, adapter_fixture_only: true },
      adapter_response: {
        adapter: { id: 'svg-node-fixture', type: 'mermaid_svg', fixture_only: true },
        candidates: [{
          id: 'svg:node-a',
          path: 'surface:mermaid-fixture/svg:node-a',
          kind: 'svg_node',
          label: 'Node A',
          bounds: { viewport: { x: 40, y: 32, width: 160, height: 48 } },
          confidence: 0.88,
          child_discovery: 'complete',
          capabilities: { hit_test: true, annotate: true, project_annotation: true },
        }],
      },
    },
    {
      case_id: 'three-object-fixture',
      surface_class: 'three_scene',
      blockers: ['No live Three.js object-picking adapter is present yet.'],
      request: {
        surface_binding: {
          surface_id: 'three-fixture',
          surface_type: 'three_scene',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/three-scene.fixture.json',
          subject_id: 'three:cube-primary',
        },
        point: { x: 320, y: 220, coordinate_space: 'viewport' },
        requested_adapter_type: 'three_object_fixture',
        allowed_target_kinds: ['three_object'],
      },
      surface: { viewport: { width: 800, height: 500, view_mode: 'three-scene' }, adapter_fixture_only: true },
      adapter_response: {
        adapter: { id: 'three-object-fixture', type: 'three_scene', fixture_only: true },
        candidates: [{
          id: 'three:cube-primary',
          path: 'surface:three-fixture/three:cube-primary',
          kind: 'three_object',
          label: 'Primary Cube',
          bounds: { viewport: { x: 280, y: 180, width: 96, height: 96 } },
          confidence: 0.84,
          child_discovery: 'partial',
          capabilities: { hit_test: true, annotate: true, project_annotation: true },
          metadata: { object_type: 'Mesh', object_uuid: 'fixture-cube-primary', projected_center: { x: 328, y: 228 } },
        }],
      },
    },
    {
      case_id: 'pdf-image-region-fixture',
      surface_class: 'pdf_image',
      blockers: ['No live PDF/image region hit-test adapter is present yet.'],
      request: {
        surface_binding: {
          surface_id: 'pdf-image-fixture',
          surface_type: 'image',
          source_path: 'docs/design/fixtures/surface-hit-test-inspect-v0/pdf-image.fixture.json',
          subject_id: 'image:callout-region',
        },
        point: { x: 144, y: 188, coordinate_space: 'image' },
        requested_adapter_type: 'pdf_image_fixture',
        allowed_target_kinds: ['image_region'],
      },
      surface: { viewport: { width: 612, height: 792, view_mode: 'pdf-page-image' }, adapter_fixture_only: true },
      adapter_response: {
        adapter: { id: 'pdf-image-fixture', type: 'pdf_image', fixture_only: true },
        candidates: [{
          id: 'image:callout-region',
          path: 'surface:pdf-image-fixture/image-region:callout',
          kind: 'image_region',
          label: 'Callout Region',
          bounds: { image: { x: 96, y: 160, width: 180, height: 72 } },
          confidence: 0.8,
          child_discovery: 'unsupported',
          capabilities: { hit_test: true, annotate: true, project_annotation: true },
          metadata: { page_number: 1, image_sha256: 'fixture-image-sha' },
        }],
      },
    },
  ]
}

function usage() {
  return [
    'Usage: node scripts/surface-hit-test-inspect.mjs [--stdout] [--default-output] [--verification-seeds]',
    '',
    '--stdout              Print deterministic inspect report JSON.',
    '--default-output      Write docs/design/fixtures/surface-hit-test-inspect-v0/representative-surfaces.report.json.',
    '--verification-seeds  Also write compatible Annotation Perception Verification seed JSON.',
  ].join('\n')
}

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  console.log(usage())
  process.exit(0)
}

const report = buildSurfaceHitTestInspectReport({ cases: buildCases(), created_at: createdAt })
assertSurfaceHitTestInspectReportShape(report)

if (args.has('--default-output')) {
  writeJson(defaultOutput, report)
}

if (args.has('--verification-seeds')) {
  writeJson(seedOutput, {
    schema: 'surface_hit_test_inspect_verification_seeds',
    version: '0.1.0',
    created_at: createdAt,
    seeds: report.cases.map((item) => item.verification_seed).filter(Boolean),
  })
}

if (args.has('--stdout') || (!args.has('--default-output') && !args.has('--verification-seeds'))) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}
