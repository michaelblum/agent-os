import * as THREE from '../../vendor/three/three.module.min.js'
import {
  applySceneTransaction,
  canonicalizeSceneDocument,
  createDesktopWorldGpuTimer,
  deriveOrthoCamera,
  resolveThreeRenderMetrics,
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
import {
  DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  createSceneSegmentResourceBudget,
} from './scene-resource-budget.js'

const MAX_RESOURCES = 32
const MAX_SIGNALS_PER_SECOND = 30

export const DESKTOP_WORLD_SCENE_RENDER_LIMITS = Object.freeze({
  maxDevicePixelRatio: 2,
  maxBackingDimension: 4096,
  maxBackingPixels: 2_097_152,
})

function sceneOutletError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function sceneResourceCanRun(resourceSuspended, stageHidden, contextLost) {
  return !resourceSuspended && !stageHidden && !contextLost
}

export function sceneStageShouldRender(resources, stageHidden, contextLost, stageSuspended = false, faulted = false) {
  if (stageHidden || contextLost || stageSuspended || faulted) return false
  for (const mounted of resources.values()) {
    if (!mounted.suspended) return true
  }
  return false
}

export function reconcileSceneStageRunState(resources, previous, next, at = performance.now()) {
  const wasRunnable = !previous.hidden && !previous.contextLost && !previous.suspended && !previous.faulted
  const isRunnable = !next.hidden && !next.contextLost && !next.suspended && !next.faulted
  if (wasRunnable === isRunnable) return false
  for (const mounted of resources.values()) {
    if (!isRunnable) {
      mounted.playClock.suspend(at)
      mounted.interactionVisuals?.suspend(at)
    } else if (sceneResourceCanRun(mounted.suspended, next.hidden || next.suspended, next.contextLost || next.faulted)) {
      mounted.playClock.resume(at)
      mounted.interactionVisuals?.resume(at)
    }
  }
  return true
}

export function createDesktopWorldSceneOutlet({
  canvas,
  extensionRegistry,
  window: hostWindow = window,
} = {}) {
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
  const resources = new Map()
  const cleanupFailures = new Map()
  const pendingResourceKeys = new Set()
  const segmentBudget = createSceneSegmentResourceBudget()
  let frame = null
  let disposed = false
  let disposeResult = null
  let hidden = document.hidden === true
  let contextLost = false
  let stageSuspended = false
  let stageFault = null
  let segment = null
  let devtoolsProbe = null
  let faultObserver = null
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
      ...DESKTOP_WORLD_SCENE_RENDER_LIMITS,
    })
    if (!metrics) return false
    renderer.setPixelRatio(metrics.effectiveDevicePixelRatio)
    renderer.setSize(metrics.cssWidth, metrics.cssHeight, false)
    renderer.clear(true, true, true)
    camera.aspect = metrics.cssWidth / metrics.cssHeight
    camera.updateProjectionMatrix()
    return true
  }

  const recordResourceFailure = (mounted, code) => {
    devtoolsProbe?.recordEvent({ kind: 'scene.resource.failed', code, resourceId: mounted.resource })
  }

  const disposeMounted = (mounted, { preserveInteractionOrigins = false } = {}) => {
    return disposeDesktopWorldSceneMountedResource(mounted, {
      onFailure: recordResourceFailure,
      preserveInteractionOrigins,
      scene,
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
  ) => {
    try {
      return createDesktopWorldSceneMountedResource({
        documentInput,
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
    const candidate = prepareMounted(key, document, payload, previous, requestedExtension)
    let resourceReservation = null
    try {
      // The active projection and candidate coexist until commit. Admission is
      // against the real transient allocation, not the eventual replacement.
      resourceReservation = segmentBudget.reserve(candidate)
      if (!previous) pendingResourceKeys.add(key)
    } catch (error) {
      if (!retireMounted(candidate, { preserveInteractionOrigins: true })) {
        faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', candidate)
        throw new AggregateError([error], 'Scene replacement admission and cleanup failed.')
      }
      throw error
    }
    let state = 'prepared'

    const releaseReservation = () => {
      if (resourceReservation !== null) {
        segmentBudget.releaseReservation(resourceReservation)
        resourceReservation = null
      }
      if (!previous) pendingResourceKeys.delete(key)
    }

    return Object.freeze({
      document: candidate.document,
      assertCurrent() {
        if (state !== 'prepared') throw new TypeError('Scene replacement is no longer pending.')
        if ((resources.get(key) ?? null) !== previous) throw new TypeError('Scene replacement base changed before commit.')
        return true
      },
      commit() {
        this.assertCurrent()
        candidate.projection.activate?.()
        if (candidate.suspended || stageSuspended) {
          if (candidate.projection.suspend() === false) {
            throw sceneOutletError(
              'SCENE_EXTENSION_SUSPEND_FAILED',
              'Scene projection rejected its initial suspended state.',
            )
          }
        }
        candidate.stageSuspendedApplied = stageSuspended
        const measured = segmentBudget.measure(candidate.projection)
        candidate.resourceMetrics = measured.metrics
        candidate.resourceMetricsSource = measured.source
        segmentBudget.updateReservation(resourceReservation, candidate)
        scene.add(candidate.projection.object)
        if (previous && !retireMounted(previous, { preserveInteractionOrigins: true })) {
          const candidateClean = retireMounted(candidate, { preserveInteractionOrigins: true })
          releaseReservation()
          state = 'failed_closed'
          faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', previous)
          const failure = sceneOutletError('SCENE_EXTENSION_DISPOSE_FAILED', 'Scene replacement cleanup failed.')
          if (!candidateClean) throw new AggregateError([failure], 'Scene replacement cleanup failed closed.')
          throw failure
        }
        segmentBudget.commit(candidate, previous, resourceReservation)
        resourceReservation = null
        if (!previous) pendingResourceKeys.delete(key)
        resources.set(key, candidate)
        state = 'committed'
        reconcileRenderLoop()
        return true
      },
      rollback() {
        if (state !== 'prepared') return false
        if (!retireMounted(candidate, { preserveInteractionOrigins: true })) {
          releaseReservation()
          state = 'rollback_failed'
          faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', candidate)
          throw sceneOutletError('SCENE_EXTENSION_DISPOSE_FAILED', 'Scene replacement rollback cleanup failed.')
        }
        releaseReservation()
        state = 'rolled_back'
        return true
      },
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
      mounted.interactionVisuals = createDesktopWorldSceneInteractionThree({ THREE, scene, projection: mounted.projection })
    }
    return mounted.interactionVisuals
  }

  const applyExtensionInteraction = (mounted, input) => {
    if (typeof mounted.projection.applyInteraction !== 'function') {
      return { handled: false, routeStarted: false }
    }
    return mounted.projection.applyInteraction(input)
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
      || !sceneStageShouldRender(resources, hidden, contextLost, stageSuspended, Boolean(stageFault))
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
    sceneStageShouldRender(resources, hidden, contextLost, stageSuspended, Boolean(stageFault))
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
        for (const mounted of resources.values()) {
          if (mounted.suspended) continue
          try {
            const elapsed = mounted.playClock.elapsed(at)
            mounted.animations.tick(elapsed)
            mounted.projection.tick?.(elapsed)
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
    applyInteractionResponse,
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
        projection: 'desktop-world-orthographic',
        renderer: 'three',
        resourceMetrics: segmentBudget.snapshot(),
        resources: resources.size,
        interactionVisuals: [...resources.values()].filter((entry) => entry.interactionVisuals && !entry.suspended).length,
        backingPixels: renderer.domElement.width * renderer.domElement.height,
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
