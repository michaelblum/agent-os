import { resolveSceneRadialMenuLayout } from './scene-radial-menu.js'

const SAFE_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu

export const SCENE_INTERACTION_VISUAL_LIMITS = Object.freeze({
  maxRadialItems: 32,
  maxRouteDurationMs: 5000,
  maxTrailCount: 16,
})

const DEFAULT_ARROW_STYLE = Object.freeze({
  accentColor: '#9b7cff',
  color: '#f7f5ff',
  dashColor: '#ffffff',
  dashGap: 7,
  dashLength: 10,
  dashOpacity: 0.9,
  dashSpeed: 42,
  dashWidth: 2,
  glowColor: '#53f5d7',
  glowOpacity: 0.48,
  glowWidth: 7,
  headLength: 28,
  headLengthDistanceFactor: 0.11,
  headLengthMax: 24,
  headLengthMin: 12,
  headWingRadians: Math.PI * 0.78,
  headWidth: 18,
  originInset: 0,
  originRingColor: '#ffffff',
  originRingOpacity: 0.38,
  originRingRadius: 10,
  pulseHz: 1.5,
  reticleColor: '#53f5d7',
  reticlePulse: 3,
  reticleRadius: 13,
  shaftWidth: 4,
  trailCount: 6,
  trailOpacity: 0.38,
  trailSpacing: 0.08,
})

const DEFAULT_WORMHOLE_STYLE = Object.freeze({
  color: '#9b7cff',
  flash: 1.4,
  ringRadius: 72,
  spin: 2.4,
})

const DEFAULT_RADIAL_STYLE = Object.freeze({
  activeColor: '#ffffff',
  fillColor: '#201b2f',
  itemRadius: 20,
  opacity: 0.94,
  radius: 86,
})

const REJECTED_VISUAL_RESULT = Object.freeze({ accepted: false, routeStarted: false })
const ACCEPTED_VISUAL_RESULT = Object.freeze({ accepted: true, routeStarted: false })
const STARTED_ROUTE_RESULT = Object.freeze({ accepted: true, routeStarted: true })

