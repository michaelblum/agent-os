import { createSceneInteractionVisualController, SCENE_INTERACTION_VISUAL_LIMITS } from '../../scene/index.js'

const MAX_ROUTE_SAMPLES = 64
const OVERLAY_Z = 100

function numberColor(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function markDynamic(THREE, attribute) {
  if (THREE.DynamicDrawUsage !== undefined) attribute.setUsage?.(THREE.DynamicDrawUsage)
  return attribute
}

function geometryWithPositions(THREE, count) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  geometry.setAttribute('position', markDynamic(THREE, new THREE.BufferAttribute(positions, 3)))
  return { geometry, positions }
}

function material(THREE, options) {
  return new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    ...options,
  })
}

function writePosition(positions, index, x, y) {
  positions[index * 3] = x
  positions[index * 3 + 1] = y
  positions[index * 3 + 2] = OVERLAY_Z
}

function unitCircleGeometry(THREE, segments = 64) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(segments * 3)
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    positions[index * 3] = Math.cos(angle)
    positions[index * 3 + 1] = Math.sin(angle)
    positions[index * 3 + 2] = 0
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function arrowVector(model) {
  const distance = Math.max(0.001, model.distance)
  return {
    distance,
    ux: (model.pointer[0] - model.origin[0]) / distance,
    uy: (model.pointer[1] - model.origin[1]) / distance,
  }
}

function arrowStart(model, vector) {
  const inset = Math.min(model.style.originInset, Math.max(0, vector.distance - 1))
  return {
    x: model.origin[0] + vector.ux * inset,
    y: model.origin[1] + vector.uy * inset,
  }
}

function setArrowGlowGeometry(attribute, model) {
  const positions = attribute.array
  const vector = arrowVector(model)
  const start = arrowStart(model, vector)
  const x0 = start.x
  const y0 = start.y
  const [x1, y1] = model.pointer
  const px = -vector.uy
  const py = vector.ux
  const halfWidth = model.style.glowWidth * 0.5
  writePosition(positions, 0, x0 + px * halfWidth, y0 + py * halfWidth)
  writePosition(positions, 1, x1 + px * halfWidth, y1 + py * halfWidth)
  writePosition(positions, 2, x0 - px * halfWidth, y0 - py * halfWidth)
  writePosition(positions, 3, x0 - px * halfWidth, y0 - py * halfWidth)
  writePosition(positions, 4, x1 + px * halfWidth, y1 + py * halfWidth)
  writePosition(positions, 5, x1 - px * halfWidth, y1 - py * halfWidth)
  attribute.needsUpdate = true
}

function setArrowLine(attribute, model) {
  const positions = attribute.array
  const vector = arrowVector(model)
  const start = arrowStart(model, vector)
  writePosition(positions, 0, start.x, start.y)
  writePosition(positions, 1, model.pointer[0], model.pointer[1])
  attribute.needsUpdate = true
  return Math.max(0, vector.distance - model.style.originInset)
}

function setArrowHead(attribute, model) {
  const positions = attribute.array
  const length = Math.min(
    model.style.headLengthMax,
    Math.max(model.style.headLengthMin, model.distance * model.style.headLengthDistanceFactor),
  )
  const angle = model.angle
  const wing = model.style.headWingRadians
  writePosition(positions, 0, model.pointer[0], model.pointer[1])
  writePosition(positions, 1, model.pointer[0] + Math.cos(angle + wing) * length, model.pointer[1] + Math.sin(angle + wing) * length)
  writePosition(positions, 2, model.pointer[0], model.pointer[1])
  writePosition(positions, 3, model.pointer[0] + Math.cos(angle - wing) * length, model.pointer[1] + Math.sin(angle - wing) * length)
  attribute.needsUpdate = true
}

