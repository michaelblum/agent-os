import {
  normalizeCanvasFrameToDesktopWorld,
} from '../runtime/spatial.js'

const DEFAULT_CREATED_AT = '1970-01-01T00:00:00.000Z'

const PATH_PREFIX_BY_KIND = {
  desktop_world: 'desktop-world',
  visible_desktop_world: 'visible-desktop-world',
  display: 'display',
  app: 'app',
  window: 'window',
  canvas: 'canvas',
  surface: 'surface',
  viewport: 'viewport',
  pane: 'pane',
  document: 'document',
  browser_frame: 'frame',
  dom_element: 'dom',
  svg_node: 'svg',
  three_object: 'three',
  pdf_page: 'pdf-page',
  image_region: 'image-region',
  ax_element: 'ax',
  semantic_target: 'target',
  annotation_projection: 'annotation',
  text_range: 'text',
  point: 'point',
  region: 'region',
}

function asNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function asId(value, fallback) {
  const raw = value ?? fallback
  if (raw == null || raw === '') return null
  return String(raw)
}

function normalizeRect(rect) {
  if (!rect) return null
  const x = asNumber(rect.x)
  const y = asNumber(rect.y)
  const width = asNumber(rect.width ?? rect.w)
  const height = asNumber(rect.height ?? rect.h)
  if ([x, y, width, height].some((value) => value == null)) return null
  return { x, y, width, height }
}

function addRects(parent, child) {
  if (!parent || !child) return null
  return {
    x: parent.x + child.x,
    y: parent.y + child.y,
    width: child.width,
    height: child.height,
  }
}

function defaultAdapter(overrides = {}) {
  return {
    id: overrides.id ?? 'unknown',
    type: overrides.type ?? 'generic',
    confidence: asNumber(overrides.confidence) ?? 0,
    freshness: overrides.freshness ?? 'unknown',
    child_discovery: overrides.child_discovery ?? 'unknown',
    ...(overrides.reason ? { reason: String(overrides.reason) } : {}),
  }
}

function defaultCapabilities(overrides = {}) {
  return {
    hit_test: Boolean(overrides.hit_test),
    annotate: Boolean(overrides.annotate),
    project_annotation: Boolean(overrides.project_annotation),
    action: Boolean(overrides.action ?? overrides.click),
    capture: Boolean(overrides.capture),
    inspect_children: Boolean(overrides.inspect_children),
  }
}

function pathSegment(kind, id) {
  const prefix = PATH_PREFIX_BY_KIND[kind] ?? kind.replaceAll('_', '-')
  if (kind === 'desktop_world') return prefix
  const rawId = String(id)
  const prefixWithSeparator = `${prefix}:`
  return `${prefix}:${rawId.startsWith(prefixWithSeparator) ? rawId.slice(prefixWithSeparator.length) : rawId}`
}

function nodePath(node, parent) {
  if (node.path) return node.path
  const segment = pathSegment(node.kind, node.id)
  return parent?.path ? `${parent.path}/${segment}` : segment
}

function normalizeBounds(bounds = {}, parent = null) {
  const parentLocal = normalizeRect(bounds.parent_local ?? bounds.parentLocal ?? bounds.local ?? bounds)
  const explicitDesktopWorld = normalizeRect(bounds.desktop_world ?? bounds.desktopWorld)
  const desktopWorld = explicitDesktopWorld ?? addRects(parent?.bounds?.desktop_world, parentLocal)
  const out = {}
  if (parentLocal) out.parent_local = parentLocal
  if (desktopWorld) out.desktop_world = desktopWorld
  for (const [inKey, outKey] of [
    ['viewport_local', 'viewport_local'],
    ['viewportLocal', 'viewport_local'],
    ['lcs_local', 'lcs_local'],
    ['lcsLocal', 'lcs_local'],
    ['image_local', 'image_local'],
    ['imageLocal', 'image_local'],
    ['screen_projected', 'screen_projected'],
    ['screenProjected', 'screen_projected'],
  ]) {
    const rect = normalizeRect(bounds[inKey])
    if (rect) out[outKey] = rect
  }
  return out
}

function parentToDesktopTransform(parent, bounds) {
  if (!parent?.bounds?.desktop_world || !bounds?.parent_local || !bounds?.desktop_world) return null
  return {
    from: 'parent_local',
    to: 'desktop_world',
    status: 'available',
    translation: {
      x: parent.bounds.desktop_world.x,
      y: parent.bounds.desktop_world.y,
    },
    scale: { x: 1, y: 1 },
  }
}

