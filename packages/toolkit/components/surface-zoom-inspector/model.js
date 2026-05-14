import {
  assertSpatialSubjectTreeShape,
  normalizeSpatialSubjectTree,
} from '../../workbench/spatial-subject-tree.js'
import {
  buildSurfaceHitTestInspectResult,
  surfaceTypeForClass,
  verificationSeedFromInspectResult,
} from '../../workbench/surface-hit-test-inspect.js'

export const SURFACE_ZOOM_INSPECTOR_SCHEMA_VERSION = '2026-05-09-surface-zoom-proof-v0'
export const SURFACE_ZOOM_INSPECTOR_ACTOR = { role: 'operator', id: 'surface-zoom-inspector' }
export const SURFACE_ZOOM_INSPECTOR_FIXTURE_SOURCE = 'docs/design/fixtures/spatial-subject-tree-v0/desktop-world-aos-canvas.json'
export const SURFACE_ZOOM_LABEL_DENSITY_MODES = ['labels_off', 'selected_only', 'all']
export const SURFACE_ZOOM_SECONDARY_VIEWS = ['targets', 'drafts', 'diagnostics']
export const SURFACE_ZOOM_MAP_DISPLAY_MODES = ['preview', 'overlay', 'both']

const OUTER_TREE_KINDS = new Set(['desktop_world', 'display', 'window', 'canvas', 'surface'])
const ELEMENT_LIKE_KINDS = new Set(['semantic_target', 'ax_element', 'dom_element', 'svg_node', 'three_object'])
const REGION_LIKE_KINDS = new Set(['region', 'image_region', 'pdf_page', 'annotation_projection'])
const DOCUMENT_COORDINATE_KINDS = new Set(['document', 'text_range'])

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback
  return JSON.parse(JSON.stringify(value))
}

function stripKindPrefix(id = '', kind = '') {
  const raw = text(id)
  const normalizedKind = text(kind).replaceAll('_', '-')
  for (const prefix of [normalizedKind, 'surface', 'canvas', 'window']) {
    if (raw.startsWith(`${prefix}:`)) return raw.slice(prefix.length + 1)
  }
  return raw
}

function rect(value = null) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  const width = Number(value.width ?? value.w)
  const height = Number(value.height ?? value.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function objectValue(value = null) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function nodeById(tree = {}) {
  return new Map((tree.nodes || []).map((node) => [node.id, node]))
}

function childrenByParent(tree = {}) {
  const children = new Map()
  for (const node of tree.nodes || []) {
    if (node.parent_id == null) continue
    if (!children.has(node.parent_id)) children.set(node.parent_id, [])
    children.get(node.parent_id).push(node)
  }
  for (const list of children.values()) {
    list.sort((a, b) => {
      const order = (a.sibling_order ?? 0) - (b.sibling_order ?? 0)
      return order || text(a.label).localeCompare(text(b.label)) || text(a.id).localeCompare(text(b.id))
    })
  }
  return children
}

function ancestorChain(tree, nodeId) {
  const byId = nodeById(tree)
  const out = []
  let current = byId.get(nodeId)
  const seen = new Set()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    out.unshift(current)
    current = current.parent_id == null ? null : byId.get(current.parent_id)
  }
  return out
}

function nearestAncestor(tree, nodeId, predicate) {
  const chain = ancestorChain(tree, nodeId)
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (predicate(chain[index])) return chain[index]
  }
  return null
}

function bestSourcePath(node = {}, surface = null) {
  return text(
    node.source?.file_path
      || node.source?.source_path
      || node.metadata?.source_path
      || surface?.source?.file_path
      || surface?.source?.source_path
      || surface?.metadata?.source_path
      || SURFACE_ZOOM_INSPECTOR_FIXTURE_SOURCE,
  )
}

function bestSourceUrl(node = {}, surface = null) {
  return text(node.source?.url || node.source?.source_url || node.metadata?.source_url || surface?.source?.url || surface?.source?.source_url) || null
}

function surfaceIdentifier(surface = null, fallback = '') {
  return text(surface?.source?.surface_id || stripKindPrefix(surface?.id, 'surface') || fallback, 'unknown-surface')
}

function canvasIdentifier(node = {}, surface = null) {
  const canvas = node.kind === 'canvas' ? node : surface
  return text(node.source?.canvas_id || surface?.source?.canvas_id || stripKindPrefix(canvas?.id, 'canvas')) || null
}

