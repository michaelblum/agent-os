import {
  createAnnotationDraftFromNode,
  createSurfaceZoomInspectorState,
  draftsGroupedBySelectedSurface,
  inspectSelectedSurfacePoint,
  markdownPreviewViewModel,
  nodeDetailsViewModel,
  selectSurface,
  selectSurfaceNode,
  selectedNode,
  selectedSurfaceNode,
  selectedLineRange,
  setMapDisplayMode,
  setMarkdownPreviewState,
  surfaceMiniMapViewModel,
  surfaceZoomInspectorSnapshot,
  surfaceZoomOuterTree,
  targetNavigatorViewModel,
} from './model.js'
import { mountChrome } from '../../panel/chrome.js'
import { createFixedSidebarPane, createSplitPane } from '../../panel/layouts/split-pane.js'
import { renderButtonHtml } from '../../controls/button.js'
import { renderSelectHtml } from '../../controls/select.js'
import { renderToggleHtml } from '../../controls/toggle.js'
import {
  renderWorkbenchPaneHeader,
  renderWorkbenchReadout,
  renderWorkbenchToolbar,
  renderWorkbenchToolbarSection,
} from '../../shell/index.js'
import { renderMarkdown } from '../../markdown/render.js'
import { createSelect } from '../../controls/select.js'
import { createToggle } from '../../controls/toggle.js'
import { resolveMarkdownSourceUrl } from './source-resolution.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'

const DEFAULT_TREE_URL = new URL('../../../../docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json', import.meta.url).href
const LABEL_DENSITY_OPTIONS = [
  ['labels_off', 'labels off'],
  ['selected_only', 'selected only'],
  ['all', 'all'],
]
const DISPLAY_MODE_OPTIONS = [
  ['preview', 'Preview'],
  ['overlay', 'Overlay'],
  ['both', 'Both'],
]

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function formatJson(value) {
  return esc(JSON.stringify(value ?? {}, null, 2))
}

function controlHtml(control) {
  const container = document.createElement('div')
  container.appendChild(control.el)
  return container.innerHTML
}

function actionValue(actionAttr) {
  return String(actionAttr || '').match(/data-action="([^"]+)"/)?.[1] || ''
}

function renderToolbarToggle({ label, checked, actionAttr }) {
  const control = createToggle({ document, label, checked })
  control.el.querySelector('input')?.setAttribute('data-action', actionValue(actionAttr))
  return controlHtml(control)
}

function renderToolbarSelect({ label, options, value, actionAttr, disabled = false }) {
  const control = createSelect({
    document,
    label,
    value,
    options: options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel })),
  })
  const select = control.el.querySelector('select')
  select?.setAttribute('data-action', actionValue(actionAttr))
  if (disabled) select?.setAttribute('disabled', '')
  control.el.classList.add('aos-control-row')
  return controlHtml(control)
}

function detailSummary(label, value = '') {
  const suffix = value ? ` — ${value}` : ''
  return `${label}${suffix}`
}

function cssPercent(value) {
  return `${Math.max(0, Math.min(1, Number(value) || 0)) * 100}%`
}

function getTreeUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('tree') || DEFAULT_TREE_URL
}

function sourceLineSelector(line) {
  return `[data-source-line="${esc(String(line))}"]`
}

function sourceLabel() {
  const treeUrl = getTreeUrl()
  try {
    const url = new URL(treeUrl)
    return url.protocol === 'aos:' ? url.pathname.replace(/^\/+/, '') : url.pathname.split('/').filter(Boolean).slice(-2).join('/')
  } catch {
    return treeUrl
  }
}

async function loadTree() {
  const response = await fetch(getTreeUrl())
  if (!response.ok) throw new Error(`failed to load tree fixture: ${response.status}`)
  return response.json()
}