export function createSpatialSubjectPath(parts = []) {
  return parts
    .filter((part) => part && part.kind && (part.kind === 'desktop_world' || part.id != null))
    .map((part) => pathSegment(part.kind, part.id))
    .join('/')
}

export function normalizeSpatialSubjectTree(input = {}) {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : []
  const byId = new Map()
  const nodes = []

  for (const rawNode of rawNodes) {
    const parent = rawNode.parent_id == null ? null : byId.get(String(rawNode.parent_id))
    const id = asId(rawNode.id, rawNode.kind)
    if (!id) continue
    const bounds = normalizeBounds(rawNode.bounds ?? {}, parent)
    const transforms = [
      ...(Array.isArray(rawNode.transforms) ? rawNode.transforms : []),
      parentToDesktopTransform(parent, bounds),
    ].filter(Boolean)
    const node = {
      id,
      parent_id: rawNode.parent_id == null ? null : String(rawNode.parent_id),
      path: nodePath({ ...rawNode, id }, parent),
      kind: rawNode.kind,
      label: String(rawNode.label ?? id),
      source: rawNode.source && typeof rawNode.source === 'object' ? { ...rawNode.source } : {},
      bounds,
      state: rawNode.state ?? 'unknown',
      adapter: defaultAdapter(rawNode.adapter),
      capabilities: defaultCapabilities(rawNode.capabilities),
      ...(rawNode.z_order != null ? { z_order: asNumber(rawNode.z_order) } : { z_order: null }),
      ...(rawNode.sibling_order != null ? { sibling_order: Number(rawNode.sibling_order) } : { sibling_order: null }),
      ...(transforms.length > 0 ? { transforms } : {}),
      ...(rawNode.points ? { points: rawNode.points } : {}),
      ...(rawNode.metadata ? { metadata: { ...rawNode.metadata } } : {}),
    }
    byId.set(node.id, node)
    nodes.push(node)
  }

  const root = input.root ?? nodes.find((node) => node.parent_id == null)?.id ?? 'desktop-world'
  return {
    schema: 'spatial_subject_tree',
    version: input.version ?? '0.1.0',
    created_at: input.created_at ?? input.createdAt ?? DEFAULT_CREATED_AT,
    root,
    nodes,
    ...(Array.isArray(input.edges) ? { edges: input.edges } : {}),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  }
}

function windowDesktopRect(window, topology) {
  const rect = normalizeRect(window.desktop_world_bounds ?? window.desktopWorldBounds)
  if (rect) return rect
  const native = normalizeRect(window.bounds)
  const origin = normalizeRect(topology?.native_desktop_bounds ?? topology?.nativeDesktopBounds)
  if (!native || !origin) return null
  return {
    x: native.x - origin.x,
    y: native.y - origin.y,
    width: native.width,
    height: native.height,
  }
}

function canvasRect(canvas, topology) {
  const displays = Array.isArray(topology?.displays) ? topology.displays : []
  if (displays.length > 0) {
    const frame = normalizeCanvasFrameToDesktopWorld(canvas, displays)
    return frame?.rect ? normalizeRect(frame.rect) : null
  }
  const explicitDesktopWorld = normalizeRect(canvas.desktop_world_bounds ?? canvas.desktopWorldBounds)
  if (explicitDesktopWorld) return explicitDesktopWorld
  // Without display topology, this helper can only preserve records that were
  // already reduced to a single caller-owned frame.
  return normalizeRect(canvas.bounds ?? canvas.frame ?? canvas.desktop_world_bounds ?? canvas.desktopWorldBounds)
}

function firstWindowId(topology) {
  for (const display of topology?.displays ?? []) {
    const window = display.windows?.[0]
    if (window?.window_id != null) return String(window.window_id)
  }
  return null
}

