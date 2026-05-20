// canvas-lifecycle.js — normalize daemon canvas_lifecycle payloads.
//
// The daemon keeps top-level compatibility fields (`canvas_id`, `action`, `at`)
// while also attaching a richer `canvas` object. Consumers should merge both
// shapes through this helper so late-created children and track metadata stay
// coherent across live events and subscribe snapshots.

export function canvasLifecycleCanvasID(data) {
  return data?.canvas_id || data?.id || data?.canvas?.id || null
}

export function mergeCanvasLifecycleCanvas(existing, data) {
  const id = canvasLifecycleCanvasID(data)
  if (!id) return null

  const canvas = (data?.canvas && typeof data.canvas === 'object') ? data.canvas : {}
  const next = {
    ...(existing || {}),
    ...canvas,
    id,
    at: data?.at || canvas.at || existing?.at || [0, 0, 0, 0],
    parent: data?.parent ?? canvas.parent ?? existing?.parent ?? null,
    track: data?.track ?? canvas.track ?? existing?.track ?? null,
    interactive: data?.interactive ?? canvas.interactive ?? existing?.interactive ?? false,
    scope: data?.scope ?? canvas.scope ?? existing?.scope ?? 'global',
    ttl: data?.ttl ?? canvas.ttl ?? existing?.ttl ?? null,
    cascade: data?.cascade ?? canvas.cascade ?? existing?.cascade ?? null,
    suspended: data?.suspended ?? canvas.suspended ?? existing?.suspended ?? null,
    lifecycle_state: data?.lifecycle_state ?? canvas.lifecycle_state ?? existing?.lifecycle_state ?? null,
  }
  const windowNumbers = data?.windowNumbers ?? canvas.windowNumbers ?? existing?.windowNumbers
  if (windowNumbers !== undefined) next.windowNumbers = windowNumbers
  const segments = data?.segments ?? canvas.segments ?? existing?.segments
  if (segments !== undefined) next.segments = segments
  const owner = data?.owner ?? canvas.owner ?? existing?.owner
  if (owner !== undefined) next.owner = owner
  return next
}

export function canvasGeometryCanvasID(data) {
  return data?.canvas_id || data?.id || data?.canvas?.id || null
}

export function normalizeCanvasGeometry(data = {}) {
  const id = canvasGeometryCanvasID(data)
  if (!id) return null
  const frame = data.frame || data.at || data.canvas?.at || null
  if (!Array.isArray(frame) || frame.length < 4) return null
  return {
    canvas_id: id,
    change: data.change || 'frame',
    cause: data.cause || 'unknown',
    phase: data.phase || 'settled',
    transaction_id: data.transaction_id || null,
    frame,
    previous_frame: Array.isArray(data.previous_frame) ? data.previous_frame : null,
    canvas: data.canvas && typeof data.canvas === 'object' ? data.canvas : null,
  }
}

export function mergeCanvasGeometryCanvas(existing, data) {
  const geometry = normalizeCanvasGeometry(data)
  if (!geometry) return null
  const canvas = geometry.canvas || {}
  return {
    ...(existing || {}),
    ...canvas,
    id: geometry.canvas_id,
    at: geometry.frame,
    interactive: data?.interactive ?? canvas.interactive ?? existing?.interactive ?? false,
    parent: data?.parent ?? canvas.parent ?? existing?.parent ?? null,
    track: data?.track ?? canvas.track ?? existing?.track ?? null,
    scope: data?.scope ?? canvas.scope ?? existing?.scope ?? 'global',
    lifecycle_state: data?.lifecycle_state ?? canvas.lifecycle_state ?? existing?.lifecycle_state ?? null,
  }
}