function renderOuterTree(state) {
  const selectedSurface = selectedSurfaceNode(state)
  const selected = selectedNode(state)
  return surfaceZoomOuterTree(state).map((node) => {
    const classes = [
      'tree-row',
      `kind-${node.kind.replaceAll('_', '-')}`,
      node.selectable ? 'selectable' : '',
      node.id === selectedSurface?.id ? 'selected-surface' : '',
      node.id === selected?.id ? 'selected-node' : '',
    ].filter(Boolean).join(' ')
    const indent = `style="--tree-depth:${node.depth}"`
    const attrs = node.selectable ? `data-surface-id="${esc(node.id)}"` : ''
    return `
      <button class="${classes}" ${indent} ${attrs} ${node.selectable ? '' : 'disabled'}>
        <span class="tree-kind">${esc(node.kind)}</span>
        <span class="tree-label">${esc(node.label)}</span>
        <span class="tree-state">${esc(node.state)}</span>
      </button>
    `
  }).join('')
}

function nodeClass(node, selected, lastSelectedId) {
  return [
    'mini-node',
    `kind-${node.kind.replaceAll('_', '-')}`,
    `priority-${node.priority ?? 'generic'}`,
    node.decision_target ? 'decision-node' : '',
    node.id === selected?.id ? 'selected-node' : '',
    node.id === lastSelectedId ? 'last-hit-node' : '',
    node.has_draft ? 'draft-node' : '',
    node.capabilities?.project_annotation || node.kind === 'annotation_projection' ? 'annotation-node' : '',
    node.overlay_presentation?.presentation_only ? 'presentation-only-bounds' : '',
    node.overlay_presentation?.role_style ? `role-${node.overlay_presentation.role_style.replaceAll('_', '-')}` : '',
  ].filter(Boolean).join(' ')
}

function shortLabel(label = '') {
  const value = String(label || '')
  return value.length > 34 ? `${value.slice(0, 31)}...` : value
}

function renderMiniMap(state) {
  const model = surfaceMiniMapViewModel(state)
  if (!model) return '<div class="empty">No surface selected</div>'
  const selected = selectedNode(state)
  const lastSelectedId = state.lastInspect?.selected_candidate?.id || null
  const mapMode = state.mapDisplayMode || 'overlay'
  const preview = markdownPreviewViewModel(state)
  const showPreview = preview.available && (mapMode === 'preview' || mapMode === 'both')
  const showOverlay = model.overlay_visible && (mapMode === 'overlay' || mapMode === 'both')
  const showMarkerOverlay = preview.available && mapMode === 'preview'
  const overlays = model.nodes.map((node) => {
    if (!node.bounds || !node.overlay_visible) return ''
    const markerNode = node.id === selected?.id || node.id === lastSelectedId
    const structuralNode = node.decision_target || markerNode
    if (showPreview && mapMode === 'both' && !structuralNode) return ''
    if (!showOverlay && !(showMarkerOverlay && markerNode)) return ''
    const pct = node.overlay_presentation?.percent_bounds || node.percent_bounds
    const style = [
      `left:${cssPercent(pct.x)}`,
      `top:${cssPercent(pct.y)}`,
      `width:${cssPercent(pct.width)}`,
      `height:${cssPercent(pct.height)}`,
      `--overlay-depth:${Number(node.depth) || 0}`,
      `--overlay-inset:${Number(node.overlay_presentation?.inset_px) || 0}px`,
    ].join(';')
    const labelText = node.label_visible ? shortLabel(node.label) : ''
    return `
      <button class="${nodeClass(node, selected, lastSelectedId)}" style="${style}" data-node-id="${esc(node.id)}" title="${esc(node.label)}" aria-label="${esc(node.label)}">
        ${labelText ? `<span>${esc(labelText)}</span>` : ''}
      </button>
    `
  }).join('')
  const selectedSummary = selected
    ? `${selected.label} / ${selected.kind}`
    : 'No selected target'
  const lastSummary = state.lastInspect?.selected_candidate
    ? `${state.lastInspect.selected_candidate.label} / ${state.lastInspect.summary.status}`
    : 'No hit-test selection'
  const previewFallback = preview.markdown_backed && !preview.available && preview.fallback_reason
    ? `<p class="preview-fallback"><strong>Markdown preview unavailable</strong> ${esc(preview.fallback_reason)}</p>`
    : ''
  const mapClasses = [
    'mini-map-frame',
    model.markdown_backed ? 'markdown-backed-map' : 'synthetic-only-map',
    showPreview ? 'show-preview' : '',
    showOverlay ? 'show-overlay' : '',
    showMarkerOverlay ? 'show-marker-overlay' : '',
  ].filter(Boolean).join(' ')

  return `
    <div class="mini-map-header">
      <div>
        <strong>Synthetic Subject Map</strong>
        <span>${esc(model.surface.label)} / ${esc(model.viewport.width)} x ${esc(model.viewport.height)}</span>
      </div>
    </div>
    <p class="map-help">Bounds are line-based or structured target bounds from the fixture, not screenshot pixels.</p>
    ${previewFallback}
    <div class="selected-summary">
      <strong>Selected</strong><span>${esc(selectedSummary)}</span>
      <strong>Last hit-test</strong><span>${esc(lastSummary)}</span>
      <strong>Lines</strong><span>${preview.selected_line_range ? `L${esc(preview.selected_line_range.start_line)}-L${esc(preview.selected_line_range.end_line)}` : 'No line range'}</span>
      <strong>Preview focus</strong><span>${esc(preview.focus?.status || 'idle')}${preview.focus?.target_line ? ` / L${esc(preview.focus.target_line)}` : ''}</span>
    </div>
    <div class="${mapClasses}" data-map-display-mode="${esc(mapMode)}" role="group" aria-label="${esc(model.surface.label)} mini-map">
      ${showPreview ? '<article class="aos-markdown-preview surface-zoom-markdown-preview" data-role="markdown-preview" data-preview-fit="component-compact-workbench" tabindex="0"></article>' : ''}
      ${overlays}
    </div>
  `
}

