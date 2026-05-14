#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertAnnotationPerceptionVerificationReportShape,
  buildAnnotationPerceptionVerificationReport,
} from '../packages/toolkit/workbench/annotation-perception-verification.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const defaultOutput = path.join(
  repoRoot,
  'docs/design/fixtures/annotation-perception-verification-v0/representative-surfaces.report.json',
)

const createdAt = '2026-05-09T12:00:00.000Z'

const sharedLayer = {
  visible: true,
  dismissed: false,
  decorator_mode: 'ordinal_badge',
  expanded_annotation_ids: [],
  capture: {
    prepare: { annotation_layer_visible: false, target_content_mutated: false },
    restore: { annotation_layer_visible: true },
  },
}

const cases = [
  {
    case_id: 'aos-canvas-semantic-target-primary-cta',
    surface_class: 'aos_canvas_semantic_target',
    perception_source: 'aos_semantic_targets_structured_xray_fixture',
    surface_binding: {
      surface_id: 'surface-zoom-proof',
      surface_type: 'generic_canvas',
      source_path: 'packages/toolkit/components/surface-zoom-inspector/index.html',
      canvas_id: 'surface-zoom-proof',
      subject_id: 'semantic-target:primary-cta',
    },
    target: {
      id: 'primary-cta',
      path: 'desktop-world/display:1/window:1001/canvas:surface-zoom-proof/surface:surface-zoom-proof/target:primary-cta',
      kind: 'semantic_target',
      label: 'Primary CTA',
      role: 'button',
      canvas_id: 'surface-zoom-proof',
      surface_id: 'surface-zoom-proof',
      window_id: '1001',
      ref: 'button-primary-cta',
      perceived_bounds: { x: 48, y: 72, width: 164, height: 40 },
      capabilities: { hit_test: true, annotate: true, action: true, capture: true },
    },
    viewport: { width: 640, height: 420, view_mode: 'aos-canvas-xray' },
    layer: sharedLayer,
    reperception: {
      source: 'structured_semantic_targets_after_projection',
      layer: { hidden_state: 'hidden', shown_state: 'visible', content_mutated: false },
      content_before: 'surface-zoom-proof-targets:v1',
      content_after: 'surface-zoom-proof-targets:v1',
      raw: {
        semantic_targets: [{ id: 'primary-cta', role: 'button', name: 'Primary CTA' }],
        annotation_layer: { visible: true, decorator_ids: ['ann-aos-canvas-semantic-target-primary-cta'] },
      },
    },
    require_layer_probe: true,
    require_content_guard: true,
    notes: ['Required passing AOS canvas/semantic-target class using structured semantic target state.'],
  },
  {
    case_id: 'markdown-workbench-line-range',
    surface_class: 'markdown_workbench_text_range',
    perception_source: 'markdown_workbench_state_annotation_projection',
    surface_binding: {
      surface_id: 'markdown-workbench',
      surface_type: 'markdown_workbench',
      source_path: 'packages/toolkit/components/markdown-workbench/sample.md',
      subject_id: 'markdown-line:4',
    },
    target: {
      id: 'line-4',
      path: 'workbench:markdown/source:sample.md/text:line-4',
      kind: 'text_range',
      label: 'Line 4',
      surface_id: 'markdown-workbench',
      perceived_bounds: { x: 28, y: 96, width: 520, height: 20 },
      text_range: { start_line: 4, end_line: 4, start_column: 1, end_column: 62 },
      text_excerpt: 'Use the annotation projection to keep source content unchanged.',
      capabilities: { hit_test: true, annotate: true, project_annotation: true },
    },
    adapter_projection: {
      annotation_id: 'ann-markdown-workbench-line-range',
      status: 'resolved',
      anchor_type: 'text_range',
      rects: [{ x: 28, y: 96, width: 520, height: 20 }],
      decorator: { x: 8, y: 96, placement: 'start-outside' },
      precision: 'markdown_workbench_line_rect',
      confidence: 0.95,
    },
    viewport: { width: 900, height: 640, scroll_y: 40, view_mode: 'source' },
    layer: sharedLayer,
    reperception: {
      source: 'window.__markdownWorkbenchState.annotation_projection',
      layer: { hidden_state: 'hidden', shown_state: 'visible', content_mutated: false },
      content_before: 'sha256:markdown-sample-before',
      content_after: 'sha256:markdown-sample-before',
      raw: {
        scroll_probe: {
          before_y: 96,
          after_scroll_y: 156,
          projection_state_updated: true,
        },
      },
    },
    require_layer_probe: true,
    require_content_guard: true,
    notes: ['Required passing Markdown text-range class; projection state carries the decorator after scroll.'],
  },
  {
    case_id: 'browser-local-html-button',
    surface_class: 'browser_page_local_html',
    perception_source: 'controlled_local_dom_state_fixture',
    surface_binding: {
      surface_id: 'local-browser-fixture',
      surface_type: 'browser_page',
      source_path: 'docs/design/fixtures/annotation-perception-verification-v0/local-browser-fixture.html',
      subject_id: 'dom:#save-button',
      tab_id: 'local-fixture-tab',
    },
    target: {
      id: 'save-button',
      path: 'browser:local-fixture/dom:main/dom:save-button',
      kind: 'dom_element',
      label: 'Save',
      role: 'button',
      surface_id: 'local-browser-fixture',
      perceived_bounds: { x: 120, y: 88, width: 96, height: 34 },
      selector_candidates: ['#save-button', 'button[data-testid="save"]'],
      capabilities: { hit_test: true, annotate: true, project_annotation: true },
    },
    adapter_projection: {
      annotation_id: 'ann-browser-local-html-button',
      status: 'resolved',
      anchor_type: 'selector_candidates',
      rects: [{ x: 120, y: 88, width: 96, height: 34 }],
      decorator: { x: 98, y: 88, placement: 'start-outside' },
      precision: 'dom_get_bounding_client_rect',
      confidence: 0.94,
    },
    viewport: { width: 800, height: 480, view_mode: 'local-html' },
    layer: sharedLayer,
    reperception: {
      source: 'local_dom_adapter_state',
      layer: { hidden_state: 'hidden', shown_state: 'visible', content_mutated: false },
      content_before: '<button id="save-button" data-testid="save">Save</button>',
      content_after: '<button id="save-button" data-testid="save">Save</button>',
      raw: { url_policy: 'local_file_only', external_url_collection: false },
    },
    require_layer_probe: true,
    require_content_guard: true,
    notes: ['Controlled local browser/DOM fixture only; no arbitrary websites are opened or collected.'],
  },
  {
    case_id: 'mac-window-topology-canvas-window',
    surface_class: 'mac_window_topology',
    perception_source: 'aos_spatial_topology_structured_fixture',
    surface_binding: {
      surface_id: 'desktop-world',
      surface_type: 'generic_canvas',
      source_path: 'aos see list --json',
      window_id: '1001',
      subject_id: 'window:1001',
    },
    target: {
      id: 'window:1001',
      path: 'desktop-world/display:1/window:1001',
      kind: 'window',
      label: 'Surface Zoom Proof',
      role: 'window',
      window_id: '1001',
      display_id: '1',
      perceived_bounds: { x: 100, y: 80, width: 900, height: 620 },
      capabilities: { hit_test: true, annotate: true, capture: true, inspect_children: true },
    },
    viewport: { width: 1512, height: 982, view_mode: 'desktop_world' },
    layer: sharedLayer,
    reperception: {
      source: 'spatial_topology_after_projection',
      layer: { hidden_state: 'hidden', shown_state: 'visible', content_mutated: false },
      raw: {
        desktop_world_bounds: { x: 0, y: 0, width: 1512, height: 982 },
        selected_window_id: 1001,
        generic_app_ax_harvesting: false,
      },
    },
    require_layer_probe: true,
    notes: ['Required passing top-level window/topology class; only AOS-owned structured topology is used.'],
  },
  {
    case_id: 'generic-ax-element-fixture',
    surface_class: 'generic_ax_element',
    perception_source: 'pi_inspired_ax_metadata_fixture_no_import_no_call',
    adapter_fixture_only: true,
    surface_binding: {
      surface_id: 'ax-fixture-window',
      surface_type: 'generic_canvas',
      source_path: 'docs/design/fixtures/annotation-perception-verification-v0/generic-ax-element.fixture.json',
      window_id: 'ax-window-1',
      subject_id: 'ax:button-submit',
    },
    target: {
      id: 'ax:button-submit',
      path: 'desktop-world/display:1/window:ax-window-1/ax:button-submit',
      kind: 'ax_element',
      label: 'Submit',
      role: 'AXButton',
      window_id: 'ax-window-1',
      perceived_bounds: { x: 220, y: 180, width: 120, height: 32 },
      capabilities: { hit_test: true, annotate: true, action: true, inspect_children: false },
      metadata: {
        subrole: null,
        title: 'Submit',
        description: 'Submit form',
        value: null,
        actions: ['AXPress'],
        center: { x: 280, y: 196 },
        confidence: 0.82,
        parent_path: 'desktop-world/display:1/window:ax-window-1',
        depth: 3,
      },
    },
    viewport: { width: 800, height: 600, view_mode: 'desktop_world' },
    layer: sharedLayer,
    blockers: ['No deterministic live AOS generic AX adapter exists in this slice; live user-app AX harvesting is intentionally out of scope.'],
  },
  {
    case_id: 'mermaid-svg-node-fixture',
    surface_class: 'mermaid_svg',
    perception_source: 'svg_node_adapter_fixture',
    adapter_fixture_only: true,
    surface_binding: {
      surface_id: 'mermaid-fixture',
      surface_type: 'mermaid_svg',
      source_path: 'docs/design/fixtures/annotation-perception-verification-v0/mermaid-svg.fixture.svg',
      subject_id: 'svg:node-a',
    },
    target: {
      id: 'svg:node-a',
      path: 'surface:mermaid-fixture/svg:node-a',
      kind: 'svg_node',
      label: 'Node A',
      surface_id: 'mermaid-fixture',
      perceived_bounds: { x: 40, y: 32, width: 160, height: 48 },
      capabilities: { hit_test: true, annotate: true, project_annotation: true },
    },
    viewport: { width: 640, height: 360, view_mode: 'svg' },
    layer: sharedLayer,
    blockers: ['No live Mermaid/SVG structured perception adapter is present yet.'],
  },
  {
    case_id: 'three-object-fixture',
    surface_class: 'three_scene',
    perception_source: 'three_object_adapter_fixture',
    adapter_fixture_only: true,
    surface_binding: {
      surface_id: 'three-fixture',
      surface_type: 'three_scene',
      source_path: 'docs/design/fixtures/annotation-perception-verification-v0/three-scene.fixture.json',
      subject_id: 'three:cube-primary',
    },
    target: {
      id: 'three:cube-primary',
      path: 'surface:three-fixture/three:cube-primary',
      kind: 'three_object',
      label: 'Primary Cube',
      surface_id: 'three-fixture',
      perceived_bounds: { x: 288, y: 128, width: 96, height: 96 },
      capabilities: { hit_test: true, annotate: true, project_annotation: true },
      metadata: { object_id: 'cube-primary', projected_from: 'world_3d_bounds' },
    },
    viewport: { width: 640, height: 360, view_mode: 'three' },
    layer: sharedLayer,
    blockers: ['No live Three.js object-picking perception adapter is present yet.'],
  },
  {
    case_id: 'pdf-image-region-fixture',
    surface_class: 'pdf_image',
    perception_source: 'pdf_image_region_adapter_fixture',
    adapter_fixture_only: true,
    surface_binding: {
      surface_id: 'pdf-image-fixture',
      surface_type: 'image',
      source_path: 'docs/design/fixtures/annotation-perception-verification-v0/pdf-image.fixture.json',
      subject_id: 'image-region:header',
    },
    target: {
      id: 'image-region:header',
      path: 'surface:pdf-image-fixture/pdf-page:1/image-region:header',
      kind: 'image_region',
      label: 'Header Region',
      surface_id: 'pdf-image-fixture',
      perceived_bounds: { x: 72, y: 54, width: 468, height: 72 },
      capabilities: { hit_test: true, annotate: true, project_annotation: true },
      metadata: { page_number: 1, coordinate_space: 'image_local' },
    },
    viewport: { width: 612, height: 792, view_mode: 'pdf-image' },
    layer: sharedLayer,
    blockers: ['No live PDF/image structured region adapter is present yet.'],
  },
]

function parseArgs(argv) {
  const args = { output: null, stdout: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output') args.output = argv[++index]
    else if (arg === '--stdout') args.stdout = true
    else if (arg === '--default-output') args.output = defaultOutput
    else if (arg === '--help') {
      console.log('Usage: node scripts/annotation-perception-verify.mjs [--stdout] [--output PATH] [--default-output]')
      process.exit(0)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const report = buildAnnotationPerceptionVerificationReport({ created_at: createdAt, cases })
assertAnnotationPerceptionVerificationReportShape(report)

const body = `${JSON.stringify(report, null, 2)}\n`
if (args.stdout || !args.output) {
  process.stdout.write(body)
} else {
  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, body)
  console.log(args.output)
}
