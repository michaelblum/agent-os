// surface-inspector — Content factory for the toolkit's canvas debug panel.
//
// Renders the live list of canvases the daemon knows about plus a spatial
// minimap of displays + canvas overlays. Reacts to canvas_lifecycle events
// to stay current. Subscribes via the host's manifest.requires entry.
//
// Consumer-published object marks ride on canvas_object.marks — see
// packages/toolkit/components/surface-inspector/marks/ and
// docs/archive/superpowers/plans/2026-04-18-surface-inspector-pivot.md.

import { emit, esc } from '../../runtime/bridge.js'
import { evalCanvas, mutateSelf, spawnChild } from '../../runtime/canvas.js'
import { canvasLifecycleCanvasID, mergeCanvasLifecycleCanvas } from '../../runtime/canvas-lifecycle.js'
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js'
import { createFixedSidebarPane } from '../../panel/layouts/split-pane.js'
import { cloneFrame, resizeFrameFromTopLeft } from '../../panel/placement.js'
import { subscribe, unsubscribe } from '../../runtime/subscribe.js'
import {
  nativeToDesktopWorldPoint,
  nativeToDesktopWorldRect,
  computeMinimapLayout,
  normalizeDisplays,
  projectPointToMinimap,
  rectFromAt,
  resolveCanvasFrames,
} from '../../runtime/spatial.js'
import { normalizeMarks } from './marks/normalize.js'
import { createMarksState, applySnapshot, evictCanvas } from './marks/reconcile.js'
import { createScheduler } from './marks/scheduler.js'
import { renderMinimapMark } from './marks/render.js'
import { canvasActionAttrs, inspectorControlAttrs } from './semantics.js'
import {
  addSurfaceInspectorComment,
  applySurfaceInspectorRevealResult,
  buildNativeAxElementSurfaceInspectorCandidate,
  buildNativeWindowSurfaceInspectorCandidate,
  buildSurfaceInspectorAnnotationSnapshotArtifact,
  buildSurfaceInspectorAnnotationTreeRows,
  buildSurfaceInspectorSnapshotPayload,
  chooseSurfaceInspectorAnnotationCandidate,
  computeSurfaceInspectorActiveEdge,
  createSurfaceInspectorAnnotationState,
  deleteSurfaceInspectorComment,
  hasSurfaceInspectorAnnotations,
  clearSurfaceInspectorAnnotationScope,
  jumpSurfaceInspectorAnnotationScope,
  markSurfaceInspectorAnnotationProjectionsStale,
  pinSurfaceInspectorFrame,
  popSurfaceInspectorAnnotationScope,
  refreshSurfaceInspectorAnnotationProjectionsFromEvidence,
  selectSurfaceInspectorAnnotationFrame,
  setSurfaceInspectorAnnotationMode,
  setSurfaceInspectorHoverCandidate,
  unpinSurfaceInspectorFrame,
  updateSurfaceInspectorComment,
} from '../../workbench/surface-inspector-annotations.js'
import {
  applyMouseEffectsInput,
  clearMouseEffectsState,
  createMouseEffectsState,
  mouseEffectsNeedAnimationFrame,
  renderMinimapCursor,
  renderMouseEffectsOverlay,
  sweepMouseEffectsState,
} from './mouse-effects.js'
import { computeInspectorTree } from './tree.js'
import {
  applyInputRegionMessage,
  applyStageLayerRegistryMessage,
  buildSurfaceResourceSnapshot,
  createSurfaceResourceState,
  removeSurfaceResourcesForCanvas,
} from './surface-resources.js'
import { buildSemanticTargetProjectionAdapterResult } from '../../workbench/annotation-projection.js'
import {
  buildAnnotationOverlayRenderPlan,
  surfaceInspectorAnnotationStateToSession,
} from '../../workbench/annotation-overlay-renderer.js'
import {
  BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
  buildBrowserDomProjectionAdapterResult,
} from '../../workbench/browser-dom-element-picker.js'

export {
  nativeToDesktopWorldPoint,
  nativeToDesktopWorldRect,
  computeMinimapLayout,
  normalizeDisplays,
  projectPointToMinimap,
  rectFromAt,
  resolveCanvasFrames,
} from '../../runtime/spatial.js'

const SELF_ID = (typeof window !== 'undefined' && (window.__aosCanvasId || window.__aosSurfaceCanvasId)) || 'surface-inspector'
const TINT_COLORS = [
  'rgba(80, 190, 255, 0.28)',
  'rgba(80, 255, 120, 0.26)',
  'rgba(255, 200, 60, 0.24)',
  'rgba(200, 80, 255, 0.24)',
  'rgba(255, 140, 60, 0.24)',
]
const TINT_OVERLAY_ID = '__aos_canvas_inspector_tint__'
const ANNOTATION_OVERLAY_ID = '__aos_surface_inspector_annotation_overlay__'
const TREE_INDENT_PX = 12
const SEE_BUNDLE_HOTKEY_LABEL = 'ctrl+opt+c'
const LIST_PANE_CLOSED_HEIGHT = 28
const LIST_PANE_OPEN_HEIGHT = 240
const MINIMAP_PANE_MAX_HEIGHT = 260
const COMMENT_BLUE = '#58c4ff'
const FRAME_GOLD = '#f4c542'
const ANNOTATION_ACTION_CANVAS_SIZE = 32
const ANNOTATION_ACTION_CANVAS_GAP = 6
const ANNOTATION_ACTION_CONTROL_PATH = './annotation-action-control/index.html'
const ANNOTATION_HIT_LAYER_PATH = './annotation-hit-layer/index.html'