function renderTargetList(state) {
  const navigator = targetNavigatorViewModel(state)
  if (!navigator.all_nodes.length) return '<div class="empty">No target list</div>'
  const row = (node) => `
    <button class="aos-list-row target-row ${node.selected ? 'selected' : ''} ${node.decision_target ? 'decision-target' : ''}" data-node-id="${esc(node.id)}" aria-selected="${node.selected ? 'true' : 'false'}">
      <span>
        <strong>${esc(node.label)}</strong>
        <small>${esc(node.kind)} / ${esc(node.role)}</small>
        <small>${esc(node.source_summary)}${node.last_hit ? ' / last hit-test' : ''}${node.draft_count ? ` / ${node.draft_count} draft` : ''}</small>
      </span>
      <span class="target-chip">${esc(node.decision_target ? 'decision' : node.draft_count ? 'drafted' : node.selected ? 'selected' : 'target')}</span>
    </button>
  `
  return `
    <div class="target-list aos-list" aria-label="Subject map targets">
      ${navigator.primary.map(row).join('')}
      ${navigator.low_level_count ? `
        <details class="all-nodes-disclosure">
          <summary>All nodes (${esc(navigator.low_level_count)} lower-level)</summary>
          <div class="all-nodes-list">${navigator.all_nodes.filter((node) => node.priority > 2).map(row).join('')}</div>
        </details>
      ` : ''}
    </div>
  `
}

