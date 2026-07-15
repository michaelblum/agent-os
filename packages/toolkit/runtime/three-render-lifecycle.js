const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2
const DEFAULT_MAX_BACKING_DIMENSION = 4096
const DEFAULT_MAX_BACKING_PIXELS = 4_194_304

export const DEFAULT_THREE_RENDER_LIMITS = Object.freeze({
  maxDevicePixelRatio: DEFAULT_MAX_DEVICE_PIXEL_RATIO,
  maxBackingDimension: DEFAULT_MAX_BACKING_DIMENSION,
  maxBackingPixels: DEFAULT_MAX_BACKING_PIXELS,
})

function positiveFinite(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export function resolveThreeRenderMetrics({
  width,
  height,
  devicePixelRatio = 1,
  maxDevicePixelRatio = DEFAULT_MAX_DEVICE_PIXEL_RATIO,
  maxBackingDimension = DEFAULT_MAX_BACKING_DIMENSION,
  maxBackingPixels = DEFAULT_MAX_BACKING_PIXELS,
} = {}) {
  const cssWidth = Number(width)
  const cssHeight = Number(height)
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) return null
  if (!Number.isFinite(cssHeight) || cssHeight <= 0) return null

  const requestedDevicePixelRatio = positiveFinite(devicePixelRatio, 1)
  const devicePixelRatioLimit = positiveFinite(
    maxDevicePixelRatio,
    DEFAULT_MAX_DEVICE_PIXEL_RATIO,
  )
  const backingDimensionLimit = Math.max(1, Math.floor(positiveFinite(
    maxBackingDimension,
    DEFAULT_MAX_BACKING_DIMENSION,
  )))
  const backingPixelLimit = Math.max(1, Math.floor(positiveFinite(
    maxBackingPixels,
    DEFAULT_MAX_BACKING_PIXELS,
  )))
  const cappedDevicePixelRatio = Math.min(requestedDevicePixelRatio, devicePixelRatioLimit)
  const dimensionScale = Math.min(
    backingDimensionLimit / cssWidth,
    backingDimensionLimit / cssHeight,
  )
  const pixelScale = Math.sqrt(backingPixelLimit / (cssWidth * cssHeight))
  const effectiveDevicePixelRatio = Math.min(
    cappedDevicePixelRatio,
    dimensionScale,
    pixelScale,
  )
  if (!Number.isFinite(effectiveDevicePixelRatio) || effectiveDevicePixelRatio <= 0) return null

  const backingWidth = Math.max(
    1,
    Math.min(backingDimensionLimit, Math.floor(cssWidth * effectiveDevicePixelRatio)),
  )
  const backingHeight = Math.max(
    1,
    Math.min(backingDimensionLimit, Math.floor(cssHeight * effectiveDevicePixelRatio)),
  )

  return {
    cssWidth,
    cssHeight,
    requestedDevicePixelRatio,
    effectiveDevicePixelRatio,
    backingWidth,
    backingHeight,
    backingPixels: backingWidth * backingHeight,
    constrained: effectiveDevicePixelRatio < requestedDevicePixelRatio,
    limits: {
      maxDevicePixelRatio: devicePixelRatioLimit,
      maxBackingDimension: backingDimensionLimit,
      maxBackingPixels: backingPixelLimit,
    },
  }
}

function disposeOnce(resource, disposed) {
  if (!resource || typeof resource.dispose !== 'function' || disposed.has(resource)) return false
  disposed.add(resource)
  resource.dispose()
  return true
}

function disposeTextureValue(value, disposed, counts, seen) {
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value.isTexture === true) {
    if (disposeOnce(value, disposed)) counts.textures += 1
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) disposeTextureValue(entry, disposed, counts, seen)
    return
  }
  if ('value' in value) disposeTextureValue(value.value, disposed, counts, seen)
}

function disposeMaterial(material, disposed, counts) {
  if (!material || typeof material !== 'object') return
  const materials = Array.isArray(material) ? material : [material]
  for (const entry of materials) {
    if (!entry || typeof entry !== 'object') continue
    const seen = new Set()
    for (const value of Object.values(entry)) {
      disposeTextureValue(value, disposed, counts, seen)
    }
    for (const uniform of Object.values(entry.uniforms ?? {})) {
      disposeTextureValue(uniform, disposed, counts, seen)
    }
    if (disposeOnce(entry, disposed)) counts.materials += 1
  }
}

