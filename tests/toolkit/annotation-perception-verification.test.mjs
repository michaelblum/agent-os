import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertAnnotationPerceptionVerificationReportShape,
  boundsOverlapRatio,
  buildAnnotationPerceptionVerificationCase,
  buildAnnotationPerceptionVerificationReport,
  createAnnotationIntentFromTarget,
} from '../../packages/toolkit/workbench/annotation-perception-verification.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

test('boundsOverlapRatio uses intersection-over-union for structured rect checks', () => {
  assert.equal(
    boundsOverlapRatio(
      { x: 10, y: 10, width: 100, height: 100 },
      { x: 10, y: 10, width: 100, height: 100 },
    ),
    1,
  )
  assert.equal(
    Number(boundsOverlapRatio(
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 50, y: 0, width: 100, height: 100 },
    ).toFixed(4)),
    0.3333,
  )
})

test('createAnnotationIntentFromTarget preserves target identity and structured anchor metadata', () => {
  const annotation = createAnnotationIntentFromTarget({
    case_id: 'markdown-case',
    surface_class: 'markdown_workbench_text_range',
    surface_binding: {
      surface_id: 'markdown-workbench',
      source_path: 'docs/example.md',
    },
    target: {
      id: 'line-7',
      path: 'workbench:markdown/source:example.md/text:line-7',
      kind: 'text_range',
      label: 'Line 7',
      perceived_bounds: { x: 24, y: 88, width: 420, height: 18 },
      text_range: { start_line: 7, end_line: 7 },
      text_excerpt: 'Example line',
    },
  })

  assert.equal(annotation.id, 'ann-markdown-case')
  assert.equal(annotation.kind, 'selection_comment')
  assert.equal(annotation.coordinate_space, 'document')
  assert.equal(annotation.metadata.target_path, 'workbench:markdown/source:example.md/text:line-7')
  assert.deepEqual(annotation.bounds, { x: 24, y: 88, width: 420, height: 18 })
})

test('verification case fails when projected and re-perceived bounds do not overlap enough', () => {
  const verificationCase = buildAnnotationPerceptionVerificationCase({
    case_id: 'bad-bounds',
    surface_class: 'aos_canvas_semantic_target',
    surface_binding: {
      surface_id: 'canvas',
      surface_type: 'generic_canvas',
      source_path: 'fixture',
    },
    target: {
      id: 'cta',
      path: 'canvas:canvas/target:cta',
      kind: 'semantic_target',
      label: 'CTA',
      perceived_bounds: { x: 0, y: 0, width: 100, height: 40 },
    },
    adapter_projection: {
      annotation_id: 'ann-bad-bounds',
      status: 'resolved',
      rects: [{ x: 300, y: 300, width: 100, height: 40 }],
      decorator: { x: 280, y: 300, placement: 'start-outside' },
    },
  })

  assert.equal(verificationCase.status, 'failed')
  assert.equal(
    verificationCase.assertions.find((item) => item.name === 'bounds_overlap_ratio').status,
    'failed',
  )
})

test('representative script emits required passing and fixture-only surface classes', () => {
  const result = spawnSync(
    'node',
    ['scripts/annotation-perception-verify.mjs', '--stdout'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
  const report = JSON.parse(result.stdout)

  assertAnnotationPerceptionVerificationReportShape(report)
  assert.equal(report.summary.total_cases, 8)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.summary.blocked, 0)
  assert.equal(report.summary.passed, 4)
  assert.equal(report.summary.adapter_fixture_only, 4)

  const bySurface = new Map(report.cases.map((item) => [item.surface_class, item]))
  for (const surface of [
    'aos_canvas_semantic_target',
    'markdown_workbench_text_range',
    'browser_page_local_html',
    'mac_window_topology',
  ]) {
    assert.equal(bySurface.get(surface)?.status, 'passed', `${surface} should pass`)
  }
  for (const surface of ['generic_ax_element', 'mermaid_svg', 'three_scene', 'pdf_image']) {
    assert.equal(bySurface.get(surface)?.status, 'adapter_fixture_only', `${surface} should be explicit fixture-only`)
    assert.ok(bySurface.get(surface)?.blockers.length > 0)
  }

  for (const verificationCase of report.cases) {
    const sourcePath = verificationCase.surface_binding.source_path
    if (sourcePath.startsWith('docs/design/fixtures/annotation-perception-verification-v0/')) {
      assert.ok(fs.existsSync(path.join(repoRoot, sourcePath)), `${sourcePath} should exist`)
    }
  }
})

test('report builder classifies adapter fixture cases without treating missing live adapters as failures', () => {
  const report = buildAnnotationPerceptionVerificationReport({
    cases: [
      {
        case_id: 'ax-fixture',
        surface_class: 'generic_ax_element',
        adapter_fixture_only: true,
        blockers: ['No live AX adapter.'],
        surface_binding: {
          surface_id: 'ax',
          surface_type: 'generic_canvas',
          source_path: 'fixture',
        },
        target: {
          id: 'ax:submit',
          path: 'window:1/ax:submit',
          kind: 'ax_element',
          label: 'Submit',
          perceived_bounds: { x: 10, y: 10, width: 80, height: 24 },
        },
      },
    ],
  })

  assert.equal(report.summary.adapter_fixture_only, 1)
  assert.equal(report.summary.failed, 0)
  assert.equal(report.cases[0].status, 'adapter_fixture_only')
})
