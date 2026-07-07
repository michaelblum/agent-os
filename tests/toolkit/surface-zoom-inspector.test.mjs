import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createAnnotationDraftFromNode,
  createSurfaceZoomInspectorState,
  draftsGroupedBySelectedSurface,
  inspectSelectedSurfacePoint,
  nodeDetailsViewModel,
  selectSurface,
  selectSurfaceNode,
  surfaceChildNodes,
  surfaceMiniMapViewModel,
  surfaceZoomInspectorSnapshot,
  surfaceZoomOuterTree,
} from '../../packages/toolkit/components/surface-zoom-inspector/model.js'
import { buildAnnotationPerceptionVerificationCase } from '../../packages/toolkit/workbench/annotation-perception-verification.js'
import { resolveMarkdownSourceUrl } from '../../packages/toolkit/components/surface-zoom-inspector/source-resolution.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const fixturePath = path.join(repoRoot, 'docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json')
const annotationSchemaPath = path.join(repoRoot, 'shared/schemas/annotation.schema.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const markdownSourcePath = 'tests/fixtures/html-workbench-expression/sample-work-card.md'

function assertSchemaValidAnnotation(draft) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = {"schema": "annotations", "version": "0.2.0", "annotations": [json.loads(sys.stdin.read())]}
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      annotationSchemaPath,
    ],
    { input: JSON.stringify(draft), encoding: 'utf8' },
  )
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
}

test('Markdown source URL resolution reuses AOS tree content roots for repo-relative paths', () => {
  assert.equal(
    resolveMarkdownSourceUrl(markdownSourcePath, {
      treeUrl: 'aos://repo_codex_docks_session_roots/docs/design/fixtures/spatial-subject-tree-v0/example.json',
      importMetaUrl: import.meta.url,
    }),
    'aos://repo_codex_docks_session_roots/tests/fixtures/html-workbench-expression/sample-work-card.md',
  )

  assert.equal(
    resolveMarkdownSourceUrl(markdownSourcePath, {
      treeUrl: 'aos://branch_scoped_root/docs/design/fixtures/spatial-subject-tree-v0/example.json',
      importMetaUrl: import.meta.url,
    }),
    'aos://branch_scoped_root/tests/fixtures/html-workbench-expression/sample-work-card.md',
  )
})

test('Markdown source URL resolution preserves absolute and protocol URLs', () => {
  assert.equal(
    resolveMarkdownSourceUrl('https://example.test/source.md', {
      treeUrl: 'aos://repo_codex_docks_session_roots/tree.json',
      importMetaUrl: import.meta.url,
    }),
    'https://example.test/source.md',
  )
  assert.equal(
    resolveMarkdownSourceUrl('aos://repo_other/source.md', {
      treeUrl: 'aos://repo_codex_docks_session_roots/tree.json',
      importMetaUrl: import.meta.url,
    }),
    'aos://repo_other/source.md',
  )
  assert.equal(
    resolveMarkdownSourceUrl('/absolute/source.md', {
      treeUrl: 'aos://repo_codex_docks_session_roots/tree.json',
      importMetaUrl: import.meta.url,
    }),
    '/absolute/source.md',
  )
})

test('Markdown source URL resolution keeps non-AOS contexts import-relative', () => {
  assert.equal(
    resolveMarkdownSourceUrl(markdownSourcePath, {
      treeUrl: 'http://localhost:4173/docs/design/fixtures/spatial-subject-tree-v0/example.json',
      importMetaUrl: 'file:///repo/packages/toolkit/components/surface-zoom-inspector/source-resolution.js',
    }),
    'file:///repo/tests/fixtures/html-workbench-expression/sample-work-card.md',
  )
})

test('normalizes fixture tree and exposes the outer DesktopWorld to surface rows', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })
  const outer = surfaceZoomOuterTree(state)

  assert.deepEqual(outer.map((node) => node.kind), [
    'desktop_world',
    'display',
    'window',
    'canvas',
    'surface',
  ])
  assert.equal(outer.at(-1).id, 'surface:comparative-audit')
  assert.equal(outer.at(-1).selectable, true)
  assert.equal(state.selectedSurfaceId, 'surface:comparative-audit')
})

