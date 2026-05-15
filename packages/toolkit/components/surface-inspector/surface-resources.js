// surface-resources.js — pure model for inspector-visible toolkit resources.

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function cloneFrame(frame = null) {
  if (Array.isArray(frame)) {
    return [
      finiteNumber(frame[0], 0),
      finiteNumber(frame[1], 0),
      Math.max(1, finiteNumber(frame[2], 1)),
      Math.max(1, finiteNumber(frame[3], 1)),
    ]
  }
  if (frame && typeof frame === 'object') {
    return [
      finiteNumber(frame.x ?? frame.left, 0),
      finiteNumber(frame.y ?? frame.top, 0),
      Math.max(1, finiteNumber(frame.w ?? frame.width, 1)),
      Math.max(1, finiteNumber(frame.h ?? frame.height, 1)),
    ]
  }
  return null
}

function metadataFrom(value = {}) {
  return value && typeof value === 'object' ? { ...value } : {}
}

function canvasIdSet(canvases = []) {
  return new Set(canvases.map((canvas) => text(canvas?.id)).filter(Boolean))
}

function affordanceIdFrom(metadata = {}) {
  return text(metadata.toolkit_affordance_id || metadata.affordance_id || metadata.resource_scope_id)
}

function ownerCanvasIdFromLayer(layer = {}) {
  const metadata = metadataFrom(layer.metadata)
  return text(
    layer.owner_canvas_id
      || layer.ownerCanvasId
      || layer.source_canvas_id
      || metadata.owner_canvas_id
      || metadata.ownerCanvasId
      || metadata.source_canvas_id
      || metadata.sourceCanvasId
      || metadata.canvas_id
      || layer.canvas_id
  )
}

function normalizeStageLayerObject(object = {}, fallbackCanvasId = '') {
  const metadata = metadataFrom(object.metadata)
  const layerMetadata = metadataFrom(metadata.stage_layer || metadata.layer)
  const objectId = text(object.object_id || object.id)
  const stageLayerId = text(metadata.stage_layer_id || layerMetadata.id || objectId)
  if (!stageLayerId) return null
  const frame = cloneFrame(metadata.frame || layerMetadata.frame || object.frame || object.bounds)
  return {
    id: stageLayerId,
    objectId,
    kind: text(metadata.stage_layer_kind || layerMetadata.kind || object.kind, 'stage_layer'),
    label: text(object.name || object.label || metadata.label || layerMetadata.label, stageLayerId),
    frame,
    zIndex: Math.round(finiteNumber(metadata.z_index ?? metadata.zIndex ?? layerMetadata.zIndex ?? object.zIndex ?? object.z_index, 0)),
    ownerCanvasId: ownerCanvasIdFromLayer({ ...layerMetadata, metadata }) || text(fallbackCanvasId),
    sourceCanvasId: text(metadata.source_canvas_id || metadata.sourceCanvasId || fallbackCanvasId),
    affordanceId: affordanceIdFrom(metadata),
    metadata,
    raw: object,
  }
}

function normalizeInputRegion(region = {}) {
  const id = text(region.id || region.region_id)
  if (!id) return null
  const metadata = metadataFrom(region.metadata)
  return {
    id,
    ownerCanvasId: text(region.owner_canvas_id || region.ownerCanvasId),
    semanticLabel: text(region.semantic_label || region.label, id),
    consumePolicy: text(region.consume_policy || region.consumePolicy, 'captured'),
    coordinateSpace: text(region.coordinate_space || region.coordinateSpace, 'native'),
    frame: cloneFrame(region.frame || region.native || region.bounds),
    enabled: region.enabled !== false,
    affordanceId: affordanceIdFrom(metadata),
    metadata,
    raw: region,
  }
}

function statusForResource(ownerCanvasId, canvasIds, extra = []) {
  const statuses = ['active', ...extra]
  if (ownerCanvasId && !canvasIds.has(ownerCanvasId)) statuses.push('orphaned_owner_missing')
  return [...new Set(statuses)]
}

function statusSummary(layers, regions, affordances) {
  const suspicious = new Set()
  for (const layer of layers) {
    if (layer.statuses.some((status) => status !== 'active')) suspicious.add(layer.id)
  }
  for (const region of regions) {
    if (region.statuses.some((status) => status !== 'active')) suspicious.add(region.id)
  }
  for (const affordance of affordances) {
    if (affordance.statuses.some((status) => status !== 'active')) suspicious.add(affordance.id)
  }
  return {
    active: layers.length + regions.length,
    staleOrSuspicious: suspicious.size,
  }
}

export function createSurfaceResourceState() {
  return {
    inputRegions: new Map(),
    stageLayerRegistries: new Map(),
  }
}