function escapeHTML(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function rectToAt(rect) {
  if (!rect) return null
  return [rect.x, rect.y, rect.w, rect.h]
}

function normalizeDisplayRect(rect = null) {
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const w = Number(rect.w ?? rect.width)
  const h = Number(rect.h ?? rect.height)
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

function unionDisplayRects(rects = []) {
  const usable = rects.map((rect) => normalizeDisplayRect(rect)).filter(Boolean)
  if (usable.length === 0) return null
  const minX = Math.min(...usable.map((rect) => rect.x))
  const minY = Math.min(...usable.map((rect) => rect.y))
  const maxX = Math.max(...usable.map((rect) => rect.x + rect.w))
  const maxY = Math.max(...usable.map((rect) => rect.y + rect.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function buildAnnotationHitLayerFrame(regions = []) {
  if (!Array.isArray(regions) || regions.length === 0) return null
  const frameRect = unionDisplayRects(regions.map((region) => region?.rect))
  if (!frameRect) return null
  const frame = [
    Math.round(frameRect.x),
    Math.round(frameRect.y),
    Math.max(1, Math.round(frameRect.w)),
    Math.max(1, Math.round(frameRect.h)),
  ]
  return frame.every(Number.isFinite) ? frame : null
}

export function projectAnnotationRectToMinimap(layout, rect, {
  displays = [],
  coordinateSpace = 'native_display',
} = {}) {
  const source = normalizeDisplayRect(rect)
  if (!source) return null
  const space = String(coordinateSpace || 'native_display')
  const desktopRect = space === 'desktop_world'
    ? source
    : nativeToDesktopWorldRect(source, displays)
  if (!desktopRect) return null
  const topLeft = projectPointToMinimap(layout, { x: desktopRect.x, y: desktopRect.y })
  const bottomRight = projectPointToMinimap(layout, { x: desktopRect.x + desktopRect.w, y: desktopRect.y + desktopRect.h })
  if (!topLeft || !bottomRight) return null
  const x = Math.min(topLeft.x, bottomRight.x)
  const y = Math.min(topLeft.y, bottomRight.y)
  return {
    x,
    y,
    w: Math.max(2, Math.abs(bottomRight.x - topLeft.x)),
    h: Math.max(2, Math.abs(bottomRight.y - topLeft.y)),
  }
}

function semanticTargetIdentifier(target = {}) {
  return String(target.id || target.target_id || target.semantic_target_id || target.ref || target.do_target || target.data_aos_ref || '').trim()
}

function isBrowserDomElementTarget(target = {}) {
  return target?.kind === 'element_target' || target?.surface_type === 'browser_page' || target?.adapter_id === BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID
}

function browserDomRawTargetFromPin(pin = {}) {
  const metadata = pin.source_tree_node_metadata || {}
  if (isBrowserDomElementTarget(metadata.raw_target)) return metadata.raw_target
  if (isBrowserDomElementTarget(metadata.source_tree_node_metadata?.raw_target)) return metadata.source_tree_node_metadata.raw_target
  if (isBrowserDomElementTarget(metadata.source_tree_node_metadata)) return metadata.source_tree_node_metadata
  if (isBrowserDomElementTarget(metadata)) return metadata
  return null
}

export function buildRevealPayloadForSurfaceInspectorPin(pin = {}) {
  const sourceMetadata = pin.source_tree_node_metadata && typeof pin.source_tree_node_metadata === 'object'
    ? pin.source_tree_node_metadata
    : {}
  const fallback = {
    adapter_id: pin.adapter_id,
    subject_id: pin.subject_id,
    subject_path: Array.isArray(pin.subject_path) ? [...pin.subject_path] : [],
    root_id: pin.root_id,
    root_path: Array.isArray(pin.projection?.root_path) ? [...pin.projection.root_path] : [],
    owner_canvas_id: pin.root_id || sourceMetadata.canvas_id || sourceMetadata.surface,
    canvas_id: sourceMetadata.canvas_id || pin.root_id,
    target_id: sourceMetadata.target_id || sourceMetadata.id || pin.subject_id,
    semantic_target_id: sourceMetadata.semantic_target_id || sourceMetadata.target_id || sourceMetadata.id || pin.subject_id,
    data_aos_ref: sourceMetadata.data_aos_ref || sourceMetadata.aos_ref,
    aos_ref: sourceMetadata.aos_ref || sourceMetadata.data_aos_ref,
    do_target: sourceMetadata.do_target,
    selector: sourceMetadata.selector,
    selector_candidates: Array.isArray(sourceMetadata.selector_candidates) ? [...sourceMetadata.selector_candidates] : [],
    source_path: sourceMetadata.source_path,
    source_url: sourceMetadata.source_url,
    source_tree_node_metadata: sourceMetadata,
    prior_projection: pin.projection,
  }
  if (pin.adapter_id !== BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID) return fallback
  const rawTarget = browserDomRawTargetFromPin(pin)
  if (!rawTarget) return fallback
  const target = {
    ...rawTarget,
    id: rawTarget.id || pin.subject_id,
    subject_id: rawTarget.subject_id || rawTarget.id || pin.subject_id,
    adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
    kind: 'element_target',
    surface_id: rawTarget.surface_id || pin.root_id || pin.source_tree_node_metadata?.surface_id,
    surface_type: 'browser_page',
    projection_precision: 'browser_dom_element',
  }
  return {
    ...target,
    source_tree_node_metadata: {
      ...target,
      raw_target: rawTarget,
      precision: 'browser_dom_element',
    },
  }
}

export function buildSurfaceInspectorTargetNodeForAnnotation(canvasId, target = {}, options = {}) {
  if (isBrowserDomElementTarget(target)) {
    const rawTarget = {
      ...target,
      surface_id: target.surface_id || canvasId,
      surface_type: 'browser_page',
      kind: 'element_target',
    }
    const projection = buildBrowserDomProjectionAdapterResult({
      ...rawTarget,
    }, {
      refreshed_at: target.refreshed_at || options.refreshed_at || new Date().toISOString(),
      provenance_source_payload_id: target.payload_id || target.id,
    })
    return {
      id: projection.subject_id,
      subject_id: projection.subject_id,
      subject_path: projection.subject_path,
      label: target.accessible_name || target.label || target.preferred_selector || projection.subject_id,
      root_id: target.surface_id || canvasId,
      root_label: target.surface_id || canvasId,
      adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
      projection,
      source_tree_node_metadata: {
        ...rawTarget,
        raw_target: rawTarget,
        surface_type: 'browser_page',
        precision: 'browser_dom_element',
      },
      has_children: false,
      pinned: Boolean(options.findPinForCandidateId?.(projection.subject_id)),
    }
  }
  const projection = buildSemanticTargetProjectionAdapterResult(target, {
    canvas_id: canvasId,
    refreshed_at: target.refreshed_at || options.refreshed_at || new Date().toISOString(),
    provenance_source_payload_id: target.payload_id,
  })
  return {
    id: projection.subject_id,
    subject_id: projection.subject_id,
    subject_path: projection.subject_path,
    label: target.name || target.label || target.role || projection.subject_id,
    root_id: canvasId,
    root_label: canvasId,
    adapter_id: 'aos-toolkit-semantic-target',
    projection,
    source_tree_node_metadata: target,
    has_children: false,
    pinned: Boolean(options.findPinForCandidateId?.(projection.subject_id)),
  }
}

function rowIndentStyle(depth) {
  return `--tree-indent:${8 + depth * TREE_INDENT_PX}px`
}

function formatAt(at) {
  const [x, y, w, h] = Array.isArray(at) ? at : [0, 0, 0, 0]
  return `${Math.round(w)}\u00d7${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`
}

function formatBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length < 4) return 'n/a'
  return bounds.map((value) => Math.round(Number(value) || 0)).join(',')
}

function renderCanvasStatusPrefix(c = {}) {
  const interactive = !!c.interactive
  const connectionScoped = c.scope === 'connection'
  const ttl = Number.isFinite(Number(c.ttl)) ? Math.round(Number(c.ttl)) : null
  const interactionTitle = interactive ? 'interactive canvas' : 'passive canvas'
  const scopeTitle = connectionScoped ? 'connection-scoped canvas' : 'global canvas'
  const ttlTitle = ttl == null ? 'no time-to-live' : `time-to-live: ${ttl}s`
  const title = `${interactionTitle}; ${scopeTitle}; ${ttlTitle}`
  return `<span class="canvas-status-prefix" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">`
    + `<span class="status-dot interaction ${interactive ? 'active' : 'inactive'}" title="${escapeHTML(interactionTitle)}"></span>`
    + `<span class="status-dot scope ${connectionScoped ? 'active' : 'inactive'}" title="${escapeHTML(scopeTitle)}"></span>`
    + `<span class="status-dot ttl ${ttl == null ? 'inactive' : 'active'}" title="${escapeHTML(ttlTitle)}"></span>`
    + `</span>`
}

function renderCanvasActionButtons(canvasId, options = {}) {
  const tintedIds = options.tintedIds || new Set()
  const statsIds = options.statsIds || new Set()
  const tintClass = tintedIds.has(canvasId) ? 'btn tint-btn active' : 'btn tint-btn'
  const statsClass = statsIds.has(canvasId) ? 'btn stats-btn active' : 'btn stats-btn'
  return `<button class="${statsClass}" data-id="${escapeHTML(canvasId)}" ${canvasActionAttrs(canvasId, 'stats', { pressed: statsIds.has(canvasId) })}>stats</button>`
    + `<button class="${tintClass}" data-id="${escapeHTML(canvasId)}" ${canvasActionAttrs(canvasId, 'tint', { pressed: tintedIds.has(canvasId) })}>tint</button>`
    + `<button class="btn remove-btn" data-id="${escapeHTML(canvasId)}" ${canvasActionAttrs(canvasId, 'remove')}>\u2715</button>`
}

export function renderCursorToggleRowHTML(options = {}) {
  const enabled = !!options.enabled
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0
  const toggleClass = enabled ? 'btn cursor-toggle-btn active' : 'btn cursor-toggle-btn'
  const toggleLabel = enabled ? 'on' : 'off'
  return `<div class="tree-row cursor-toggle-row" style="${rowIndentStyle(depth)}">`
    + `<span class="cursor-toggle-label">minimap cursor</span>`
    + `<span class="cursor-toggle-state">${enabled ? 'live' : 'hidden'}</span>`
    + `<span class="canvas-flags">`
    + `<button class="${toggleClass}" data-enabled="${enabled ? '1' : '0'}" ${inspectorControlAttrs('minimap-cursor', {
      name: 'Minimap cursor',
      action: 'toggle_minimap_cursor',
      pressed: enabled,
    })}>${toggleLabel}</button>`
    + `</span>`
    + `</div>`
}

export function renderMouseEventsToggleRowHTML(options = {}) {
  const enabled = !!options.enabled
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0
  const toggleClass = enabled ? 'btn mouse-events-toggle-btn active' : 'btn mouse-events-toggle-btn'
  const toggleLabel = enabled ? 'on' : 'off'
  return `<div class="tree-row cursor-toggle-row" style="${rowIndentStyle(depth)}">`
    + `<span class="cursor-toggle-label">mouse events</span>`
    + `<span class="cursor-toggle-state">${enabled ? 'live' : 'hidden'}</span>`
    + `<span class="canvas-flags">`
    + `<button class="${toggleClass}" data-enabled="${enabled ? '1' : '0'}" ${inspectorControlAttrs('mouse-events', {
      name: 'Mouse events',
      action: 'toggle_mouse_events',
      pressed: enabled,
    })}>${toggleLabel}</button>`
    + `</span>`
    + `</div>`
}

export function renderAnnotationModeToggleRowHTML(options = {}) {
  const enabled = !!options.enabled
  const depth = Number.isFinite(Number(options.depth)) ? Number(options.depth) : 0
  const toggleClass = enabled ? 'btn annotation-mode-toggle-btn active' : 'btn annotation-mode-toggle-btn'
  const label = `Annotation Mode: ${enabled ? 'on' : 'off'}`
  return `<div class="tree-row cursor-toggle-row annotation-mode-row" style="${rowIndentStyle(depth)}">`
    + `<span class="cursor-toggle-label">annotation mode</span>`
    + `<span class="cursor-toggle-state">${enabled ? 'active' : 'off'}</span>`
    + `<span class="canvas-flags">`
    + `<button class="${toggleClass}" data-enabled="${enabled ? '1' : '0'}" title="${escapeHTML(label)}" ${inspectorControlAttrs('annotation-mode', {
      name: label,
      action: 'toggle_annotation_mode',
      pressed: enabled,
    })}>${enabled ? 'on' : 'off'}</button>`
    + `</span>`
    + `</div>`
}

export function buildSemanticTargetsRequestMessages(canvases = [], options = {}) {
  const selfId = options.selfId || SELF_ID
  const reason = options.reason || 'surface_inspector_refresh'
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  const minIntervalMs = Number.isFinite(Number(options.minIntervalMs)) ? Number(options.minIntervalMs) : 1000
  const force = options.force === true
  const requestedAtByCanvas = options.requestedAtByCanvas instanceof Map ? options.requestedAtByCanvas : new Map()
  const messages = []
  for (const canvas of Array.isArray(canvases) ? canvases : []) {
    const target = String(canvas?.id || '').trim()
    if (!target || target === selfId || canvas?.suspended === true) continue
    const lastRequestAt = Number(requestedAtByCanvas.get(target) || 0)
    if (!force && lastRequestAt && now - lastRequestAt < minIntervalMs) continue
    requestedAtByCanvas.set(target, now)
    messages.push({
      target,
      message: {
        type: 'canvas_inspector.semantic_targets.request',
        requester_canvas_id: selfId,
        reply_to: selfId,
        reason,
        requested_at: new Date(now).toISOString(),
      },
    })
  }
  return messages
}

export function buildAnnotationActionControlCanvasRecords(candidate = null, options = {}) {
  const rect = normalizeDisplayRect(candidate?.projection?.visible_display_rect || candidate?.projection?.display_space_rect)
  if (!candidate?.projection?.can_project_display_overlay || !rect) return []
  const selfId = options.selfId || SELF_ID
  const size = Number.isFinite(Number(options.size)) ? Number(options.size) : ANNOTATION_ACTION_CANVAS_SIZE
  const gap = Number.isFinite(Number(options.gap)) ? Number(options.gap) : ANNOTATION_ACTION_CANVAS_GAP
  const inset = Number.isFinite(Number(options.inset)) ? Number(options.inset) : 8
  const actions = [
    {
      action: 'add_comment',
      label: 'Add comment to frame candidate',
      icon: 'plus',
      accent: 'blue',
    },
  ]
  actions.push({
    action: 'pin_frame',
    label: candidate.pinned ? 'Remove frame anchor' : 'Create frame anchor',
    icon: 'frame_anchor',
    accent: 'gold',
    pressed: Boolean(candidate.pinned),
  })
  const totalHeight = actions.length * size + Math.max(0, actions.length - 1) * gap
  const left = Math.round(rect.x + rect.w - size - inset)
  const top = Math.round(rect.y + (rect.h - totalHeight) / 2)
  return actions.map((item, index) => ({
    ...item,
    id: `${selfId}-annotation-action-${candidate.id}-${item.action}`,
    parent: selfId,
    canvas_id: candidate.id,
    frame: [
      left,
      top + index * (size + gap),
      size,
      size,
    ],
    interactive: true,
    window_level: 'screen_saver',
  }))
}

export function planAnnotationActionControlCanvasSync({
  controls = [],
  existingIds = new Set(),
  managedIds = new Set(),
  frameKeys = new Map(),
} = {}) {
  const normalizedExisting = existingIds instanceof Set ? existingIds : new Set(existingIds)
  const normalizedManaged = managedIds instanceof Set ? managedIds : new Set(managedIds)
  const normalizedFrameKeys = frameKeys instanceof Map ? frameKeys : new Map(Object.entries(frameKeys || {}))
  const nextIds = new Set(controls.map((control) => control.id))
  const creates = []
  const updates = []
  const removes = []
  const nextFrameKeys = new Map(normalizedFrameKeys)

  for (const id of normalizedManaged) {
    if (!nextIds.has(id)) {
      removes.push(id)
      nextFrameKeys.delete(id)
    }
  }

  for (const control of controls) {
    const frameKey = control.frame.join(',')
    const payload = {
      id: control.id,
      frame: control.frame,
      interactive: true,
      window_level: control.window_level,
    }
    if (normalizedExisting.has(control.id)) {
      if (nextFrameKeys.get(control.id) !== frameKey) updates.push(payload)
      nextFrameKeys.set(control.id, frameKey)
    } else if (!normalizedManaged.has(control.id)) {
      creates.push({ control, payload, frameKey })
      nextFrameKeys.set(control.id, frameKey)
    }
  }

  return {
    creates,
    updates,
    removes,
    nextIds,
    nextFrameKeys,
  }
}

export function buildAnnotationScopedHitRegions({ canvases = [], semanticTargetsByCanvas = new Map(), scopeStack = [], selfId = SELF_ID } = {}) {
  const internal = (id) => id === selfId || String(id || '').startsWith(`${selfId}-annotation-action-`) || String(id || '').startsWith(`${selfId}-annotation-hit-layer`)
  const broadRoot = (id) => /^desktop[-_]world$/i.test(String(id || '')) || /^aos-desktop-world-stage$/i.test(String(id || '')) || /^display[-_:]/i.test(String(id || '')) || /^avatar-main$/i.test(String(id || '')) || /^root$/i.test(String(id || ''))
  const parentId = (canvas = {}) => canvas.parent || canvas.parent_id || ''
  const rectForCanvas = (canvas) => normalizeDisplayRect(canvas.visible_display_rect || canvas.display_space_rect || canvas.rect || rectFromAt(canvas.atResolved ?? canvas.at))
  const scope = Array.isArray(scopeStack) ? scopeStack.at(-1) : null
  const visibleCanvases = (Array.isArray(canvases) ? canvases : []).filter((canvas) => !canvas?.suspended && !internal(canvas.id))
  const ids = new Set(visibleCanvases.map((canvas) => canvas.id))
  const canvasRegions = visibleCanvases
    .filter((canvas) => {
      if (broadRoot(canvas.id)) return false
      const parent = parentId(canvas)
      return scope
        ? parent === scope.subject_id
        : (!parent || !ids.has(parent) || broadRoot(parent) || internal(parent))
    })
    .map((canvas) => {
      const rect = rectForCanvas(canvas)
      return rect ? {
        id: canvas.id,
        rect,
        candidate: {
          id: canvas.id,
          subject_id: canvas.id,
          subject_path: scope ? [...(scope.subject_path || [scope.subject_id]), canvas.id] : ['canvas', canvas.id],
          root_id: scope?.root_id || 'main',
          root_label: scope?.root_label || 'main',
          adapter_id: 'aos-canvas-window',
          projection: { status: 'visible', projectable: true, can_project_display_overlay: true, can_reveal: true, visible_display_rect: rect, display_space_rect: rect },
          has_children: visibleCanvases.some((item) => parentId(item) === canvas.id),
        },
      } : null
    })
    .filter(Boolean)
  const semanticEntries = semanticTargetsByCanvas instanceof Map
    ? [...semanticTargetsByCanvas.entries()]
    : Object.entries(semanticTargetsByCanvas || {})
  const semanticRegions = []
  if (scope) {
    for (const [canvasId, targets] of semanticEntries) {
      if (canvasId !== scope.subject_id && canvasId !== scope.root_id) continue
      for (const target of Array.isArray(targets) ? targets : []) {
        const node = buildSurfaceInspectorTargetNodeForAnnotation(canvasId, target)
        const id = node.id
        const rect = normalizeDisplayRect(node.projection?.visible_display_rect || node.projection?.display_space_rect || target.visible_display_rect || target.display_space_rect || target.rect || target.bounds)
        if (!id || !rect) continue
        const parent = target.parent_id || target.parent || ''
        if (canvasId !== scope.subject_id && parent !== scope.subject_id) continue
        semanticRegions.push({
          id,
          rect,
          candidate: {
            ...node,
            subject_path: [...(scope.subject_path || [scope.subject_id]), id],
          },
        })
      }
    }
  }
  return [...canvasRegions, ...semanticRegions]
}

export function buildAnnotationNativeHitRegions({ nativeWindowCandidate = null, nativeAxCandidate = null, scopeStack = [] } = {}) {
  const scope = Array.isArray(scopeStack) ? scopeStack.at(-1) : null
  const candidates = []
  if (!scope && nativeWindowCandidate) candidates.push(nativeWindowCandidate)
  if (scope?.adapter_id === 'macos-ax' && scope.root_kind === 'native_window' && nativeAxCandidate) candidates.push(nativeAxCandidate)
  return candidates
    .map((candidate) => ({ candidate, rect: normalizeDisplayRect(candidate?.projection?.visible_display_rect || candidate?.projection?.display_space_rect || candidate?.display_space_rect || candidate?.rect) }))
    .filter((region) => region.rect && region.candidate?.projection?.can_project_display_overlay !== false)
    .map(({ candidate, rect }) => ({ id: candidate.id, candidate, rect }))
}

export function renderCanvasListToggleButton(options = {}) {
  const collapsed = options.collapsed !== false
  const label = collapsed ? 'Show canvas list' : 'Hide canvas list'
  return `<button class="canvas-list-toggle" type="button" ${inspectorControlAttrs('canvas-list-toggle', {
    name: label,
    action: 'toggle_canvas_list',
    expanded: !collapsed,
  })} title="${escapeHTML(label)}">`
    + `<span class="canvas-list-caret ${collapsed ? '' : 'open'}" aria-hidden="true"></span>`
    + `</button>`
}

function renderSurfaceSegmentRow(segment, depth) {
  return `<div class="tree-row surface-segment" data-display-id="${escapeHTML(segment.display_id)}" style="${rowIndentStyle(depth)}">`
    + `<span class="seg-index">[${escapeHTML(segment.index)}]</span>`
    + `<span class="seg-display">display ${escapeHTML(segment.display_id)}</span>`
    + `<span class="seg-bounds">dw(${escapeHTML(formatBounds(segment.dw_bounds))})</span>`
    + `</div>`
}

function renderSurfaceRow(c, depth, options = {}) {
  const segmentCount = Array.isArray(c.segments) ? c.segments.length : 0
  let html = `<div class="tree-row surface" data-id="${escapeHTML(c.id)}" style="${rowIndentStyle(depth)}">`
  html += renderCanvasStatusPrefix(c)
  html += `<span class="canvas-id">${escapeHTML(c.id)}</span>`
  html += `<span class="canvas-kind">desktop-world</span>`
  html += `<span class="canvas-kind-detail">${segmentCount} segment${segmentCount === 1 ? '' : 's'}</span>`
  html += `<span class="canvas-dims">${formatAt(c.atResolved || c.at)}</span>`
  html += `<span class="canvas-flags">`
  html += renderCanvasActionButtons(c.id, options)
  html += `</span></div>`
  html += (c.segments || []).map((segment) => renderSurfaceSegmentRow(segment, depth + 1)).join('')
  return html
}

export function renderCanvasRow(c, depth = 0, options = {}) {
  if (Array.isArray(c?.segments)) return renderSurfaceRow(c, depth, options)

  const dims = formatAt(c?.atResolved || c?.at)
  const selfId = options.selfId ?? SELF_ID
  const tintedIds = options.tintedIds || new Set()
  const statsIds = options.statsIds || new Set()
  const cls = c?.id === selfId ? 'tree-row canvas self' : 'tree-row canvas'
  let html = `<div class="${cls}" data-id="${escapeHTML(c?.id)}" style="${rowIndentStyle(depth)}">`
  html += renderCanvasStatusPrefix(c)
  html += `<span class="canvas-id">${escapeHTML(c?.id)}</span>`
  html += `<span class="canvas-dims">${dims}</span>`
  html += `<span class="canvas-flags">`
  html += renderCanvasActionButtons(c?.id, { tintedIds, statsIds })
  html += `</span></div>`
  return html
}

function buildTintEvalScript(color) {
  const colorLiteral = color == null ? 'null' : JSON.stringify(color)
  return `(() => {
    const existing = document.getElementById(${JSON.stringify(TINT_OVERLAY_ID)})
    if (existing) existing.remove()
    const color = ${colorLiteral}
    if (!color) return true
    const overlay = document.createElement('div')
    overlay.id = ${JSON.stringify(TINT_OVERLAY_ID)}
    overlay.setAttribute('aria-hidden', 'true')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'background:' + color,
      'box-shadow:inset 0 0 0 4px ' + color,
      'outline:2px solid rgba(255,255,255,0.9)'
    ].join(';')
    ;(document.body || document.documentElement).appendChild(overlay)
    return true
  })()`
}

function buildStatsToggleEvalScript(options = {}) {
  return `(() => {
    if (!window.aosStats || typeof window.aosStats.toggle !== 'function') return false
    window.aosStats.toggle(${JSON.stringify(options)})
    return true
  })()`
}

function buildStatsStatusEvalScript() {
  return `(() => {
    if (!window.aosStats || typeof window.aosStats.status !== 'function') return JSON.stringify({ available: false })
    return JSON.stringify(window.aosStats.status())
  })()`
}

export function buildAnnotationOverlayEvalScript(group = null) {
  const groupLiteral = JSON.stringify(group)
  return `(() => {
    const existing = document.getElementById(${JSON.stringify(ANNOTATION_OVERLAY_ID)})
    const group = ${groupLiteral}
    const overlayFrame = normalizeRect(group?.overlay_frame) || { x: 0, y: 0, width: innerWidth || 0, height: innerHeight || 0 }
    function normalizeRect(rect) {
      if (!rect || typeof rect !== 'object') return null
      const x = Number(rect.x ?? rect.left)
      const y = Number(rect.y ?? rect.top)
      const width = Number(rect.width ?? rect.w)
      const height = Number(rect.height ?? rect.h)
      if (![x, y, width, height].every(Number.isFinite)) return null
      return { x, y, width, height }
    }
    function overlayRectForFrame(framePlan) {
      if (!framePlan || framePlan.status !== 'live') return null
      const rect = normalizeRect(framePlan.rect)
      if (!rect) return null
      const coordinateSpace = String(framePlan.projection?.coordinate_space || 'native_display')
      const local = coordinateSpace === 'local' || coordinateSpace === 'canvas_local' || coordinateSpace === 'target_overlay'
        ? rect
        : { x: rect.x - overlayFrame.x, y: rect.y - overlayFrame.y, width: rect.width, height: rect.height }
      if (local.width <= 0 || local.height <= 0) return null
      return local
    }
    const frames = [
      ...(group?.committed_frames || []).map((item) => ({ ...item, display_kind: 'active-edge' })),
      ...(group?.preview_frames || []),
      ...(group?.hover_candidate ? [group.hover_candidate] : [])
    ].filter((framePlan) => framePlan?.status === 'live' && framePlan?.rect)
    const comments = group?.comment_chips || []
    if (!group || (frames.length === 0 && comments.length === 0)) {
      if (existing) existing.remove()
      return true
    }
    const overlay = existing || document.createElement('div')
    overlay.id = ${JSON.stringify(ANNOTATION_OVERLAY_ID)}
    overlay.replaceChildren()
    overlay.setAttribute('aria-label', 'Surface Inspector annotation overlay')
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483646',
      'font:11px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
    ].join(';')
    frames.forEach((framePlan) => {
      const localRect = overlayRectForFrame(framePlan)
      if (!localRect) return
      const frame = document.createElement('div')
      const opacity = Number.isFinite(Number(framePlan.opacity)) ? Number(framePlan.opacity) : 1
      const status = framePlan.status || 'live'
      const border = framePlan.layer === 'hover'
        ? '2px dashed ${FRAME_GOLD}'
        : (framePlan.layer === 'preview' ? '2px dashed rgba(244,197,66,0.78)' : '2px solid ${FRAME_GOLD}')
      frame.style.cssText = [
        'position:absolute',
        'left:' + Math.round(localRect.x) + 'px',
        'top:' + Math.round(localRect.y) + 'px',
        'width:' + Math.round(localRect.width) + 'px',
        'height:' + Math.round(localRect.height) + 'px',
        'box-sizing:border-box',
        'border:' + border,
        'background:transparent',
        'opacity:' + opacity,
        status === 'live' ? '' : 'filter:grayscale(1)'
      ].join(';')
      frame.setAttribute('data-highlight-kind', framePlan.layer === 'hover' ? 'frame-candidate' : (framePlan.display_kind || framePlan.layer || 'frame'))
      frame.setAttribute('data-projection-status', status)
      if (framePlan.reason) frame.setAttribute('title', framePlan.reason)
      overlay.appendChild(frame)
    })
    comments.forEach((comment, index) => {
      const chip = document.createElement('div')
      chip.textContent = comment.label
      chip.title = comment.text
      chip.style.cssText = [
        'position:absolute',
        'left:8px',
        'top:' + (8 + index * 24) + 'px',
        'max-width:180px',
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        'box-sizing:border-box',
        'border:2px solid ${COMMENT_BLUE}',
        'border-radius:5px',
        'background:#000',
        'color:${COMMENT_BLUE}',
        'padding:2px 6px'
      ].join(';')
      chip.setAttribute('data-comment-id', comment.id)
      chip.setAttribute('data-projection-status', comment.status || 'live')
      overlay.appendChild(chip)
    })
    if (!existing) (document.body || document.documentElement).appendChild(overlay)
    return true
  })()`
}

function buildRevealTargetEvalScript(target = {}) {
  const targetLiteral = JSON.stringify(target)
  return `(() => {
    const target = ${targetLiteral}
    const now = new Date().toISOString()
    try {
      if (window.aosSurfaceInspector && typeof window.aosSurfaceInspector.revealTarget === 'function') {
        return JSON.stringify(window.aosSurfaceInspector.revealTarget(target) || { status: 'unsupported', completed_at: now })
      }
      const selector = [
        target.subject_id ? '[data-semantic-target-id="' + CSS.escape(target.subject_id) + '"]' : '',
        target.subject_id ? '[data-aos-ref="' + CSS.escape(target.subject_id) + '"]' : '',
        target.source_tree_node_metadata?.target_id ? '[data-semantic-target-id="' + CSS.escape(target.source_tree_node_metadata.target_id) + '"]' : '',
        target.source_tree_node_metadata?.data_aos_ref ? '[data-aos-ref="' + CSS.escape(target.source_tree_node_metadata.data_aos_ref) + '"]' : '',
        target.source_tree_node_metadata?.aos_ref ? '[data-aos-ref="' + CSS.escape(target.source_tree_node_metadata.aos_ref) + '"]' : '',
        target.source_tree_node_metadata?.selector || '',
        target.source_tree_node_metadata?.preferred_selector || '',
        ...(Array.isArray(target.source_tree_node_metadata?.selector_candidates) ? target.source_tree_node_metadata.selector_candidates : []),
        target.do_target ? '[data-aos-ref="' + CSS.escape(target.do_target) + '"]' : '',
        target.do_target ? '[data-aos-action="' + CSS.escape(target.do_target) + '"]' : '',
        target.subject_id ? '[data-aos-action="' + CSS.escape(target.subject_id) + '"]' : ''
      ].filter(Boolean).join(',')
      const element = selector ? document.querySelector(selector) : null
      if (!element) return JSON.stringify({ status: 'target_absent', blocker_reason: 'semantic_target_not_found', completed_at: now })
      const before = element.getBoundingClientRect()
      const alreadyVisible = before && before.bottom >= 0 && before.right >= 0 && before.top <= innerHeight && before.left <= innerWidth
      if (!alreadyVisible && typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
      }
      element.focus?.({ preventScroll: true })
      const rect = element.getBoundingClientRect()
      const visible = rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth
      return JSON.stringify({
        status: alreadyVisible ? 'already_visible' : (visible ? 'revealed' : 'blocked'),
        blocker_reason: visible ? '' : 'scroll_into_view_did_not_make_target_visible',
        completed_at: now,
        projection: {
          status: visible ? 'visible' : 'clipped',
          can_reveal: true,
          display_space_rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
          local_space_rect: { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.width, h: rect.height },
          refreshed_at: now
        }
      })
    } catch (error) {
      return JSON.stringify({ status: 'adapter_error', blocker_reason: String(error), completed_at: now })
    }
  })()`
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function verticalMargins(element) {
  if (!element) return 0
  const style = window.getComputedStyle?.(element)
  if (!style) return 0
  return (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0)
}

export default function CanvasInspector() {
  let contentEl = null
  let minimapPaneEl = null
  let listPaneEl = null
  let splitController = null
  let currentSelfFrame = null
  let pendingSelfResizeFrame = 0
  let displays = []
  let canvases = []
  let cursor = { x: 0, y: 0, valid: false }
  let nativeCursor = { x: 0, y: 0, valid: false }
  let latestNativeWindowEvent = null
  let latestNativeAxElementEvent = null
  let cursorTrackingEnabled = false
  let mouseEventsEnabled = false
  let inputSubscriptionActive = false
  let inputSubscriptionEvents = []
  let tintedIds = new Set()
  let tintMap = new Map()
  let statsIds = new Set()
  let semanticTargetsByCanvas = new Map()
  const semanticTargetRequestAtByCanvas = new Map()
  let tintIndex = 0
  let eventCount = 0
  let resizeObserver = null
  let lastMinimapWidth = 0
  let lastMinimapLayout = null
  let lastTintError = null
  let dynamicAnimationFrame = 0
  let bundleHotkeyLabel = SEE_BUNDLE_HOTKEY_LABEL
  let listCollapsed = true
  let bundleCapture = {
    status: 'idle',
    message: `bundle ${bundleHotkeyLabel}`,
    bundlePath: null,
    bundleJSONPath: null,
    trigger: null,
    at: null,
  }
  let annotationState = createSurfaceInspectorAnnotationState()

  const marksState = createMarksState()
  const surfaceResourceState = createSurfaceResourceState()
  const marksScheduler = createScheduler({
    state: marksState,
    onChange: () => rerender(),
  })
  const mouseEffectsState = createMouseEffectsState()
  const annotationOverlayCanvasIds = new Set()
  const annotationOverlaySignatures = new Map()
  const annotationActionControlCanvasIds = new Set()
  const annotationActionControlFrames = new Map()
  let annotationHitLayerCanvasId = ''
  let annotationHitLayerSignature = ''
  let annotationHitLayerFrameKey = ''
  let pendingAnnotationHoverFrame = 0
  let pendingAnnotationProjectionSettleTimer = 0
  let annotationHoverUpdateReason = ''
  let annotationHoverStats = { create: 0, update: 0, remove: 0 }
  let annotationOverlayStats = { create: 0, update: 0, clear: 0 }

  function semanticTargetId(target = {}) {
    return semanticTargetIdentifier(target)
  }

  function syncDebugState() {
    const hitRegions = annotationHitRegions()
    const surfaceResources = buildSurfaceResourceSnapshot(surfaceResourceState, { canvases })
    const annotationSnapshotArtifact = buildAnnotationSnapshotArtifact({ trigger: 'state_sync' })
    window.__canvasInspectorState = {
      displays,
      canvases,
      eventCount,
      tintedIds: [...tintedIds],
      tintMap: Object.fromEntries(tintMap),
      statsIds: [...statsIds],
      semanticTargetsByCanvas: Object.fromEntries(semanticTargetsByCanvas),
      cursor,
      nativeCursor,
      latestNativeWindowCandidate: nativeWindowCandidateForAnnotation(),
      latestNativeAxCandidate: nativeAxCandidateForAnnotation(),
      cursorTrackingEnabled,
      mouseEventsEnabled,
      inputSubscriptionActive,
      lastTintError,
      bundleHotkeyLabel,
      bundleCapture,
      annotation: buildSurfaceInspectorSnapshotPayload(annotationState),
      annotation_snapshot_artifact: annotationSnapshotArtifact,
      annotationScopeStackIds: annotationScopeStackIds(),
      annotationHitLayerCanvasId,
      annotationHitRegionCount: hitRegions.length,
      annotationHitRegionIds: hitRegions.map((region) => region.id),
      annotationHoverCandidateId: annotationState.last_hover_candidate?.id || null,
      annotationLastHoverUpdateReason: annotationHoverUpdateReason,
      annotationOverlayTargetCanvasIds: [...annotationOverlayCanvasIds],
      annotationActionControlEmitCounts: { ...annotationHoverStats },
      annotationOverlayEvalCounts: { ...annotationOverlayStats },
      annotationPendingHoverRefresh: Boolean(pendingAnnotationHoverFrame),
      annotationPendingProjectionSettle: Boolean(pendingAnnotationProjectionSettleTimer),
      annotationProjectionRefresh: annotationState.projection_refresh,
      annotationActionControlCanvases: annotationActionControlsForHover(),
      mouseEffects: {
        active: mouseEffectsState.active,
        transients: mouseEffectsState.transients,
      },
      marksByCanvas: Object.fromEntries(
        [...marksState.marksByCanvas].map(([k, v]) => [k, v.marks]),
      ),
      surfaceResources,
      surfaceResourceCounts: surfaceResources.counts,
    }
  }

  function buildAnnotationSnapshotArtifact(options = {}) {
    return buildSurfaceInspectorAnnotationSnapshotArtifact(annotationState, {
      captured_at: options.captured_at || new Date().toISOString(),
      trigger: options.trigger || 'manual',
      source_canvas_id: SELF_ID,
      surface_inspector_frame: currentFrameFallback(),
      assets: options.assets || {},
    })
  }

  function stopDynamicAnimationFrame() {
    if (dynamicAnimationFrame) {
      window.cancelAnimationFrame(dynamicAnimationFrame)
      dynamicAnimationFrame = 0
    }
  }

  function ensureDynamicAnimationFrame() {
    if (dynamicAnimationFrame) return
    dynamicAnimationFrame = window.requestAnimationFrame(() => {
      dynamicAnimationFrame = 0
      syncMinimapDynamicLayer(Date.now())
    })
  }

  function renderMinimapDynamicLayer(now = Date.now()) {
    if (!lastMinimapLayout) return ''
    if (annotationState.annotation_mode.active) return ''
    let html = ''
    if (cursorTrackingEnabled && cursor?.valid) {
      const projectedCursor = projectPointToMinimap(lastMinimapLayout, cursor)
      if (projectedCursor) html += renderMinimapCursor(projectedCursor)
    }
    if (mouseEventsEnabled) {
      html += renderMouseEffectsOverlay(mouseEffectsState, lastMinimapLayout, now)
    }
    return html
  }

  function syncMinimapDynamicLayer(now = Date.now()) {
    if (!contentEl) return
    const layer = contentEl.querySelector('.minimap-dynamic-layer')
    if (!layer) {
      lastMinimapLayout = null
      stopDynamicAnimationFrame()
      return
    }
    if (sweepMouseEffectsState(mouseEffectsState, now)) syncDebugState()
    layer.innerHTML = renderMinimapDynamicLayer(now)
    if (mouseEventsEnabled && mouseEffectsNeedAnimationFrame(mouseEffectsState, now)) {
      ensureDynamicAnimationFrame()
    } else {
      stopDynamicAnimationFrame()
    }
  }

  async function clearControlledAnnotationOverlay(canvasId) {
    if (!canvasId || canvasId === SELF_ID) return
    try {
      annotationOverlayStats.clear += 1
      await evalCanvas(canvasId, buildAnnotationOverlayEvalScript())
      annotationOverlaySignatures.delete(canvasId)
    } catch {}
  }

  function annotationOverlaySignature(group = null) {
    return group?.signature || ''
  }

  function syncControlledAnnotationDisplayOverlays() {
    const nextCanvasIds = new Set()
    if (annotationState.annotation_mode.active) {
      const session = surfaceInspectorAnnotationStateToSession(annotationState)
      const plan = buildAnnotationOverlayRenderPlan(session)
      const groupsByCanvas = new Map(plan.groups
        .filter((group) => group.target.canvas_id && group.target.canvas_id !== SELF_ID)
        .map((group) => [group.target.canvas_id, group]))
      for (const canvas of minimapCanvases()) {
        const group = groupsByCanvas.get(canvas.id)
        if (!group) continue
        nextCanvasIds.add(canvas.id)
        const signature = annotationOverlaySignature(group)
        if (annotationOverlaySignatures.get(canvas.id) === signature) continue
        if (annotationOverlaySignatures.has(canvas.id)) annotationOverlayStats.update += 1
        else annotationOverlayStats.create += 1
        annotationOverlaySignatures.set(canvas.id, signature)
        evalCanvas(canvas.id, buildAnnotationOverlayEvalScript({
          ...group,
          overlay_frame: normalizeDisplayRect(rectFromAt(canvas.atResolved || canvas.at)),
        })).catch(() => {
          annotationOverlaySignatures.delete(canvas.id)
        })
      }
    }
    for (const canvasId of annotationOverlayCanvasIds) {
      if (!nextCanvasIds.has(canvasId)) clearControlledAnnotationOverlay(canvasId)
    }
    annotationOverlayCanvasIds.clear()
    for (const canvasId of nextCanvasIds) annotationOverlayCanvasIds.add(canvasId)
  }

  function cancelPendingAnnotationHoverRefresh() {
    if (!pendingAnnotationHoverFrame) return
    window.cancelAnimationFrame(pendingAnnotationHoverFrame)
    pendingAnnotationHoverFrame = 0
  }

  function cancelPendingAnnotationProjectionSettle() {
    if (!pendingAnnotationProjectionSettleTimer) return
    window.clearTimeout(pendingAnnotationProjectionSettleTimer)
    pendingAnnotationProjectionSettleTimer = 0
  }

  function emitAnnotationModeState(reason = 'state_sync') {
    emit('canvas_inspector.annotation_state', {
      canvas_id: SELF_ID,
      annotation_mode_active: Boolean(annotationState.annotation_mode.active),
      reason,
      snapshot_version: annotationState.snapshot_version,
    })
  }

  function annotationActionControlsForHover() {
    if (!annotationState.annotation_mode.active) return []
    return buildAnnotationActionControlCanvasRecords(annotationState.last_hover_candidate, { selfId: SELF_ID })
  }

  function annotationCurrentScope() {
    return annotationState.annotation_scope_stack?.at?.(-1) || null
  }

  function nativeWindowCandidateForAnnotation() {
    return buildNativeWindowSurfaceInspectorCandidate(latestNativeWindowEvent)
  }

  function nativeAxCandidateForAnnotation() {
    const scope = annotationCurrentScope()
    if (scope?.adapter_id !== 'macos-ax' || scope.root_kind !== 'native_window') return null
    return buildNativeAxElementSurfaceInspectorCandidate(latestNativeAxElementEvent, {
      selected_root: scope,
      window: latestNativeWindowEvent,
    })
  }

  function annotationScopeStackIds() {
    return (annotationState.annotation_scope_stack || []).map((frame) => frame.subject_id || frame.pin_id).filter(Boolean)
  }

  function isAnnotationActionControlCanvasId(id) {
    return typeof id === 'string' && id.startsWith(`${SELF_ID}-annotation-action-`)
  }

  function isAnnotationHitLayerCanvasId(id) {
    return typeof id === 'string' && id.startsWith(`${SELF_ID}-annotation-hit-layer`)
  }

  function isAnnotationInternalCanvasId(id) {
    return id === SELF_ID || isAnnotationActionControlCanvasId(id) || isAnnotationHitLayerCanvasId(id)
  }

  function canvasLifecycleIds(payload = {}) {
    const ids = [
      payload.id,
      payload.canvas_id,
      payload.canvas?.id,
      payload.data?.id,
      payload.data?.canvas_id,
    ]
    if (Array.isArray(payload.canvases)) {
      for (const canvas of payload.canvases) ids.push(canvas?.id)
    }
    return ids.map((id) => String(id || '')).filter(Boolean)
  }

  function annotationCanvasLifecycleAffectsProjection(payload = {}) {
    const ids = canvasLifecycleIds(payload)
    if (ids.length === 0) return true
    return ids.some((id) => !isAnnotationInternalCanvasId(id))
  }

  function isBroadRootCanvasId(id) {
    return /^desktop[-_]world$/i.test(String(id || '')) || /^aos-desktop-world-stage$/i.test(String(id || '')) || /^display[-_:]/i.test(String(id || '')) || /^avatar-main$/i.test(String(id || '')) || /^root$/i.test(String(id || ''))
  }

  function canvasParentId(canvas = {}) {
    return canvas.parent || canvas.parent_id || canvas.owner || canvas.owner_id || ''
  }

  function scopedCanvasCandidates() {
    const scope = annotationCurrentScope()
    const visible = minimapCanvases().filter((canvas) => !isAnnotationInternalCanvasId(canvas.id))
    if (!scope) {
      const ids = new Set(visible.map((canvas) => canvas.id))
      return visible
        .filter((canvas) => {
          if (isBroadRootCanvasId(canvas.id)) return false
          const parent = canvasParentId(canvas)
          return !parent || !ids.has(parent) || isBroadRootCanvasId(parent) || isAnnotationInternalCanvasId(parent)
        })
        .map(canvasNodeForAnnotation)
    }
    return visible
      .filter((canvas) => canvasParentId(canvas) === scope.subject_id)
      .map((canvas) => ({
        ...canvasNodeForAnnotation(canvas),
        subject_path: [...(scope.subject_path || [scope.subject_id]), canvas.id],
        root_id: scope.root_id || 'main',
        root_label: scope.root_label || scope.root_id || 'main',
      }))
  }

  function scopedSemanticCandidates() {
    const scope = annotationCurrentScope()
    if (!scope) return []
    const candidates = []
    for (const [canvasId, targets] of semanticTargetsByCanvas) {
      if (canvasId !== scope.subject_id && scope.root_id !== canvasId) continue
      for (const target of targets) {
        const node = semanticTargetNodeForAnnotation(canvasId, target)
        const path = Array.isArray(node.subject_path) ? node.subject_path : []
        const scopePath = Array.isArray(scope.subject_path) ? scope.subject_path : []
        const targetParent = target.parent_id || target.parent || target.owner_id || ''
        const isImmediateByParent = targetParent && targetParent === scope.subject_id
        const isImmediateCanvasChild = canvasId === scope.subject_id && !targetParent
        const isImmediateByPath = scopePath.length > 0
          && path.length === scopePath.length + 1
          && scopePath.every((part, index) => String(part) === String(path[index]))
        if (isImmediateByParent || isImmediateCanvasChild || isImmediateByPath) candidates.push(node)
      }
    }
    return candidates
  }

  function annotationHitRegions() {
    return [
      ...scopedCanvasCandidates(),
      ...scopedSemanticCandidates(),
      ...buildAnnotationNativeHitRegions({
        nativeWindowCandidate: nativeWindowCandidateForAnnotation(),
        nativeAxCandidate: nativeAxCandidateForAnnotation(),
        scopeStack: annotationState.annotation_scope_stack,
      }).map((region) => region.candidate),
    ]
      .map((candidate) => ({ candidate, rect: normalizeDisplayRect(candidate.projection?.visible_display_rect || candidate.projection?.display_space_rect || candidate.rect) }))
      .filter((region) => region.rect && region.candidate?.projection?.can_project_display_overlay !== false)
      .map(({ candidate, rect }) => ({
        id: candidate.id,
        candidate,
        rect,
      }))
  }

  function hitRegionSignature(regions = annotationHitRegions()) {
    return JSON.stringify({
      scope: annotationScopeStackIds(),
      regions: regions.map((region) => [region.id, region.rect.x, region.rect.y, region.rect.w, region.rect.h]),
    })
  }

  function removeAnnotationHitLayerCanvas() {
    const id = annotationHitLayerCanvasId || `${SELF_ID}-annotation-hit-layer`
    if (annotationHitLayerCanvasId || canvases.some((canvas) => canvas.id === id)) {
      emit('canvas.remove', { id })
    }
    annotationHitLayerCanvasId = ''
    annotationHitLayerFrameKey = ''
  }

  function annotationHitLayerURL() {
    const url = new URL(ANNOTATION_HIT_LAYER_PATH, window.location.href)
    url.searchParams.set('target', SELF_ID)
    return url.href
  }

  function syncAnnotationHitLayer() {
    if (!annotationState.annotation_mode.active) {
      removeAnnotationHitLayerCanvas()
      annotationHitLayerSignature = ''
      return []
    }
    const regions = annotationHitRegions()
    const signature = hitRegionSignature(regions)
    const frame = buildAnnotationHitLayerFrame(regions)
    if (!frame) {
      removeAnnotationHitLayerCanvas()
      annotationHitLayerSignature = ''
      return regions
    }
    annotationHitLayerCanvasId = `${SELF_ID}-annotation-hit-layer`
    const frameKey = frame.join(',')
    const payload = {
      id: annotationHitLayerCanvasId,
      frame,
      interactive: false,
      window_level: 'screen_saver',
    }
    const existingIds = new Set(canvases.map((canvas) => canvas.id))
    if (existingIds.has(annotationHitLayerCanvasId)) {
      if (annotationHitLayerFrameKey !== frameKey) emit('canvas.update', payload)
    } else if (annotationHitLayerFrameKey !== frameKey) {
      spawnChild({
        ...payload,
        url: annotationHitLayerURL(),
        parent: SELF_ID,
      }).catch((error) => {
        console.error('[surface-inspector] annotation hit layer create failed', error)
      })
    }
    annotationHitLayerFrameKey = frameKey
    if (signature !== annotationHitLayerSignature) {
      annotationHoverUpdateReason = annotationHitLayerSignature ? 'hit_layer_regions_changed' : 'hit_layer_created'
      annotationHitLayerSignature = signature
    }
    return regions
  }

  function annotationActionControlURL(control) {
    const url = new URL(ANNOTATION_ACTION_CONTROL_PATH, window.location.href)
    url.searchParams.set('target', SELF_ID)
    url.searchParams.set('canvas', control.canvas_id)
    url.searchParams.set('action', control.action)
    url.searchParams.set('label', control.label)
    url.searchParams.set('icon', control.icon)
    url.searchParams.set('accent', control.accent)
    url.searchParams.set('pressed', control.pressed ? '1' : '0')
    return url.href
  }

  function syncAnnotationActionControlCanvases() {
    const controls = annotationActionControlsForHover()
    const existingIds = new Set(canvases.map((canvas) => canvas.id))
    const plan = planAnnotationActionControlCanvasSync({
      controls,
      existingIds,
      managedIds: annotationActionControlCanvasIds,
      frameKeys: annotationActionControlFrames,
    })
    for (const id of plan.removes) {
      annotationHoverStats.remove += 1
      emit('canvas.remove', { id })
    }
    for (const update of plan.updates) {
      annotationHoverStats.update += 1
      emit('canvas.update', update)
    }
    for (const { control, payload } of plan.creates) {
      annotationHoverStats.create += 1
      spawnChild({
        ...payload,
        url: annotationActionControlURL(control),
        parent: SELF_ID,
      }).catch((error) => {
        annotationActionControlFrames.delete(control.id)
        console.error('[surface-inspector] annotation action control create failed', control.id, error)
      })
    }
    annotationActionControlCanvasIds.clear()
    for (const id of plan.nextIds) annotationActionControlCanvasIds.add(id)
    annotationActionControlFrames.clear()
    for (const [id, frameKey] of plan.nextFrameKeys) annotationActionControlFrames.set(id, frameKey)
  }

  function removeAnnotationRuntimeCanvases() {
    const ids = new Set([
      annotationHitLayerCanvasId,
      ...annotationActionControlCanvasIds,
      ...canvases
        .map((canvas) => canvas?.id)
        .filter((id) => isAnnotationActionControlCanvasId(id) || isAnnotationHitLayerCanvasId(id)),
    ])
    for (const id of ids) {
      if (id && id !== SELF_ID) emit('canvas.remove', { id })
    }
    annotationHitLayerCanvasId = ''
    annotationHitLayerSignature = ''
    annotationHitLayerFrameKey = ''
    annotationActionControlCanvasIds.clear()
    annotationActionControlFrames.clear()
    for (const canvasId of annotationOverlayCanvasIds) {
      clearControlledAnnotationOverlay(canvasId)
    }
    annotationOverlayCanvasIds.clear()
    annotationOverlaySignatures.clear()
  }

  function canvasNodeForAnnotation(canvas) {
    const rect = rectFromAt(canvas?.atResolved ?? canvas?.at)
    const hasChildren = canvases.some((item) => item?.parent === canvas?.id || item?.parent_id === canvas?.id)
    return {
      id: canvas?.id,
      subject_id: canvas?.id,
      subject_path: ['canvas', canvas?.id],
      label: canvas?.id,
      root_id: canvas?.root_id || canvas?.display_id || 'main',
      root_label: canvas?.root_label || canvas?.display_label || 'main',
      adapter_id: 'aos-canvas-window',
      projection: rect
        ? { status: 'visible', projectable: true, can_project_display_overlay: true, can_reveal: true, visible_display_rect: rect, display_space_rect: rect, coordinate_space: 'native_display' }
        : { status: 'stale', projectable: false, can_reveal: false, blocker: { reason: 'missing_canvas_rect' }, blocker_reason: 'missing_canvas_rect' },
      has_children: hasChildren,
      pinned: Boolean(findPinForCandidateId(canvas?.id)),
      rect,
    }
  }

  function findPinForCandidateId(candidateId) {
    const id = String(candidateId || '')
    if (!id) return null
    return annotationState.pins.find((pin) => (
      pin.status !== 'removed'
      && (
        pin.subject_id === id
        || pin.id === id
        || pin.source_tree_node_metadata?.id === id
        || pin.source_tree_node_metadata?.subject_id === id
      )
    )) || null
  }

  function normalizeSemanticTargetsPayload(payload = {}) {
    const canvasId = payload.canvas_id || payload.surface || payload.id
    const targets = Array.isArray(payload.semantic_targets)
      ? payload.semantic_targets
      : (Array.isArray(payload.targets) ? payload.targets : [])
    if (!canvasId) return
    semanticTargetsByCanvas.set(canvasId, targets.map((target) => ({
      ...target,
      id: semanticTargetId(target) || target.id,
      canvas_id: target.canvas_id || canvasId,
    })))
  }

  function requestSemanticTargetsForLiveCanvases(reason = 'surface_inspector_refresh', options = {}) {
    const messages = buildSemanticTargetsRequestMessages(canvases, {
      selfId: SELF_ID,
      reason,
      force: options.force === true,
      requestedAtByCanvas: semanticTargetRequestAtByCanvas,
    })
    for (const request of messages) {
      emit('canvas.send', request)
    }
    return messages.length
  }

  function currentAnnotationProjectionEvidence() {
    const evidence = []
    for (const canvas of minimapCanvases()) {
      if (!isAnnotationInternalCanvasId(canvas.id)) evidence.push(canvasNodeForAnnotation(canvas))
    }
    for (const [canvasId, targets] of semanticTargetsByCanvas) {
      for (const target of targets) evidence.push(semanticTargetNodeForAnnotation(canvasId, target))
    }
    const nativeWindow = nativeWindowCandidateForAnnotation()
    if (nativeWindow) evidence.push(nativeWindow)
    const nativeAx = nativeAxCandidateForAnnotation()
    if (nativeAx) evidence.push(nativeAx)
    return evidence
  }

  function refreshSettledAnnotationProjections(reason = 'settled_projection_refresh') {
    pendingAnnotationProjectionSettleTimer = 0
    if (!annotationState.annotation_mode.active) return
    annotationState = refreshSurfaceInspectorAnnotationProjectionsFromEvidence(annotationState, currentAnnotationProjectionEvidence(), { reason })
    annotationHoverUpdateReason = annotationState.projection_refresh?.last_result?.blocker_reason || reason
    syncDebugState()
    syncControlledAnnotationDisplayOverlays()
    syncAnnotationActionControlCanvases()
    rerender()
  }

  function scheduleSettledAnnotationProjectionRefresh(reason = 'settled_projection_refresh', options = {}) {
    if (!annotationState.annotation_mode.active) return
    if (pendingAnnotationProjectionSettleTimer) window.clearTimeout(pendingAnnotationProjectionSettleTimer)
    pendingAnnotationProjectionSettleTimer = window.setTimeout(() => {
      refreshSettledAnnotationProjections(reason)
    }, Number.isFinite(Number(options.delay_ms)) ? Number(options.delay_ms) : 180)
  }

  function invalidateAnnotationProjections(reason = 'projection_stale', options = {}) {
    if (!annotationState.annotation_mode.active) return
    annotationState = markSurfaceInspectorAnnotationProjectionsStale(annotationState, reason, {
      pending_settle_reason: options.settle_reason || reason,
    })
    annotationHoverUpdateReason = reason
    if (options.request_semantic_targets) {
      requestSemanticTargetsForLiveCanvases(options.request_semantic_targets, { force: options.force_semantic_targets === true })
    }
    syncDebugState()
    syncControlledAnnotationDisplayOverlays()
    rerender()
    scheduleSettledAnnotationProjectionRefresh(options.settle_reason || reason, options)
  }

  function semanticTargetNodeForAnnotation(canvasId, target = {}) {
    return buildSurfaceInspectorTargetNodeForAnnotation(canvasId, target, {
      findPinForCandidateId,
    })
  }

  function candidateAtCursor(regions = annotationHitRegions()) {
    if (!annotationState.annotation_mode.active || !cursor?.valid) return null
    const hitPoint = nativeCursor?.valid ? nativeCursor : cursor
    if (annotationState.last_hover_candidate && annotationActionControlsForHover().some((control) => rectContainsPoint(rectFromAt(control.frame), hitPoint))) {
      return annotationState.last_hover_candidate
    }
    return chooseSurfaceInspectorAnnotationCandidate(regions.map((region) => region.candidate), hitPoint)
  }

  function rectContainsPoint(rect, point) {
    return rect && point && point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h
  }

  function setHoverCandidateIfChanged(candidate, blocker = null) {
    const current = annotationState.last_hover_candidate
    const currentRect = normalizeDisplayRect(current?.projection?.visible_display_rect || current?.projection?.display_space_rect)
    const nextRect = normalizeDisplayRect(candidate?.projection?.visible_display_rect || candidate?.projection?.display_space_rect)
    if ((current?.id || '') === (candidate?.id || '') && rectsEqual(currentRect, nextRect)) return false
    annotationState = setSurfaceInspectorHoverCandidate(annotationState, candidate, blocker)
    return true
  }

  function nativeAxHoverBlocker() {
    const scope = annotationCurrentScope()
    if (scope?.adapter_id !== 'macos-ax' || scope.root_kind !== 'native_window') return null
    const candidate = nativeAxCandidateForAnnotation()
    return candidate?.blocker_reason ? { reason: candidate.blocker_reason, candidate_id: candidate.id } : null
  }

  function refreshAnnotationHover() {
    pendingAnnotationHoverFrame = 0
    if (!annotationState.annotation_mode.active || !cursor?.valid) {
      setHoverCandidateIfChanged(null)
      return
    }
    const regions = syncAnnotationHitLayer()
    const candidate = candidateAtCursor(regions)
    if (!candidate) {
      const blocker = nativeAxHoverBlocker() || { reason: 'no_projectable_candidate_under_cursor' }
      setHoverCandidateIfChanged(null, blocker)
      annotationHoverUpdateReason = blocker.reason || 'no_projectable_candidate_under_cursor'
      return
    }
    if (setHoverCandidateIfChanged(candidate)) annotationHoverUpdateReason = 'hover_candidate_changed'
  }

  function scheduleAnnotationHoverRefresh(reason = 'mouse_moved') {
    annotationHoverUpdateReason = reason
    if (pendingAnnotationHoverFrame) return
    pendingAnnotationHoverFrame = window.requestAnimationFrame(() => {
      refreshAnnotationHover()
      syncMinimapDynamicLayer(Date.now())
      syncDebugState()
      syncControlledAnnotationDisplayOverlays()
      syncAnnotationActionControlCanvases()
    })
  }

  function rectsEqual(a, b) {
    if (!a && !b) return true
    if (!a || !b) return false
    return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
  }

  function renderMinimapAnnotationLayer(layout) {
    if (!annotationState.annotation_mode.active || !layout) return ''
    const edge = computeSurfaceInspectorActiveEdge(annotationState)
    let html = ''
    for (const pin of edge.frame_path) {
      if (!pin.projection?.can_project_display_overlay) continue
      const rect = pin.projection?.visible_display_rect
      const projected = rect ? projectAnnotationRectToMinimap(layout, rect, {
        displays,
        coordinateSpace: pin.projection?.coordinate_space,
      }) : null
      if (!projected) continue
      html += `<div class="minimap-annotation-frame" style="left:${projected.x}px;top:${projected.y}px;width:${projected.w}px;height:${projected.h}px;opacity:${pin.opacity}" title="${esc(pin.subject_path.join(' / '))}"></div>`
    }
    for (const comment of edge.comments) {
      const pin = edge.frame_path.find((item) => item.id === comment.pin_id)
      if (!pin?.projection?.can_project_display_overlay) continue
      const rect = pin?.projection?.visible_display_rect
      const projected = rect ? projectAnnotationRectToMinimap(layout, rect, {
        displays,
        coordinateSpace: pin.projection?.coordinate_space,
      }) : null
      if (!projected) continue
      const x = projected.x + projected.w - 8
      const y = projected.y + Math.min(projected.h, 14)
      html += `<div class="minimap-annotation-comment" style="left:${x}px;top:${y}px" title="${esc(comment.text)}"></div>`
    }
    return `<div class="minimap-annotation-layer">${html}</div>`
  }

  function currentFrameFallback() {
    if (currentSelfFrame) return currentSelfFrame
    return cloneFrame([
      window.screenX ?? window.screenLeft ?? 0,
      window.screenY ?? window.screenTop ?? 0,
      window.outerWidth || window.innerWidth || 320,
      window.outerHeight || window.innerHeight || 480,
    ])
  }

  function desiredPanelHeightForListState() {
    const panel = contentEl?.closest?.('.aos-panel')
    const header = panel?.querySelector?.('.aos-header')
    const headerHeight = Math.ceil(header?.getBoundingClientRect?.().height || 44)
    const minimap = minimapPaneEl?.querySelector?.('.minimap')
    const minimapHeight = Math.ceil(minimap?.getBoundingClientRect?.().height || 180) + verticalMargins(minimap)
    const dividerSize = Number.parseFloat(getComputedStyle(splitController?.divider || contentEl)?.flexBasis) || 8
    const listHeight = listCollapsed ? LIST_PANE_CLOSED_HEIGHT : LIST_PANE_OPEN_HEIGHT
    return Math.ceil(headerHeight + minimapHeight + dividerSize + listHeight)
  }

  function resizeSelfToListState() {
    pendingSelfResizeFrame = 0
    const source = currentFrameFallback()
    const height = desiredPanelHeightForListState()
    const nextFrame = resizeFrameFromTopLeft(source, {
      height,
      minWidth: 280,
      minHeight: 220,
      maxHeight: 900,
    })
    if (!nextFrame || source.every((value, index) => value === nextFrame[index])) return
    currentSelfFrame = nextFrame
    mutateSelf({ frame: nextFrame })
  }

  function scheduleSelfResizeToListState() {
    if (pendingSelfResizeFrame) return
    pendingSelfResizeFrame = window.requestAnimationFrame(resizeSelfToListState)
  }

  function syncInputSubscription({ snapshot = false } = {}) {
    const wantsInput = cursorTrackingEnabled || mouseEventsEnabled || annotationState.annotation_mode.active
    const inputEvents = annotationState.annotation_mode.active
      ? ['input_event', 'window_entered', 'element_focused']
      : ['input_event']
    if (!wantsInput) {
      if (inputSubscriptionActive) unsubscribe(['input_event', 'window_entered', 'element_focused'])
      inputSubscriptionActive = false
      inputSubscriptionEvents = []
      cursor = { x: 0, y: 0, valid: false }
      nativeCursor = { x: 0, y: 0, valid: false }
      latestNativeWindowEvent = null
      latestNativeAxElementEvent = null
      clearMouseEffectsState(mouseEffectsState)
      stopDynamicAnimationFrame()
      syncMinimapDynamicLayer()
      syncDebugState()
      return
    }

    if (!inputSubscriptionActive) {
      inputSubscriptionActive = true
      inputSubscriptionEvents = inputEvents
      subscribe(inputEvents, { snapshot })
      syncDebugState()
      return
    }

    const obsoleteEvents = inputSubscriptionEvents.filter((event) => !inputEvents.includes(event))
    if (obsoleteEvents.length > 0) unsubscribe(obsoleteEvents)
    const inputEventsChanged = obsoleteEvents.length > 0 || inputEvents.some((event) => !inputSubscriptionEvents.includes(event))
    if (!snapshot && !inputEventsChanged) {
      syncDebugState()
      return
    }
    inputSubscriptionEvents = inputEvents
    subscribe(inputEvents, { snapshot })
    syncDebugState()
  }

  function setCursorTrackingEnabled(enabled) {
    const next = !!enabled
    if (cursorTrackingEnabled === next) return
    cursorTrackingEnabled = next
    syncInputSubscription({ snapshot: next })
    rerender()
  }

  function setMouseEventsEnabled(enabled) {
    const next = !!enabled
    if (mouseEventsEnabled === next) return
    mouseEventsEnabled = next
    if (!next) {
      clearMouseEffectsState(mouseEffectsState)
      stopDynamicAnimationFrame()
    }
    syncInputSubscription({ snapshot: next })
    rerender()
  }

  function requestSeeBundle(trigger = 'manual') {
    bundleCapture = {
      status: 'pending',
      message: 'capturing see bundle...',
      bundlePath: bundleCapture.bundlePath,
      bundleJSONPath: bundleCapture.bundleJSONPath,
      trigger,
      at: Date.now(),
    }
    syncDebugState()
    rerender()
    emit('canvas_inspector.capture_bundle', { trigger })
  }

  function setAnnotationMode(enabled, options = {}) {
    const wasActive = annotationState.annotation_mode.active
    annotationState = setSurfaceInspectorAnnotationMode(annotationState, enabled, options)
    if (annotationState.annotation_mode.active) {
      annotationHoverStats = { create: 0, update: 0, remove: 0 }
      annotationOverlayStats = { create: 0, update: 0, clear: 0 }
      annotationHoverUpdateReason = 'annotation_mode_entered'
      requestSemanticTargetsForLiveCanvases('annotation_mode_entered', { force: true })
      syncInputSubscription({ snapshot: false })
      if (listCollapsed) {
        splitController?.setSidebarOpen?.(true)
        listCollapsed = false
        scheduleSelfResizeToListState()
      }
    } else if (wasActive && !annotationState.clear_confirmation) {
      annotationHoverUpdateReason = options.reason || 'annotation_mode_exited'
      cancelPendingAnnotationHoverRefresh()
      cancelPendingAnnotationProjectionSettle()
      removeAnnotationRuntimeCanvases()
      syncInputSubscription({ snapshot: false })
    }
    emitAnnotationModeState(options.reason || 'annotation_mode_set')
    rerender()
  }

  function confirmAnnotationClear() {
    const reason = annotationState.clear_confirmation?.reason
    if (reason === 'unpin_descendants' && annotationState.clear_confirmation?.descendant_pin_id) {
      annotationState = unpinSurfaceInspectorFrame(annotationState, annotationState.clear_confirmation.descendant_pin_id, { confirmed: true })
    } else if (reason === 'clear_anchors') {
      annotationState = setSurfaceInspectorAnnotationMode(annotationState, false, { confirmed: true, reason })
      removeAnnotationRuntimeCanvases()
    } else {
      annotationState = setSurfaceInspectorAnnotationMode(annotationState, false, { confirmed: true, reason })
      removeAnnotationRuntimeCanvases()
    }
    cancelPendingAnnotationHoverRefresh()
    cancelPendingAnnotationProjectionSettle()
    syncInputSubscription({ snapshot: false })
    emitAnnotationModeState(reason || 'annotation_clear_confirmed')
    rerender()
  }

  function cancelAnnotationClear() {
    annotationState = createSurfaceInspectorAnnotationState({ ...annotationState, clear_confirmation: null })
    rerender()
  }

  function pinHoverCandidate({ openEditor = false } = {}) {
    const candidate = annotationState.last_hover_candidate
    if (!candidate) return null
    const existing = findPinForCandidateId(candidate.subject_id || candidate.id)
    if (existing && openEditor) {
      annotationState = selectSurfaceInspectorAnnotationFrame(annotationState, existing.id)
      if (annotationState.last_hover_candidate) {
        annotationState = setSurfaceInspectorHoverCandidate(annotationState, {
          ...annotationState.last_hover_candidate,
          pinned: true,
        })
      }
      annotationState.editor = {
        mode: 'new',
        pin_id: existing.id,
        text: '',
      }
      rerender()
      return existing.id
    }
    if (existing && !openEditor) {
      annotationState = unpinSurfaceInspectorFrame(annotationState, existing.id)
      if (annotationState.last_hover_candidate) {
        annotationState = setSurfaceInspectorHoverCandidate(annotationState, {
          ...annotationState.last_hover_candidate,
          pinned: false,
        })
      }
      rerender()
      return null
    }
    annotationState = pinSurfaceInspectorFrame(annotationState, candidate)
    if (annotationState.last_hover_candidate) {
      annotationState = setSurfaceInspectorHoverCandidate(annotationState, {
        ...annotationState.last_hover_candidate,
        pinned: true,
      })
    }
    if (openEditor) {
      annotationState.editor = {
        mode: 'new',
        pin_id: annotationState.active_frame_id,
        text: '',
      }
    }
    rerender()
    return annotationState.active_frame_id
  }

  function backAnnotationScope() {
    annotationState = popSurfaceInspectorAnnotationScope(annotationState)
    annotationHoverUpdateReason = 'scope_popped'
    rerender()
  }

  function clearAnnotationAnchors() {
    annotationState = setSurfaceInspectorAnnotationMode(annotationState, false, { reason: 'clear_anchors' })
    if (!annotationState.clear_confirmation) {
      cancelPendingAnnotationHoverRefresh()
      cancelPendingAnnotationProjectionSettle()
      removeAnnotationRuntimeCanvases()
      syncInputSubscription({ snapshot: false })
      emitAnnotationModeState('clear_anchors')
    }
    rerender()
  }

  function handleAnnotationActionForCanvas(canvasId, { openEditor = false } = {}) {
    let candidate = annotationState.last_hover_candidate?.id === canvasId
      ? annotationState.last_hover_candidate
      : null
    if (!candidate) {
      const canvas = minimapCanvases().find((item) => item.id === canvasId)
      if (canvas) candidate = canvasNodeForAnnotation(canvas)
    }
    if (!candidate) {
      for (const [ownerCanvasId, targets] of semanticTargetsByCanvas) {
        const target = targets.find((item) => semanticTargetId(item) === canvasId)
        if (target) {
          candidate = semanticTargetNodeForAnnotation(ownerCanvasId, target)
          break
        }
      }
    }
    if (!candidate) return null
    annotationState = setSurfaceInspectorHoverCandidate(annotationState, candidate)
    return pinHoverCandidate({ openEditor })
  }

  async function revealAnnotationTarget(pinId) {
    const pin = annotationState.pins.find((item) => item.id === pinId && item.status !== 'removed')
    if (!pin) return
    const requestedAt = new Date().toISOString()
    annotationState.last_reveal_request = {
      pin_id: pin.id,
      adapter_id: pin.adapter_id,
      subject_id: pin.subject_id,
      requested_at: requestedAt,
    }
    if (!pin.projection?.can_reveal) {
      annotationState = applySurfaceInspectorRevealResult(annotationState, pin.id, {
        status: pin.projection?.current_render_status === 'virtualized' ? 'virtualized' : 'unsupported',
        blocker_reason: pin.projection?.blocker_reason || 'adapter_does_not_support_reveal',
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
      })
      rerender()
      return
    }
    if (pin.adapter_id === 'aos-canvas-window' && pin.projection?.current_render_status === 'visible') {
      annotationState = applySurfaceInspectorRevealResult(annotationState, pin.id, {
        status: 'already_visible',
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
        projection: pin.projection,
      })
      rerender()
      return
    }
    const canvasId = pin.root_id || pin.source_tree_node_metadata?.canvas_id || pin.source_tree_node_metadata?.surface
    if (!canvasId || canvasId === SELF_ID) {
      annotationState = applySurfaceInspectorRevealResult(annotationState, pin.id, {
        status: 'unsupported',
        blocker_reason: 'missing_reveal_owner_canvas',
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
      })
      rerender()
      return
    }
    rerender()
    try {
      const result = parseEvalJsonResult(await evalCanvas(canvasId, buildRevealTargetEvalScript({
        ...buildRevealPayloadForSurfaceInspectorPin(pin),
      }))) || { status: 'unsupported', blocker_reason: 'invalid_reveal_response' }
      annotationState = applySurfaceInspectorRevealResult(annotationState, pin.id, {
        ...result,
        requested_at: requestedAt,
      })
      if (result.status === 'revealed' || result.status === 'already_visible') {
        requestSemanticTargetsForLiveCanvases('surface_inspector_reveal_refresh', { force: true })
      }
    } catch (error) {
      annotationState = applySurfaceInspectorRevealResult(annotationState, pin.id, {
        status: 'adapter_error',
        blocker_reason: String(error),
        requested_at: requestedAt,
        completed_at: new Date().toISOString(),
      })
    }
    rerender()
  }

  function addCommentFromEditor() {
    if (!annotationState.editor?.pin_id || !annotationState.editor.text?.trim()) return
    if (annotationState.editor.mode === 'edit' && annotationState.editor.comment_id) {
      annotationState = updateSurfaceInspectorComment(annotationState, annotationState.editor.comment_id, annotationState.editor.text)
    } else {
      annotationState = addSurfaceInspectorComment(annotationState, annotationState.editor.pin_id, annotationState.editor.text)
    }
    rerender()
  }

  function renderAnnotationEditor() {
    if (!annotationState.editor) return ''
    const isEdit = annotationState.editor.mode === 'edit'
    const value = escapeHTML(annotationState.editor.text || '')
    return `<div class="annotation-editor" role="dialog" aria-label="${isEdit ? 'Edit annotation comment' : 'Add annotation comment'}">`
      + `<input class="annotation-editor-input" placeholder="Leave a comment" value="${value}" ${inspectorControlAttrs('annotation-comment-input', { name: 'Leave a comment', action: 'edit_comment_text' })}>`
      + `<div class="annotation-editor-actions">`
      + `<button class="btn annotation-editor-cancel" ${inspectorControlAttrs('annotation-editor-cancel', { name: 'Cancel comment edit', action: 'cancel_comment' })}>Cancel</button>`
      + `<button class="btn annotation-editor-save ${value.trim() ? '' : 'disabled'}" ${value.trim() ? '' : 'disabled'} ${inspectorControlAttrs('annotation-editor-save', { name: isEdit ? 'Update comment' : 'Add Comment', action: isEdit ? 'update_comment' : 'add_comment' })}>${isEdit ? 'Update' : 'Add Comment'}</button>`
      + `</div></div>`
  }

  function renderAnnotationConfirm() {
    const confirmation = annotationState.clear_confirmation
    if (!confirmation) return ''
    return `<div class="annotation-confirm" role="alertdialog" aria-label="Confirm destructive annotation clear">`
      + `<div class="annotation-confirm-message">${esc(confirmation.message || 'Annotations will be lost.')}</div>`
      + `<div class="annotation-confirm-actions">`
      + `<button class="btn annotation-confirm-cancel" ${inspectorControlAttrs('annotation-clear-cancel', { name: 'Cancel annotation clear', action: 'cancel_destructive_clear' })}>Cancel</button>`
      + `<button class="btn annotation-confirm-ok" ${inspectorControlAttrs('annotation-clear-confirm', { name: 'Confirm annotation clear', action: 'confirm_destructive_clear' })}>Confirm</button>`
      + `</div></div>`
  }

  function renderAnnotationOverlays() {
    if (!annotationState.annotation_mode.active && !annotationState.clear_confirmation) return ''
    return `<div class="annotation-overlay-surface">${renderAnnotationEditor()}${renderAnnotationConfirm()}</div>`
  }

  async function applyTint(id, color) {
    await evalCanvas(id, buildTintEvalScript(color))
  }

  function parseEvalJsonResult(result) {
    if (result && typeof result === 'object') return result
    if (typeof result !== 'string') return null
    try {
      return JSON.parse(result)
    } catch {
      return null
    }
  }

  function rerender() {
    if (!contentEl) return
    const priorListRegion = listPaneEl?.querySelector?.('.canvas-list-region')
    const priorListScrollTop = priorListRegion?.scrollTop ?? 0
    if (minimapPaneEl) {
      const minimapHTML = renderMinimap(minimapCanvases())
      minimapPaneEl.innerHTML = minimapHTML || '<div class="empty-state">Waiting for display geometry...</div>'
    }
    if (listPaneEl) {
      listPaneEl.innerHTML = renderStatusBar()
        + `<div class="canvas-list-region aos-sidebar-rail-content" ${listCollapsed ? 'hidden' : ''}>${renderTree()}</div>`
    }
    contentEl.querySelectorAll('.annotation-overlay-surface').forEach((node) => node.remove())
    const overlay = renderAnnotationOverlays()
    if (overlay) contentEl.insertAdjacentHTML('beforeend', overlay)
    const nextListRegion = listPaneEl?.querySelector?.('.canvas-list-region')
    if (nextListRegion && !listCollapsed) nextListRegion.scrollTop = priorListScrollTop
    syncAnnotationHitLayer()
    syncMinimapDynamicLayer()
    syncDebugState()
    syncControlledAnnotationDisplayOverlays()
    syncAnnotationActionControlCanvases()
  }

  function getMinimapWidth() {
    return Math.max(120, (minimapPaneEl?.clientWidth || contentEl?.clientWidth || 296) - 16)
  }

  function getMinimapMaxHeight() {
    const paneHeight = minimapPaneEl?.clientHeight || MINIMAP_PANE_MAX_HEIGHT
    return Math.max(96, paneHeight - 16)
  }

  function minimapCanvases() {
    const displayRects = normalizeDisplays(displays)
      .map((display) => display.nativeBounds || display.bounds)
      .filter(Boolean)
    const visibleCanvases = canvases.filter((canvas) => canvas?.suspended !== true)
    return resolveCanvasFrames(visibleCanvases).filter((canvas) => {
      const rect = rectFromAt(canvas.atResolved ?? canvas.at)
      if (!rect) return false
      return displayRects.some((display) => rectsIntersect(rect, display))
    })
  }

  function rectsIntersect(a, b) {
    return a.x < b.x + b.w
      && a.x + a.w > b.x
      && a.y < b.y + b.h
      && a.y + a.h > b.y
  }

  function renderMinimap(list) {
    if (displays.length === 0) {
      lastMinimapLayout = null
      return ''
    }

    const layout = computeMinimapLayout(displays, list, getMinimapWidth(), {
      selfId: SELF_ID,
      maxH: getMinimapMaxHeight(),
      minW: 120,
      minH: 96,
    })
    lastMinimapLayout = layout
    if (!layout) return ''

    let html = `<div class="minimap" style="width:${layout.mapW}px;height:${layout.mapH}px">`
    for (const { x, y, w, h, visibleX, visibleY, visibleW, visibleH } of layout.displays) {
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`
      html += `<div class="minimap-display-visible" style="left:${visibleX - x}px;top:${visibleY - y}px;width:${visibleW}px;height:${visibleH}px"></div>`
      html += `</div>`
    }
    for (const { canvas: c, x, y, w, h, isSelf } of layout.canvases) {
      const tint = tintMap.get(c.id)
      const cls = isSelf ? 'minimap-canvas self' : (tint ? 'minimap-canvas tinted' : 'minimap-canvas')
      const tintStyle = tint ? `background:${esc(tint)};border-color:${esc(tint)};` : ''
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${tintStyle}" title="${esc(c.id)}"></div>`
    }
    html += renderMinimapAnnotationLayer(layout)
    if (!annotationState.annotation_mode.active) {
      // Object marks: projected CG position, primitive composition at logical w/h.
      for (const [canvasId, entry] of marksState.marksByCanvas) {
        for (const m of entry.marks) {
          const projected = projectPointToMinimap(layout, { x: m.x, y: m.y })
          if (!projected) continue
          html += renderMinimapMark(m, projected, { canvasId, layout })
        }
      }
    }
    html += `<div class="minimap-dynamic-layer"></div>`
    html += `</div>`
    return html
  }

  function renderTree() {
    if (canvases.length === 0 && marksState.marksByCanvas.size === 0 && displays.length === 0) {
      return '<div class="empty-state">Waiting for canvases...</div>'
    }
    const resolvedCanvases = normalizeCanvasesToDesktopWorld(canvases)
    const tree = computeInspectorTree({
      displays: normalizeDisplays(displays),
      canvases: resolvedCanvases,
      marksByCanvas: marksState.marksByCanvas,
      surfaceResources: buildSurfaceResourceSnapshot(surfaceResourceState, { canvases }),
    })
    if (!tree || tree.type === 'empty') {
      return '<div class="empty-state">No canvases active</div>'
    }
    return `<div class="canvas-list">${renderTreeNode(tree, 0)}</div>`
  }

  function renderTreeNode(node, depth) {
    if (!node) return ''
    if (node.type === 'union') {
      return renderLocationRow(node.label, depth)
        + renderCursorToggleRow(depth + 1)
        + renderMouseEventsToggleRow(depth + 1)
        + renderAnnotationModeToggleRow(depth + 1)
        + renderAnnotationTree(depth + 1)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'display') {
      return renderLocationRow(node.label, depth)
        + (depth === 0 ? renderAnnotationModeToggleRow(depth + 1) + renderAnnotationTree(depth + 1) : '')
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'surface_resource_group') {
      return renderLocationRow(node.label, depth)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'canvas') {
      return renderCanvasRow(node.canvas, depth, { selfId: SELF_ID, tintedIds, statsIds })
        + renderSemanticTargetRows(node.canvas.id, depth + 1)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'mark') {
      return renderMarkTreeRow(node.mark, depth)
    }
    if (node.type === 'surface_affordance') {
      return renderAffordanceTreeRow(node.affordance, depth)
        + node.children.map((c) => renderTreeNode(c, depth + 1)).join('')
    }
    if (node.type === 'stage_layer') {
      return renderStageLayerTreeRow(node.stageLayer, depth)
    }
    if (node.type === 'input_region') {
      return renderInputRegionTreeRow(node.inputRegion, depth)
    }
    return ''
  }

  function indentStyle(depth) {
    return rowIndentStyle(depth)
  }

  function renderLocationRow(label, depth) {
    return `<div class="tree-row location" style="${indentStyle(depth)}">`
      + `<span class="location-label">${esc(label)}</span>`
      + `</div>`
  }

  function renderCursorToggleRow(depth) {
    return renderCursorToggleRowHTML({ depth, enabled: cursorTrackingEnabled })
  }

  function renderMouseEventsToggleRow(depth) {
    return renderMouseEventsToggleRowHTML({ depth, enabled: mouseEventsEnabled })
  }

  function renderAnnotationModeToggleRow(depth) {
    return renderAnnotationModeToggleRowHTML({ depth, enabled: annotationState.annotation_mode.active })
  }

  function renderAnnotationTree(depth) {
    if (!annotationState.annotation_mode.active) return ''
    const fallbackActions = renderAnnotationTreeFallbackActions(depth + 1)
    const scopeControls = renderAnnotationScopeControls(depth + 1)
    const managementRows = renderAnnotationManagementRows(depth + 1)
    return `<div class="annotation-support" role="group" aria-label="Annotation support state">`
      + scopeControls
      + renderAnnotationSupportRows(depth + 1)
      + managementRows
      + fallbackActions
      + `</div>`
  }

  function renderAnnotationTreeFallbackActions(depth) {
    return ''
  }

  function renderAnnotationScopeControls(depth) {
    const stack = annotationState.annotation_scope_stack || []
    const canBack = stack.length > 0
    const rootActive = stack.length === 0
    const crumbs = [
      `<button class="annotation-scope-crumb ${rootActive ? 'active' : ''}" data-pin-id="" ${inspectorControlAttrs('annotation-scope-root', { name: 'Annotation scope main', action: 'select_annotation_scope_root' })}>main</button>`,
      ...stack.map((frame, index) => `<button class="annotation-scope-crumb ${index === stack.length - 1 ? 'active' : ''}" data-pin-id="${esc(frame.pin_id)}" ${inspectorControlAttrs(`annotation-scope-${frame.pin_id}`, { name: `Annotation scope ${frame.subject_id}`, action: 'select_annotation_scope' })}>${esc(frame.subject_id)}</button>`),
    ].join('<span class="annotation-scope-separator">/</span>')
    return `<div class="tree-row annotation-scope-row" style="${indentStyle(depth)}">`
      + `<button class="btn annotation-scope-back" ${canBack ? '' : 'disabled'} ${inspectorControlAttrs('annotation-scope-back', { name: 'Back annotation scope', action: 'back_annotation_scope' })}>Back</button>`
      + `<span class="annotation-scope-crumbs">${crumbs}</span>`
      + `<button class="btn annotation-clear-anchors" ${inspectorControlAttrs('annotation-clear-anchors', { name: 'Clear anchors', action: 'clear_anchors' })}>Clear anchors</button>`
      + `</div>`
  }

  function renderAnnotationSupportRows(depth) {
    const session = surfaceInspectorAnnotationStateToSession(annotationState)
    const anchors = session.anchors || []
    const comments = anchors.filter((anchor) => (anchor.comment_text || '').trim())
    const stale = anchors.filter((anchor) => anchor.status !== 'live' || anchor.projection?.can_project_display_overlay === false)
    const blocker = annotationState.last_projection_blocker?.reason || ''
    const current = session.committed_scope_stack?.at?.(-1) || session.root
    const currentPath = current?.subject?.path?.join(' / ') || current?.address || 'main'
    const snapshotState = 'snapshot ready'
    const hover = session.hover_candidate
    const minimapCount = anchors.filter((anchor) => anchor.projection?.can_project_display_overlay).length
    let html = ''
    html += renderAnnotationSupportRow('mode', 'active', depth)
    html += renderAnnotationSupportRow('root', session.root?.root?.label || session.root?.address || 'pending', depth)
    html += renderAnnotationSupportRow('scope', currentPath, depth)
    html += renderAnnotationSupportRow('anchors', `${anchors.length} frames / ${comments.length} comments`, depth)
    html += renderAnnotationSupportRow('snapshot', snapshotState, depth)
    html += renderAnnotationSupportRow('minimap', `${minimapCount} projected markers, passive`, depth)
    if (hover) {
      html += renderAnnotationSupportRow('hover preview', `${hover.adapter_id}:${hover.subject?.id || hover.address}`, depth, {
        state: hover.projection?.current_render_status || hover.status || 'preview',
        blocker: hover.projection?.blocker_reason || '',
      })
    }
    for (const anchor of anchors) {
      html += renderAnnotationSupportRow(anchor.comment_text ? 'comment anchor' : 'frame anchor', anchor.address, depth, {
        state: anchor.projection?.current_render_status || anchor.status || 'unknown',
        adapter: anchor.subject?.adapter_id || anchor.projection?.adapter_id || 'unknown-adapter',
        subject: anchor.subject?.subject?.id || anchor.projection?.subject_id || '',
        blocker: anchor.projection?.blocker_reason || '',
      })
    }
    if (stale.length > 0) {
      html += renderAnnotationSupportRow('diagnostics', `${stale.length} stale/blocked anchors`, depth, {
        state: 'blocked',
        blocker: stale.map((anchor) => anchor.projection?.blocker_reason || anchor.status).filter(Boolean).join(', '),
      })
    } else if (blocker) {
      html += renderAnnotationSupportRow('diagnostics', blocker, depth, { state: 'blocked', blocker })
    } else if (anchors.length === 0 && !hover) {
      html += `<div class="tree-row annotation-empty" style="${indentStyle(depth)}"><span>waiting for display anchor evidence</span></div>`
    }
    return html
  }

  function renderAnnotationSupportRow(label, value, depth, options = {}) {
    const state = options.state || ''
    const adapter = options.adapter ? ` · ${options.adapter}` : ''
    const subject = options.subject ? ` · ${options.subject}` : ''
    const blocker = options.blocker ? `<span class="annotation-blocker">${esc(options.blocker)}</span>` : ''
    const stateClass = state ? ` state-${esc(state)}` : ''
    return `<div class="tree-row annotation-support-row${stateClass}" style="${indentStyle(depth)}" title="${esc(value)}">`
      + `<span class="annotation-support-label">${esc(label)}</span>`
      + `<span class="annotation-support-value">${esc(value)}</span>`
      + (state ? `<span class="annotation-projection-state">${esc(state)}</span>` : '')
      + (adapter || subject ? `<span class="annotation-support-evidence">${esc(`${adapter}${subject}`.replace(/^ · /, ''))}</span>` : '')
      + blocker
      + `</div>`
  }

  function renderAnnotationManagementRows(depth) {
    const rows = buildSurfaceInspectorAnnotationTreeRows(annotationState)
    if (rows.length === 0) return ''
    return `<div class="annotation-management" role="tree" aria-label="Saved annotation management">`
      + `<div class="tree-row annotation-management-heading" style="${indentStyle(depth)}"><span>saved annotation management</span></div>`
      + rows.map((row) => renderAnnotationManagementRow(row, depth + 1)).join('')
      + `</div>`
  }

  function renderAnnotationManagementRow(row, depth) {
    const stateLabel = row.projection_state || row.pin?.projection?.current_render_status || 'unsupported'
    const blocker = row.blocker_text || row.pin?.projection?.blocker_reason || ''
    if (row.type === 'comment') {
      return `<div class="tree-row annotation-row comment ${row.active ? 'active' : ''} state-${esc(stateLabel)}" data-comment-id="${esc(row.comment.id)}" style="${indentStyle(depth)}" title="${esc(blocker || row.comment.text)}">`
        + `<span class="annotation-comment-dot"></span>`
        + `<button class="annotation-comment-text" data-comment-id="${esc(row.comment.id)}" data-pin-id="${esc(row.comment.pin_id)}" ${inspectorControlAttrs(`annotation-comment-${row.comment.id}`, { name: `Edit comment ${row.comment.id}`, action: 'edit_comment' })}>${esc(row.comment.text)}</button>`
        + `<span class="annotation-projection-state">${esc(stateLabel)}</span>`
        + (blocker ? `<span class="annotation-blocker">${esc(blocker)}</span>` : '')
        + `<button class="btn annotation-comment-delete" data-comment-id="${esc(row.comment.id)}" title="Delete comment" ${inspectorControlAttrs(`annotation-delete-${row.comment.id}`, { name: `Delete comment ${row.comment.id}`, action: 'delete_comment' })}>del</button>`
        + `</div>`
    }
    const expanded = row.pin.expanded === true
    const address = row.frame_address || { compact: row.label, full: row.pin.subject_path.join(' / ') }
    const label = address.compact
    return `<div class="tree-row annotation-row pin ${row.active ? 'active' : ''} state-${esc(stateLabel)}" data-pin-id="${esc(row.pin.id)}" style="${indentStyle(depth)}" title="${esc(address.full)}">`
      + `<span class="annotation-pin-dot"></span>`
      + `<button class="annotation-pin-label" data-pin-id="${esc(row.pin.id)}" ${inspectorControlAttrs(`annotation-pin-${row.pin.id}`, { name: `Frame address ${address.full}`, action: 'select_frame_anchor' })}>${esc(label)}</button>`
      + `<span class="annotation-projection-state">${esc(stateLabel)}</span>`
      + `<span class="annotation-reveal-capability">${row.can_reveal ? 'revealable' : 'no reveal'}</span>`
      + (blocker ? `<span class="annotation-blocker">${esc(blocker)}</span>` : '')
      + (row.can_reveal ? `<button class="btn annotation-pin-reveal" data-pin-id="${esc(row.pin.id)}" ${inspectorControlAttrs(`annotation-reveal-${row.pin.id}`, { name: `Reveal Target ${label}`, action: 'reveal_target' })}>Reveal</button>` : '')
      + `<button class="btn annotation-pin-expand" data-pin-id="${esc(row.pin.id)}" title="Expand frame address" ${inspectorControlAttrs(`annotation-expand-${row.pin.id}`, { name: `Expand frame address ${label}`, action: 'expand_frame_address' })}>${expanded ? 'less' : 'more'}</button>`
      + `<button class="btn annotation-pin-copy" data-pin-id="${esc(row.pin.id)}" title="Copy full frame address" ${inspectorControlAttrs(`annotation-copy-${row.pin.id}`, { name: `Copy full frame address ${label}`, action: 'copy_full_frame_address' })}>copy</button>`
      + `<button class="btn annotation-pin-remove" data-pin-id="${esc(row.pin.id)}" title="Remove frame anchor" ${inspectorControlAttrs(`annotation-remove-${row.pin.id}`, { name: `Remove frame anchor ${label}`, action: 'remove_frame_anchor' })}>remove</button>`
      + (expanded ? `<span class="annotation-full-path">${esc(address.full)}</span>` : '')
      + `</div>`
  }

  function renderSemanticTargetRows(canvasId, depth) {
    return ''
  }

  function renderMarkTreeRow(mark, depth) {
    return `<div class="tree-row mark" data-mark-id="${esc(mark.id)}" style="${indentStyle(depth)}">`
      + `<span class="mark-name" style="color:${esc(mark.color)}">${esc(mark.name)}</span>`
      + `</div>`
  }

  function compactStatus(statuses = []) {
    const notable = statuses.filter((status) => status !== 'active')
    return notable.length ? notable.join(', ') : 'active'
  }

  function renderAffordanceTreeRow(affordance, depth) {
    const status = compactStatus(affordance.statuses)
    return `<div class="tree-row surface-affordance" data-resource-type="surface-affordance" data-affordance-id="${esc(affordance.id)}" style="${indentStyle(depth)}" title="${esc(status)}">`
      + `<span class="surface-resource-kind">affordance</span>`
      + `<span class="surface-resource-label">${esc(affordance.id)}</span>`
      + `<span class="surface-resource-status">${esc(status)}</span>`
      + `</div>`
  }

  function renderStageLayerTreeRow(layer, depth) {
    const status = compactStatus(layer.statuses)
    const dims = Array.isArray(layer.frame) ? formatAt(layer.frame) : ''
    return `<div class="tree-row stage-layer" data-resource-type="stage-layer" data-stage-layer-id="${esc(layer.id)}" style="${indentStyle(depth)}" title="${esc(status)}">`
      + `<span class="surface-resource-kind">stage</span>`
      + `<span class="surface-resource-label">${esc(layer.label || layer.id)}</span>`
      + `<span class="canvas-dims">${esc(layer.kind)} ${esc(dims)}</span>`
      + `<span class="surface-resource-status">${esc(status)}</span>`
      + `</div>`
  }

  function renderInputRegionTreeRow(region, depth) {
    const status = compactStatus(region.statuses)
    const dims = Array.isArray(region.frame) ? formatAt(region.frame) : ''
    return `<div class="tree-row input-region" data-resource-type="input-region" data-input-region-id="${esc(region.id)}" style="${indentStyle(depth)}" title="${esc(status)}">`
      + `<span class="surface-resource-kind">region</span>`
      + `<span class="surface-resource-label">${esc(region.semanticLabel || region.id)}</span>`
      + `<span class="canvas-dims">${esc(region.consumePolicy)} ${esc(dims)}</span>`
      + `<span class="surface-resource-status">${esc(status)}</span>`
      + `</div>`
  }

  function renderStatusBar() {
    let detail = bundleHotkeyLabel === 'disabled'
      ? 'bundle hotkey disabled'
      : `bundle ${bundleHotkeyLabel}`
    if (lastTintError) {
      detail = `${lastTintError.action === 'stats' ? 'stats' : 'tint'} error: ${esc(lastTintError.id)}`
    } else if (bundleCapture?.status === 'pending') {
      detail = bundleCapture.message || 'capturing see bundle...'
    } else if (bundleCapture?.status === 'success') {
      const target = bundleCapture.bundlePath || bundleCapture.bundleJSONPath || 'bundle ready'
      const leaf = target.split('/').filter(Boolean).pop() || target
      detail = `bundle copied: ${esc(leaf)}`
    } else if (bundleCapture?.status === 'error') {
      detail = bundleCapture.message || 'bundle failed'
    }
    return `<div class="status-bar aos-sidebar-rail-top">`
      + `<span class="event-count">${eventCount} events</span>`
      + renderCanvasListToggleButton({ collapsed: listCollapsed })
      + `<span>${detail}</span>`
      + `</div>`
  }

  async function toggleTint(id) {
    const wasTinted = tintedIds.has(id)
    const priorColor = tintMap.get(id) || null
    let color = null
    if (wasTinted) {
      tintedIds.delete(id)
      tintMap.delete(id)
    } else {
      color = TINT_COLORS[tintIndex % TINT_COLORS.length]
      tintIndex++
      tintedIds.add(id)
      tintMap.set(id, color)
    }
    lastTintError = null
    rerender()
    try {
      await applyTint(id, color)
    } catch (error) {
      if (wasTinted) {
        tintedIds.add(id)
        if (priorColor) tintMap.set(id, priorColor)
      } else {
        tintIndex = Math.max(0, tintIndex - 1)
        tintedIds.delete(id)
        tintMap.delete(id)
      }
      lastTintError = { id, error: String(error), at: Date.now() }
      rerender()
      console.error('[surface-inspector] tint failed', id, error)
    }
  }

  async function toggleStats(id) {
    if (!id) return
    const wasEnabled = statsIds.has(id)
    if (wasEnabled) statsIds.delete(id)
    else statsIds.add(id)
    lastTintError = null
    rerender()
    try {
      const result = await evalCanvas(id, buildStatsToggleEvalScript({
        panel: 0,
        position: 'top-right',
      }))
      if (result === false || result === 'false') throw new Error('window.aosStats.toggle missing')
      await delay(250)
      const status = parseEvalJsonResult(await evalCanvas(id, buildStatsStatusEvalScript()))
      if (status?.enabled) statsIds.add(id)
      else statsIds.delete(id)
      rerender()
    } catch (error) {
      if (wasEnabled) statsIds.add(id)
      else statsIds.delete(id)
      lastTintError = { id, error: String(error), at: Date.now(), action: 'stats' }
      rerender()
      console.error('[surface-inspector] stats toggle failed', id, error)
    }
  }

  function bindListEvents() {
    contentEl.addEventListener('click', (event) => {
      const btn = event.target?.closest?.('button')
      if (!btn || !contentEl.contains(btn)) return
      if (btn.classList.contains('annotation-mode-toggle-btn')) {
        setAnnotationMode(!annotationState.annotation_mode.active)
        return
      }
      if (btn.classList.contains('annotation-editor-cancel')) {
        annotationState = createSurfaceInspectorAnnotationState({ ...annotationState, editor: null })
        rerender()
        return
      }
      if (btn.classList.contains('annotation-editor-save')) {
        addCommentFromEditor()
        return
      }
      if (btn.classList.contains('annotation-confirm-ok')) {
        confirmAnnotationClear()
        return
      }
      if (btn.classList.contains('annotation-confirm-cancel')) {
        cancelAnnotationClear()
        return
      }
      if (btn.classList.contains('annotation-scope-back')) {
        backAnnotationScope()
        return
      }
      if (btn.classList.contains('annotation-clear-anchors')) {
        clearAnnotationAnchors()
        return
      }
      if (btn.classList.contains('annotation-scope-crumb')) {
        annotationState = jumpSurfaceInspectorAnnotationScope(annotationState, btn.dataset.pinId || '')
        annotationHoverUpdateReason = btn.dataset.pinId ? 'scope_breadcrumb_selected' : 'scope_root_selected'
        rerender()
        return
      }
      if (btn.classList.contains('annotation-pin-label')) {
        annotationState = jumpSurfaceInspectorAnnotationScope(selectSurfaceInspectorAnnotationFrame(annotationState, btn.dataset.pinId || ''), btn.dataset.pinId || '')
        rerender()
        return
      }
      if (btn.classList.contains('annotation-comment-text')) {
        const comment = annotationState.comments.find((item) => item.id === btn.dataset.commentId && item.status !== 'removed')
        if (comment) {
          annotationState = createSurfaceInspectorAnnotationState({
            ...annotationState,
            active_frame_id: comment.pin_id || annotationState.active_frame_id,
            editor: {
              mode: 'edit',
              pin_id: comment.pin_id,
              comment_id: comment.id,
              text: comment.text,
            },
          })
          rerender()
        }
        return
      }
      if (btn.classList.contains('annotation-pin-reveal')) {
        revealAnnotationTarget(btn.dataset.pinId)
        return
      }
      if (btn.classList.contains('annotation-pin-copy')) {
        const pin = annotationState.pins.find((item) => item.id === btn.dataset.pinId)
        navigator.clipboard?.writeText?.(pin?.subject_path?.join(' / ') || '')
        return
      }
      if (btn.classList.contains('annotation-pin-expand')) {
        annotationState = createSurfaceInspectorAnnotationState({
          ...annotationState,
          pins: annotationState.pins.map((pin) => (
            pin.id === btn.dataset.pinId ? { ...pin, expanded: pin.expanded !== true } : pin
          )),
        })
        rerender()
        return
      }
      if (btn.classList.contains('annotation-pin-remove')) {
        annotationState = unpinSurfaceInspectorFrame(annotationState, btn.dataset.pinId)
        rerender()
        return
      }
      if (btn.classList.contains('annotation-comment-delete')) {
        annotationState = deleteSurfaceInspectorComment(annotationState, btn.dataset.commentId)
        rerender()
        return
      }
      if (btn.classList.contains('canvas-list-toggle')) {
        splitController?.toggleSidebar?.()
        listCollapsed = !(splitController?.getSidebarOpen?.() ?? !listCollapsed)
        if (!listCollapsed) requestSemanticTargetsForLiveCanvases('surface_inspector_refresh', { force: true })
        rerender()
        scheduleSelfResizeToListState()
        return
      }
      if (btn.classList.contains('cursor-toggle-btn')) {
        setCursorTrackingEnabled(!cursorTrackingEnabled)
        return
      }
      if (btn.classList.contains('mouse-events-toggle-btn')) {
        setMouseEventsEnabled(!mouseEventsEnabled)
        return
      }
      if (btn.classList.contains('tint-btn')) {
        toggleTint(btn.dataset.id)
        return
      }
      if (btn.classList.contains('stats-btn')) {
        toggleStats(btn.dataset.id)
        return
      }
      if (btn.classList.contains('remove-btn')) {
        emit('canvas.remove', { id: btn.dataset.id })
      }
    })
    contentEl.addEventListener('input', (event) => {
      if (!event.target?.classList?.contains('annotation-editor-input')) return
      annotationState.editor = {
        ...(annotationState.editor || { mode: 'new', pin_id: annotationState.active_frame_id }),
        text: event.target.value,
      }
      const save = contentEl.querySelector('.annotation-editor-save')
      if (save) {
        save.disabled = !event.target.value.trim()
        save.classList.toggle('disabled', save.disabled)
      }
    })
    window.addEventListener('keydown', (event) => {
      if (!annotationState.annotation_mode.active || event.key !== 'Escape') return
      if ((annotationState.annotation_scope_stack || []).length === 0) return
      event.preventDefault()
      backAnnotationScope()
    })
  }

  function normalizeCanvasesToDesktopWorld(list) {
    const resolved = resolveCanvasFrames(list)
    return resolved.map((canvas) => {
      const worldResolved = nativeToDesktopWorldRect(rectFromAt(canvas.atResolved ?? canvas.at), displays)
      const worldAt = nativeToDesktopWorldRect(rectFromAt(canvas.at), displays)
      return {
        ...canvas,
        at: rectToAt(worldAt) ?? canvas.at,
        atResolved: rectToAt(worldResolved) ?? canvas.atResolved,
      }
    })
  }

  function applyLifecycle(data) {
    const id = canvasLifecycleCanvasID(data)
    if (!id) return

    if (data.action === 'removed') {
      canvases = canvases.filter(c => c.id !== id)
      tintedIds.delete(id)
      tintMap.delete(id)
      statsIds.delete(id)
      annotationActionControlCanvasIds.delete(id)
      annotationActionControlFrames.delete(id)
      if ((annotationState.annotation_scope_stack || []).some((frame) => frame.subject_id === id)) {
        let next = annotationState
        while ((next.annotation_scope_stack || []).some((frame) => frame.subject_id === id)) {
          next = popSurfaceInspectorAnnotationScope(next)
          if ((next.annotation_scope_stack || []).length === 0) break
        }
        annotationState = next
        annotationHoverUpdateReason = 'scope_candidate_removed'
      }
      if (annotationState.last_hover_candidate?.id === id) {
        annotationState = setSurfaceInspectorHoverCandidate(annotationState, null, { reason: 'target_canvas_removed' })
      }
      evictCanvas(marksState, id)
      removeSurfaceResourcesForCanvas(surfaceResourceState, id)
      return
    }

    const existing = canvases.find(c => c.id === id) || null
    const next = mergeCanvasLifecycleCanvas(existing, data)
    if (!next) return
    if (id === SELF_ID) currentSelfFrame = cloneFrame(next.at)

    const existingIndex = canvases.findIndex(c => c.id === id)
    if (existingIndex >= 0) {
      canvases[existingIndex] = next
    } else {
      canvases.push(next)
    }
  }

  return {
    manifest: {
      name: 'surface-inspector',
      title: 'Surface Inspector',
      accepts: ['bootstrap', 'canvas_lifecycle', 'display_geometry', 'input_event', 'window_entered', 'element_focused', 'canvas_object.marks', 'canvas_object.registry', 'input_region', 'canvas_inspector.see_bundle_status', 'canvas_inspector.annotation_toggle', 'canvas_inspector.annotation_open', 'canvas_inspector.semantic_targets'],
      emits: ['canvas.send'],
      channelPrefix: 'surface-inspector',
      requires: ['canvas_lifecycle', 'display_geometry', 'canvas_object.marks', 'canvas_object.registry', 'input_region'],
      defaultSize: { w: 320, h: 480 },
    },

    render(host) {
      host.contentEl.style.overflow = 'hidden'
      contentEl = document.createElement('div')
      contentEl.className = 'surface-inspector-body'
      const splitRoot = document.createElement('div')
      minimapPaneEl = document.createElement('section')
      listPaneEl = document.createElement('section')
      splitRoot.className = 'surface-inspector-split'
      minimapPaneEl.className = 'surface-inspector-minimap-pane'
      listPaneEl.className = 'surface-inspector-list-pane aos-sidebar-rail'
      contentEl.appendChild(splitRoot)
      splitController = createFixedSidebarPane({
        root: splitRoot,
        mainPane: minimapPaneEl,
        sidebarPane: listPaneEl,
        orientation: 'vertical',
        side: 'end',
        openSize: LIST_PANE_OPEN_HEIGHT,
        closedSize: LIST_PANE_CLOSED_HEIGHT,
        minMain: 150,
        maxMain: MINIMAP_PANE_MAX_HEIGHT,
        maxSidebar: Infinity,
        initiallyOpen: !listCollapsed,
        dividerSize: 8,
        ariaLabel: 'Resize minimap and canvas list',
        onChange(state) {
          listCollapsed = state.closedPane === 'end'
        },
      })
      window.__canvasInspectorDebug = {
        tintCanvas(id, color = TINT_COLORS[0]) {
          return applyTint(id, color)
        },
        setCursorTrackingEnabled,
        setMouseEventsEnabled,
        requestSeeBundle,
        buildAnnotationSnapshotArtifact,
        toggleStats,
        toggleCanvasList() {
          splitController?.toggleSidebar?.()
          listCollapsed = !(splitController?.getSidebarOpen?.() ?? !listCollapsed)
          rerender()
          scheduleSelfResizeToListState()
        },
      }
      bindListEvents()
      subscribe(['canvas_object.registry', 'input_region'], { snapshot: true })
      emit('canvas_inspector.request_bundle_config')
      emitAnnotationModeState('bootstrap')
      requestSemanticTargetsForLiveCanvases('surface_inspector_launch')
      resizeObserver = new ResizeObserver(() => {
        const nextWidth = getMinimapWidth()
        if (nextWidth !== lastMinimapWidth) {
          lastMinimapWidth = nextWidth
          rerender()
        }
      })
      resizeObserver.observe(contentEl)
      window.__canvasInspectorMounted = true
      syncDebugState()
      rerender()
      scheduleSelfResizeToListState()
      return contentEl
    },

    onMessage(msg, _host) {
      if (msg.type === 'canvas_inspector.annotation_toggle') {
        if (annotationState.annotation_mode.active) setAnnotationMode(false, { reason: msg.reason || 'shortcut' })
        else setAnnotationMode(true, { reason: msg.reason || 'shortcut' })
        return
      }
      if (msg.type === 'canvas_inspector.annotation_open') {
        if (!annotationState.annotation_mode.active) setAnnotationMode(true, { reason: msg.reason || 'external_open' })
        else emitAnnotationModeState(msg.reason || 'external_open')
        return
      }
      if (msg.type === 'lifecycle' && msg.action === 'suspend') {
        if (annotationState.annotation_mode.active || annotationState.clear_confirmation) {
          annotationState = setSurfaceInspectorAnnotationMode(annotationState, false, { confirmed: true, reason: 'surface_inspector_suspended' })
        }
        cancelPendingAnnotationHoverRefresh()
        cancelPendingAnnotationProjectionSettle()
        removeAnnotationRuntimeCanvases()
        syncInputSubscription({ snapshot: false })
        emitAnnotationModeState('surface_inspector_suspended')
        return
      }
      if (msg.type === 'canvas_inspector.annotation_display_action') {
        if (msg.action === 'pin_frame') handleAnnotationActionForCanvas(msg.canvas_id)
        if (msg.action === 'add_comment') handleAnnotationActionForCanvas(msg.canvas_id, { openEditor: true })
        return
      }
      if (msg.type === 'canvas_inspector.see_bundle_status') {
        const payload = msg.payload || msg
        bundleHotkeyLabel = payload.shortcut || bundleHotkeyLabel
        bundleCapture = {
          status: payload.status || 'idle',
          message: payload.message || (bundleHotkeyLabel === 'disabled' ? 'bundle hotkey disabled' : `bundle ${bundleHotkeyLabel}`),
          bundlePath: payload.bundle_path || null,
          bundleJSONPath: payload.bundle_json_path || null,
          trigger: payload.trigger || null,
          at: payload.at || Date.now(),
        }
        rerender()
        return
      }
      if (msg.type === 'bootstrap') {
        const p = msg.payload || msg
        if (p.displays) displays = normalizeDisplays(p.displays)
        if (p.canvases) canvases = p.canvases
        if (p.semantic_targets || p.targets) normalizeSemanticTargetsPayload(p)
        requestSemanticTargetsForLiveCanvases('surface_inspector_bootstrap')
        if (p.window) latestNativeWindowEvent = { ...p.window, ts: p.ts || Date.now(), ref: p.ref || '' }
        if (p.element) latestNativeAxElementEvent = { ...p.element, ts: p.ts || Date.now(), ref: p.ref || '' }
        if (p.cursor && typeof p.cursor.x === 'number' && typeof p.cursor.y === 'number') {
          nativeCursor = { x: p.cursor.x, y: p.cursor.y, valid: true }
          cursor = nativeToDesktopWorldPoint({ x: p.cursor.x, y: p.cursor.y }, displays) || { x: p.cursor.x, y: p.cursor.y, valid: true }
          cursor.valid = true
        }
        rerender()
        return
      }
      if (msg.type === 'canvas_inspector.semantic_targets') {
        normalizeSemanticTargetsPayload(msg.payload || msg)
        if (annotationState.annotation_mode.active) {
          refreshSettledAnnotationProjections('semantic_targets_refreshed')
        }
        rerender()
        return
      }
      if (msg.type === 'display_geometry') {
        const p = msg.payload || msg
        if (p.displays) displays = normalizeDisplays(p.displays)
        invalidateAnnotationProjections('display_geometry_changed', {
          settle_reason: 'display_geometry_settled',
          request_semantic_targets: 'display_geometry_changed',
          force_semantic_targets: true,
        })
        rerender()
        return
      }
      if (msg.type === 'window_entered' || msg.event === 'window_entered') {
        const p = msg.payload || msg.data || msg
        latestNativeWindowEvent = {
          ...p,
          ts: msg.ts || p.ts || Date.now(),
          ref: msg.ref || p.ref || '',
        }
        if (annotationState.annotation_mode.active) {
          invalidateAnnotationProjections('native_window_moved_or_changed', {
            settle_reason: 'native_window_settled',
          })
          scheduleAnnotationHoverRefresh('native_window_entered')
          syncDebugState()
        }
        return
      }
      if (msg.type === 'element_focused' || msg.event === 'element_focused') {
        const p = msg.payload || msg.data || msg
        latestNativeAxElementEvent = {
          ...p,
          ts: msg.ts || p.ts || Date.now(),
          ref: msg.ref || p.ref || '',
        }
        if (annotationState.annotation_mode.active) {
          invalidateAnnotationProjections('native_ax_stale_or_absent', {
            settle_reason: 'native_ax_settled',
          })
          scheduleAnnotationHoverRefresh('native_ax_element_focused')
          syncDebugState()
        }
        return
      }
      const input = normalizeCanvasInputMessage(msg)
      if (input) {
        const now = Date.now()
        const hasPoint = typeof input.x === 'number' && typeof input.y === 'number'
        const worldPoint = hasPoint
          ? (nativeToDesktopWorldPoint({ x: input.x, y: input.y }, displays) || { x: input.x, y: input.y, valid: true })
          : null
        let changed = false

        if ((cursorTrackingEnabled || mouseEventsEnabled || annotationState.annotation_mode.active) && worldPoint) {
          cursor = { ...worldPoint, valid: true }
          nativeCursor = hasPoint ? { x: input.x, y: input.y, valid: true } : { x: worldPoint.x, y: worldPoint.y, valid: true }
          changed = cursorTrackingEnabled
        }
        if (annotationState.annotation_mode.active && worldPoint && input.type === 'mouse_moved') {
          scheduleAnnotationHoverRefresh('mouse_moved')
          changed = true
        }
        if (mouseEventsEnabled && applyMouseEffectsInput(mouseEffectsState, input, worldPoint, now)) {
          changed = true
        }
        if (changed) {
          syncMinimapDynamicLayer(now)
          syncDebugState()
          syncControlledAnnotationDisplayOverlays()
          syncAnnotationActionControlCanvases()
        }
        return
      }
      if (msg.type === 'canvas_lifecycle') {
        eventCount++
        const lifecycle = msg.payload || msg.data || msg
        applyLifecycle(lifecycle)
        if (annotationCanvasLifecycleAffectsProjection(lifecycle)) {
          if (annotationState.annotation_mode.active) {
            invalidateAnnotationProjections('canvas_lifecycle_changed', {
              settle_reason: 'canvas_lifecycle_settled',
              request_semantic_targets: 'surface_inspector_lifecycle',
              force_semantic_targets: true,
            })
          } else {
            requestSemanticTargetsForLiveCanvases('surface_inspector_lifecycle')
          }
        }
        rerender()
        return
      }
      if (msg.type === 'canvas_object.marks') {
        const p = msg.payload || msg
        const canvasId = p.canvas_id
        if (!canvasId || typeof canvasId !== 'string') return
        eventCount++
        const normalized = normalizeMarks(canvasId, p.objects || [])
        applySnapshot(marksState, canvasId, normalized, Date.now())
        if (marksState.marksByCanvas.size > 0) marksScheduler.start()
        rerender()
        return
      }
      if (msg.type === 'input_region.snapshot' || msg.type === 'input_region') {
        if (applyInputRegionMessage(surfaceResourceState, msg)) {
          eventCount++
          rerender()
        }
        return
      }
      if (msg.type === 'canvas_object.registry') {
        if (applyStageLayerRegistryMessage(surfaceResourceState, msg)) {
          eventCount++
          rerender()
        }
      }
    },
  }
}