function renderDetails(state) {
  const details = nodeDetailsViewModel(state)
  if (!details) return '<div class="empty">Select a node</div>'
  const inspect = state.lastInspect
  const lastHitSummary = inspect?.selected_candidate
    ? `${inspect.selected_candidate.label} / ${inspect.summary.status}`
    : inspect
      ? `${inspect.summary.status} / no selected target`
      : 'Not inspected'
  return `
    <div class="details-title">
      <div>
        <strong>${esc(details.label)}</strong>
        <span>${esc(details.kind)}</span>
      </div>
      ${renderButtonHtml({ label: 'Draft Annotation', variant: 'primary', dataset: { action: 'draft-node' } })}
    </div>
    <dl class="detail-grid">
      <dt>Kind / role</dt><dd>${esc(details.kind)} / ${esc(details.role)}</dd>
      <dt>Source</dt><dd>${esc(details.source_summary)}</dd>
      <dt>Bounds</dt><dd>${esc(details.bounds_summary)}</dd>
      <dt>Last hit-test</dt><dd>${esc(lastHitSummary)}</dd>
    </dl>
    <div class="json-blocks">
      <details><summary>${esc(detailSummary('Full path', details.id))}</summary><pre>${esc(details.path)}</pre></details>
      <details><summary>${esc(detailSummary('Adapter', details.adapter.type))}</summary><pre>${formatJson(details.adapter)}</pre></details>
      <details><summary>${esc(detailSummary('Source IDs', details.source_ids?.surface_id || details.source_ids?.subject_id))}</summary><pre>${formatJson(details.source_ids)}</pre></details>
      <details><summary>${esc(detailSummary('Bounds', details.bounds_summary))}</summary><pre>${formatJson(details.bounds)}</pre></details>
      <details><summary>${esc(detailSummary('Capabilities', Object.keys(details.capabilities || {}).join(', ')))}</summary><pre>${formatJson(details.capabilities)}</pre></details>
      <details><summary>Metadata</summary><pre>${formatJson(details.metadata)}</pre></details>
    </div>
  `
}

function renderDiagnostics(state) {
  return `
    <div class="diagnostics-stack">
      ${renderOuterTree(state) ? `<details><summary>Surface outline</summary><div class="outer-tree">${renderOuterTree(state)}</div></details>` : ''}
      ${renderInspectResult(state)}
      <details><summary>Snapshot payload</summary><pre>${formatJson(surfaceZoomInspectorSnapshot(state))}</pre></details>
    </div>
  `
}

function renderSecondaryView(state) {
  const active = state.activeSecondaryView || 'targets'
  if (active === 'drafts') return `<div class="draft-list">${renderDrafts(state)}</div>`
  if (active === 'diagnostics') return `<div class="secondary-scroll diagnostics-scroll">${renderDiagnostics(state)}</div>`
  return `<div class="secondary-scroll">${renderTargetList(state)}</div>`
}

function renderSecondaryTabs(state) {
  const active = state.activeSecondaryView || 'targets'
  return ['targets', 'drafts', 'diagnostics'].map((tab) => `
    <button class="secondary-tab ${active === tab ? 'active' : ''}" data-secondary-tab="${tab}" aria-selected="${active === tab ? 'true' : 'false'}">${esc(tab[0].toUpperCase() + tab.slice(1))}</button>
  `).join('')
}

function renderDrafts(state) {
  const group = draftsGroupedBySelectedSurface(state)
  if (!group.drafts.length) return '<div class="empty">No annotation drafts for this surface</div>'
  return group.drafts.map((draft) => `
    <article class="draft-card">
      <header>
        <strong>${esc(draft.ordinal)}. ${esc(draft.label)}</strong>
        <span>${esc(draft.kind)} / ${esc(draft.status)}</span>
      </header>
      <p>${esc(draft.note)}</p>
      <dl class="draft-grid">
        <dt>Surface</dt><dd>${esc(draft.surface_id)}</dd>
        <dt>Space</dt><dd>${esc(draft.coordinate_space)}</dd>
        <dt>Source</dt><dd>${esc(draft.source_path || draft.source_url || 'fixture')}</dd>
      </dl>
      <details><summary>Draft payload</summary><pre>${formatJson({
          viewport_bounds: draft.viewport_bounds,
          bounds: draft.bounds,
          actor: draft.actor,
        })}</pre></details>
    </article>
  `).join('')
}