export function applyInputRegionMessage(state, message = {}) {
  if (!state?.inputRegions || !message) return false
  if (message.type === 'input_region.snapshot') {
    state.inputRegions.clear()
    for (const region of message.regions || []) {
      const normalized = normalizeInputRegion(region)
      if (normalized) state.inputRegions.set(normalized.id, normalized)
    }
    return true
  }
  if (message.type !== 'input_region') return false
  const action = text(message.action || message.payload?.action || message.data?.action)
  const region = message.region || message.payload?.region || message.data?.region
  const normalized = normalizeInputRegion(region)
  if (!action || !normalized) return false
  if (action === 'removed') state.inputRegions.delete(normalized.id)
  else if (action === 'registered' || action === 'updated') state.inputRegions.set(normalized.id, normalized)
  else return false
  return true
}

export function applyStageLayerRegistryMessage(state, message = {}) {
  if (!state?.stageLayerRegistries || message?.type !== 'canvas_object.registry') return false
  const canvasId = text(message.canvas_id || message.payload?.canvas_id || message.data?.canvas_id || message.source_id)
  const objects = message.objects || message.payload?.objects || message.data?.objects
  if (!canvasId || !Array.isArray(objects)) return false
  const stageLayers = objects
    .filter((object) => {
      const metadata = metadataFrom(object.metadata)
      return metadata.inspector_surface_resource_type === 'desktop_world_stage_layer'
        || metadata.stage_layer_id
        || object.kind === 'desktop_world_stage.layer'
    })
    .map((object) => normalizeStageLayerObject(object, canvasId))
    .filter(Boolean)
  if (stageLayers.length) state.stageLayerRegistries.set(canvasId, stageLayers)
  else state.stageLayerRegistries.delete(canvasId)
  return true
}

export function removeSurfaceResourcesForCanvas(state, canvasId) {
  const id = text(canvasId)
  if (!id || !state) return false
  let changed = false
  if (state.stageLayerRegistries?.delete?.(id)) changed = true
  return changed
}

export function buildSurfaceResourceSnapshot(state, {
  canvases = [],
} = {}) {
  const canvasIds = canvasIdSet(canvases)
  const stageLayers = [...(state?.stageLayerRegistries?.values?.() || [])]
    .flat()
    .map((layer) => ({ ...layer }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const inputRegions = [...(state?.inputRegions?.values?.() || [])]
    .map((region) => ({ ...region }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const layersByAffordance = new Map()
  const regionsByAffordance = new Map()
  for (const layer of stageLayers) {
    if (!layer.affordanceId) continue
    if (!layersByAffordance.has(layer.affordanceId)) layersByAffordance.set(layer.affordanceId, [])
    layersByAffordance.get(layer.affordanceId).push(layer)
  }
  for (const region of inputRegions) {
    if (!region.affordanceId) continue
    if (!regionsByAffordance.has(region.affordanceId)) regionsByAffordance.set(region.affordanceId, [])
    regionsByAffordance.get(region.affordanceId).push(region)
  }

  const affordanceIds = new Set([...layersByAffordance.keys(), ...regionsByAffordance.keys()])
  const affordances = [...affordanceIds].sort().map((id) => {
    const layers = layersByAffordance.get(id) || []
    const regions = regionsByAffordance.get(id) || []
    const ownerCanvasId = text(layers[0]?.ownerCanvasId || regions[0]?.ownerCanvasId)
    const statuses = statusForResource(ownerCanvasId, canvasIds, [
      ...(layers.length === 0 ? ['region_without_stage_layer'] : []),
      ...(regions.length === 0 ? ['stage_layer_without_region'] : []),
    ])
    return {
      id,
      ownerCanvasId,
      stageLayerIds: layers.map((layer) => layer.id),
      inputRegionIds: regions.map((region) => region.id),
      statuses,
    }
  })

  const layerAffordanceIdsWithRegions = new Set(
    affordances.filter((affordance) => affordance.inputRegionIds.length > 0).map((affordance) => affordance.id),
  )
  const regionAffordanceIdsWithLayers = new Set(
    affordances.filter((affordance) => affordance.stageLayerIds.length > 0).map((affordance) => affordance.id),
  )

  for (const layer of stageLayers) {
    layer.statuses = statusForResource(layer.ownerCanvasId, canvasIds, [
      ...(layer.affordanceId && !layerAffordanceIdsWithRegions.has(layer.affordanceId) ? ['stage_layer_without_region'] : []),
      ...(!layer.affordanceId ? ['stage_layer_without_region'] : []),
    ])
  }
  for (const region of inputRegions) {
    region.statuses = statusForResource(region.ownerCanvasId, canvasIds, [
      ...(region.affordanceId && !regionAffordanceIdsWithLayers.has(region.affordanceId) ? ['region_without_stage_layer'] : []),
      ...(!region.affordanceId ? ['region_without_stage_layer'] : []),
      ...(region.enabled === false ? ['cleanup_suspect'] : []),
    ])
  }

  const counts = {
    stageLayers: stageLayers.length,
    inputRegions: inputRegions.length,
    affordances: affordances.length,
    staleOrSuspicious: statusSummary(stageLayers, inputRegions, affordances).staleOrSuspicious,
  }

  return {
    stageLayers,
    inputRegions,
    affordances,
    counts,
  }
}