export function buildSpatialSubjectTree({
  spatial_topology,
  topology,
  canvases = [],
  surfaces = [],
  semantic_targets = [],
  annotation_projections = [],
  created_at,
  metadata = {},
} = {}) {
  const snapshot = spatial_topology ?? topology ?? {}
  const nodes = []
  const rootId = 'desktop-world'
  nodes.push({
    id: rootId,
    parent_id: null,
    kind: 'desktop_world',
    label: 'DesktopWorld',
    source: {},
    bounds: { desktop_world: snapshot.desktop_world_bounds },
    state: 'visible',
    adapter: { id: 'spatial-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
    capabilities: { hit_test: true, annotate: false, inspect_children: true },
  })

  const windowParentById = new Map()
  for (const [displayIndex, display] of (snapshot.displays ?? []).entries()) {
    const displayId = asId(display.display_id ?? display.id ?? display.ordinal, displayIndex + 1)
    const displayNodeId = `display:${displayId}`
    nodes.push({
      id: displayNodeId,
      parent_id: rootId,
      kind: 'display',
      label: display.label ?? `Display ${display.ordinal ?? displayId}`,
      source: { display_id: display.display_id ?? display.id ?? displayId },
      bounds: { parent_local: display.desktop_world_bounds ?? display.bounds, desktop_world: display.desktop_world_bounds ?? display.bounds },
      sibling_order: displayIndex,
      state: 'visible',
      adapter: { id: 'spatial-topology', type: 'spatial_topology', confidence: 1, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: { hit_test: true, annotate: false, inspect_children: true },
    })

    for (const [windowIndex, window] of (display.windows ?? []).entries()) {
      const windowId = asId(window.window_id, windowIndex)
      const nodeId = `window:${windowId}`
      const desktopRect = windowDesktopRect(window, snapshot)
      nodes.push({
        id: nodeId,
        parent_id: displayNodeId,
        kind: 'window',
        label: window.title || window.app_name || `Window ${windowId}`,
        source: {
          window_id: window.window_id ?? windowId,
          app_pid: window.app_pid,
          app_bundle_id: window.bundle_id ?? null,
        },
        bounds: { desktop_world: desktopRect },
        z_order: windowIndex,
        sibling_order: windowIndex,
        state: window.is_on_screen === false ? 'hidden' : 'visible',
        adapter: { id: 'spatial-topology', type: 'spatial_topology', confidence: 0.9, freshness: 'snapshot', child_discovery: 'partial' },
        capabilities: { hit_test: true, annotate: false, inspect_children: true, capture: true },
      })
      windowParentById.set(windowId, nodeId)
    }
  }

  const defaultWindowId = firstWindowId(snapshot)
  const surfaceParentById = new Map()
  for (const [canvasIndex, canvas] of canvases.entries()) {
    const canvasId = asId(canvas.id ?? canvas.canvas_id, canvasIndex)
    const parentId = windowParentById.get(asId(canvas.window_id, defaultWindowId)) ?? windowParentById.get(defaultWindowId) ?? rootId
    nodes.push({
      id: `canvas:${canvasId}`,
      parent_id: parentId,
      kind: 'canvas',
      label: canvas.label ?? canvas.title ?? canvasId,
      source: { canvas_id: canvasId, window_id: canvas.window_id ?? defaultWindowId },
      bounds: { parent_local: canvas.parent_local_bounds, desktop_world: canvasRect(canvas, snapshot) },
      sibling_order: canvasIndex,
      state: canvas.hidden ? 'hidden' : 'visible',
      adapter: { id: 'aos-canvas', type: 'aos_canvas', confidence: 0.9, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: { hit_test: true, annotate: true, capture: true, inspect_children: true },
    })
  }

  const targetSurfaces = surfaces.length > 0
    ? surfaces
    : [...new Set(semantic_targets.map((target) => target.surface ?? target.provenance?.canvas_id).filter(Boolean))]
      .map((id) => ({
        id,
        canvas_id: semantic_targets.find((target) => (target.surface ?? target.provenance?.canvas_id) === id)?.provenance?.canvas_id,
      }))

  for (const [surfaceIndex, surface] of targetSurfaces.entries()) {
    const surfaceId = asId(surface.id ?? surface.surface_id, surfaceIndex)
    const canvasId = asId(surface.canvas_id ?? surface.canvasId, canvases[0]?.id ?? canvases[0]?.canvas_id)
    const parentId = canvasId ? `canvas:${canvasId}` : rootId
    nodes.push({
      id: `surface:${surfaceId}`,
      parent_id: parentId,
      kind: surface.kind ?? 'surface',
      label: surface.label ?? surfaceId,
      source: {
        surface_id: surfaceId,
        canvas_id: canvasId,
        file_path: surface.source_path ?? null,
        url: surface.source_url ?? null,
        subject_id: surface.subject_id ?? null,
      },
      bounds: { parent_local: surface.bounds ?? surface.parent_local_bounds ?? null },
      sibling_order: surfaceIndex,
      state: surface.state ?? 'visible',
      adapter: { id: surface.adapter_id ?? 'surface-adapter', type: surface.adapter_type ?? 'generic', confidence: 0.7, freshness: 'snapshot', child_discovery: 'partial' },
      capabilities: { hit_test: true, annotate: true, project_annotation: true, capture: true, inspect_children: true },
    })
    surfaceParentById.set(surfaceId, `surface:${surfaceId}`)
  }

  for (const [targetIndex, target] of semantic_targets.entries()) {
    const provenance = target.provenance && typeof target.provenance === 'object' ? target.provenance : {}
    const extension = target.extension && typeof target.extension === 'object' ? target.extension : {}
    const canvasId = asId(provenance.canvas_id, null)
    const surfaceId = asId(target.surface ?? canvasId, canvasId)
    const parentId = surfaceParentById.get(surfaceId) ?? (canvasId ? `canvas:${canvasId}` : rootId)
    const targetId = asId(target.ref, targetIndex)
    const bounds = provenance.bounds ?? provenance.frame ?? null
    const actions = Array.isArray(target.actions) ? target.actions : []
    const doTarget = provenance.do_target ?? null
    nodes.push({
      id: `target:${targetId}`,
      parent_id: parentId,
      kind: 'semantic_target',
      label: target.name ?? target.label ?? target.role ?? targetId,
      source: {
        canvas_id: canvasId,
        surface_id: surfaceId,
        subject_id: targetId,
        adapter_subject_id: doTarget ?? targetId,
      },
      bounds: { parent_local: bounds },
      sibling_order: targetIndex,
      state: target.enabled === false ? 'hidden' : 'visible',
      adapter: { id: 'aos-semantic-targets', type: 'aos_canvas', confidence: 0.85, freshness: 'snapshot', child_discovery: 'complete' },
      capabilities: { hit_test: true, annotate: true, action: actions.length > 0 || Boolean(doTarget), capture: true, inspect_children: false },
      metadata: {
        role: target.role ?? null,
        actions,
        dom_id: extension.dom_id ?? null,
        do_target: doTarget,
        state: target.state ?? null,
      },
    })
  }

  for (const [projectionIndex, projection] of annotation_projections.entries()) {
    const surfaceId = asId(projection.surface_id ?? projection.surfaceId, targetSurfaces[0]?.id ?? targetSurfaces[0]?.surface_id)
    const parentId = surfaceParentById.get(surfaceId) ?? rootId
    const projectionId = asId(projection.annotation_id ?? projection.id, projectionIndex)
    const rect = Array.isArray(projection.rects) ? projection.rects[0] : projection.bounds
    nodes.push({
      id: `annotation:${projectionId}`,
      parent_id: parentId,
      kind: 'annotation_projection',
      label: projection.label ?? `Annotation ${projectionId}`,
      source: { surface_id: surfaceId, subject_id: projectionId },
      bounds: { viewport_local: rect },
      sibling_order: projectionIndex,
      state: projection.status === 'out_of_viewport' ? 'out_of_viewport' : projection.status === 'resolved' ? 'visible' : 'unknown',
      adapter: { id: 'annotation-projection', type: 'generic', confidence: asNumber(projection.confidence) ?? 0.5, freshness: 'snapshot', child_discovery: 'unsupported' },
      capabilities: { hit_test: false, annotate: false, project_annotation: true, capture: true, inspect_children: false },
      metadata: { status: projection.status ?? 'unknown', anchor_type: projection.anchor_type ?? null },
    })
  }

  return normalizeSpatialSubjectTree({
    version: '0.1.0',
    created_at: created_at ?? snapshot.timestamp ?? DEFAULT_CREATED_AT,
    root: rootId,
    nodes,
    metadata: {
      ...metadata,
      source_schema: snapshot.schema ?? null,
    },
  })
}

export function assertSpatialSubjectTreeShape(tree) {
  if (!tree || tree.schema !== 'spatial_subject_tree') {
    throw new TypeError('expected spatial_subject_tree')
  }
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    throw new TypeError('spatial subject tree requires nodes')
  }
  const ids = new Set(tree.nodes.map((node) => node.id))
  if (!ids.has(tree.root)) {
    throw new TypeError(`root node ${tree.root} is missing`)
  }
  for (const node of tree.nodes) {
    if (!node.path) throw new TypeError(`node ${node.id} is missing path`)
    if (node.parent_id != null && !ids.has(node.parent_id)) {
      throw new TypeError(`node ${node.id} references missing parent ${node.parent_id}`)
    }
  }
  return true
}