test('selects a surface and derives visible child nodes for the mini-map', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture, selectedSurfaceId: null })

  assert.equal(selectSurface(state, 'surface:comparative-audit'), true)
  assert.deepEqual(surfaceChildNodes(state).map((node) => node.id), [
    'target:primary-cta',
    'target:evidence-card',
    'annotation:ann-cta-copy',
  ])

  const miniMap = surfaceMiniMapViewModel(state)
  assert.equal(miniMap.surface.id, 'surface:comparative-audit')
  assert.deepEqual(miniMap.viewport, { width: 852, height: 540 })
  assert.deepEqual(miniMap.nodes.find((node) => node.id === 'target:primary-cta').bounds, {
    x: 48,
    y: 80,
    width: 160,
    height: 36,
  })
  assert.equal(miniMap.nodes.find((node) => node.id === 'target:primary-cta').coordinate_space, 'viewport')
})

test('converts selected semantic nodes to structured annotation intent drafts', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })

  assert.equal(selectSurfaceNode(state, 'target:primary-cta'), true)
  const draft = createAnnotationDraftFromNode(state, null, { now: '2026-05-09T12:34:56.000Z' })

  assert.equal(draft.kind, 'element_selection')
  assert.equal(draft.surface_id, 'comparative-audit')
  assert.equal(draft.source_path, 'docs/design/fixtures/aos-artifacts/example-design-pass/report.md')
  assert.equal(draft.coordinate_space, 'viewport')
  assert.deepEqual(draft.viewport_bounds, { x: 48, y: 80, width: 160, height: 36 })
  assert.deepEqual(draft.actor, { role: 'operator', id: 'surface-zoom-inspector' })
  assert.equal(draft.status, 'draft')
  assert.equal(draft.note, 'Review Primary CTA')
  assert.equal(draft.role, 'semantic_target')
  assert.ok(draft.ancestor_chain.includes('Comparative Audit Surface'))
  assert.equal(draftsGroupedBySelectedSurface(state).drafts.length, 1)
  assertSchemaValidAnnotation(draft)
})

test('preserves adapter boundaries and unsupported child discovery state in details', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })

  assert.equal(selectSurfaceNode(state, 'annotation:ann-cta-copy'), true)
  const details = nodeDetailsViewModel(state)

  assert.equal(details.adapter.type, 'generic')
  assert.equal(details.adapter.child_discovery, 'unsupported')
  assert.equal(details.capabilities.project_annotation, true)
  assert.equal(details.source_ids.surface_id, 'comparative-audit')
})

test('snapshot serializes the mini-map view model and local drafts without live adapters', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })
  selectSurfaceNode(state, 'target:evidence-card')
  createAnnotationDraftFromNode(state, 'target:evidence-card', { now: '2026-05-09T12:35:00.000Z' })
  state.overlayVisible = false

  const snapshot = surfaceZoomInspectorSnapshot(state)
  assert.equal(snapshot.schema_version, '2026-05-09-surface-zoom-proof-v0')
  assert.equal(snapshot.selected_surface, 'surface:comparative-audit')
  assert.equal(snapshot.selected_surface_label, 'Comparative Audit Surface')
  assert.equal(snapshot.selected_node, 'target:evidence-card')
  assert.equal(snapshot.selected_node_label, 'Evidence Card')
  assert.equal(snapshot.label_density, 'selected_only')
  assert.equal(snapshot.inspect_status, 'not_inspected')
  assert.equal(snapshot.active_secondary_view, 'targets')
  assert.deepEqual(snapshot.selected_target_summary, {
    id: 'target:evidence-card',
    label: 'Evidence Card',
    kind: 'semantic_target',
    role: 'semantic_target',
    source_summary: 'evidence-card',
    bounds_summary: '48, 148, 360 x 180',
    last_hit_test_status: 'not_inspected',
  })
  assert.deepEqual(snapshot.map_view, { mode: 'fit', zoom: 1 })
  assert.equal(snapshot.layout.responsive, true)
  assert.equal(snapshot.layout.document_horizontal_overflow_guard, true)
  assert.equal(snapshot.layout.primary_map_frame_internal_scroll, false)
  assert.equal(snapshot.layout.raw_json_collapsible, true)
  assert.equal(snapshot.layout.active_secondary_view, 'targets')
  assert.deepEqual(snapshot.layout.normal_default_scroll_regions, ['inspector-or-secondary-active-view'])
  assert.equal(snapshot.mini_map.overlay_visible, false)
  assert.equal(snapshot.mini_map.label_density, 'selected_only')
  assert.deepEqual(snapshot.mini_map.map_view, { mode: 'fit', zoom: 1 })
  assert.equal(snapshot.mini_map.nodes.find((node) => node.id === 'target:evidence-card').overlay_visible, false)
  assert.equal(snapshot.target_navigator.primary[0].id, 'target:evidence-card')
  assert.equal(snapshot.draft_group.drafts[0].metadata.adapter.type, 'aos_canvas')
})

