import * as THREE from '../../vendor/three/three.module.min.js'
import {
  applySceneTransaction,
  canonicalizeSceneDocument,
  createDesktopWorldGpuTimer,
} from '../../scene/index.js'
import { createDesktopWorldSceneInteractionThree } from './scene-interaction-three.js'
import {
  createDesktopWorldSceneMountedResource,
  disposeDesktopWorldSceneMountedResource,
  sameSceneExtensionReference,
} from './scene-mounted-resource.js'
import {
  createSceneOutletDevToolsSnapshot,
  emitSceneOutletRouteStartedSnapshot,
} from './scene-outlet-devtools.js'
import { prepareDesktopWorldSceneOutletReplacement } from './scene-outlet-replacement.js'
import { createDesktopWorldSceneRenderCoordinator } from './scene-render-coordinator.js'
import { evaluateDesktopWorldNativeRenderMetrics } from './scene-render-budget.js'
import { createDesktopWorldRenderDamageTracker } from './scene-render-damage.js'
import {
  DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  createSceneSegmentResourceBudget,
} from './scene-resource-budget.js'
import {
  createDesktopWorldFramebufferProofRateLimiter,
  proveDesktopWorldSceneFramebuffer,
} from './scene-framebuffer-proof.js'
import {
  reconcileSceneStageRunState,
  sceneResourceCanRun,
  sceneStageShouldRender,
} from './scene-outlet-run-state.js'
import { createDesktopWorldStageClock } from './scene-stage-clock.js'

export {
  DESKTOP_WORLD_SCENE_RENDER_LIMITS,
  reconcileSceneStageRunState,
  sceneResourceCanRun,
  sceneStageShouldRender,
} from './scene-outlet-run-state.js'

const MAX_RESOURCES = 32
const MAX_SIGNALS_PER_SECOND = 30