function renderInspectResult(state) {
  const inspect = state.lastInspect
  if (!inspect) return '<div class="empty">No hit-test inspect result</div>'
  const selected = inspect.selected_candidate
  return `
    <div class="inspect-card">
      <header>
        <div>
          <h2>Hit-Test Inspect</h2>
          <span>${esc(inspect.summary.status)} / ${esc(inspect.request.point.coordinate_space)}</span>
        </div>
        <span>${esc(inspect.summary.candidate_count)} candidates</span>
      </header>
      <dl class="detail-grid inspect-grid">
        <dt>Point</dt><dd>${esc(inspect.request.point.x)}, ${esc(inspect.request.point.y)}</dd>
        <dt>Selected</dt><dd>${selected ? esc(selected.label) : 'None'}</dd>
        <dt>Ambiguous</dt><dd>${esc(inspect.summary.ambiguous)}</dd>
        <dt>Blockers</dt><dd>${inspect.summary.blockers.length ? esc(inspect.summary.blockers.join(', ')) : 'None'}</dd>
        <dt>Seed</dt><dd>${inspect.verification_seed ? 'Present' : 'Missing'}</dd>
      </dl>
      <details><summary>Hit-test candidates</summary><pre>${formatJson({
          selected_path: inspect.summary.selected_path,
          candidates: inspect.candidates.map((candidate) => ({
            id: candidate.id,
            label: candidate.label,
            status: candidate.hit_test_status,
            confidence: candidate.confidence,
          })),
          ambiguous_candidate_paths: inspect.summary.ambiguous_candidate_paths,
          fixture_only: inspect.surface.adapter_fixture_only,
        })}</pre></details>
    </div>
  `
}

function inspectStatusText(state) {
  const inspect = state.lastInspect
  if (!inspect) return 'inspect: idle'
  const selected = inspect.selected_candidate?.label || 'miss'
  return `inspect: ${inspect.summary.status} / ${selected} / ${inspect.summary.candidate_count} candidates`
}

function renderToolbar(state) {
  const surface = selectedSurfaceNode(state)
  const mapZoom = Number.isFinite(Number(state.mapView?.zoom)) ? Number(state.mapView.zoom) : 1
  const preview = markdownPreviewViewModel(state)
  return renderWorkbenchToolbar({
    className: 'surface-zoom-toolbar',
    content: `
      ${renderWorkbenchToolbarSection({
        content: `
        ${renderWorkbenchReadout({ label: 'Surface', value: surface?.label || 'none' })}
        ${renderToggleHtml({ label: 'Overlay', checked: state.overlayVisible, dataset: { action: 'toggle-overlay' } })}
        ${renderSelectHtml({
          label: 'Labels',
          value: state.labelDensity,
          options: LABEL_DENSITY_OPTIONS.map(([value, label]) => ({ value, label })),
          wrapperTag: 'label',
          wrapperClassName: 'aos-control-row',
          dataset: { action: 'label-density' },
        })}
        ${renderSelectHtml({
          label: 'Map',
          value: state.mapDisplayMode,
          options: DISPLAY_MODE_OPTIONS.map(([value, label]) => ({ value, label })),
          wrapperTag: 'label',
          wrapperClassName: 'aos-control-row',
          disabled: !preview.markdown_backed,
          dataset: { action: 'map-display-mode' },
        })}
        `,
      })}
      ${renderWorkbenchToolbarSection({
        attributes: { 'aria-label': 'Subject map zoom controls' },
        content: `
        ${renderButtonHtml({ label: 'Fit', dataset: { action: 'zoom-fit' } })}
        ${renderButtonHtml({ label: 'Zoom Out', dataset: { action: 'zoom-out' } })}
        ${renderButtonHtml({ label: 'Zoom In', dataset: { action: 'zoom-in' } })}
        ${renderButtonHtml({ label: 'Reset View', dataset: { action: 'zoom-reset' } })}
        ${renderWorkbenchReadout({ label: 'Map', value: `${Math.round(mapZoom * 100)}%` })}
        `,
      })}
      ${renderWorkbenchToolbarSection({
        dataset: { align: 'end' },
        content: `
        ${renderButtonHtml({ label: 'Reset Selection', dataset: { action: 'reset-selection' } })}
        ${renderButtonHtml({ label: 'Clear Drafts', dataset: { action: 'clear-drafts' } })}
        ${renderWorkbenchReadout({ content: esc(inspectStatusText(state)) })}
        `,
      })}
    `,
  })
}

