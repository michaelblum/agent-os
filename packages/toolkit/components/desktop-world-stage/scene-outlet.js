import * as THREE from '../../vendor/three/three.module.min.js'
import {
  applySceneTransaction,
  canonicalizeSceneDocument,
  createDesktopWorldGpuTimer,
  createSceneAnimationController,
  createSceneSignalController,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
  deriveOrthoCamera,
  resolveThreeRenderMetrics,
} from '../../scene/index.js'
import { createSceneAnimationInteractionState } from './scene-animation-interaction-state.js'
import { createDesktopWorldSceneInteractionThree } from './scene-interaction-three.js'
import { createScenePlaybackClock } from './scene-playback-clock.js'

const MAX_RESOURCES = 32
const MAX_SIGNALS_PER_SECOND = 30

export function createDesktopWorldSceneOutlet({ canvas, window: hostWindow = window } = {}) {
  if (!canvas) throw new TypeError('DesktopWorld scene outlet requires a canvas.')
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000)
  camera.position.set(0, 0, 7)
  scene.add(new THREE.AmbientLight(0xffffff, 1.8))
  const keyLight = new THREE.DirectionalLight(0xd8ccff, 3)
  keyLight.position.set(3, 4, 5)
  scene.add(keyLight)
  const registry = createGenericSceneImplementationRegistry()
  const resources = new Map()
  let frame = 0
  let disposed = false
  let hidden = false
  let contextLost = false
  let segment = null
  let devtoolsProbe = null
  let gpuTimer = null
  let lastRenderAt = null
  let interactionGeometryObserver = null
  let nextPlayGeneration = 0

  const notifyInteractionGeometry = (key, generation) => {
    try {
      interactionGeometryObserver?.(key, generation)
    } catch {
      devtoolsProbe?.recordEvent({ kind: 'interaction.geometry.failed', code: 'INPUT_REGION_SYNC_FAILED' })
    }
  }

  const updateSegment = (nextSegment) => {
    const projection = deriveOrthoCamera(nextSegment)
    if (!projection.width || !projection.height) return false
    segment = nextSegment
    camera.left = projection.left
    camera.right = projection.right
    camera.top = projection.top
    camera.bottom = projection.bottom
    camera.near = projection.near
    camera.far = projection.far
    camera.updateProjectionMatrix()
    return true
  }

  const resize = () => {
    const metrics = resolveThreeRenderMetrics({
      width: canvas.clientWidth || hostWindow.innerWidth,
      height: canvas.clientHeight || hostWindow.innerHeight,
      devicePixelRatio: hostWindow.devicePixelRatio,
    })
    if (!metrics) return false
    renderer.setPixelRatio(metrics.effectiveDevicePixelRatio)
    renderer.setSize(metrics.cssWidth, metrics.cssHeight, false)
    renderer.clear(true, true, true)
    camera.aspect = metrics.cssWidth / metrics.cssHeight
    camera.updateProjectionMatrix()
    return true
  }

  const disposeMounted = (mounted, { preserveInteractionOrigins = false } = {}) => {
    scene.remove(mounted.projection.object)
    mounted.animations.dispose()
    mounted.signals.dispose()
    mounted.interactionVisuals?.dispose()
    mounted.projection.dispose()
    if (!preserveInteractionOrigins) mounted.interactionOrigins.clear()
  }

  const release = (key) => {
    const mounted = resources.get(key)
    if (!mounted) return false
    disposeMounted(mounted)
    resources.delete(key)
    return true
  }

  const prepareMounted = (key, documentInput, identity = {}, previous = resources.get(key)) => {
    const document = canonicalizeSceneDocument(documentInput)
    const validation = registry.validateDocument(document)
    if (!validation.ok) throw new TypeError('Scene document requires an unavailable or invalid implementation.')
    const projection = createGenericThreeSceneProjection({ THREE, document })
    const interactionState = createSceneAnimationInteractionState(document)
    let animations
    let signals
    try {
      animations = createSceneAnimationController(document, {
        apply: (binding, value, elapsedMs, progress) => projection.applyAnimation(binding, value, elapsedMs, progress),
        onComplete: (binding, value) => interactionState.complete(binding, value),
      })
      signals = createSceneSignalController(document, {
        apply: (binding, value, input, at) => projection.applySignal(binding, value, input, at),
      })
    } catch (error) {
      animations?.dispose()
      signals?.dispose()
      projection.dispose()
      throw error
    }
    projection.object.position.copy(previous?.projection.object.position ?? new THREE.Vector3())
    return {
      key,
      owner: identity.owner ?? previous?.owner ?? '',
      resource: identity.resource ?? previous?.resource ?? key,
      document,
      projection,
      signals,
      animations,
      interactionState,
      interactionVisuals: null,
      playGeneration: null,
      playClock: createScenePlaybackClock(),
      suspended: false,
      signalWindowAt: 0,
      signalWindowCount: 0,
      interactionOrigins: previous?.interactionOrigins ?? new Map(),
    }
  }

  const prepareReplacement = (message) => {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    const operation = payload.operation ?? {}
    if (message?.type !== 'desktop_world_stage.scene.operation' || typeof key !== 'string') {
      throw new TypeError('Scene replacement requires a scene operation and lease key.')
    }
    if (operation.op !== 'mount' && operation.op !== 'transact') {
      throw new TypeError('Only scene mount and transact operations can be prepared.')
    }
    const previous = resources.get(key) ?? null
    if (!previous && resources.size >= MAX_RESOURCES) throw new RangeError('DesktopWorld scene resource budget exceeded.')
    let document = operation.document
    if (operation.op === 'transact') {
      if (!previous) throw new TypeError('Scene resource is not mounted.')
      const result = applySceneTransaction(previous.document, operation.transaction, { lease: operation.lease })
      if (!result.ok) throw new TypeError(result.code)
      document = result.document
    }
    const candidate = prepareMounted(key, document, payload, previous)
    let state = 'prepared'

    return Object.freeze({
      document: candidate.document,
      assertCurrent() {
        if (state !== 'prepared') throw new TypeError('Scene replacement is no longer pending.')
        if ((resources.get(key) ?? null) !== previous) throw new TypeError('Scene replacement base changed before commit.')
        return true
      },
      commit() {
        this.assertCurrent()
        scene.add(candidate.projection.object)
        if (previous) disposeMounted(previous, { preserveInteractionOrigins: true })
        resources.set(key, candidate)
        state = 'committed'
        return true
      },
      rollback() {
        if (state !== 'prepared') return false
        candidate.animations.dispose()
        candidate.signals.dispose()
        candidate.interactionVisuals?.dispose()
        candidate.projection.dispose()
        state = 'rolled_back'
        return true
      },
    })
  }

  const apply = (message) => {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    if (message?.type === 'desktop_world_stage.scene.release') return release(key)
    if (message?.type !== 'desktop_world_stage.scene.operation' || typeof key !== 'string') return false
    const operation = payload.operation ?? {}
    if (operation.op === 'mount') {
      prepareReplacement(message).commit()
    } else if (operation.op === 'transact') {
      prepareReplacement(message).commit()
    } else if (operation.op === 'signal') {
      const mounted = resources.get(key)
      if (!mounted || !Number.isFinite(operation.value)) return false
      const now = performance.now()
      if (now - mounted.signalWindowAt >= 1000) {
        mounted.signalWindowAt = now
        mounted.signalWindowCount = 0
      }
      if (++mounted.signalWindowCount > MAX_SIGNALS_PER_SECOND) return true
      mounted.signals.publish(operation.signalId, operation.value, Number(operation.at) || Date.now())
    } else if (operation.op === 'play') {
      const mounted = resources.get(key)
      if (mounted) {
        const now = performance.now()
        mounted.animations.restart()
        mounted.interactionState.reset(mounted.document)
        mounted.interactionState.takeDirty()
        mounted.playGeneration = ++nextPlayGeneration
        mounted.playClock.restart(now)
        if (mounted.suspended || hidden || contextLost) mounted.playClock.suspend(now)
      }
    } else if (operation.op === 'suspend' || operation.op === 'resume') {
      const mounted = resources.get(key)
      if (mounted) {
        const now = performance.now()
        const wasSuspended = mounted.suspended
        mounted.suspended = operation.op === 'suspend'
        if (!wasSuspended && mounted.suspended) mounted.playClock.suspend(now)
        if (wasSuspended && !mounted.suspended && !hidden && !contextLost) mounted.playClock.resume(now)
        mounted.projection[operation.op]()
        mounted.interactionVisuals?.[operation.op]()
      }
    } else if (operation.op === 'remove' || operation.op === 'close') {
      release(key)
    } else if (operation.op !== 'inspect') return false
    return true
  }

  const commitObjectPosition = (mounted, objectId, position) => {
    const index = mounted.document.objects.findIndex((object) => object.id === objectId)
    if (index < 0) return null
    const objects = [...mounted.document.objects]
    const object = objects[index]
    objects[index] = {
      ...object,
      transform: {
        ...object.transform,
        position: [...position],
      },
    }
    mounted.document = canonicalizeSceneDocument({
      ...mounted.document,
      revision: mounted.document.revision + 1,
      objects,
    })
    mounted.interactionState.setObjectPosition(objectId, position)
    mounted.interactionState.takeDirty()
    return mounted.document.revision
  }

  const ensureInteractionVisuals = (mounted) => {
    if (!mounted.interactionVisuals) {
      mounted.interactionVisuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection: mounted.projection })
    }
    return mounted.interactionVisuals
  }

  const applyInteractionResponse = (key, { frame, interaction, response, topology } = {}) => {
    const mounted = resources.get(key)
    if (!mounted || !response?.kind || !frame?.interactionId) return null
    if (response.kind === 'aim_commit') {
      const interactionVisuals = ensureInteractionVisuals(mounted)
      if (frame.phase !== 'end') {
        interactionVisuals.apply({ frame, interaction, response, topology })
        return { ...response, applied: false, revision: mounted.document.revision }
      }
      const revision = commitObjectPosition(mounted, response.objectId, response.position)
      if (revision === null) {
        interactionVisuals.cancel()
        return { ...response, applied: false, revision: mounted.document.revision }
      }
      const visual = interactionVisuals.apply({ frame, interaction, response, topology })
      if (!visual.routeStarted) mounted.projection.setObjectPosition(response.objectId, response.position)
      return { ...response, applied: true, revision }
    }
    if (interaction?.recognizer?.implementation === 'aos.scene.gesture.radial') {
      ensureInteractionVisuals(mounted).apply({ frame, interaction, response, topology })
    }
    if (response.kind === 'radial_menu') {
      if (response.action !== 'open' || frame.phase === 'end') {
        ensureInteractionVisuals(mounted).apply({ frame, interaction, response, topology })
      }
      return { ...response, applied: true, revision: mounted.document.revision }
    }
    if (response.kind === 'translate') {
      const originKey = `${frame.interactionId}:${frame.gesture_id}`
      if (frame.phase === 'start') {
        const origin = mounted.projection.objectPosition(response.objectId)
        if (origin) mounted.interactionOrigins.set(originKey, origin)
      }
      if (frame.phase === 'cancel') {
        const origin = mounted.interactionOrigins.get(originKey)
        if (origin) mounted.projection.setObjectPosition(response.objectId, origin)
        mounted.interactionOrigins.delete(originKey)
        return { ...response, applied: Boolean(origin), revision: mounted.document.revision }
      }
      const applied = mounted.projection.setObjectPosition(response.objectId, response.position)
      let revision = mounted.document.revision
      if (applied && frame.phase === 'end') {
        revision = commitObjectPosition(mounted, response.objectId, response.position) ?? revision
        mounted.interactionOrigins.delete(originKey)
      }
      return { ...response, applied, revision }
    }
    if (response.kind === 'signal_graph') {
      let appliedSignals = 0
      for (const signal of response.signals ?? []) {
        if (!Number.isFinite(signal.value)) continue
        if (mounted.signals.publish(signal.signalId, signal.value, frame.timing?.t ?? Date.now())) appliedSignals += 1
      }
      return { ...response, appliedSignals, revision: mounted.document.revision }
    }
    return { ...response, applied: false, revision: mounted.document.revision }
  }

  const render = (at) => {
    if (disposed) return
    const trackPerformance = devtoolsProbe?.isEnabled() === true
    const trackGpu = devtoolsProbe?.isRecording() === true
    const updateStartedAt = trackPerformance ? performance.now() : 0
    if (!hidden && !contextLost) {
      for (const mounted of resources.values()) {
        if (mounted.suspended) continue
        const elapsed = mounted.playClock.elapsed(at)
        mounted.animations.tick(elapsed)
        if (mounted.interactionState.takeDirty()) {
          notifyInteractionGeometry(mounted.key, mounted.playGeneration)
        }
        mounted.interactionVisuals?.tick(at)
      }
      const renderStartedAt = trackPerformance ? performance.now() : 0
      if (trackGpu && !gpuTimer) gpuTimer = createDesktopWorldGpuTimer(renderer.getContext())
      if (!trackGpu && gpuTimer) {
        gpuTimer.dispose()
        gpuTimer = null
      }
      gpuTimer?.begin()
      renderer.render(scene, camera)
      const gpuMs = gpuTimer?.end() ?? null
      if (trackPerformance) {
        const renderEndedAt = performance.now()
        const info = renderer.info
        devtoolsProbe.sampleFrame({
          backingPixels: renderer.domElement.width * renderer.domElement.height,
          drawCalls: info.render.calls,
          frameMs: lastRenderAt === null ? null : Math.max(0, at - lastRenderAt),
          geometries: info.memory.geometries,
          gpuMs,
          programs: info.programs?.length ?? null,
          renderEndedAt,
          renderMs: Math.max(0, renderEndedAt - renderStartedAt),
          textures: info.memory.textures,
          triangles: info.render.triangles,
          updateMs: Math.max(0, renderStartedAt - updateStartedAt),
        })
        lastRenderAt = at
      }
    } else if (lastRenderAt !== null) {
      lastRenderAt = null
    }
    if ((hidden || contextLost) && gpuTimer) {
      gpuTimer.dispose()
      gpuTimer = null
    }
    if (!trackPerformance && lastRenderAt !== null) lastRenderAt = null
    frame = hostWindow.requestAnimationFrame(render)
  }

  const suspendPlaybackClocks = (at = performance.now()) => {
    for (const mounted of resources.values()) mounted.playClock.suspend(at)
  }
  const resumePlaybackClocks = (at = performance.now()) => {
    for (const mounted of resources.values()) {
      if (!mounted.suspended) mounted.playClock.resume(at)
    }
  }
  const onVisibility = () => {
    const nextHidden = document.hidden
    if (nextHidden && !hidden) suspendPlaybackClocks()
    if (!nextHidden && hidden && !contextLost) resumePlaybackClocks()
    hidden = nextHidden
  }
  const onContextLost = (event) => {
    event.preventDefault()
    if (!contextLost) suspendPlaybackClocks()
    contextLost = true
    gpuTimer?.dispose()
    gpuTimer = null
    devtoolsProbe?.recordEvent({ kind: 'context.lost', code: 'WEBGL_CONTEXT_LOST' })
  }
  const onContextRestored = () => {
    contextLost = false
    if (!hidden) resumePlaybackClocks()
    resize()
    devtoolsProbe?.recordEvent({ kind: 'context.restored' })
  }
  hostWindow.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  resize()
  frame = hostWindow.requestAnimationFrame(render)

  return Object.freeze({
    apply,
    applyInteractionResponse,
    prepareReplacement,
    configuration(key) {
      const mounted = resources.get(key)
      return mounted ? Object.freeze({ document: mounted.document, suspended: mounted.suspended }) : null
    },
    document(key) { return resources.get(key)?.document ?? null },
    animationGeneration(key) { return resources.get(key)?.playGeneration ?? null },
    hasInteractionAnimation(key) {
      return resources.get(key)?.interactionState.hasSpatialAnimation() === true
    },
    interactionDocument(key) { return resources.get(key)?.interactionState.document() ?? null },
    nextAnimationGeneration(key) {
      return resources.has(key) ? nextPlayGeneration + 1 : null
    },
    devtoolsSnapshot() {
      const mountedResources = []
      const nodes = []
      const routes = []
      for (const mounted of resources.values()) {
        const implementationIds = new Set()
        const resourceById = new Map(mounted.document.resources.map((entry) => [entry.id, entry]))
        for (const descriptor of mounted.document.resources) implementationIds.add(descriptor.implementation)
        for (const object of mounted.document.objects) {
          for (const component of object.components ?? []) implementationIds.add(component.implementation)
          const geometry = object.geometryId ? resourceById.get(object.geometryId) : null
          const material = object.materialId ? resourceById.get(object.materialId) : null
          const implementation = geometry?.implementation ?? material?.implementation ?? null
          nodes.push({
            id: object.id,
            implementation,
            kind: object.kind,
            parentId: object.parentId,
            position: mounted.projection.objectPosition(object.id) ?? object.transform.position,
            resourceId: mounted.resource,
            visible: object.visible !== false && !mounted.suspended,
          })
        }
        const visualSnapshot = mounted.interactionVisuals?.snapshot()
        if (visualSnapshot?.route?.objectId) {
          routes.push({
            active: visualSnapshot.route.active,
            destination: visualSnapshot.route.destination,
            kind: visualSnapshot.route.kind,
            origin: visualSnapshot.route.origin,
            progress: visualSnapshot.route.progress,
            resourceId: mounted.resource,
          })
        }
        mountedResources.push({
          allocations: {
            geometries: mounted.document.resources.filter((entry) => entry.kind === 'geometry').length,
            materials: mounted.document.resources.filter((entry) => entry.kind === 'material').length,
            programs: 0,
            textures: mounted.document.resources.filter((entry) => entry.kind === 'texture').length,
          },
          animationCount: mounted.animations.snapshot().bindings.length,
          descriptorCount: mounted.document.resources.length,
          id: mounted.resource,
          implementations: [...implementationIds],
          interactionCount: 0,
          lifecycle: mounted.suspended ? 'suspended' : 'active',
          objectCount: mounted.document.objects.length,
          owner: mounted.owner,
          revision: mounted.document.revision,
          sceneId: mounted.document.id,
          signalCount: mounted.signals.snapshot().bindings.length,
          suspended: mounted.suspended,
        })
      }
      return { nodes, resources: mountedResources, routes }
    },
    setDevToolsProbe(probe) {
      devtoolsProbe = probe ?? null
      lastRenderAt = null
      return true
    },
    setInteractionGeometryObserver(observer) {
      interactionGeometryObserver = typeof observer === 'function' ? observer : null
      return true
    },
    updateSegment,
    snapshot() {
      return {
        contextLost,
        displayId: segment?.display_id ?? null,
        hidden,
        maxResources: MAX_RESOURCES,
        projection: 'desktop-world-orthographic',
        renderer: 'three',
        resources: resources.size,
        interactionVisuals: [...resources.values()].filter((entry) => entry.interactionVisuals && !entry.suspended).length,
        backingPixels: renderer.domElement.width * renderer.domElement.height,
      }
    },
    dispose() {
      if (disposed) return false
      disposed = true
      hostWindow.cancelAnimationFrame(frame)
      hostWindow.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      for (const key of [...resources.keys()]) release(key)
      gpuTimer?.dispose()
      gpuTimer = null
      interactionGeometryObserver = null
      renderer.dispose()
      renderer.forceContextLoss()
      return true
    },
  })
}
