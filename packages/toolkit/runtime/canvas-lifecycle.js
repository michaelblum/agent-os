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
  }
  const windowNumbers = data?.windowNumbers ?? canvas.windowNumbers ?? existing?.windowNumbers
  if (windowNumbers !== undefined) next.windowNumbers = windowNumbers
  const segments = data?.segments ?? canvas.segments ?? existing?.segments
  if (segments !== undefined) next.segments = segments
  return next
}