function setArrowTrails(attribute, model) {
  const positions = attribute.array
  const count = model.style.trailCount
  const dx = model.pointer[0] - model.origin[0]
  const dy = model.pointer[1] - model.origin[1]
  for (let index = 0; index < SCENE_INTERACTION_VISUAL_LIMITS.maxTrailCount; index += 1) {
    const visible = index < count
    const start = visible ? Math.min(0.9, index * model.style.trailSpacing) : 1
    const end = visible ? Math.min(1, start + 0.18) : 1
    positions[index * 6] = model.origin[0] + dx * start
    positions[index * 6 + 1] = model.origin[1] + dy * start
    positions[index * 6 + 2] = OVERLAY_Z - 0.1
    positions[index * 6 + 3] = model.origin[0] + dx * end
    positions[index * 6 + 4] = model.origin[1] + dy * end
    positions[index * 6 + 5] = OVERLAY_Z - 0.1
  }
  attribute.needsUpdate = true
}

function setRouteTrail(attribute, model) {
  const positions = attribute.array
  const visibleSamples = Math.max(2, Math.ceil(model.progress * (MAX_ROUTE_SAMPLES - 1)) + 1)
  for (let index = 0; index < MAX_ROUTE_SAMPLES; index += 1) {
    const t = Math.min(model.progress, index / (MAX_ROUTE_SAMPLES - 1))
    positions[index * 3] = model.origin[0] + (model.destination[0] - model.origin[0]) * t
    positions[index * 3 + 1] = model.origin[1] + (model.destination[1] - model.origin[1]) * t
    positions[index * 3 + 2] = OVERLAY_Z - 0.2
  }
  attribute.needsUpdate = true
  return visibleSamples
}