function visitObjectTree(root, visitor) {
  if (!root || typeof root !== 'object') return
  if (typeof root.traverse === 'function') {
    root.traverse(visitor)
    return
  }
  const pending = [root]
  const seen = new Set()
  while (pending.length > 0) {
    const object = pending.pop()
    if (!object || typeof object !== 'object' || seen.has(object)) continue
    seen.add(object)
    visitor(object)
    if (Array.isArray(object.children)) pending.push(...object.children)
  }
}

export function disposeThreeObjectTree(root, { clear = true } = {}) {
  const disposed = new Set()
  const counts = { objects: 0, geometries: 0, materials: 0, textures: 0 }
  visitObjectTree(root, (object) => {
    counts.objects += 1
    if (disposeOnce(object.geometry, disposed)) counts.geometries += 1
    disposeMaterial(object.material, disposed, counts)
    disposeMaterial(object.customDepthMaterial, disposed, counts)
    disposeMaterial(object.customDistanceMaterial, disposed, counts)
    disposeTextureValue(object.background, disposed, counts, new Set())
    disposeTextureValue(object.environment, disposed, counts, new Set())
    if (object.skeleton?.boneTexture?.isTexture === true) {
      if (disposeOnce(object.skeleton.boneTexture, disposed)) counts.textures += 1
    }
  })
  if (clear) root?.clear?.()
  return counts
}

export function disposeThreeRenderer(renderer, { forceContextLoss = true } = {}) {
  if (!renderer) return { disposed: false, contextLost: false }
  renderer.setAnimationLoop?.(null)
  renderer.renderLists?.dispose?.()
  renderer.dispose?.()
  if (forceContextLoss) renderer.forceContextLoss?.()
  return {
    disposed: typeof renderer.dispose === 'function',
    contextLost: forceContextLoss && typeof renderer.forceContextLoss === 'function',
  }
}

function measureContainer(container) {
  const rect = container?.getBoundingClientRect?.()
  return {
    width: Number(rect?.width ?? container?.clientWidth),
    height: Number(rect?.height ?? container?.clientHeight),
  }
}

function defaultCameraUpdate(camera, metrics) {
  if (!camera?.isPerspectiveCamera) return
  camera.aspect = metrics.cssWidth / metrics.cssHeight
  camera.updateProjectionMatrix?.()
}

