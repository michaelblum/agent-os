import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertSurfaceHitTestInspectReportShape,
  buildSurfaceHitTestInspectResult,
  chooseInspectCandidate,
  normalizeHitTestCandidate,
} from '../../packages/toolkit/workbench/surface-hit-test-inspect.js'
import {
  buildAnnotationPerceptionVerificationCase,
} from '../../packages/toolkit/workbench/annotation-perception-verification.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

test('chooseInspectCandidate prefers deepest, then confidence, then smaller area, then stable path order', () => {
  const request = { point: { x: 18, y: 18, coordinate_space: 'viewport' } }
  const candidates = [
    normalizeHitTestCandidate({
      id: 'container',
      path: 'surface:a/region:container',
      kind: 'region',
      bounds: { viewport: { x: 0, y: 0, width: 100, height: 100 } },
      confidence: 0.99,
    }, request),
    normalizeHitTestCandidate({
      id: 'button-low-confidence',
      path: 'surface:a/region:container/target:button-low',
      kind: 'semantic_target',
      bounds: { viewport: { x: 10, y: 10, width: 40, height: 30 } },
      confidence: 0.7,
    }, request),
    normalizeHitTestCandidate({
      id: 'button-high-confidence',
      path: 'surface:a/region:container/target:button-high',
      kind: 'semantic_target',
      bounds: { viewport: { x: 10, y: 10, width: 80, height: 30 } },
      confidence: 0.9,
    }, request),
  ]

  const { selected_candidate: selected } = chooseInspectCandidate(candidates, request)
  assert.equal(selected.path, 'surface:a/region:container/target:button-high')
})

test('buildSurfaceHitTestInspectResult creates a selection_comment draft and verification seed for text ranges', () => {
  const result = buildSurfaceHitTestInspectResult({
    case_id: 'text-range',
    surface_class: 'markdown_workbench_text_range',
    request: {
      surface_binding: {
        surface_id: 'markdown-workbench',
        surface_type: 'markdown_workbench',
        source_path: 'fixture.md',
      },
      point: { x: 40, y: 20, coordinate_space: 'document' },
      requested_adapter_type: 'markdown_fixture',
      allowed_target_kinds: ['text_range'],
    },
    surface: { viewport: { width: 800, height: 600, view_mode: 'source' } },
    adapter_response: {
      candidates: [{
        id: 'line-1',
        path: 'workbench:markdown/text:line-1',
        kind: 'text_range',
        label: 'Line 1',
        text: 'Fixture line',
        bounds: { document: { x: 20, y: 12, width: 200, height: 20 } },
        text_range: { start_line: 1, end_line: 1 },
        confidence: 1,
      }],
    },
  })

  assert.equal(result.selected_candidate.id, 'line-1')
  assert.equal(result.annotation_draft.kind, 'selection_comment')
  assert.equal(result.annotation_draft.status, 'draft')
  assert.equal(result.verification_seed.target.kind, 'text_range')
  assert.equal(buildAnnotationPerceptionVerificationCase(result.verification_seed).status, 'passed')
})

test('representative script emits required inspect surface classes and APV-compatible seeds', () => {
  const result = spawnSync(
    'node',
    ['scripts/surface-hit-test-inspect.mjs', '--stdout'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  const report = JSON.parse(result.stdout)

  assertSurfaceHitTestInspectReportShape(report)
  assert.equal(report.summary.total_cases, 8)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.summary.blocked, 0)
  assert.equal(report.summary.passed, 4)
  assert.equal(report.summary.adapter_fixture_only, 4)
  assert.equal(report.summary.verification_seed_count, 8)
  assert.equal(report.summary.verification_failed, 0)

  const byClass = new Map(report.cases.map((item) => [item.surface_class, item]))
  assert.equal(byClass.get('aos_canvas_semantic_target').selected_candidate.label, 'Primary CTA')
  assert.equal(byClass.get('aos_canvas_semantic_target').annotation_draft.kind, 'element_selection')
  assert.equal(byClass.get('markdown_workbench_text_range').selected_candidate.kind, 'text_range')
  assert.equal(byClass.get('markdown_workbench_text_range').annotation_draft.kind, 'selection_comment')
  assert.equal(byClass.get('browser_page_local_html').selected_candidate.kind, 'dom_element')
  assert.equal(byClass.get('mac_window_topology').selected_candidate.kind, 'canvas')

  for (const surface of ['generic_ax_element', 'mermaid_svg', 'three_scene', 'pdf_image']) {
    const item = byClass.get(surface)
    assert.equal(item.surface.adapter_fixture_only, true, `${surface} should be explicit fixture-only`)
    assert.ok(item.blockers.length > 0, `${surface} should explain missing live adapter`)
  }
})