test('display modes are represented in state and non-Markdown subjects retain synthetic map behavior', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })
  const snapshot = surfaceZoomInspectorSnapshot(state)
  assert.equal(snapshot.markdown_preview.markdown_backed, false)
  assert.equal(snapshot.markdown_preview.available, false)
  assert.equal(snapshot.map_display_mode, 'overlay')
  assert.equal(snapshot.mini_map.markdown_backed, false)
  assert.equal(snapshot.mini_map.nodes.find((node) => node.id === 'target:primary-cta').overlay_presentation.inset_px, 0)
})

test('component shell consumes toolkit chrome, workbench, and control primitives', () => {
  const html = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/index.html'), 'utf8')
  const js = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/index.js'), 'utf8')
  const css = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/styles.css'), 'utf8')

  assert.match(html, /panel\/defaults\.css/)
  assert.match(html, /controls\/defaults\.css/)
  assert.match(html, /workbench\/defaults\.css/)
  assert.match(js, /import \{ mountChrome \} from '..\/..\/panel\/chrome\.js'/)
  assert.match(js, /import \{ createFixedSidebarPane, createSplitPane \} from '..\/..\/panel\/layouts\/split-pane\.js'/)
  assert.match(js, /import \{ renderButtonHtml \} from '..\/..\/controls\/button\.js'/)
  assert.match(js, /import \{ createSelect \} from '..\/..\/controls\/select\.js'/)
  assert.match(js, /import \{ renderToggleHtml \} from '..\/..\/controls\/toggle\.js'/)
  assert.match(js, /renderWorkbenchToolbar/)
  assert.match(js, /renderWorkbenchToolbarSection/)
  assert.match(js, /renderWorkbenchReadout/)
  assert.match(js, /renderWorkbenchPaneHeader/)
  assert.match(js, /title: 'Surface-Zoom Inspector'/)
  assert.match(js, /close: true/)
  assert.match(js, /minimize: true/)
  assert.match(js, /maximize: true/)
  assert.match(js, /resizable: true/)
  assert.match(js, /className: 'surface-zoom-toolbar'/)
  assert.match(js, /renderToggleHtml\(\{ label: 'Overlay'/)
  assert.match(js, /createToolbarSelect\(\{\s*label: 'Labels'/)
  assert.match(js, /mountToolbarSelects\(root, content, state\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Fit', dataset: \{ action: 'zoom-fit' \} \}\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Zoom Out', dataset: \{ action: 'zoom-out' \} \}\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Zoom In', dataset: \{ action: 'zoom-in' \} \}\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Reset View', dataset: \{ action: 'zoom-reset' \} \}\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Reset Selection', dataset: \{ action: 'reset-selection' \} \}\)/)
  assert.match(js, /renderButtonHtml\(\{ label: 'Clear Drafts', dataset: \{ action: 'clear-drafts' \} \}\)/)
  assert.match(js, /\['targets', 'drafts', 'diagnostics'\]/)
  assert.match(js, /data-secondary-tab="\$\{tab\}"/)
  assert.match(js, /Synthetic Subject Map/)
  assert.match(js, /not screenshot pixels/)
  assert.match(js, /data-preview-fit="component-compact-workbench"/)
  assert.match(js, /previewFocusStatus/)
  assert.match(js, /previewFocusStrategy/)
  assert.match(js, /target\.scrollTo/)
  assert.match(js, /createFixedSidebarPane\(\{/)
  assert.match(js, /createSplitPane\(\{/)
  assert.match(js, /mainPane:\s*leftStack/)
  assert.match(js, /sidebarPane:\s*content\.querySelector\('\.inspector-panel'\)/)
  assert.match(css, /\.surface-zoom-workbench\s*\{/)
  assert.match(css, /\.surface-zoom-left-stack,\s*\.surface-zoom-lower-stack\s*\{/)
  assert.doesNotMatch(css, /grid-template-areas:\s*[\s\S]*"map inspector"/)
  assert.match(css, /flex-wrap:\s*wrap/)
  assert.match(css, /--aos-markdown-preview-font:\s*11\.5px\/1\.45/)
  assert.match(css, /\.surface-zoom-markdown-preview\s*\{[\s\S]*position:\s*absolute/)
  assert.match(css, /\.surface-zoom-markdown-preview\s*:where\(table\)/)
  assert.match(css, /\.mini-node\.kind-semantic-target/)
  assert.match(css, /\.mini-node\.decision-node/)
  assert.match(css, /\.mini-node\.last-hit-node/)
  assert.doesNotMatch(css, /\.aos-window-button\s*\{/)
  assert.doesNotMatch(css, /\.aos-button\s*\{/)
})

test('spatial workbench uses one tabbed secondary drawer instead of permanent split panes', () => {
  const js = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/index.js'), 'utf8')
  const css = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/styles.css'), 'utf8')

  assert.doesNotMatch(js, /class="surface-zoom-layout"/)
  assert.doesNotMatch(css, /\.surface-zoom-layout\s*\{/)
  assert.doesNotMatch(js, /drafts-panel/)
  assert.doesNotMatch(css, /\.drafts-panel/)
  assert.match(js, /class="surface-zoom-workbench"/)
  assert.match(js, /class="surface-panel map-panel"/)
  assert.match(js, /class="surface-panel inspector-panel"/)
  assert.match(js, /class="surface-panel secondary-panel"/)
  assert.match(js, /aria-label="Secondary drawer"/)
  assert.match(js, /renderSecondaryView/)
  assert.match(js, /renderSecondaryTabs/)
  assert.doesNotMatch(js, /Targets \/ Outline/)
  assert.doesNotMatch(css, /grid-template-columns:\s*minmax\(220px,\s*0\.6fr\)\s*minmax\(0,\s*1fr\)/)
})

test('layout contracts constrain horizontal overflow and collapse raw diagnostics by default', () => {
  const js = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/index.js'), 'utf8')
  const css = readFileSync(path.join(repoRoot, 'packages/toolkit/components/surface-zoom-inspector/styles.css'), 'utf8')
  const bodyBlock = css.match(/html,\s*body\s*\{[^}]*\}/)?.[0] || ''

  assert.doesNotMatch(css, /min-width:\s*980px/)
  assert.doesNotMatch(bodyBlock, /min-width/)
  assert.match(css, /overflow-x:\s*hidden/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
  assert.match(css, /white-space:\s*pre-wrap/)
  assert.match(css, /max-width:\s*100%/)
  assert.match(css, /@media\s*\(max-width:\s*900px\)/)
  assert.match(js, /<details><summary>/)
  assert.match(js, /Full path/)
  assert.match(js, /Snapshot payload/)
  assert.doesNotMatch(js, /<section><h3>Source IDs<\/h3><pre>/)
  assert.doesNotMatch(js, /<dt>Path<\/dt>/)
  assert.doesNotMatch(js, /<dt>Adapter<\/dt>/)
})

test('inspects a mini-map point inside Primary CTA via hit-test and stores structured state', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })
  selectSurfaceNode(state, 'target:evidence-card')

  const result = inspectSelectedSurfacePoint(state, { x: 64, y: 92, coordinate_space: 'viewport' }, { now: '2026-05-09T12:36:00.000Z' })

  assert.equal(result.request.point.x, 64)
  assert.equal(result.request.point.y, 92)
  assert.equal(result.request.point.coordinate_space, 'viewport')
  assert.equal(result.selected_candidate.id, 'target:primary-cta')
  assert.equal(state.selectedNodeId, 'target:primary-cta')
  assert.equal(result.annotation_draft.metadata.created_from, 'surface_hit_test_inspect')
  assert.equal(result.annotation_draft.label, 'Primary CTA')
  assert.equal(result.verification_seed.target.id, 'target:primary-cta')
  assert.equal(surfaceZoomInspectorSnapshot(state).last_inspect.selected_candidate.id, 'target:primary-cta')
  assertSchemaValidAnnotation(result.annotation_draft)

  const verification = buildAnnotationPerceptionVerificationCase(result.verification_seed)
  assert.equal(verification.status, 'adapter_fixture_only')
})

test('inspects a mini-map point inside Evidence Card via hit-test', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })

  const result = inspectSelectedSurfacePoint(state, { x: 120, y: 190, coordinate_space: 'viewport' }, { now: '2026-05-09T12:37:00.000Z' })

  assert.equal(result.selected_candidate.id, 'target:evidence-card')
  assert.equal(state.selectedNodeId, 'target:evidence-card')
  assert.equal(result.annotation_draft.label, 'Evidence Card')
  assert.equal(result.verification_seed.target.id, 'target:evidence-card')
  assertSchemaValidAnnotation(result.annotation_draft)
})

test('miss preserves candidates and creates no selected candidate or draft', () => {
  const state = createSurfaceZoomInspectorState({ tree: fixture })

  const result = inspectSelectedSurfacePoint(state, { x: 12, y: 20, coordinate_space: 'viewport' }, { now: '2026-05-09T12:38:00.000Z' })

  assert.equal(result.selected_candidate, null)
  assert.equal(result.annotation_draft, null)
  assert.equal(result.verification_seed, null)
  assert.equal(result.candidates.length, 3)
  assert.equal(result.candidates.every((candidate) => candidate.hit_test_status === 'miss'), true)
  assert.equal(state.drafts.length, 0)
  assert.equal(surfaceZoomInspectorSnapshot(state).last_inspect.summary.candidate_count, 3)
})

test('hit-test ambiguity metadata is preserved for equal candidates', () => {
  const tree = JSON.parse(JSON.stringify(fixture))
  const primary = tree.nodes.find((node) => node.id === 'target:primary-cta')
  tree.nodes.push({
    ...JSON.parse(JSON.stringify(primary)),
    id: 'target:primary-cta-twin',
    label: 'Primary CTA Twin',
    path: primary.path.replace('target:primary-cta', 'target:primary-cta-twin'),
    source: {
      ...primary.source,
      subject_id: 'primary-cta-twin',
      adapter_subject_id: 'button-primary-cta-twin',
    },
  })
  const state = createSurfaceZoomInspectorState({ tree })

  const result = inspectSelectedSurfacePoint(state, { x: 64, y: 92, coordinate_space: 'viewport' }, { now: '2026-05-09T12:39:00.000Z' })

  assert.equal(result.selected_candidate.id, 'target:primary-cta')
  assert.equal(result.summary.ambiguous, true)
  assert.deepEqual(result.summary.ambiguous_candidate_paths, [
    'desktop-world/display:1/window:1001/canvas:brand-audit/surface:comparative-audit/target:primary-cta-twin',
  ])
})
