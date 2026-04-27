const POINTER_PHASES = {
  left_mouse_down: 'down',
  left_mouse_dragged: 'drag',
  mouse_moved: 'move',
  left_mouse_up: 'up',
  right_mouse_down: 'down',
  right_mouse_dragged: 'drag',
  right_mouse_up: 'up',
  middle_mouse_down: 'down',
  middle_mouse_dragged: 'drag',
  middle_mouse_up: 'up',
  other_mouse_down: 'down',
  other_mouse_dragged: 'drag',
  other_mouse_up: 'up',
  scroll_wheel: 'scroll',
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

function defaultCaptureId(rawEvent = {}, region = {}) {
  const sequence = rawEvent.sequence
  if (sequence && typeof sequence === 'object' && sequence.source !== undefined && sequence.value !== undefined) {
    return `${sequence.source}:${sequence.value}:${region.id}`
  }
  if (rawEvent.gesture_id) return `${rawEvent.gesture_id}:${region.id}`
  if (rawEvent.gestureId) return `${rawEvent.gestureId}:${region.id}`
  return `capture:${region.id}`
}

export function pointerPhase(type) {
  return POINTER_PHASES[type] || null
}

export function createDesktopWorldInteractionRouter(options = {}) {
  const regions = new Map()
  let capture = null
  const hoverBySource = new Map()
  let outsidePointerDown = false
  let suppressNextOutsideUp = false

  function registerRegion(region = {}) {
    if (!region.id) throw new Error('interaction region requires an id')
    if (typeof region.onPointer !== 'function') throw new Error(`interaction region ${region.id} requires onPointer`)
    regions.set(region.id, region)
    return () => regions.delete(region.id)
  }

  function cancelCapture(reason = 'cancelled', rawEvent = {}) {
    if (!capture) return false
    const current = capture
    dispatch(current.region, 'cancel', {
      type: 'pointer_cancel',
      cancel_reason: reason,
      cancelReason: reason,
      ...rawEvent,
    }, { source: current.source })
    capture = null
    suppressNextOutsideUp = true
    return true
  }

  function releaseCapture(captureId = null, reason = 'released') {
    if (!capture) return false
    if (captureId && capture.captureId !== captureId) return false
    return cancelCapture(reason)
  }

  function unregisterRegion(id) {
    if (capture?.region?.id === id) cancelCapture('region_unregistered')
    for (const [source, hovered] of hoverBySource.entries()) {
      if (hovered?.region?.id !== id) continue
      dispatch(hovered.region, 'hover_cancel', {
        type: 'pointer_cancel',
        cancel_reason: 'region_unregistered',
        cancelReason: 'region_unregistered',
        x: hovered.point?.x,
        y: hovered.point?.y,
      }, { source })
      hoverBySource.delete(source)
    }
    regions.delete(id)
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
      captureId: capture?.region?.id === region.id ? capture.captureId : null,
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

  function updateHover(rawEvent, routeOptions = {}) {
    const source = sourceName(routeOptions)
    const point = pointFromEvent(rawEvent)
    const previous = hoverBySource.get(source) || null
    const nextRegion = pickRegion(point, routeOptions)
    let handled = false

    if (previous?.region && previous.region.id !== nextRegion?.id) {
      handled = dispatch(previous.region, 'leave', rawEvent, routeOptions) || handled
    }
    if (nextRegion && previous?.region?.id !== nextRegion.id) {
      handled = dispatch(nextRegion, 'enter', rawEvent, routeOptions) || handled
    }
    if (nextRegion) {
      hoverBySource.set(source, { region: nextRegion, point })
      handled = dispatch(nextRegion, 'hover', rawEvent, routeOptions) || handled
      return handled
    }

    hoverBySource.delete(source)
    return handled
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

    if (phase === 'move') {
      return updateHover(rawEvent, routeOptions)
    }

    if (phase === 'down') {
      const region = pickRegion(point, routeOptions)
      if (region) {
        capture = {
          region,
          source,
          captureId: routeOptions.captureId || rawEvent.capture_id || rawEvent.captureId || defaultCaptureId(rawEvent, region),
        }
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
    hoverBySource.clear()
    outsidePointerDown = false
    suppressNextOutsideUp = false
  }

  function snapshot() {
    return {
      capturedRegionId: capture?.region?.id || null,
      capturedSource: capture?.source || null,
      hoveredRegions: [...hoverBySource.entries()].map(([source, hovered]) => ({
        source,
        regionId: hovered?.region?.id || null,
        point: hovered?.point || null,
      })),
      outsidePointerDown,
      suppressNextOutsideUp,
      regionCount: regions.size,
    }
  }

  return {
    registerRegion,
    unregisterRegion,
    route,
    releaseCapture,
    reset,
    snapshot,
  }
}