function finite(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function color(value, fallback) {
  return typeof value === 'string' && SAFE_COLOR.test(value) ? value : fallback
}

function copyPoint(target, source, fallback = 0) {
  target[0] = finite(source?.x ?? source?.[0], fallback, -1e6, 1e6)
  target[1] = finite(source?.y ?? source?.[1], fallback, -1e6, 1e6)
  if (target.length > 2) target[2] = finite(source?.z ?? source?.[2], fallback, -1e6, 1e6)
  return target
}

function cubicInOut(value) {
  return value < 0.5 ? 4 * value ** 3 : 1 - ((-2 * value + 2) ** 3) / 2
}

function eased(value, implementation) {
  if (implementation === 'linear') return value
  if (implementation === 'ease_out_quart') return 1 - (1 - value) ** 4
  if (implementation === 'smoothstep') return value * value * (3 - 2 * value)
  return cubicInOut(value)
}

function containingDisplay(topology, point) {
  const displays = Array.isArray(topology?.displays) ? topology.displays.slice(0, 16) : []
  return displays.find((display) => {
    const bounds = display?.bounds
    return Array.isArray(bounds) && bounds.length === 4
      && point[0] >= bounds[0] && point[0] <= bounds[0] + bounds[2]
      && point[1] >= bounds[1] && point[1] <= bounds[1] + bounds[3]
  }) ?? displays.find((display) => Array.isArray(display?.bounds) && display.bounds.length === 4) ?? null
}

function clampRadialCenter(target, origin, topology, radius, itemRadius) {
  target[0] = origin[0]
  target[1] = origin[1]
  const bounds = containingDisplay(topology, origin)?.bounds
  if (!bounds) return target
  const inset = radius + itemRadius + 4
  const minX = bounds[0] + inset
  const maxX = bounds[0] + bounds[2] - inset
  const minY = bounds[1] + inset
  const maxY = bounds[1] + bounds[3] - inset
  target[0] = minX > maxX ? bounds[0] + bounds[2] / 2 : Math.min(maxX, Math.max(minX, origin[0]))
  target[1] = minY > maxY ? bounds[1] + bounds[3] / 2 : Math.min(maxY, Math.max(minY, origin[1]))
  return target
}

export function resolveSceneAimVisualStyle(parameters = {}) {
  const arrow = parameters?.arrow ?? {}
  const wormhole = parameters?.wormhole ?? {}
  const route = parameters?.route === 'wormhole' ? 'wormhole' : 'line'
  return Object.freeze({
    arrow: Object.freeze({
      accentColor: color(arrow.accentColor, DEFAULT_ARROW_STYLE.accentColor),
      color: color(arrow.color, DEFAULT_ARROW_STYLE.color),
      dashColor: color(arrow.dashColor, DEFAULT_ARROW_STYLE.dashColor),
      dashGap: finite(arrow.dashGap, DEFAULT_ARROW_STYLE.dashGap, 1, 128),
      dashLength: finite(arrow.dashLength, DEFAULT_ARROW_STYLE.dashLength, 1, 128),
      dashOpacity: finite(arrow.dashOpacity, DEFAULT_ARROW_STYLE.dashOpacity, 0, 1),
      dashSpeed: finite(arrow.dashSpeed, DEFAULT_ARROW_STYLE.dashSpeed, -512, 512),
      dashWidth: finite(arrow.dashWidth, arrow.shaftWidth ?? DEFAULT_ARROW_STYLE.dashWidth, 1, 32),
      glowColor: color(arrow.glowColor, DEFAULT_ARROW_STYLE.glowColor),
      glowOpacity: finite(arrow.glowOpacity, DEFAULT_ARROW_STYLE.glowOpacity, 0, 1),
      glowWidth: finite(arrow.glowWidth, DEFAULT_ARROW_STYLE.glowWidth, 1, 64),
      headLength: finite(arrow.headLength, DEFAULT_ARROW_STYLE.headLength, 4, 128),
      headLengthDistanceFactor: finite(arrow.headLengthDistanceFactor, DEFAULT_ARROW_STYLE.headLengthDistanceFactor, 0, 1),
      headLengthMax: finite(arrow.headLengthMax, arrow.headLength ?? DEFAULT_ARROW_STYLE.headLengthMax, 4, 128),
      headLengthMin: finite(arrow.headLengthMin, Math.min(arrow.headLength ?? DEFAULT_ARROW_STYLE.headLengthMin, arrow.headLengthMax ?? DEFAULT_ARROW_STYLE.headLengthMax), 4, 128),
      headWingRadians: finite(arrow.headWingRadians, DEFAULT_ARROW_STYLE.headWingRadians, 0.1, Math.PI),
      headWidth: finite(arrow.headWidth, DEFAULT_ARROW_STYLE.headWidth, 4, 128),
      originInset: finite(arrow.originInset, DEFAULT_ARROW_STYLE.originInset, 0, 512),
      originRingColor: color(arrow.originRingColor, DEFAULT_ARROW_STYLE.originRingColor),
      originRingOpacity: finite(arrow.originRingOpacity, DEFAULT_ARROW_STYLE.originRingOpacity, 0, 1),
      originRingRadius: finite(arrow.originRingRadius, DEFAULT_ARROW_STYLE.originRingRadius, 2, 512),
      pulseHz: finite(arrow.pulseHz, DEFAULT_ARROW_STYLE.pulseHz, 0, 20),
      reticleColor: color(arrow.reticleColor, DEFAULT_ARROW_STYLE.reticleColor),
      reticlePulse: finite(arrow.reticlePulse, DEFAULT_ARROW_STYLE.reticlePulse, 0, 64),
      reticleRadius: finite(arrow.reticleRadius, DEFAULT_ARROW_STYLE.reticleRadius, 2, 512),
      shaftWidth: finite(arrow.shaftWidth, DEFAULT_ARROW_STYLE.shaftWidth, 1, 32),
      trailCount: Math.round(finite(arrow.trailCount, DEFAULT_ARROW_STYLE.trailCount, 0, SCENE_INTERACTION_VISUAL_LIMITS.maxTrailCount)),
      trailOpacity: finite(arrow.trailOpacity, DEFAULT_ARROW_STYLE.trailOpacity, 0, 1),
      trailSpacing: finite(arrow.trailSpacing, DEFAULT_ARROW_STYLE.trailSpacing, 0, 1),
    }),
    durationMs: finite(
      parameters?.durationMs,
      route === 'wormhole' ? 900 : 220,
      50,
      SCENE_INTERACTION_VISUAL_LIMITS.maxRouteDurationMs,
    ),
    easing: ['ease_in_out_cubic', 'ease_out_quart', 'linear', 'smoothstep'].includes(parameters?.easing)
      ? parameters.easing
      : 'ease_in_out_cubic',
    route,
    wormhole: Object.freeze({
      color: color(wormhole.color, DEFAULT_WORMHOLE_STYLE.color),
      flash: finite(wormhole.flash, DEFAULT_WORMHOLE_STYLE.flash, 0, 4),
      ringRadius: finite(wormhole.ringRadius, DEFAULT_WORMHOLE_STYLE.ringRadius, 8, 512),
      spin: finite(wormhole.spin, DEFAULT_WORMHOLE_STYLE.spin, -20, 20),
    }),
  })
}

export function resolveSceneRadialVisualStyle(parameters = {}) {
  const style = parameters?.style ?? {}
  const items = Array.isArray(parameters?.items)
    ? parameters.items.slice(0, SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems)
    : Array.from({ length: Math.round(finite(parameters?.items, 4, 1, SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems)) }, (_, index) => ({ id: `item-${index}` }))
  return Object.freeze({
    activeColor: color(style.activeColor, DEFAULT_RADIAL_STYLE.activeColor),
    fillColor: color(style.fillColor, DEFAULT_RADIAL_STYLE.fillColor),
    itemRadius: finite(style.itemRadius, DEFAULT_RADIAL_STYLE.itemRadius, 2, 128),
    items: Object.freeze(items.map((item, index) => Object.freeze({
      color: color(item?.color, null),
      disabled: item?.disabled === true,
      index,
    }))),
    opacity: finite(style.opacity, DEFAULT_RADIAL_STYLE.opacity, 0, 1),
    radius: finite(parameters?.radius, DEFAULT_RADIAL_STYLE.radius, 1, 2048),
  })
}

export function createSceneInteractionVisualController({ now = () => performance.now(), onFrame = () => {} } = {}) {
  const radialPositions = new Float64Array(SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems * 2)
  const radialColors = Array(SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems).fill(null)
  const radialDisabled = new Uint8Array(SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems)
  const radialOrigin = new Float64Array(2)
  const model = {
    arrow: {
      visible: false,
      origin: new Float64Array(2),
      pointer: new Float64Array(2),
      angle: 0,
      distance: 0,
      pulse: 1,
      style: DEFAULT_ARROW_STYLE,
    },
    radial: {
      visible: false,
      center: new Float64Array(2),
      positions: radialPositions,
      colors: radialColors,
      disabled: radialDisabled,
      itemCount: 0,
      selectionIndex: -1,
      style: DEFAULT_RADIAL_STYLE,
    },
    route: {
      active: false,
      kind: 'line',
      objectId: null,
      origin: new Float64Array(3),
      destination: new Float64Array(3),
      localDestination: new Float64Array(3),
      position: new Float64Array(3),
      progress: 0,
      opacity: 1,
      scale: 1,
      originRing: 0,
      destinationRing: 0,
      flash: 0,
      generation: 0,
      startedAt: 0,
      durationMs: 220,
      style: Object.freeze({ arrow: DEFAULT_ARROW_STYLE, wormhole: DEFAULT_WORMHOLE_STYLE }),
    },
  }
  let disposed = false
  let suspended = false
  let suspendedAt = 0
  let aimStyle = null
  let radialStyle = null

  function publish(at = now()) {
    onFrame(model, at)
    return model
  }

  function hidePreview() {
    model.arrow.visible = false
    model.radial.visible = false
  }

  function finishRoute() {
    if (!model.route.objectId) return
    copyPoint(model.route.position, model.route.destination)
    model.route.active = false
    model.route.progress = 1
    model.route.opacity = 1
    model.route.scale = 1
    model.route.originRing = 0
    model.route.destinationRing = 0
    model.route.flash = 0
  }

  function updateArrow(event, style) {
    const { frame, response } = event
    copyPoint(model.arrow.origin, response.origin ?? frame.origin)
    copyPoint(model.arrow.pointer, response.pointer ?? frame.current)
    model.arrow.angle = finite(response.angle, 0, -Math.PI * 4, Math.PI * 4)
    model.arrow.distance = finite(response.distance, 0, 0, 2e6)
    model.arrow.style = style.arrow
    model.arrow.visible = frame.phase !== 'cancel' && frame.phase !== 'end'
  }

  function updateRadial(event, style) {
    const frame = event.frame
    copyPoint(radialOrigin, frame.origin ?? frame.current)
    clampRadialCenter(model.radial.center, radialOrigin, event.topology, style.radius, style.itemRadius)
    model.radial.itemCount = style.items.length
    model.radial.selectionIndex = Number.isInteger(frame.radial?.selectionIndex) ? frame.radial.selectionIndex : -1
    model.radial.style = style
    for (let index = 0; index < SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems; index += 1) {
      const item = style.items[index]
      if (!item) {
        radialPositions[index * 2] = 0
        radialPositions[index * 2 + 1] = 0
        radialColors[index] = null
        radialDisabled[index] = 0
        continue
      }
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / style.items.length
      radialPositions[index * 2] = model.radial.center[0] + Math.cos(angle) * style.radius
      radialPositions[index * 2 + 1] = model.radial.center[1] + Math.sin(angle) * style.radius
      radialColors[index] = item.color
      radialDisabled[index] = item.disabled ? 1 : 0
    }
    model.radial.visible = frame.phase !== 'cancel' && frame.phase !== 'end'
  }

  function updatePersistentRadial(event) {
    if (event.response.action === 'focus') {
      model.radial.selectionIndex = Number.isInteger(event.response.selectionIndex) ? event.response.selectionIndex : -1
      return
    }
    if (event.response.action !== 'open') {
      model.radial.visible = false
      model.radial.selectionIndex = Number.isInteger(event.response.selectionIndex) ? event.response.selectionIndex : -1
      return
    }
    const layout = event.radialLayout ?? resolveSceneRadialMenuLayout(event.response, event.topology)
    const style = resolveSceneRadialVisualStyle(event.response)
    copyPoint(model.radial.center, layout.center)
    model.radial.itemCount = layout.items.length
    model.radial.selectionIndex = -1
    model.radial.style = style
    for (let index = 0; index < SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems; index += 1) {
      const item = layout.items[index]
      if (!item) {
        radialPositions[index * 2] = 0
        radialPositions[index * 2 + 1] = 0
        radialColors[index] = null
        radialDisabled[index] = 0
        continue
      }
      radialPositions[index * 2] = item.center.x
      radialPositions[index * 2 + 1] = item.center.y
      radialColors[index] = item.color
      radialDisabled[index] = item.disabled ? 1 : 0
    }
    model.radial.visible = true
  }

  function beginRoute(event, style, at) {
    const response = event.response
    copyPoint(model.route.origin, response.origin)
    copyPoint(model.route.destination, response.pointer)
    copyPoint(model.route.localDestination, response.position)
    copyPoint(model.route.position, response.origin)
    model.route.active = true
    model.route.kind = style.route
    model.route.objectId = response.objectId
    model.route.progress = 0
    model.route.opacity = 1
    model.route.scale = 1
    model.route.originRing = style.route === 'wormhole' ? 1 : 0
    model.route.destinationRing = 0
    model.route.flash = 0
    model.route.generation += 1
    model.route.startedAt = at
    model.route.durationMs = style.durationMs
    model.route.style = style
  }

  function apply(event = {}) {
    if (disposed || suspended || !event.frame || !event.response) return REJECTED_VISUAL_RESULT
    const at = now()
    const recognizer = event.interaction?.recognizer
    if (recognizer?.implementation === 'aos.scene.gesture.radial') {
      if (event.frame.phase === 'start' || !radialStyle) radialStyle = resolveSceneRadialVisualStyle(recognizer.parameters)
      updateRadial(event, radialStyle)
    }
    if (event.response.kind === 'aim_commit') {
      if (event.frame.phase === 'start' || !aimStyle) aimStyle = resolveSceneAimVisualStyle(event.interaction?.response?.parameters)
      const style = aimStyle
      if (event.frame.phase === 'start' && model.route.active) {
        finishRoute()
      }
      updateArrow(event, style)
      if (event.frame.phase === 'end') beginRoute(event, style, at)
      if (event.frame.phase === 'cancel' && model.route.active) finishRoute()
      publish(at)
      if (event.frame.phase === 'end' || event.frame.phase === 'cancel') aimStyle = null
      return event.frame.phase === 'end' ? STARTED_ROUTE_RESULT : ACCEPTED_VISUAL_RESULT
    }
    if (event.response.kind === 'radial_menu') {
      updatePersistentRadial(event)
      publish(at)
      return ACCEPTED_VISUAL_RESULT
    }
    if (recognizer?.implementation === 'aos.scene.gesture.radial') {
      publish(at)
      if (event.frame.phase === 'end' || event.frame.phase === 'cancel') radialStyle = null
      return ACCEPTED_VISUAL_RESULT
    }
    return REJECTED_VISUAL_RESULT
  }

  function tick(at = now()) {
    if (disposed || suspended) return false
    let changed = false
    if (model.arrow.visible) {
      const hz = model.arrow.style.pulseHz
      model.arrow.pulse = hz === 0 ? 1 : 0.5 + Math.sin((at / 1000) * Math.PI * 2 * hz) * 0.5
      changed = true
    }
    if (model.route.active) {
      const linear = Math.min(1, Math.max(0, (at - model.route.startedAt) / model.route.durationMs))
      const progress = eased(linear, model.route.style.easing)
      model.route.progress = progress
      for (let index = 0; index < 3; index += 1) {
        model.route.position[index] = model.route.origin[index] + (model.route.destination[index] - model.route.origin[index]) * progress
      }
      if (model.route.kind === 'wormhole') {
        model.route.scale = linear < 0.22 ? 1 - (linear / 0.22) * 0.92 : linear > 0.78 ? 0.08 + ((linear - 0.78) / 0.22) * 0.92 : 0.08
        model.route.opacity = linear < 0.22 ? 1 - (linear / 0.22) * 0.88 : linear > 0.78 ? 0.12 + ((linear - 0.78) / 0.22) * 0.88 : 0.12
        model.route.originRing = Math.max(0, 1 - linear / 0.45)
        model.route.destinationRing = Math.max(0, (linear - 0.55) / 0.45)
        model.route.flash = Math.max(0, 1 - Math.abs(linear - 0.78) / 0.12) * model.route.style.wormhole.flash
      } else {
        model.route.scale = 1
        model.route.opacity = 1
      }
      if (linear >= 1) {
        copyPoint(model.route.position, model.route.destination)
        model.route.active = false
        model.route.scale = 1
        model.route.opacity = 1
        model.route.originRing = 0
        model.route.destinationRing = 0
        model.route.flash = 0
      }
      changed = true
    }
    if (changed) publish(at)
    return changed
  }

  function cancel() {
    if (disposed) return false
    const changed = model.arrow.visible || model.radial.visible || model.route.active
    hidePreview()
    if (model.route.active) finishRoute()
    if (changed) publish()
    return changed
  }

  function suspend(at = now()) {
    if (disposed || suspended) return false
    suspended = true
    suspendedAt = at
    hidePreview()
    publish(at)
    return true
  }

  function resume(at = now()) {
    if (disposed || !suspended) return false
    if (model.route.active) model.route.startedAt += Math.max(0, at - suspendedAt)
    suspended = false
    publish(at)
    return true
  }

  function snapshot() {
    return Object.freeze({
      arrow: Object.freeze({ visible: model.arrow.visible, origin: [...model.arrow.origin], pointer: [...model.arrow.pointer], distance: model.arrow.distance }),
      disposed,
      radial: Object.freeze({ visible: model.radial.visible, center: [...model.radial.center], itemCount: model.radial.itemCount, selectionIndex: model.radial.selectionIndex }),
      route: Object.freeze({
        active: model.route.active,
        destination: [...model.route.destination],
        kind: model.route.kind,
        objectId: model.route.objectId,
        origin: [...model.route.origin],
        position: [...model.route.position],
        progress: model.route.progress,
      }),
      suspended,
    })
  }

  function dispose() {
    if (disposed) return false
    cancel()
    disposed = true
    return true
  }

  return Object.freeze({ apply, cancel, dispose, resume, snapshot, suspend, tick })
}