export function createThreeRenderLifecycle({
  renderer,
  scene = null,
  camera = null,
  canvas = renderer?.domElement ?? null,
  container = canvas?.parentElement ?? canvas,
  document: documentObject = globalThis.document,
  window: windowObject = globalThis.window,
  ResizeObserver: ResizeObserverClass = globalThis.ResizeObserver,
  requestAnimationFrame: requestFrame = windowObject?.requestAnimationFrame?.bind(windowObject),
  cancelAnimationFrame: cancelFrame = windowObject?.cancelAnimationFrame?.bind(windowObject),
  measure = () => measureContainer(container),
  updateCamera = defaultCameraUpdate,
  onFrame = null,
  onResize = null,
  onContextLost = null,
  onContextRestored = null,
  onVisibilityChange = null,
  additionalDisposables = [],
  limits = {},
} = {}) {
  if (!renderer || typeof renderer.setSize !== 'function') {
    throw new TypeError('Three render lifecycle requires a renderer with setSize().')
  }

  const frameHandler = typeof onFrame === 'function'
    ? onFrame
    : scene && camera && typeof renderer.render === 'function'
      ? () => renderer.render(scene, camera)
      : null
  let started = false
  let disposed = false
  let suspended = false
  let contextLost = false
  let frameId = null
  let previousFrameAt = null
  let metrics = null
  let observer = null
  let disposalResult = null

  const documentHidden = () => (
    documentObject?.hidden === true || documentObject?.visibilityState === 'hidden'
  )

  const rendererContextLost = () => {
    try {
      return renderer.getContext?.().isContextLost?.() === true
    } catch {
      return false
    }
  }

  const canRender = () => (
    started && !disposed && !suspended && !contextLost && !documentHidden()
  )

  const snapshot = () => ({
    started,
    disposed,
    suspended,
    contextLost,
    hidden: documentHidden(),
    frameScheduled: frameId !== null,
    metrics,
  })

  const cancelScheduledFrame = () => {
    if (frameId === null) return
    cancelFrame?.(frameId)
    frameId = null
  }

  const scheduleFrame = () => {
    if (!frameHandler || !canRender() || frameId !== null || typeof requestFrame !== 'function') return
    frameId = requestFrame((at) => {
      frameId = null
      if (!canRender()) return
      const deltaMs = previousFrameAt === null ? 0 : Math.max(0, Number(at) - previousFrameAt)
      previousFrameAt = Number(at)
      frameHandler({ at: Number(at), deltaMs, metrics, renderer, scene, camera })
      scheduleFrame()
    })
  }

  const resize = () => {
    if (disposed) return null
    const measured = measure?.() ?? {}
    const next = resolveThreeRenderMetrics({
      width: measured.width,
      height: measured.height,
      devicePixelRatio: windowObject?.devicePixelRatio ?? 1,
      ...limits,
    })
    if (!next) return null
    metrics = next
    renderer.setPixelRatio?.(next.effectiveDevicePixelRatio)
    renderer.setSize(next.cssWidth, next.cssHeight, false)
    updateCamera?.(camera, next)
    onResize?.(next)
    return next
  }

  const handleVisibilityChange = () => {
    previousFrameAt = null
    if (documentHidden()) cancelScheduledFrame()
    else {
      resize()
      scheduleFrame()
    }
    onVisibilityChange?.(snapshot())
  }

  const handleContextLost = (event) => {
    event?.preventDefault?.()
    contextLost = true
    previousFrameAt = null
    cancelScheduledFrame()
    onContextLost?.(snapshot())
  }

  const handleContextRestored = () => {
    contextLost = false
    if (canRender()) resize()
    onContextRestored?.(snapshot())
    scheduleFrame()
  }

  const handleResize = () => {
    if (canRender()) resize()
  }

  const start = () => {
    if (disposed) throw new Error('Three render lifecycle is disposed.')
    if (started) return snapshot()
    started = true
    contextLost = rendererContextLost()
    documentObject?.addEventListener?.('visibilitychange', handleVisibilityChange)
    windowObject?.addEventListener?.('resize', handleResize)
    canvas?.addEventListener?.('webglcontextlost', handleContextLost)
    canvas?.addEventListener?.('webglcontextrestored', handleContextRestored)
    if (typeof ResizeObserverClass === 'function' && container) {
      observer = new ResizeObserverClass(handleResize)
      observer.observe(container)
    }
    if (!suspended && !documentHidden() && !contextLost) resize()
    scheduleFrame()
    return snapshot()
  }

  const stop = () => {
    if (!started) return snapshot()
    started = false
    previousFrameAt = null
    cancelScheduledFrame()
    observer?.disconnect?.()
    observer = null
    documentObject?.removeEventListener?.('visibilitychange', handleVisibilityChange)
    windowObject?.removeEventListener?.('resize', handleResize)
    canvas?.removeEventListener?.('webglcontextlost', handleContextLost)
    canvas?.removeEventListener?.('webglcontextrestored', handleContextRestored)
    return snapshot()
  }

  const suspend = () => {
    suspended = true
    previousFrameAt = null
    cancelScheduledFrame()
    return snapshot()
  }

  const resume = () => {
    if (disposed) throw new Error('Three render lifecycle is disposed.')
    suspended = false
    if (!documentHidden() && !contextLost) resize()
    scheduleFrame()
    return snapshot()
  }

  const dispose = ({ forceContextLoss = true } = {}) => {
    if (disposalResult) return disposalResult
    stop()
    disposed = true
    const sceneResources = disposeThreeObjectTree(scene)
    let additionalResources = 0
    const disposedAdditionalResources = new Set()
    for (const resource of additionalDisposables) {
      if (
        resource
        && typeof resource.dispose === 'function'
        && !disposedAdditionalResources.has(resource)
      ) {
        disposedAdditionalResources.add(resource)
        resource.dispose()
        additionalResources += 1
      }
    }
    const rendererResult = disposeThreeRenderer(renderer, { forceContextLoss })
    disposalResult = { sceneResources, additionalResources, renderer: rendererResult }
    return disposalResult
  }

  return {
    start,
    stop,
    resize,
    suspend,
    resume,
    snapshot,
    dispose,
  }
}