function bestBoundsForNode(tree, node, surface = null) {
  const bounds = objectValue(node.bounds)
  const surfaceBounds = objectValue(surface?.bounds)
  const directParentLocal = rect(bounds.parent_local)
  if (directParentLocal && (!surface || node.parent_id === surface.id)) {
    return { coordinate_space: 'viewport', key: 'viewport_bounds', rect: directParentLocal }
  }

  const viewportLocal = rect(bounds.viewport_local)
  if (viewportLocal) return { coordinate_space: 'viewport', key: 'viewport_bounds', rect: viewportLocal }

  const lcsLocal = rect(bounds.lcs_local)
  if (lcsLocal) return { coordinate_space: 'lcs', key: 'bounds', rect: lcsLocal }

  if (DOCUMENT_COORDINATE_KINDS.has(node.kind)) {
    const documentRect = rect(bounds.document) || rect(bounds.page) || directParentLocal
    if (documentRect) return { coordinate_space: node.kind === 'text_range' ? 'document' : 'page', key: 'page_bounds', rect: documentRect }
  }

  const desktop = rect(bounds.desktop_world)
  const surfaceDesktop = rect(surfaceBounds.desktop_world)
  if (desktop && surfaceDesktop && node.id !== surface?.id) {
    return {
      coordinate_space: 'viewport',
      key: 'viewport_bounds',
      rect: {
        x: desktop.x - surfaceDesktop.x,
        y: desktop.y - surfaceDesktop.y,
        width: desktop.width,
        height: desktop.height,
      },
    }
  }

  if (desktop) return { coordinate_space: 'desktop_world', key: 'bounds', rect: desktop }
  return { coordinate_space: 'unknown', key: 'bounds', rect: null }
}

function annotationKindForNode(node = {}) {
  if (node.kind === 'point') return 'point_comment'
  if (node.kind === 'text_range') return 'selection_comment'
  if (REGION_LIKE_KINDS.has(node.kind)) return 'region_comment'
  if (ELEMENT_LIKE_KINDS.has(node.kind)) return 'element_selection'
  return node.capabilities?.action || node.capabilities?.annotate ? 'element_selection' : 'region_comment'
}

function selectorCandidates(node = {}) {
  const candidates = [
    node.source?.selector,
    node.source?.xpath,
    node.source?.adapter_subject_id,
    node.metadata?.selector,
    node.metadata?.xpath,
    ...(Array.isArray(node.metadata?.selector_candidates) ? node.metadata.selector_candidates : []),
  ]
  return [...new Set(candidates.map((value) => text(value)).filter(Boolean))]
}

function roleForNode(node = {}) {
  return text(node.metadata?.role || node.source?.role || node.kind)
}

function labelForNode(node = {}) {
  return text(node.label || node.source?.title || node.source?.name || node.id, 'node')
}

function sourceSummaryForNode(node = {}, surface = null) {
  const source = objectValue(node.source)
  const metadata = objectValue(node.metadata)
  const path = bestSourcePath(node, surface)
  const pathPart = path.split('/').filter(Boolean).at(-1) || path
  const start = source.line_start ?? metadata.line_range?.start_line
  const end = source.line_end ?? metadata.line_range?.end_line
  if (start && end && start !== end) return `${pathPart}:L${start}-L${end}`
  if (start) return `${pathPart}:L${start}`
  return text(source.subject_id || source.adapter_subject_id || pathPart, 'fixture')
}

function boundsSummaryFromBounds(bounds = {}) {
  const candidates = [
    rect(bounds.parent_local),
    rect(bounds.viewport_local),
    rect(bounds.document),
    rect(bounds.page),
    rect(bounds.desktop_world),
    rect(bounds.lcs_local),
  ]
  const value = candidates.find(Boolean)
  if (!value) return 'No structured bounds'
  return `${value.x}, ${value.y}, ${value.width} x ${value.height}`
}

function sourceStartForNode(node = {}) {
  return Number(node.source?.line_start ?? node.metadata?.line_range?.start_line ?? Number.MAX_SAFE_INTEGER)
}

function lineRangeForNode(node = {}) {
  const start = Number(node.metadata?.line_range?.start_line ?? node.source?.line_start)
  const end = Number(node.metadata?.line_range?.end_line ?? node.source?.line_end ?? start)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return {
    start_line: Math.max(1, Math.min(start, end)),
    end_line: Math.max(1, Math.max(start, end)),
  }
}

function linesInRange(range = null) {
  if (!range) return []
  const out = []
  for (let line = range.start_line; line <= range.end_line; line += 1) out.push(line)
  return out
}

function markdownPreviewFitState(preview = {}) {
  return {
    mode: 'component_compact_workbench',
    viewport: 'map_frame',
    typography: 'compact_markdown_preview',
    horizontal_overflow_guard: true,
    internal_scroll: true,
    max_width: '100%',
    source: preview.markdown_backed ? 'surface_zoom_inspector' : null,
  }
}