function applyMarkdownPreview(root, state) {
  const preview = markdownPreviewViewModel(state)
  const target = root.querySelector('[data-role="markdown-preview"]')
  if (!target || !preview.available) return
  target.innerHTML = state.markdownPreview?.html || ''
  target.dataset.previewFocusStatus = preview.focus?.status || 'idle'
  target.dataset.previewFocusStrategy = preview.focus?.strategy || ''
  target.dataset.previewTargetLine = preview.focus?.target_line ? String(preview.focus.target_line) : ''
  const range = selectedLineRange(state)
  target.querySelectorAll('.surface-zoom-source-line-highlight').forEach((node) => {
    node.classList.remove('surface-zoom-source-line-highlight')
    node.removeAttribute('data-surface-zoom-highlight')
  })
  if (!range) return
  for (let line = range.start_line; line <= range.end_line; line += 1) {
    target.querySelectorAll(sourceLineSelector(line)).forEach((node) => {
      node.classList.add('surface-zoom-source-line-highlight')
      node.setAttribute('data-surface-zoom-highlight', 'selected-line-range')
    })
  }
  const firstHighlighted = target.querySelector('.surface-zoom-source-line-highlight')
  if (!firstHighlighted) return
  const top = Math.max(0, firstHighlighted.offsetTop - Math.round(target.clientHeight * 0.24))
  if (typeof target.scrollTo === 'function') {
    target.scrollTo({ top, left: 0, behavior: 'auto' })
  } else {
    target.scrollTop = top
  }
  target.dataset.previewFocusStatus = 'focused'
  state.markdownPreview = {
    ...(state.markdownPreview || {}),
    focus_state: {
      status: 'focused',
      scroll_top: top,
      target_line: range.start_line,
      line_range: range,
    },
  }
}