export function createDesktopWorldSceneInteractionThree({ THREE, scene, projection, now = () => performance.now() } = {}) {
  if (!THREE?.Group || !scene?.add || !projection?.setObjectPosition) {
    throw new TypeError('DesktopWorld interaction visuals require Three.js, a scene, and a mutable projection.')
  }
  const group = new THREE.Group()
  group.name = 'aos.scene.interaction.visuals'
  group.renderOrder = 10_000

  const arrowGlowResource = geometryWithPositions(THREE, 6)
  const arrowGlowMaterial = material(THREE, { color: '#53f5d7', opacity: 0.48, side: THREE.DoubleSide })
  const arrowGlow = new THREE.Mesh(arrowGlowResource.geometry, arrowGlowMaterial)
  arrowGlow.name = 'aos.scene.interaction.arrow.glow'
  arrowGlow.frustumCulled = false
  group.add(arrowGlow)

  const arrowDashResource = geometryWithPositions(THREE, 2)
  const arrowLineDistance = markDynamic(THREE, new THREE.BufferAttribute(new Float32Array(2), 1))
  arrowDashResource.geometry.setAttribute('lineDistance', arrowLineDistance)
  const arrowDashMaterial = new THREE.LineDashedMaterial({
    color: '#ffffff',
    dashSize: 10,
    depthTest: false,
    depthWrite: false,
    gapSize: 7,
    opacity: 0.9,
    transparent: true,
  })
  const arrowDash = new THREE.Line(arrowDashResource.geometry, arrowDashMaterial)
  arrowDash.name = 'aos.scene.interaction.arrow.dash'
  arrowDash.frustumCulled = false
  group.add(arrowDash)

  const arrowHeadResource = geometryWithPositions(THREE, 4)
  const arrowHeadMaterial = new THREE.LineBasicMaterial({ color: '#53f5d7', depthTest: false, depthWrite: false, transparent: true })
  const arrowHead = new THREE.LineSegments(arrowHeadResource.geometry, arrowHeadMaterial)
  arrowHead.name = 'aos.scene.interaction.arrow.head'
  arrowHead.frustumCulled = false
  group.add(arrowHead)

  const arrowRingGeometry = unitCircleGeometry(THREE)
  const arrowReticleMaterial = new THREE.LineBasicMaterial({ color: '#53f5d7', depthTest: false, depthWrite: false, transparent: true })
  const arrowOriginRingMaterial = new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, depthWrite: false, opacity: 0.38, transparent: true })
  const arrowReticle = new THREE.LineLoop(arrowRingGeometry, arrowReticleMaterial)
  const arrowOriginRing = new THREE.LineLoop(arrowRingGeometry, arrowOriginRingMaterial)
  arrowReticle.name = 'aos.scene.interaction.arrow.reticle'
  arrowOriginRing.name = 'aos.scene.interaction.arrow.origin-ring'
  group.add(arrowReticle, arrowOriginRing)

  const arrowTrailResource = geometryWithPositions(THREE, SCENE_INTERACTION_VISUAL_LIMITS.maxTrailCount * 2)
  const arrowTrailMaterial = new THREE.LineBasicMaterial({ color: '#9b7cff', depthTest: false, depthWrite: false, opacity: 0.38, transparent: true })
  const arrowTrails = new THREE.LineSegments(arrowTrailResource.geometry, arrowTrailMaterial)
  arrowTrails.name = 'aos.scene.interaction.arrow.trails'
  arrowTrails.frustumCulled = false
  group.add(arrowTrails)

  const routeResource = geometryWithPositions(THREE, MAX_ROUTE_SAMPLES)
  const routeMaterial = new THREE.LineBasicMaterial({ color: '#9b7cff', depthTest: false, depthWrite: false, opacity: 0.72, transparent: true })
  const routeTrail = new THREE.Line(routeResource.geometry, routeMaterial)
  routeTrail.name = 'aos.scene.interaction.route.line'
  routeTrail.frustumCulled = false
  group.add(routeTrail)

  const ringGeometry = new THREE.RingGeometry(0.72, 1, 48)
  const routeOriginRingMaterial = material(THREE, { color: '#9b7cff', opacity: 0, side: THREE.DoubleSide })
  const destinationRingMaterial = routeOriginRingMaterial.clone()
  const routeOriginRing = new THREE.Mesh(ringGeometry, routeOriginRingMaterial)
  const destinationRing = new THREE.Mesh(ringGeometry, destinationRingMaterial)
  routeOriginRing.name = 'aos.scene.interaction.route.wormhole-origin'
  destinationRing.name = 'aos.scene.interaction.route.wormhole-destination'
  group.add(routeOriginRing, destinationRing)

  const flashGeometry = new THREE.CircleGeometry(1, 48)
  const flashMaterial = material(THREE, { color: '#ffffff', opacity: 0, side: THREE.DoubleSide })
  const flash = new THREE.Mesh(flashGeometry, flashMaterial)
  flash.name = 'aos.scene.interaction.route.wormhole-flash'
  group.add(flash)

  const radialGeometry = new THREE.CircleGeometry(1, 32)
  const radialItems = []
  for (let index = 0; index < SCENE_INTERACTION_VISUAL_LIMITS.maxRadialItems; index += 1) {
    const itemMaterial = material(THREE, { color: '#201b2f', opacity: 0.94, side: THREE.DoubleSide })
    const item = new THREE.Mesh(radialGeometry, itemMaterial)
    item.name = `aos.scene.interaction.radial.item-${index}`
    item.visible = false
    radialItems.push(item)
    group.add(item)
  }

  scene.add(group)
  let disposed = false
  let activeRouteObject = null
  let activeRouteGeneration = -1
  let appliedRouteGeneration = -1
  const basePosition = new Float64Array(3)
  const routePosition = new Float64Array(3)
  const baseScale = new Float64Array([1, 1, 1])

  function targetObject(objectId) {
    return projection.object?.getObjectByName?.(objectId) ?? null
  }

  function renderModel(model, at) {
    arrowGlow.visible = model.arrow.visible
    arrowDash.visible = model.arrow.visible
    arrowHead.visible = model.arrow.visible
    arrowReticle.visible = model.arrow.visible
    arrowOriginRing.visible = model.arrow.visible
    arrowTrails.visible = model.arrow.visible && model.arrow.style.trailCount > 0
    if (model.arrow.visible) {
      setArrowGlowGeometry(arrowGlowResource.geometry.getAttribute('position'), model.arrow)
      const arrowLength = setArrowLine(arrowDashResource.geometry.getAttribute('position'), model.arrow)
      const dashOffset = at === 0 ? 0 : -((at / 1000) * model.arrow.style.dashSpeed)
      arrowLineDistance.array[0] = dashOffset
      arrowLineDistance.array[1] = dashOffset + arrowLength
      arrowLineDistance.needsUpdate = true
      setArrowHead(arrowHeadResource.geometry.getAttribute('position'), model.arrow)
      setArrowTrails(arrowTrailResource.geometry.getAttribute('position'), model.arrow)
      arrowGlowMaterial.color.set(numberColor(model.arrow.style.glowColor, '#53f5d7'))
      arrowGlowMaterial.opacity = model.arrow.style.glowOpacity * (0.66 + model.arrow.pulse * 0.34)
      arrowDashMaterial.color.set(numberColor(model.arrow.style.dashColor, '#ffffff'))
      arrowDashMaterial.dashSize = model.arrow.style.dashLength
      arrowDashMaterial.gapSize = model.arrow.style.dashGap
      arrowDashMaterial.opacity = model.arrow.style.dashOpacity
      arrowDashMaterial.linewidth = model.arrow.style.dashWidth
      arrowHeadMaterial.color.set(numberColor(model.arrow.style.reticleColor, '#53f5d7'))
      arrowHeadMaterial.opacity = model.arrow.style.dashOpacity
      arrowReticle.position.set(model.arrow.pointer[0], model.arrow.pointer[1], OVERLAY_Z + 0.1)
      arrowReticle.scale.setScalar(model.arrow.style.reticleRadius + model.arrow.pulse * model.arrow.style.reticlePulse)
      arrowReticleMaterial.color.set(numberColor(model.arrow.style.reticleColor, '#53f5d7'))
      arrowReticleMaterial.opacity = model.arrow.style.dashOpacity
      arrowOriginRing.position.set(model.arrow.origin[0], model.arrow.origin[1], OVERLAY_Z + 0.1)
      arrowOriginRing.scale.setScalar(model.arrow.style.originRingRadius)
      arrowOriginRingMaterial.color.set(numberColor(model.arrow.style.originRingColor, '#ffffff'))
      arrowOriginRingMaterial.opacity = model.arrow.style.originRingOpacity
      arrowTrailMaterial.color.set(numberColor(model.arrow.style.accentColor, '#9b7cff'))
      arrowTrailMaterial.opacity = model.arrow.style.trailOpacity
    }

    for (let index = 0; index < radialItems.length; index += 1) {
      const item = radialItems[index]
      const visible = model.radial.visible && index < model.radial.itemCount
      item.visible = visible
      if (!visible) continue
      item.position.set(model.radial.positions[index * 2], model.radial.positions[index * 2 + 1], OVERLAY_Z)
      item.scale.setScalar(model.radial.style.itemRadius)
      item.material.color.set(numberColor(
        index === model.radial.selectionIndex ? model.radial.style.activeColor : model.radial.colors[index],
        model.radial.style.fillColor,
      ))
      item.material.opacity = model.radial.disabled[index] ? model.radial.style.opacity * 0.32 : model.radial.style.opacity
    }

    if (model.route.objectId && (activeRouteObject !== model.route.objectId || activeRouteGeneration !== model.route.generation)) {
      const object = targetObject(model.route.objectId)
      if (object) {
        basePosition[0] = object.position.x
        basePosition[1] = object.position.y
        basePosition[2] = object.position.z
        baseScale[0] = object.scale.x
        baseScale[1] = object.scale.y
        baseScale[2] = object.scale.z
        activeRouteObject = model.route.objectId
        activeRouteGeneration = model.route.generation
      }
    }
    const applyRoutePosition = model.route.objectId
      && activeRouteObject === model.route.objectId
      && activeRouteGeneration === model.route.generation
      && (model.route.active || appliedRouteGeneration !== model.route.generation)
    if (applyRoutePosition) {
      for (let index = 0; index < 3; index += 1) {
        routePosition[index] = basePosition[index] + (model.route.localDestination[index] - basePosition[index]) * model.route.progress
      }
      projection.setObjectPosition(model.route.objectId, routePosition)
      const object = targetObject(model.route.objectId)
      if (object) object.scale.set(baseScale[0] * model.route.scale, baseScale[1] * model.route.scale, baseScale[2] * model.route.scale)
      if (!model.route.active) appliedRouteGeneration = model.route.generation
    }

    routeTrail.visible = model.route.active && model.route.kind === 'line'
    if (routeTrail.visible) {
      const samples = setRouteTrail(routeResource.geometry.getAttribute('position'), model.route)
      routeResource.geometry.setDrawRange(0, samples)
      routeMaterial.color.set(numberColor(model.route.style.arrow.accentColor, '#9b7cff'))
    }
    const wormholeVisible = model.route.active && model.route.kind === 'wormhole'
    routeOriginRing.visible = wormholeVisible
    destinationRing.visible = wormholeVisible
    flash.visible = wormholeVisible && model.route.flash > 0
    if (wormholeVisible) {
      const ringRadius = model.route.style.wormhole.ringRadius
      const ringColor = numberColor(model.route.style.wormhole.color, '#9b7cff')
      routeOriginRing.position.set(model.route.origin[0], model.route.origin[1], OVERLAY_Z)
      destinationRing.position.set(model.route.destination[0], model.route.destination[1], OVERLAY_Z)
      routeOriginRing.scale.setScalar(ringRadius * (0.75 + model.route.originRing * 0.25))
      destinationRing.scale.setScalar(ringRadius * (0.75 + model.route.destinationRing * 0.25))
      routeOriginRing.rotation.z = (at / 1000) * model.route.style.wormhole.spin
      destinationRing.rotation.z = -(at / 1000) * model.route.style.wormhole.spin
      routeOriginRingMaterial.color.set(ringColor)
      destinationRingMaterial.color.set(ringColor)
      routeOriginRingMaterial.opacity = model.route.originRing
      destinationRingMaterial.opacity = model.route.destinationRing
      flash.position.set(model.route.destination[0], model.route.destination[1], OVERLAY_Z + 0.1)
      flash.scale.setScalar(ringRadius * 0.72)
      flashMaterial.opacity = Math.min(1, model.route.flash)
    }
  }

  const controller = createSceneInteractionVisualController({ now, onFrame: renderModel })

  return Object.freeze({
    apply(event) { return disposed ? Object.freeze({ accepted: false, routeStarted: false }) : controller.apply(event) },
    cancel() { return disposed ? false : controller.cancel() },
    tick(at) { return disposed ? false : controller.tick(at) },
    suspend(at) {
      if (disposed) return false
      group.visible = false
      return controller.suspend(at)
    },
    resume(at) {
      if (disposed) return false
      group.visible = true
      return controller.resume(at)
    },
    snapshot() {
      return Object.freeze({
        ...controller.snapshot(),
        allocations: Object.freeze({ geometries: 9, materials: 42, radialItems: radialItems.length }),
        hasOwnFrameLoop: false,
      })
    },
    dispose() {
      if (disposed) return false
      controller.dispose()
      disposed = true
      scene.remove(group)
      arrowGlowResource.geometry.dispose()
      arrowGlowMaterial.dispose()
      arrowDashResource.geometry.dispose()
      arrowDashMaterial.dispose()
      arrowHeadResource.geometry.dispose()
      arrowHeadMaterial.dispose()
      arrowRingGeometry.dispose()
      arrowReticleMaterial.dispose()
      arrowOriginRingMaterial.dispose()
      arrowTrailResource.geometry.dispose()
      arrowTrailMaterial.dispose()
      routeResource.geometry.dispose()
      routeMaterial.dispose()
      ringGeometry.dispose()
      routeOriginRingMaterial.dispose()
      destinationRingMaterial.dispose()
      flashGeometry.dispose()
      flashMaterial.dispose()
      radialGeometry.dispose()
      for (const item of radialItems) item.material.dispose()
      group.clear()
      return true
    },
  })
}
