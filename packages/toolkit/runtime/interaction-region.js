const POINTER_PHASES = {
  left_mouse_down: 'down',
  left_mouse_dragged: 'drag',
  mouse_moved: 'move',
  left_mouse_up: 'up',
  pointer_cancel: 'cancel',
  mouse_cancel: 'cancel',
}

function pointFromEvent(event = {}) {
  const x = Number(event.x)
  const y = Number(event.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y, valid: true }
}

function sourceName(options = {}) {
  return options.source || (options.assumeInside ? 'hit' : 'global')
}

function regionPriority(region = {}) {
  return Number(region.priority ?? 0)
}

function sortRegions(a, b) {
  const priority = regionPriority(b) - regionPriority(a)
  if (priority !== 0) return priority
  return String(a.id).localeCompare(String(b.id))
}

export function pointerPhase(type) {
  return POINTER_PHASES[type] || null
}

export function createDesktopWorldInteractionRouter(options = {}) {
  const regions = new Map()
  let capture = null
  let outsidePointerDown = false
  let suppressNextOutsideUp = false

  function registerRegion(region = {}) {
    if (!region.id) throw new Error('interaction region requires an id')
    if (typeof region.onPointer !== 'function') throw new Error(`interaction region ${region.id} requires onPointer`)
    regions.set(region.id, region)
    return () => regions.delete(region.id)
  }

  function unregisterRegion(id) {
    regions.delete(id)
    if (capture?.region?.id === id) capture = null
  }

  function pickRegion(point, routeOptions = {}) {
    if (routeOptions.regionId && regions.has(routeOptions.regionId)) {
      return regions.get(routeOptions.regionId)
    }
    if (!point) return null
    return [...regions.values()]
      .filter((region) => {
        if (routeOptions.assumeInside && (!routeOptions.regionId || routeOptions.regionId === region.id)) {
          return true
        }
        return typeof region.contains === 'function' && region.contains(point)
      })
      .sort(sortRegions)[0] || null
  }

  function dispatch(region, phase, rawEvent, routeOptions = {}) {
    const point = pointFromEvent(rawEvent)
    return region.onPointer({
      ...rawEvent,
      phase,
      point,
      source: sourceName(routeOptions),
      regionId: region.id,
      captured: capture?.region?.id === region.id,
    }) !== false
  }

  function dispatchOutside(phase, rawEvent, routeOptions = {}) {
    const handler = options.onOutsidePointer
    if (typeof handler !== 'function') return false
    const point = pointFromEvent(rawEvent)
    return handler({
      ...rawEvent,
      phase,
      point,
      source: sourceName(routeOptions),
    }) !== false
  }

  function route(rawEvent = {}, routeOptions = {}) {
    const phase = routeOptions.phase || pointerPhase(rawEvent.type)
    if (!phase) return false
    const source = sourceName(routeOptions)
    const point = pointFromEvent(rawEvent)

    if (capture) {
      if (capture.source !== source) return true
      const handled = dispatch(capture.region, phase, rawEvent, routeOptions)
      if (phase === 'up' || phase === 'cancel') {
        capture = null
        suppressNextOutsideUp = true
      }
      return handled
    }

    if (phase === 'down') {
      const region = pickRegion(point, routeOptions)
      if (region) {
        capture = { region, source }
        outsidePointerDown = false
        return dispatch(region, phase, rawEvent, routeOptions)
      }
      outsidePointerDown = true
      return dispatchOutside(phase, rawEvent, routeOptions) || true
    }

    if (phase === 'up' || phase === 'cancel') {
      const region = pickRegion(point, routeOptions)
      if (region && !outsidePointerDown) {
        return dispatch(region, phase, rawEvent, routeOptions)
      }
      if (suppressNextOutsideUp) {
        suppressNextOutsideUp = false
        outsidePointerDown = false
        return true
      }
      const shouldNotifyOutside = outsidePointerDown || phase === 'up'
      outsidePointerDown = false
      return shouldNotifyOutside ? (dispatchOutside(phase, rawEvent, routeOptions) || true) : false
    }

    const region = pickRegion(point, routeOptions)
    if (region) return dispatch(region, phase, rawEvent, routeOptions)
    return false
  }

  function reset() {
    capture = null
    outsidePointerDown = false
    suppressNextOutsideUp = false
  }

  function snapshot() {
    return {
      capturedRegionId: capture?.region?.id || null,
      capturedSource: capture?.source || null,
      outsidePointerDown,
      suppressNextOutsideUp,
      regionCount: regions.size,
    }
  }

  return {
    registerRegion,
    unregisterRegion,
    route,
    reset,
    snapshot,
  }
}