function render(root, content, state) {
  const narrowLayout = typeof window !== 'undefined'
    && window.matchMedia?.('(max-width: 900px)')?.matches
  const secondaryTitle = esc((state.activeSecondaryView || 'targets').replace(/^\w/, (value) => value.toUpperCase()))
  const mapPanel = `
    <section class="surface-panel map-panel" aria-label="Synthetic Subject Map work area">
      ${renderMiniMap(state)}
    </section>
  `
  const inspectorPanel = `
    <aside class="surface-panel inspector-panel" aria-label="Inspector">
      ${renderWorkbenchPaneHeader({ title: 'Inspector', subtitle: 'Selected target details' })}
      <div class="panel-scroll">
        ${renderDetails(state)}
      </div>
    </aside>
  `
  const secondaryPanel = `
    <section class="surface-panel secondary-panel" aria-label="Secondary drawer">
      ${renderWorkbenchPaneHeader({
        title: secondaryTitle,
        className: 'secondary-header',
        actions: `<div class="secondary-tabs" role="tablist" aria-label="Secondary drawer views">${renderSecondaryTabs(state)}</div>`,
      })}
      ${renderSecondaryView(state)}
    </section>
  `
  content.innerHTML = `
    ${renderToolbar(state)}
    <div class="surface-zoom-workbench">
      ${narrowLayout
        ? `${mapPanel}<div class="surface-zoom-lower-stack">${inspectorPanel}${secondaryPanel}</div>`
        : `<div class="surface-zoom-left-stack">${mapPanel}${secondaryPanel}</div>${inspectorPanel}`}
    </div>
  `
  const workbench = content.querySelector('.surface-zoom-workbench')
  if (narrowLayout) {
    const lowerStack = content.querySelector('.surface-zoom-lower-stack')
    createSplitPane({
      root: workbench,
      startPane: content.querySelector('.map-panel'),
      endPane: lowerStack,
      orientation: 'vertical',
      initialRatio: 0.43,
      minStart: 300,
      minEnd: 480,
      dividerSize: 1,
      ariaLabel: 'Resize subject map and lower panes',
    })
    createSplitPane({
      root: lowerStack,
      startPane: content.querySelector('.inspector-panel'),
      endPane: content.querySelector('.secondary-panel'),
      orientation: 'vertical',
      initialRatio: 0.5,
      minStart: 240,
      minEnd: 240,
      dividerSize: 1,
      ariaLabel: 'Resize inspector and secondary panes',
    })
  } else {
    const leftStack = content.querySelector('.surface-zoom-left-stack')
    createFixedSidebarPane({
      root: workbench,
      mainPane: leftStack,
      sidebarPane: content.querySelector('.inspector-panel'),
      orientation: 'horizontal',
      side: 'end',
      openSize: 360,
      closedSize: 0,
      minMain: 300,
      maxSidebar: 360,
      dividerSize: 1,
      initiallyOpen: true,
      ariaLabel: 'Resize subject map and inspector panes',
    })
    createSplitPane({
      root: leftStack,
      startPane: content.querySelector('.map-panel'),
      endPane: content.querySelector('.secondary-panel'),
      orientation: 'vertical',
      initialRatio: 0.7,
      minStart: 220,
      minEnd: 150,
      dividerSize: 1,
      ariaLabel: 'Resize subject map and secondary panes',
    })
  }
  applyMarkdownPreview(content, state)
  root.dataset.snapshot = JSON.stringify(surfaceZoomInspectorSnapshot(state))
}

function setMapZoom(state, zoom, mode = 'manual') {
  const nextZoom = Math.max(0.5, Math.min(2, Number(zoom) || 1))
  state.mapView = { mode, zoom: nextZoom }
}