function sceneOutletError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createDesktopWorldSceneOutlet({
  canvas,
  desktopFrameSourceFactory = null,
  extensionRegistry,
  stageClock = createDesktopWorldStageClock(),
  window: hostWindow = window,
} = {}) {
  if (!canvas) throw new TypeError('DesktopWorld scene outlet requires a canvas.')
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    powerPreference: 'low-power',
    preserveDrawingBuffer: true,
  })
  renderer.setClearColor(0x000000, 0)
  const renderCoordinator = createDesktopWorldSceneRenderCoordinator({ THREE, renderer })
  const resources = new Map()
  const cleanupFailures = new Map()
  const pendingResourceKeys = new Set()
  const segmentBudget = createSceneSegmentResourceBudget()
  const damageTracker = createDesktopWorldRenderDamageTracker()
  let frame = null
  let disposed = false
  let disposeResult = null
  let hidden = document.hidden === true
  let contextLost = false
  let stageSuspended = false
  let stageFault = null
  let segment = null
  let topology = []
  let renderMetrics = null
  let devtoolsProbe = null
  let faultObserver = null
  let gpuTimer = null
  let lastRenderAt = null
  let interactionGeometryObserver = null
  let nextPlayGeneration = 0
  const framebufferProofRateLimiter = createDesktopWorldFramebufferProofRateLimiter()

  const notifyInteractionGeometry = (key, generation) => {
    try {
      interactionGeometryObserver?.(key, generation)
    } catch {
      devtoolsProbe?.recordEvent({ kind: 'interaction.geometry.failed', code: 'INPUT_REGION_SYNC_FAILED' })
    }
  }

  const updateSegment = (nextSegment, nextTopology) => {
    if (!renderCoordinator.updateSegment(nextSegment, nextTopology)) {
      faultSceneSegment('SCENE_SEGMENT_CONFIGURATION_FAILED')
      return false
    }
    segment = nextSegment
    topology = Array.isArray(nextTopology) ? [...nextTopology] : []
    if (!damageTracker.updateSegment(nextSegment)) {
      faultSceneSegment('SCENE_SEGMENT_CONFIGURATION_FAILED')
      return false
    }
    return resize()
  }

  const resize = () => {
    const resolution = evaluateDesktopWorldNativeRenderMetrics({
      context: renderer.getContext(),
      width: canvas.clientWidth || hostWindow.innerWidth,
      height: canvas.clientHeight || hostWindow.innerHeight,
      devicePixelRatio: hostWindow.devicePixelRatio,
      segment,
      topology,
    })
    if (!resolution.ok) {
      faultSceneSegment(resolution.code)
      return false
    }
    const metrics = resolution.metrics
    renderMetrics = metrics
    renderer.setPixelRatio(metrics.effectiveDevicePixelRatio)
    renderer.setSize(metrics.cssWidth, metrics.cssHeight, false)
    renderer.clear(true, true, true)
    damageTracker.invalidate()
    if (!renderCoordinator.refresh(resources)) {
      faultSceneSegment('SCENE_RENDER_PASS_CONFIGURATION_FAILED')
      return false
    }
    return true
  }

  const recordResourceFailure = (mounted, code) => {
    devtoolsProbe?.recordEvent({ kind: 'scene.resource.failed', code, resourceId: mounted.resource })
  }

  const disposeMounted = (mounted, { preserveInteractionOrigins = false } = {}) => {
    return disposeDesktopWorldSceneMountedResource(mounted, {
      onFailure: recordResourceFailure,
      preserveInteractionOrigins,
      removeProjection: renderCoordinator.detach,
    })
  }

  const trackCleanup = (mounted, clean) => {
    const pending = cleanupFailures.get(mounted.key) ?? new Set()
    if (clean) pending.delete(mounted)
    else pending.add(mounted)
    if (pending.size > 0) cleanupFailures.set(mounted.key, pending)
    else cleanupFailures.delete(mounted.key)
    return clean
  }

  const retireMounted = (mounted, options) => trackCleanup(mounted, disposeMounted(mounted, options))

  const retryCleanup = (key = null) => {
    let clean = true
    const entries = key === null
      ? [...cleanupFailures.entries()]
      : [[key, cleanupFailures.get(key) ?? new Set()]]
    for (const [entryKey, pending] of entries) {
      for (const mounted of [...pending]) {
        if (disposeMounted(mounted)) pending.delete(mounted)
        else clean = false
      }
      if (pending.size === 0) cleanupFailures.delete(entryKey)
    }
    return clean
  }

  function faultSceneSegment(code, mounted = null) {
    if (disposed || stageFault) return false
    const now = performance.now()
    const fault = Object.freeze({
      code,
      leaseKey: mounted?.key ?? null,
      owner: mounted?.owner ?? null,
      resource: mounted?.resource ?? null,
    })
    reconcileSceneStageRunState(
      resources,
      { hidden, contextLost, suspended: stageSuspended, faulted: false },
      { hidden, contextLost, suspended: stageSuspended, faulted: true },
      now,
    )
    stageFault = fault
    lastRenderAt = null
    cancelRender()
    try { gpuTimer?.dispose() } catch {}
    gpuTimer = null
    devtoolsProbe?.recordEvent({ kind: 'scene.segment.failed', code, resourceId: fault.resource })
    try { faultObserver?.(fault) } catch {}
    return true
  }

  const release = (key) => {
    const mounted = resources.get(key)
    const hadPendingCleanup = cleanupFailures.has(key)
    if (!mounted && !hadPendingCleanup) return false
    if (mounted) {
      resources.delete(key)
      segmentBudget.unaccount(mounted)
      retireMounted(mounted)
    }
    const clean = retryCleanup(key)
    reconcileRenderLoop()
    if (!clean) {
      faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', mounted)
      throw sceneOutletError('SCENE_EXTENSION_DISPOSE_FAILED', 'DesktopWorld scene resource cleanup failed.')
    }
    return true
  }

  const prepareMounted = (
    key,
    documentInput,
    identity = {},
    previous = resources.get(key),
    extensionReference = previous?.extensionReference ?? null,
    budgets = null,
  ) => {
    try {
      return createDesktopWorldSceneMountedResource({
        budgets,
        documentInput,
        desktopFrameSourceFactory,
        extensionReference,
        extensionRegistry,
        identity,
        key,
        onCleanupFailure: (code) => {
          devtoolsProbe?.recordEvent({ kind: 'scene.resource.failed', code })
        },
        previous,
        segmentBudget,
      })
    } catch (error) {
      if (error?.code === 'SCENE_EXTENSION_DISPOSE_FAILED') {
        faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED')
      }
      throw error
    }
  }

  const prepareReplacement = (message) => {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    const operation = payload.operation ?? {}
    if (disposed) throw sceneOutletError('SCENE_STAGE_DISPOSED', 'DesktopWorld scene stage is disposed.')
    if (message?.type !== 'desktop_world_stage.scene.operation' || typeof key !== 'string') {
      throw new TypeError('Scene replacement requires a scene operation and lease key.')
    }
    if (operation.op !== 'mount' && operation.op !== 'transact') {
      throw new TypeError('Only scene mount and transact operations can be prepared.')
    }
    const previous = resources.get(key) ?? null
    if (!previous && resources.size + pendingResourceKeys.size >= MAX_RESOURCES) {
      throw new RangeError('DesktopWorld scene resource budget exceeded.')
    }
    let document = operation.document
    if (operation.op === 'transact') {
      if (!previous) throw new TypeError('Scene resource is not mounted.')
      const result = applySceneTransaction(previous.document, operation.transaction, { lease: operation.lease })
      if (!result.ok) throw new TypeError(result.code)
      document = result.document
    }
    const requestedExtension = operation.op === 'mount'
      ? (Object.hasOwn(operation, 'extension') ? operation.extension : null)
      : previous?.extensionReference ?? null
    if (operation.op === 'transact' && Object.hasOwn(operation, 'extension')) {
      if (!sameSceneExtensionReference(requestedExtension, previous?.extensionReference ?? null)) {
        throw new TypeError('Scene projection extensions may change only through a full mount.')
      }
    }
    return prepareDesktopWorldSceneOutletReplacement({
      attachCandidate: renderCoordinator.attach,
      createCandidate: (budgets) => prepareMounted(
        key,
        document,
        payload,
        previous,
        requestedExtension,
        budgets,
      ),
      faultSceneSegment,
      key,
      pendingResourceKeys,
      previous,
      reconcileRenderLoop,
      resources,
      retireMounted,
      segmentBudget,
      stageSuspended: () => stageSuspended,
    })
  }

  const apply = (message) => {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    if (disposed) throw sceneOutletError('SCENE_STAGE_DISPOSED', 'DesktopWorld scene stage is disposed.')
    if (message?.type === 'desktop_world_stage.scene.release') return release(key)
    if (message?.type !== 'desktop_world_stage.scene.operation' || typeof key !== 'string') return false
    const operation = payload.operation ?? {}
    if (stageFault && !['close', 'inspect', 'remove'].includes(operation.op)) {
      throw sceneOutletError(stageFault.code, 'DesktopWorld scene segment is faulted.')
    }
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
      try {
        mounted.signals.publish(operation.signalId, operation.value, Number(operation.at) || Date.now())
      } catch (error) {
        recordResourceFailure(mounted, 'SCENE_EXTENSION_SIGNAL_FAILED')
        release(key)
        throw error
      }
    } else if (operation.op === 'play') {
      const mounted = resources.get(key)
      if (mounted) {
        const now = performance.now()
        mounted.animations.restart()
        mounted.interactionState.reset(mounted.document)
        mounted.interactionState.takeDirty()
        mounted.playGeneration = ++nextPlayGeneration
        mounted.playClock.restart(now)
        if (!sceneResourceCanRun(mounted.suspended, hidden || stageSuspended, contextLost || Boolean(stageFault))) {
          mounted.playClock.suspend(now)
        }
      }
    } else if (operation.op === 'suspend' || operation.op === 'resume') {
      const mounted = resources.get(key)
      if (mounted) {
        const now = performance.now()
        const wasSuspended = mounted.suspended
        mounted.suspended = operation.op === 'suspend'
        if (!wasSuspended && mounted.suspended) mounted.playClock.suspend(now)
        const canRun = sceneResourceCanRun(
          mounted.suspended,
          hidden || stageSuspended,
          contextLost || Boolean(stageFault),
        )
        if (wasSuspended && canRun) {
          mounted.playClock.resume(now)
        }
        try {
          if (operation.op === 'suspend' || canRun) mounted.projection[operation.op]()
          if (
            operation.op === 'suspend'
            || canRun
          ) {
            mounted.interactionVisuals?.[operation.op](now)
          }
        } catch (error) {
          recordResourceFailure(mounted, `SCENE_EXTENSION_${operation.op.toUpperCase()}_FAILED`)
          release(key)
          throw error
        }
      }
    } else if (operation.op === 'remove' || operation.op === 'close') {
      release(key)
    } else if (operation.op !== 'inspect') return false
    reconcileRenderLoop()
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
      mounted.interactionVisuals = createDesktopWorldSceneInteractionThree({
        THREE,
        scene: renderCoordinator.overlayScene,
        projection: mounted.projection,
      })
    }
    return mounted.interactionVisuals
  }

  const applyExtensionInteraction = (mounted, input) => {
    if (typeof mounted.projection.applyInteraction !== 'function') {
      return { handled: false, routeStarted: false }
    }
    return mounted.projection.applyInteraction(input)
  }

  const applyPointerVisual = (key, input) => {
    const mounted = resources.get(key)
    if (!mounted || typeof mounted.projection.applyPointerVisual !== 'function') return false
    mounted.projection.applyPointerVisual(input)
    return true
  }

  const applyCursorPresentation = (key, input) => {
    const mounted = resources.get(key)
    if (!mounted || typeof mounted.projection.applyCursorPresentation !== 'function') return false
    mounted.projection.applyCursorPresentation(input)
    return true
  }

  const applyInteractionResponseUnsafe = (key, { frame, interaction, response, topology } = {}) => {
    const mounted = resources.get(key)
    if (!mounted || stageSuspended || stageFault || hidden || contextLost || !response?.kind || !frame?.interactionId) return null
    if (response.kind === 'aim_commit') {
      if (frame.phase !== 'end') {
        const input = { frame, interaction, response, topology }
        const extension = applyExtensionInteraction(mounted, input)
        if (!extension.handled) ensureInteractionVisuals(mounted).apply(input)
        return { ...response, applied: false, revision: mounted.document.revision }
      }
      const revision = commitObjectPosition(mounted, response.objectId, response.position)
      if (revision === null) {
        mounted.interactionVisuals?.cancel()
        return { ...response, applied: false, revision: mounted.document.revision }
      }
      const input = {
        frame,
        interaction,
        response: { ...response, applied: true, revision },
        topology,
      }
      const extension = applyExtensionInteraction(mounted, input)
      const visual = extension.handled
        ? extension
        : ensureInteractionVisuals(mounted).apply(input)
      emitSceneOutletRouteStartedSnapshot(devtoolsProbe, visual)
      if (!visual.routeStarted) mounted.projection.setObjectPosition(response.objectId, response.position)
      return { ...response, applied: true, revision }
    }
    if (interaction?.recognizer?.implementation === 'aos.scene.gesture.radial') {
      ensureInteractionVisuals(mounted).apply({ frame, interaction, response, topology })
    }
    if (response.kind === 'radial_menu') {
      if (response.action !== 'open' || frame.phase === 'end') {
        const input = { frame, interaction, response, topology }
        const extension = applyExtensionInteraction(mounted, input)
        if (!extension.handled) ensureInteractionVisuals(mounted).apply(input)
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

  const applyInteractionResponse = (key, input) => {
    try {
      return applyInteractionResponseUnsafe(key, input)
    } catch (error) {
      const mounted = resources.get(key)
      if (mounted) {
        recordResourceFailure(mounted, 'SCENE_EXTENSION_INTERACTION_FAILED')
        faultSceneSegment('SCENE_EXTENSION_INTERACTION_FAILED', mounted)
      }
      throw error
    }
  }

  const scheduleRender = () => {
    if (
      frame !== null
      || disposed
      || !sceneStageShouldRender(
        resources,
        hidden,
        contextLost,
        stageSuspended,
        Boolean(stageFault),
        damageTracker.hasPendingCleanup(resources),
      )
    ) return false
    frame = hostWindow.requestAnimationFrame(render)
    return true
  }

  const cancelRender = () => {
    if (frame === null) return false
    hostWindow.cancelAnimationFrame(frame)
    frame = null
    return true
  }

  const reconcileRenderLoop = () => (
    sceneStageShouldRender(
      resources,
      hidden,
      contextLost,
      stageSuspended,
      Boolean(stageFault),
      damageTracker.hasPendingCleanup(resources),
    )
      ? scheduleRender()
      : cancelRender()
  )

  const render = (at) => {
    if (disposed) return
    frame = null
    const trackPerformance = devtoolsProbe?.isEnabled() === true
    const trackGpu = devtoolsProbe?.isRecording() === true
    const updateStartedAt = trackPerformance ? performance.now() : 0
    try {
      if (!hidden && !contextLost && !stageSuspended && !stageFault) {
        const stageAt = stageClock.at(at)
        for (const mounted of resources.values()) {
          if (mounted.suspended) continue
          try {
            const elapsed = mounted.playClock.elapsed(at)
            mounted.animations.tick(elapsed)
            mounted.projection.tick?.(elapsed, stageAt)
            segmentBudget.refresh(mounted)
            if (mounted.interactionState.takeDirty()) {
              notifyInteractionGeometry(mounted.key, mounted.playGeneration)
            }
            mounted.interactionVisuals?.tick(at)
          } catch (error) {
            const code = typeof error?.code === 'string' && error.code.startsWith('SCENE_SEGMENT_RESOURCE_')
              ? error.code
              : 'SCENE_EXTENSION_TICK_FAILED'
            recordResourceFailure(mounted, code)
            faultSceneSegment(code, mounted)
            break
          }
        }
        if (stageFault) return
        const renderStartedAt = trackPerformance ? performance.now() : 0
        if (trackGpu && !gpuTimer) gpuTimer = createDesktopWorldGpuTimer(renderer.getContext())
        if (!trackGpu && gpuTimer) {
          gpuTimer.dispose()
          gpuTimer = null
        }
        const damage = damageTracker.frame(resources)
        gpuTimer?.begin()
        renderCoordinator.render(resources, damage)
        const gpuMs = gpuTimer?.end() ?? null
        if (trackPerformance) {
          const renderEndedAt = performance.now()
          const info = renderer.info
          devtoolsProbe.sampleFrame({
            backingPixels: renderer.domElement.width * renderer.domElement.height,
            backingHeight: renderMetrics?.backingHeight,
            backingWidth: renderMetrics?.backingWidth,
            damagedPixelPercentage: damage.damagedPixelPercentage,
            drawCalls: info.render.calls,
            frameMs: lastRenderAt === null ? null : Math.max(0, at - lastRenderAt),
            geometries: info.memory.geometries,
            gpuMs,
            effectiveDevicePixelRatio: renderMetrics?.effectiveDevicePixelRatio,
            estimatedBackingBytes: renderMetrics?.estimatedBackingBytes,
            msaaSamples: renderMetrics?.msaaSamples,
            programs: info.programs?.length ?? null,
            requestedDevicePixelRatio: renderMetrics?.requestedDevicePixelRatio,
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
    } catch {
      faultSceneSegment('SCENE_RENDER_FAILED')
    } finally {
      if (!stageFault) scheduleRender()
    }
  }

  const setStageSuspended = (nextSuspended) => {
    if (disposed) return false
    if (nextSuspended === stageSuspended) return true
    if (!nextSuspended && stageFault) return false
    const now = performance.now()
    if (nextSuspended) {
      reconcileSceneStageRunState(
        resources,
        { hidden, contextLost, suspended: false, faulted: false },
        { hidden, contextLost, suspended: true, faulted: false },
        now,
      )
      stageSuspended = true
    }
    for (const mounted of resources.values()) {
      if (mounted.suspended) continue
      try {
        const action = nextSuspended ? 'suspend' : 'resume'
        if (mounted.projection[action]() === false) {
          throw new Error(`Scene projection rejected stage ${action}.`)
        }
        mounted.stageSuspendedApplied = nextSuspended
      } catch {
        recordResourceFailure(mounted, `SCENE_EXTENSION_${nextSuspended ? 'SUSPEND' : 'RESUME'}_FAILED`)
        faultSceneSegment(`SCENE_EXTENSION_${nextSuspended ? 'SUSPEND' : 'RESUME'}_FAILED`, mounted)
        return false
      }
    }
    if (!nextSuspended) {
      stageSuspended = false
      reconcileSceneStageRunState(
        resources,
        { hidden, contextLost, suspended: true, faulted: false },
        { hidden, contextLost, suspended: false, faulted: false },
        now,
      )
    }
    reconcileRenderLoop()
    return true
  }

  const releaseAll = () => {
    const failures = []
    const keys = new Set([...resources.keys(), ...cleanupFailures.keys()])
    for (const key of keys) {
      try { release(key) } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'DesktopWorld scene aggregate retirement failed.')
    }
    return true
  }

  const onVisibility = () => {
    const nextHidden = document.hidden
    reconcileSceneStageRunState(
      resources,
      { hidden, contextLost, suspended: stageSuspended, faulted: Boolean(stageFault) },
      { hidden: nextHidden, contextLost, suspended: stageSuspended, faulted: Boolean(stageFault) },
    )
    hidden = nextHidden
    reconcileRenderLoop()
  }
  const onContextLost = (event) => {
    event.preventDefault()
    reconcileSceneStageRunState(
      resources,
      { hidden, contextLost, suspended: stageSuspended, faulted: Boolean(stageFault) },
      { hidden, contextLost: true, suspended: stageSuspended, faulted: Boolean(stageFault) },
    )
    contextLost = true
    for (const mounted of resources.values()) {
      try { mounted.projection.contextLost?.() } catch {
        recordResourceFailure(mounted, 'SCENE_EXTENSION_CONTEXT_LOST_FAILED')
        faultSceneSegment('SCENE_EXTENSION_CONTEXT_LOST_FAILED', mounted)
        break
      }
    }
    gpuTimer?.dispose()
    gpuTimer = null
    devtoolsProbe?.recordEvent({ kind: 'context.lost', code: 'WEBGL_CONTEXT_LOST' })
    reconcileRenderLoop()
  }
  const onContextRestored = () => {
    for (const mounted of resources.values()) {
      try {
        mounted.projection.contextRestored?.()
      } catch {
        recordResourceFailure(mounted, 'SCENE_EXTENSION_CONTEXT_RESTORED_FAILED')
        faultSceneSegment('SCENE_EXTENSION_CONTEXT_RESTORED_FAILED', mounted)
        return
      }
    }
    reconcileSceneStageRunState(
      resources,
      { hidden, contextLost, suspended: stageSuspended, faulted: Boolean(stageFault) },
      { hidden, contextLost: false, suspended: stageSuspended, faulted: Boolean(stageFault) },
    )
    contextLost = false
    resize()
    devtoolsProbe?.recordEvent({ kind: 'context.restored' })
    reconcileRenderLoop()
  }
  hostWindow.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  resize()
  reconcileRenderLoop()

  return Object.freeze({
    apply,
    applyCursorPresentation,
    applyInteractionResponse,
    applyPointerVisual,
    prepareReplacement,
    configuration(key) {
      const mounted = resources.get(key)
      return mounted ? Object.freeze({
        document: mounted.document,
        extension: mounted.extensionReference,
        suspended: mounted.suspended,
      }) : null
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
      return createSceneOutletDevToolsSnapshot(resources, { stageFault, stageSuspended })
    },
    setDevToolsProbe(probe) {
      devtoolsProbe = probe ?? null
      lastRenderAt = null
      return true
    },
    setFaultObserver(observer) {
      faultObserver = typeof observer === 'function' ? observer : null
      return true
    },
    setInteractionGeometryObserver(observer) {
      interactionGeometryObserver = typeof observer === 'function' ? observer : null
      return true
    },
    proveFramebuffer(key, { expectedDigest, expectedRevision, proofId } = {}) {
      const mounted = resources.get(key)
      if (disposed || hidden || contextLost || stageSuspended || stageFault || mounted?.suspended !== false) {
        throw sceneOutletError(
          'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
          'DesktopWorld framebuffer proof is unavailable.',
        )
      }
      if (mounted.document.revision !== expectedRevision
          || mounted.extensionReference?.digest !== expectedDigest) {
        throw sceneOutletError(
          'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
          'DesktopWorld framebuffer proof authority is stale.',
        )
      }
      const descriptor = mounted.projection.framebufferProofDescriptor?.(proofId) ?? null
      if (!descriptor) {
        throw sceneOutletError(
          'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
          'DesktopWorld framebuffer proof is not declared by the mounted extension.',
        )
      }
      try {
        return Object.freeze({
          ...proveDesktopWorldSceneFramebuffer({
            admit: () => framebufferProofRateLimiter.admit(),
            descriptor,
            renderer,
            renderFrame: () => renderCoordinator.render(resources),
          }),
          extension_digest: expectedDigest,
          resource_revision: expectedRevision,
        })
      } catch (error) {
        if (error?.code === 'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE'
            || error?.code === 'SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED'
            || error?.code === 'SCENE_FRAMEBUFFER_READBACK_FAILED') throw error
        throw sceneOutletError(
          'SCENE_FRAMEBUFFER_READBACK_FAILED',
          'DesktopWorld framebuffer proof failed.',
        )
      }
    },
    releaseAll,
    updateSegment,
    suspend() { return setStageSuspended(true) },
    resume() { return setStageSuspended(false) },
    snapshot() {
      return {
        contextLost,
        displayId: segment?.display_id ?? null,
        faultCode: stageFault?.code ?? null,
        faulted: stageFault !== null,
        hidden,
        maxResources: MAX_RESOURCES,
        maxResourceMetrics: { ...DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS },
        projection: 'desktop-world-mixed',
        renderPasses: renderCoordinator.snapshot(resources),
        renderer: 'three',
        resourceMetrics: segmentBudget.snapshot(),
        resources: resources.size,
        interactionVisuals: [...resources.values()].filter((entry) => entry.interactionVisuals && !entry.suspended).length,
        backingPixels: renderer.domElement.width * renderer.domElement.height,
        backingHeight: renderMetrics?.backingHeight ?? renderer.domElement.height,
        backingWidth: renderMetrics?.backingWidth ?? renderer.domElement.width,
        effectiveDevicePixelRatio: renderMetrics?.effectiveDevicePixelRatio ?? null,
        estimatedBackingBytes: renderMetrics?.estimatedBackingBytes ?? null,
        estimatedTopologyBackingBytes: renderMetrics?.estimatedTopologyBackingBytes ?? null,
        msaaSamples: renderMetrics?.msaaSamples ?? null,
        requestedDevicePixelRatio: renderMetrics?.requestedDevicePixelRatio ?? null,
        topologyBackingPixels: renderMetrics?.topologyBackingPixels ?? null,
        renderDamage: damageTracker.snapshot(),
        renderLoopActive: frame !== null,
        stageSuspended,
      }
    },
    dispose() {
      if (disposed) return disposeResult
      disposed = true
      let clean = true
      cancelRender()
      hostWindow.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      for (const mounted of resources.values()) {
        segmentBudget.unaccount(mounted)
        if (!retireMounted(mounted)) clean = false
      }
      resources.clear()
      if (!retryCleanup()) clean = false
      try { gpuTimer?.dispose() } catch { clean = false }
      gpuTimer = null
      interactionGeometryObserver = null
      faultObserver = null
      try { renderer.dispose() } catch { clean = false }
      try { renderer.forceContextLoss() } catch { clean = false }
      disposeResult = clean
      return disposeResult
    },
  })
}