function markdownPreviewFocusState(state = {}, preview = {}) {
  const range = selectedLineRange(state)
  const node = selectedNode(state)
  if (!preview.available || !range || !node) {
    return {
      status: range ? 'pending_preview' : 'idle',
      strategy: null,
      target_node_id: node?.id || null,
      target_line: range?.start_line || null,
      line_range: range,
      expected_visible_text: null,
    }
  }
  return {
    status: preview.focus_state?.status || 'pending_dom_focus',
    strategy: 'scroll_first_highlighted_line',
    target_node_id: node.id,
    target_line: range.start_line,
    line_range: range,
    expected_visible_text: text(node.metadata?.text_excerpt || node.source?.text_excerpt).slice(0, 220) || null,
    scroll_top: Number.isFinite(Number(preview.focus_state?.scroll_top)) ? Number(preview.focus_state.scroll_top) : null,
  }
}

function isMarkdownSurface(surface = null, tree = {}) {
  const sourcePath = bestSourcePath(surface, surface)
  return surface?.adapter?.type === 'markdown_workbench'
    || surface?.metadata?.source_type === 'markdown_document'
    || tree?.metadata?.source_type === 'markdown'
    || (surface?.metadata?.coordinate_space === 'markdown_line_document_v0' && /\.md(?:$|[?#])/.test(sourcePath))
}

function markdownPreviewSource(surface = null, tree = {}) {
  if (!surface || !isMarkdownSurface(surface, tree)) return null
  const sourcePath = bestSourcePath(surface, surface)
  return {
    type: 'markdown_workbench',
    file_path: sourcePath,
    source_url: bestSourceUrl(surface, surface),
    line_count: Number(surface.metadata?.line_count) || null,
  }
}

function normalizedDisplayMode(mode, fallback = 'overlay') {
  return SURFACE_ZOOM_MAP_DISPLAY_MODES.includes(mode) ? mode : fallback
}

function defaultPreviewState(surface = null, tree = {}) {
  const source = markdownPreviewSource(surface, tree)
  if (!source) {
    return {
      markdown_backed: false,
      available: false,
      status: 'not_applicable',
      source: null,
      fallback_reason: null,
    }
  }
  return {
    markdown_backed: true,
    available: false,
    status: 'not_loaded',
    source,
    fallback_reason: null,
  }
}

function nodePriority(node = {}) {
  const role = roleForNode(node)
  if (node.metadata?.required_alignment_target || role === 'decision_target') return 0
  if (node.kind === 'semantic_target') return 1
  if (node.capabilities?.project_annotation || node.kind === 'annotation_projection') return 2
  if (ELEMENT_LIKE_KINDS.has(node.kind)) return 3
  if (REGION_LIKE_KINDS.has(node.kind)) return 4
  return 5
}

function isPriorityNavigatorNode(node = {}) {
  return nodePriority(node) <= 2
}

export function normalizeSurfaceZoomInspectorTree(input = {}) {
  const tree = normalizeSpatialSubjectTree(input)
  assertSpatialSubjectTreeShape(tree)
  return tree
}

export function createSurfaceZoomInspectorState({
  tree = {},
  selectedSurfaceId = null,
  selectedNodeId = null,
  overlayVisible = true,
  labelDensity = 'selected_only',
  mapDisplayMode = null,
  markdownPreview = null,
  mapView = null,
  activeSecondaryView = 'targets',
  createdAt = null,
} = {}) {
  const normalizedTree = normalizeSurfaceZoomInspectorTree(tree)
  const firstSurface = normalizedTree.nodes.find((node) => node.kind === 'surface')
  const selectedSurface = selectedSurfaceId && normalizedTree.nodes.some((node) => node.id === selectedSurfaceId)
    ? selectedSurfaceId
    : firstSurface?.id || null
  const selectedNode = selectedNodeId && normalizedTree.nodes.some((node) => node.id === selectedNodeId)
    ? selectedNodeId
    : selectedSurface
  const surfaceNode = normalizedTree.nodes.find((node) => node.id === selectedSurface && node.kind === 'surface')
  const previewState = {
    ...defaultPreviewState(surfaceNode, normalizedTree),
    ...(markdownPreview && typeof markdownPreview === 'object' ? markdownPreview : {}),
  }
  return {
    schema_version: SURFACE_ZOOM_INSPECTOR_SCHEMA_VERSION,
    tree: normalizedTree,
    selectedSurfaceId: selectedSurface,
    selectedNodeId: selectedNode,
    overlayVisible: overlayVisible !== false,
    labelDensity: SURFACE_ZOOM_LABEL_DENSITY_MODES.includes(labelDensity) ? labelDensity : 'selected_only',
    mapDisplayMode: normalizedDisplayMode(
      mapDisplayMode,
      previewState.markdown_backed && previewState.available ? 'both' : 'overlay',
    ),
    markdownPreview: previewState,
    activeSecondaryView: SURFACE_ZOOM_SECONDARY_VIEWS.includes(activeSecondaryView) ? activeSecondaryView : 'targets',
    mapView: {
      mode: ['fit', 'manual'].includes(mapView?.mode) ? mapView.mode : 'fit',
      zoom: Number.isFinite(Number(mapView?.zoom)) ? Math.max(0.5, Math.min(2, Number(mapView.zoom))) : 1,
    },
    drafts: [],
    lastInspect: null,
    createdAt: createdAt || normalizedTree.created_at,
  }
}

export function surfaceZoomOuterTree(stateOrTree = {}) {
  const tree = stateOrTree.tree || stateOrTree
  const children = childrenByParent(tree)
  return (tree.nodes || [])
    .filter((node) => OUTER_TREE_KINDS.has(node.kind))
    .map((node) => ({
      id: node.id,
      parent_id: node.parent_id && OUTER_TREE_KINDS.has(nodeById(tree).get(node.parent_id)?.kind) ? node.parent_id : null,
      path: node.path,
      kind: node.kind,
      label: node.label,
      state: node.state,
      depth: Math.max(0, ancestorChain(tree, node.id).filter((ancestor) => OUTER_TREE_KINDS.has(ancestor.kind)).length - 1),
      child_count: (children.get(node.id) || []).filter((child) => OUTER_TREE_KINDS.has(child.kind)).length,
      selectable: node.kind === 'surface',
    }))
}

export function selectSurface(state, surfaceId) {
  const surface = (state.tree.nodes || []).find((node) => node.id === surfaceId && node.kind === 'surface')
  if (!surface) return false
  state.selectedSurfaceId = surface.id
  state.selectedNodeId = surface.id
  state.markdownPreview = defaultPreviewState(surface, state.tree)
  state.mapDisplayMode = state.markdownPreview.markdown_backed && state.markdownPreview.available ? 'both' : 'overlay'
  return true
}

export function selectSurfaceNode(state, nodeId) {
  const node = (state.tree.nodes || []).find((candidate) => candidate.id === nodeId)
  if (!node) return false
  const surface = nearestAncestor(state.tree, node.id, (candidate) => candidate.kind === 'surface')
  if (!surface) return false
  state.selectedSurfaceId = surface.id
  state.selectedNodeId = node.id
  return true
}

export function selectedSurfaceNode(state = {}) {
  return (state.tree?.nodes || []).find((node) => node.id === state.selectedSurfaceId && node.kind === 'surface') || null
}

export function selectedNode(state = {}) {
  return (state.tree?.nodes || []).find((node) => node.id === state.selectedNodeId) || selectedSurfaceNode(state)
}

export function selectedLineRange(state = {}) {
  return lineRangeForNode(selectedNode(state))
}

export function setMapDisplayMode(state = {}, mode = 'overlay') {
  state.mapDisplayMode = normalizedDisplayMode(mode, state.mapDisplayMode || 'overlay')
  return state.mapDisplayMode
}

export function setMarkdownPreviewState(state = {}, previewState = {}) {
  const surface = selectedSurfaceNode(state)
  const base = defaultPreviewState(surface, state.tree)
  state.markdownPreview = {
    ...base,
    ...(previewState && typeof previewState === 'object' ? previewState : {}),
    source: previewState.source || base.source,
  }
  if (state.markdownPreview.markdown_backed && state.markdownPreview.available) {
    state.mapDisplayMode = normalizedDisplayMode(state.mapDisplayMode, 'both')
    if (state.mapDisplayMode === 'overlay') state.mapDisplayMode = 'both'
  } else if (!state.markdownPreview.available && state.mapDisplayMode !== 'overlay') {
    state.mapDisplayMode = 'overlay'
  }
  return state.markdownPreview
}

export function markdownPreviewViewModel(state = {}) {
  const surface = selectedSurfaceNode(state)
  const base = defaultPreviewState(surface, state.tree)
  const preview = {
    ...base,
    ...(state.markdownPreview && typeof state.markdownPreview === 'object' ? state.markdownPreview : {}),
  }
  const selectedRange = selectedLineRange(state)
  const highlightedSourceLines = preview.available ? linesInRange(selectedRange) : []
  return {
    markdown_backed: preview.markdown_backed,
    available: preview.available === true,
    status: preview.status || (preview.markdown_backed ? 'not_loaded' : 'not_applicable'),
    source: preview.source || base.source,
    fallback_reason: preview.fallback_reason || null,
    selected_line_range: selectedRange,
    highlighted_source_lines: highlightedSourceLines,
    highlighted_line_count: highlightedSourceLines.length,
    fit: markdownPreviewFitState(preview),
    focus: markdownPreviewFocusState(state, {
      ...preview,
      available: preview.available === true,
    }),
  }
}

export function surfaceChildNodes(state = {}) {
  const surface = selectedSurfaceNode(state)
  if (!surface) return []
  const children = childrenByParent(state.tree)
  return (children.get(surface.id) || []).filter((node) => node.state !== 'hidden')
}

export function surfaceMiniMapViewModel(state = {}) {
  const surface = selectedSurfaceNode(state)
  if (!surface) return null
  const markdownBacked = isMarkdownSurface(surface, state.tree)
  const surfaceBounds = rect(surface.bounds?.parent_local) || rect(surface.bounds?.viewport_local) || rect(surface.bounds?.desktop_world) || { x: 0, y: 0, width: 1, height: 1 }
  const width = Math.max(1, surfaceBounds.width)
  const height = Math.max(1, surfaceBounds.height)
  const nodes = surfaceChildNodes(state).map((node) => {
    const bounds = bestBoundsForNode(state.tree, node, surface)
    const role = roleForNode(node)
    const hasDraft = (state.drafts || []).some((draft) => draft.metadata?.source_node_id === node.id)
    const depth = Math.max(0, ancestorChain(state.tree, node.id).length - ancestorChain(state.tree, surface.id).length)
    const roleInset = node.kind === 'document' ? 0
      : role === 'decision_target' ? 20
        : node.kind === 'region' ? 14
          : role === 'heading' || node.kind === 'text_range' ? 8
            : 6
    const inset = markdownBacked && bounds.rect
      ? Math.min(Math.max(0, bounds.rect.width / 3), roleInset + Math.max(0, depth - 1) * 2)
      : 0
    const presentationRect = bounds.rect
      ? {
          x: bounds.rect.x + inset,
          y: bounds.rect.y,
          width: Math.max(1, bounds.rect.width - (inset * 2)),
          height: bounds.rect.height,
        }
      : null
    return {
      id: node.id,
      kind: node.kind,
      label: labelForNode(node),
      role,
      depth,
      source_summary: sourceSummaryForNode(node, surface),
      priority: nodePriority(node),
      decision_target: node.metadata?.required_alignment_target === true || role === 'decision_target',
      has_draft: hasDraft,
      state: node.state,
      adapter: cloneJson(node.adapter, {}),
      capabilities: cloneJson(node.capabilities, {}),
      bounds: bounds.rect,
      coordinate_space: bounds.coordinate_space,
      overlay_visible: state.overlayVisible,
      label_visible: state.labelDensity === 'all' || (state.labelDensity === 'selected_only' && node.id === state.selectedNodeId),
      percent_bounds: bounds.rect ? {
        x: bounds.rect.x / width,
        y: bounds.rect.y / height,
        width: bounds.rect.width / width,
        height: bounds.rect.height / height,
      } : null,
      overlay_presentation: {
        presentation_only: true,
        depth,
        role_style: node.kind === 'document' ? 'document'
          : role === 'decision_target' ? 'decision_target'
            : role === 'heading' ? 'heading'
              : role === 'markdown_table' || role === 'mermaid_block' || node.kind === 'region' ? 'region'
                : 'content',
        inset_px: inset,
        percent_bounds: presentationRect ? {
          x: presentationRect.x / width,
          y: presentationRect.y / height,
          width: presentationRect.width / width,
          height: presentationRect.height / height,
        } : null,
      },
    }
  })
  return {
    surface: {
      id: surface.id,
      label: surface.label,
      path: surface.path,
      source: cloneJson(surface.source, {}),
      adapter: cloneJson(surface.adapter, {}),
      bounds: surfaceBounds,
    },
    viewport: { width, height },
    markdown_backed: markdownBacked,
    overlay_visible: state.overlayVisible,
    label_density: SURFACE_ZOOM_LABEL_DENSITY_MODES.includes(state.labelDensity) ? state.labelDensity : 'selected_only',
    both_mode_overlay: {
      rendered_markdown_primary: markdownBacked,
      generic_bounds: 'hidden',
      selected_last_hit_and_decision_bounds: 'visible',
      overlay_mode_preserves_all_bounds: true,
    },
    map_view: {
      mode: ['fit', 'manual'].includes(state.mapView?.mode) ? state.mapView.mode : 'fit',
      zoom: Number.isFinite(Number(state.mapView?.zoom)) ? state.mapView.zoom : 1,
    },
    nodes,
  }
}

export function nodeDetailsViewModel(state = {}, nodeId = null) {
  const node = nodeId
    ? (state.tree?.nodes || []).find((candidate) => candidate.id === nodeId)
    : selectedNode(state)
  if (!node) return null
  const surface = nearestAncestor(state.tree, node.id, (candidate) => candidate.kind === 'surface') || selectedSurfaceNode(state)
  return {
    id: node.id,
    path: node.path,
    kind: node.kind,
    role: roleForNode(node),
    label: node.label,
    source_summary: sourceSummaryForNode(node, surface),
    bounds_summary: boundsSummaryFromBounds(objectValue(node.bounds)),
    source_ids: cloneJson(node.source, {}),
    adapter: {
      type: node.adapter?.type || 'unknown',
      confidence: node.adapter?.confidence ?? 0,
      freshness: node.adapter?.freshness || 'unknown',
      child_discovery: node.adapter?.child_discovery || 'unknown',
      id: node.adapter?.id || 'unknown',
    },
    bounds: cloneJson(node.bounds, {}),
    capabilities: cloneJson(node.capabilities, {}),
    state: node.state,
    metadata: cloneJson(node.metadata, {}),
  }
}

export function targetNavigatorViewModel(state = {}) {
  const selected = selectedNode(state)
  const lastSelectedId = state.lastInspect?.selected_candidate?.id || null
  const draftsByNodeId = new Map()
  for (const draft of state.drafts || []) {
    const id = draft.metadata?.source_node_id
    if (!id) continue
    draftsByNodeId.set(id, (draftsByNodeId.get(id) || 0) + 1)
  }
  const nodes = surfaceChildNodes(state).map((node) => ({
    id: node.id,
    kind: node.kind,
    role: roleForNode(node),
    label: labelForNode(node),
    source_summary: sourceSummaryForNode(node, selectedSurfaceNode(state)),
    source_start: sourceStartForNode(node),
    selected: node.id === selected?.id,
    last_hit: node.id === lastSelectedId,
    draft_count: draftsByNodeId.get(node.id) || 0,
    priority: nodePriority(node),
    decision_target: node.metadata?.required_alignment_target === true || roleForNode(node) === 'decision_target',
  }))
  const sorted = nodes.sort((a, b) => (
    a.priority - b.priority
    || Number(b.selected) - Number(a.selected)
    || Number(b.last_hit) - Number(a.last_hit)
    || a.source_start - b.source_start
    || a.source_summary.localeCompare(b.source_summary)
    || a.label.localeCompare(b.label)
  ))
  return {
    primary: sorted.filter(isPriorityNavigatorNode),
    all_nodes: sorted,
    low_level_count: sorted.filter((node) => !isPriorityNavigatorNode(node)).length,
  }
}

export function createAnnotationDraftFromNode(state = {}, nodeId = null, { now = null } = {}) {
  const node = nodeId
    ? (state.tree?.nodes || []).find((candidate) => candidate.id === nodeId)
    : selectedNode(state)
  if (!node) return null
  const surface = nearestAncestor(state.tree, node.id, (candidate) => candidate.kind === 'surface') || selectedSurfaceNode(state)
  const bounds = bestBoundsForNode(state.tree, node, surface)
  const ordinal = state.drafts.length + 1
  const timestamp = now || new Date().toISOString()
  const sourceUrl = bestSourceUrl(node, surface)
  const sourcePath = bestSourcePath(node, surface)
  const draft = {
    id: `surface-zoom-draft-${ordinal}`,
    ordinal,
    kind: annotationKindForNode(node),
    surface_id: surfaceIdentifier(surface, node.source?.surface_id || node.source?.canvas_id || node.id),
    source_path: sourcePath,
    source_url: sourceUrl,
    coordinate_space: bounds.coordinate_space,
    selector_candidates: selectorCandidates(node),
    text_excerpt: text(node.metadata?.text_excerpt || node.source?.text_excerpt),
    role: roleForNode(node),
    label: labelForNode(node),
    ancestor_chain: ancestorChain(state.tree, node.id).map((ancestor) => labelForNode(ancestor)),
    note: `Review ${labelForNode(node)}`,
    actor: { ...SURFACE_ZOOM_INSPECTOR_ACTOR },
    status: 'draft',
    lifecycle: {
      clearable: true,
      committed_at: null,
      resolved_at: null,
      rejected_at: null,
      recovered_from: null,
    },
    capture: {
      prepare: {},
      restore: {},
    },
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {
      source_node_id: node.id,
      source_node_kind: node.kind,
      source_node_path: node.path,
      canvas_id: canvasIdentifier(node, surface),
      adapter: cloneJson(node.adapter, {}),
      source_ids: cloneJson(node.source, {}),
    },
  }
  if (node.kind === 'point' && node.points?.center) {
    draft.point = cloneJson(node.points.center)
  }
  if (bounds.rect) {
    draft.bounds = bounds.rect
    if (bounds.key === 'viewport_bounds') draft.viewport_bounds = bounds.rect
    if (bounds.key === 'page_bounds') draft.page_bounds = bounds.rect
  }
  state.drafts.push(draft)
  return draft
}

export function buildInspectRequestFromSelectedSurface(state = {}, point = {}) {
  const surface = selectedSurfaceNode(state)
  if (!surface) return null
  const normalizedPoint = {
    x: Number(point.x),
    y: Number(point.y),
    coordinate_space: text(point.coordinate_space, 'viewport'),
  }
  if (!Number.isFinite(normalizedPoint.x) || !Number.isFinite(normalizedPoint.y)) {
    normalizedPoint.x = 0
    normalizedPoint.y = 0
  }
  return {
    surface_binding: {
      surface_id: surfaceIdentifier(surface, state.selectedSurfaceId),
      surface_type: surfaceTypeForClass('aos_canvas_semantic_target'),
      source_path: bestSourcePath(surface, surface),
      source_url: bestSourceUrl(surface, surface),
      subject_id: text(surface.source?.subject_id || surface.id) || null,
      canvas_id: canvasIdentifier(surface, surface),
      window_id: text(surface.source?.window_id) || null,
      tab_id: null,
    },
    point: normalizedPoint,
    active_surface_path: surface.path,
    selected_surface_id: surface.id,
    requested_adapter_type: text(surface.adapter?.type, 'fixture'),
    allowed_target_kinds: [],
  }
}

export function hitTestCandidatesFromSelectedSurface(state = {}) {
  const surface = selectedSurfaceNode(state)
  if (!surface) return []
  return surfaceChildNodes(state).map((node) => {
    const bounds = bestBoundsForNode(state.tree, node, surface)
    const normalizedBounds = bounds.rect
      ? {
          [bounds.coordinate_space]: bounds.rect,
          viewport: bounds.coordinate_space === 'viewport' ? bounds.rect : node.bounds?.viewport_local ?? node.bounds?.parent_local,
          parent_local: node.bounds?.parent_local,
          desktop_world: node.bounds?.desktop_world,
          document: node.bounds?.document,
          page: node.bounds?.page,
          image: node.bounds?.image,
          lcs: node.bounds?.lcs_local ?? node.bounds?.lcs,
        }
      : cloneJson(node.bounds, {})
    return {
      id: node.id,
      path: node.path,
      kind: node.kind,
      label: labelForNode(node),
      depth: ancestorChain(state.tree, node.id).length - 1,
      ancestor_chain: ancestorChain(state.tree, node.id).map((ancestor) => labelForNode(ancestor)),
      role: roleForNode(node),
      text: text(node.metadata?.text_excerpt || node.source?.text_excerpt),
      source_ids: cloneJson(node.source, {}),
      bounds: normalizedBounds,
      adapter: cloneJson(node.adapter, {}),
      confidence: node.adapter?.confidence,
      child_discovery: node.adapter?.child_discovery,
      capabilities: cloneJson(node.capabilities, {}),
      metadata: cloneJson(node.metadata, {}),
      blockers: node.capabilities?.hit_test === false ? ['candidate_reports_hit_test_unsupported'] : [],
      selector_candidates: selectorCandidates(node),
    }
  })
}

export function inspectSelectedSurfacePoint(state = {}, point = {}, { now = null } = {}) {
  const surface = selectedSurfaceNode(state)
  const request = buildInspectRequestFromSelectedSurface(state, point)
  if (!surface || !request) return null
  const miniMap = surfaceMiniMapViewModel(state)
  const result = buildSurfaceHitTestInspectResult({
    case_id: `surface-zoom-inspector-point-${request.point.x}-${request.point.y}`,
    surface_class: 'aos_canvas_semantic_target',
    request,
    surface: {
      selected_surface_path: surface.path,
      surface_id: request.surface_binding.surface_id,
      surface_type: request.surface_binding.surface_type,
      source_ids: cloneJson(surface.source, {}),
      viewport: {
        width: miniMap?.viewport?.width ?? 0,
        height: miniMap?.viewport?.height ?? 0,
        scroll_x: 0,
        scroll_y: 0,
        zoom: 1,
        scale: 1,
        view_mode: 'surface_zoom_inspector_fixture',
      },
      bounds: cloneJson(surface.bounds, {}),
      adapter: cloneJson(surface.adapter, {}),
      adapter_fixture_only: true,
      content_fingerprint: state.tree?.source?.fingerprint ?? state.tree?.created_at ?? null,
    },
    adapter_response: {
      adapter: {
        id: text(surface.adapter?.id, 'surface-zoom-inspector-fixture'),
        type: text(surface.adapter?.type, 'fixture'),
        fixture_only: true,
      },
      candidates: hitTestCandidatesFromSelectedSurface(state),
    },
    created_at: now || new Date().toISOString(),
    notes: ['surface_zoom_inspector_fixture_only'],
  })
  if (result.selected_candidate) {
    state.selectedNodeId = result.selected_candidate.id
  }
  if (result.annotation_draft) {
    const ordinal = state.drafts.length + 1
    result.annotation_draft = {
      ...result.annotation_draft,
      id: `surface-zoom-hit-test-draft-${ordinal}`,
      ordinal,
      metadata: {
        ...result.annotation_draft.metadata,
        created_from: 'surface_hit_test_inspect',
        source_node_id: result.selected_candidate.id,
        source_node_path: result.selected_candidate.path,
      },
    }
    result.verification_seed = verificationSeedFromInspectResult(result)
    state.drafts.push(result.annotation_draft)
  }
  state.lastInspect = result
  return result
}

export function draftsGroupedBySelectedSurface(state = {}) {
  const surface = selectedSurfaceNode(state)
  const surfaceId = surfaceIdentifier(surface, state.selectedSurfaceId)
  return {
    surface_id: surfaceId,
    surface_label: surface?.label || surfaceId,
    drafts: state.drafts.filter((draft) => draft.surface_id === surfaceId),
  }
}

export function surfaceZoomInspectorSnapshot(state = {}) {
  const surface = selectedSurfaceNode(state)
  const selected = selectedNode(state)
  const details = nodeDetailsViewModel(state)
  const activeSecondaryView = SURFACE_ZOOM_SECONDARY_VIEWS.includes(state.activeSecondaryView) ? state.activeSecondaryView : 'targets'
  const preview = markdownPreviewViewModel(state)
  return {
    schema_version: state.schema_version || SURFACE_ZOOM_INSPECTOR_SCHEMA_VERSION,
    outer_tree: surfaceZoomOuterTree(state),
    selected_surface: surface?.id || null,
    selected_surface_label: surface?.label || null,
    selected_node: selected?.id || null,
    selected_node_label: selected?.label || null,
    overlay_visible: state.overlayVisible !== false,
    label_density: SURFACE_ZOOM_LABEL_DENSITY_MODES.includes(state.labelDensity) ? state.labelDensity : 'selected_only',
    map_display_mode: normalizedDisplayMode(state.mapDisplayMode, 'overlay'),
    markdown_preview: preview,
    selected_line_range: preview.selected_line_range,
    highlighted_source_lines: preview.highlighted_source_lines,
    inspect_status: state.lastInspect?.summary?.status || 'not_inspected',
    active_secondary_view: activeSecondaryView,
    selected_target_summary: details ? {
      id: details.id,
      label: details.label,
      kind: details.kind,
      role: details.role,
      source_summary: details.source_summary,
      bounds_summary: details.bounds_summary,
      last_hit_test_status: state.lastInspect?.summary?.status || 'not_inspected',
    } : null,
    map_view: {
      mode: ['fit', 'manual'].includes(state.mapView?.mode) ? state.mapView.mode : 'fit',
      zoom: Number.isFinite(Number(state.mapView?.zoom)) ? state.mapView.zoom : 1,
    },
    layout: {
      responsive: true,
      document_horizontal_overflow_guard: true,
      primary_map_frame_internal_scroll: false,
      raw_json_collapsible: true,
      active_secondary_view: activeSecondaryView,
      normal_default_scroll_regions: ['inspector-or-secondary-active-view'],
    },
    mini_map: surfaceMiniMapViewModel(state),
    target_navigator: targetNavigatorViewModel(state),
    node_details: details,
    draft_group: draftsGroupedBySelectedSurface(state),
    last_inspect: cloneJson(state.lastInspect, null),
  }
}