async function main() {
  const root = document.querySelector('#surface-zoom-inspector-root')
  root.innerHTML = '<div class="loading">Loading Spatial Subject Tree fixture...</div>'
  try {
    const tree = await loadTree()
    const state = createSurfaceZoomInspectorState({ tree })
    const chrome = mountChrome(root, {
      title: 'Surface-Zoom Inspector',
      draggable: true,
      close: true,
      minimize: true,
      maximize: true,
      resizable: true,
      resize: { minWidth: 560, minHeight: 520 },
    })
    chrome.customControlsEl.innerHTML = `<span class="surface-zoom-subtitle">${esc(sourceLabel())}</span>`
    async function loadSelectedMarkdownPreview() {
      const preview = markdownPreviewViewModel(state)
      if (!preview.markdown_backed || !preview.source?.file_path) {
        setMarkdownPreviewState(state, { available: false, status: 'not_applicable' })
        return
      }
      setMarkdownPreviewState(state, { available: false, status: 'loading', fallback_reason: null })
      render(root, chrome.contentEl, state)
      try {
        const response = await fetch(resolveMarkdownSourceUrl(preview.source.file_path, {
          treeUrl: getTreeUrl(),
          importMetaUrl: import.meta.url,
        }))
        if (!response.ok) throw new Error(`source fetch failed: ${response.status}`)
        const source = await response.text()
        const html = renderMarkdown(source)
        setMarkdownPreviewState(state, {
          available: true,
          status: 'ready',
          source: preview.source,
          source_line_count: source.split(/\r?\n/).length,
          html,
          fallback_reason: null,
        })
      } catch (error) {
        setMarkdownPreviewState(state, {
          available: false,
          status: 'fallback',
          source: preview.source,
          fallback_reason: error?.message || 'Markdown source could not be rendered.',
        })
      }
      render(root, chrome.contentEl, state)
    }

    window.surfaceZoomInspector = {
      state,
      inspectPoint: (point) => {
        const result = inspectSelectedSurfacePoint(state, point)
        render(root, chrome.contentEl, state)
        return result
      },
      selectSurfaceNode: (nodeId) => {
        const ok = selectSurfaceNode(state, nodeId)
        render(root, chrome.contentEl, state)
        return ok
      },
      snapshot: () => surfaceZoomInspectorSnapshot(state),
    }
    render(root, chrome.contentEl, state)
    declareManifest({
      name: 'surface-zoom-inspector',
      title: 'Surface-Zoom Inspector',
      accepts: [],
      emits: [],
      defaultSize: { w: 1180, h: 720 },
    })
    window.setTimeout(() => emitReady(), 100)
    void loadSelectedMarkdownPreview()
    root.addEventListener('click', (event) => {
      const surfaceButton = event.target.closest('[data-surface-id]')
      const nodeButton = event.target.closest('[data-node-id]')
      const miniMapFrame = event.target.closest('.mini-map-frame')
      const secondaryTab = event.target.closest('[data-secondary-tab]')
      const action = event.target.closest('[data-action]')?.dataset.action
      if (surfaceButton) {
        selectSurface(state, surfaceButton.dataset.surfaceId)
        render(root, chrome.contentEl, state)
        void loadSelectedMarkdownPreview()
      } else if (secondaryTab) {
        state.activeSecondaryView = secondaryTab.dataset.secondaryTab
        render(root, chrome.contentEl, state)
      } else if (action === 'reset-selection') {
        selectSurface(state, state.selectedSurfaceId)
        state.lastInspect = null
        render(root, chrome.contentEl, state)
      } else if (action === 'clear-drafts') {
        state.drafts = []
        render(root, chrome.contentEl, state)
      } else if (action === 'zoom-fit') {
        setMapZoom(state, 1, 'fit')
        render(root, chrome.contentEl, state)
      } else if (action === 'zoom-out') {
        setMapZoom(state, (state.mapView?.zoom || 1) - 0.1)
        render(root, chrome.contentEl, state)
      } else if (action === 'zoom-in') {
        setMapZoom(state, (state.mapView?.zoom || 1) + 0.1)
        render(root, chrome.contentEl, state)
      } else if (action === 'zoom-reset') {
        setMapZoom(state, 1, 'manual')
        render(root, chrome.contentEl, state)
      } else if (miniMapFrame) {
        const miniMap = surfaceMiniMapViewModel(state)
        if (miniMap) {
          const frameRect = miniMapFrame.getBoundingClientRect()
          const x = ((event.clientX - frameRect.left) / frameRect.width) * miniMap.viewport.width
          const y = ((event.clientY - frameRect.top) / frameRect.height) * miniMap.viewport.height
          inspectSelectedSurfacePoint(state, { x, y, coordinate_space: 'viewport' })
        }
        render(root, chrome.contentEl, state)
      } else if (nodeButton) {
        selectSurfaceNode(state, nodeButton.dataset.nodeId)
        render(root, chrome.contentEl, state)
      } else if (action === 'draft-node') {
        createAnnotationDraftFromNode(state)
        render(root, chrome.contentEl, state)
      }
    })
    root.addEventListener('change', (event) => {
      if (event.target?.dataset?.action === 'toggle-overlay') {
        state.overlayVisible = event.target.checked
        render(root, chrome.contentEl, state)
      } else if (event.target?.dataset?.action === 'label-density') {
        state.labelDensity = event.target.value
        render(root, chrome.contentEl, state)
      } else if (event.target?.dataset?.action === 'map-display-mode') {
        setMapDisplayMode(state, event.target.value)
        render(root, chrome.contentEl, state)
      }
    })
  } catch (error) {
    root.innerHTML = `<div class="error">Surface-Zoom Inspector failed: ${esc(error.message)}</div>`
  }
}

main()
