import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildMarkdownSpatialSubjectTree,
  requiredMarkdownDecisionTargets,
} from '../../packages/toolkit/workbench/markdown-spatial-subject-tree.js'
import { buildAnnotationPerceptionVerificationCase } from '../../packages/toolkit/workbench/annotation-perception-verification.js'
import {
  createSurfaceZoomInspectorState,
  inspectSelectedSurfacePoint,
  surfaceMiniMapViewModel,
} from '../../packages/toolkit/components/surface-zoom-inspector/model.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const markdownPath = 'docs/design/fixtures/aos-artifacts/employer-brand-comparative-audit/human-alignment-pack.md'
const fixturePath = 'docs/design/fixtures/spatial-subject-tree-v0/employer-brand-human-alignment-pack.json'
const sourceMarkdown = readFileSync(path.join(repoRoot, markdownPath), 'utf8')

function treeFixture() {
  return JSON.parse(readFileSync(path.join(repoRoot, fixturePath), 'utf8'))
}

function center(bounds) {
  return {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2),
    coordinate_space: 'viewport',
  }
}

function inspectTarget(state, targetId) {
  const miniMap = surfaceMiniMapViewModel(state)
  const target = miniMap.nodes.find((node) => node.id === targetId)
  assert.ok(target, `${targetId} should be in selected surface mini-map`)
  return inspectSelectedSurfacePoint(state, center(target.bounds), { now: '2026-05-09T12:40:00.000Z' })
}

test('builds a neutral Markdown Spatial Subject Tree with required decision targets', () => {
  const tree = buildMarkdownSpatialSubjectTree({
    markdown: sourceMarkdown,
    sourcePath: markdownPath,
    createdAt: '2026-05-09T12:00:00.000Z',
  })
  const ids = new Set(tree.nodes.map((node) => node.id))

  assert.equal(tree.schema, 'spatial_subject_tree')
  assert.equal(tree.metadata.builder, 'markdown-spatial-subject-tree')
  assert.equal(tree.metadata.coordinate_oracle, 'synthetic_line_based_not_rendered_pixels')
  assert.ok(ids.has('surface:employer-brand-human-alignment-pack'))
  assert.ok(ids.has('document:human-alignment-pack-md'))
  for (const target of requiredMarkdownDecisionTargets()) {
    assert.ok(
      tree.nodes.find((node) => node.id.includes(target.id) && node.metadata?.required_alignment_target),
      `${target.id} should be represented`,
    )
  }

  const liveScope = tree.nodes.find((node) => node.id.includes('desired-evidence-elements-4-visibility-adjusted-slots'))
  assert.deepEqual(liveScope.metadata.line_range, { start_line: 57, end_line: 73 })
  assert.equal(liveScope.source.file_path, markdownPath)
  assert.equal(liveScope.capabilities.capture, false)
  assert.equal(liveScope.adapter.type, 'markdown_workbench')
})

test('checked-in generated fixture validates against Spatial Subject Tree V0 schema', () => {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:12]:
        print(error.message)
    sys.exit(1)
`,
      path.join(repoRoot, 'shared/schemas/spatial-subject-tree-v0.schema.json'),
      path.join(repoRoot, fixturePath),
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('Surface-Zoom mini-map includes the required Employer Brand decision targets', () => {
  const state = createSurfaceZoomInspectorState({ tree: treeFixture() })
  const miniMap = surfaceMiniMapViewModel(state)
  const labels = miniMap.nodes.map((node) => node.label)

  assert.equal(miniMap.surface.id, 'surface:employer-brand-human-alignment-pack')
  assert.ok(labels.includes('Current assumptions / 0 accepted live captures'))
  assert.ok(labels.includes('Company and competitor set'))
  assert.ok(labels.includes('Desired evidence elements and 4 visibility-adjusted executable slots'))
  assert.ok(labels.includes('What not to collect'))
  assert.ok(labels.includes('KILOS interpretation table'))
  assert.ok(labels.includes('LinkedIn/source-unavailable policy'))
  assert.ok(labels.includes('Report tone and direction'))
  assert.ok(labels.includes('Explicit human decision table'))
})

test('Surface-Zoom hit-test selects required Markdown targets and emits APV-accepted seeds', () => {
  const state = createSurfaceZoomInspectorState({ tree: treeFixture() })
  const targetIds = [
    'target:line-041-company-and-competitor-set',
    'target:line-057-desired-evidence-elements-4-visibility-adjusted-slots',
    'target:line-089-linkedin-source-unavailable-policy',
    'target:line-099-report-tone-and-direction',
  ]

  for (const targetId of targetIds) {
    const result = inspectTarget(state, targetId)
    assert.equal(result.selected_candidate.id, targetId)
    assert.ok(result.annotation_draft, `${targetId} should create a draft`)
    assert.ok(result.verification_seed, `${targetId} should emit a verification seed`)
    assert.equal(result.selected_candidate.source_ids.surface_id, 'employer-brand-human-alignment-pack')
    assert.equal(result.selected_candidate.source_metadata.line_range.start_line, Number(targetId.slice(12, 15)))
    assert.equal(result.selected_candidate.source_ids.adapter_subject_id.startsWith(`${markdownPath}:L`), true)

    const verification = buildAnnotationPerceptionVerificationCase(result.verification_seed)
    assert.equal(verification.status, 'adapter_fixture_only')
    assert.equal(verification.assertions.every((item) => item.status !== 'failed'), true)
  }
})

test('Markdown Surface-Zoom miss behavior is deterministic and creates no draft', () => {
  const state = createSurfaceZoomInspectorState({ tree: treeFixture() })
  const result = inspectSelectedSurfacePoint(state, { x: 5, y: 5, coordinate_space: 'viewport' }, { now: '2026-05-09T12:41:00.000Z' })

  assert.equal(result.selected_candidate, null)
  assert.equal(result.annotation_draft, null)
  assert.equal(result.verification_seed, null)
  assert.equal(state.drafts.length, 0)
  assert.equal(result.summary.candidate_count > 0, true)
  assert.equal(result.candidates.every((candidate) => candidate.hit_test_status === 'miss'), true)
})
