import * as THREE from '../../vendor/three/three.module.min.js'
import {
  applySceneTransaction,
  canonicalizeSceneDocument,
  createSceneAnimationController,
  createSceneSignalController,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
  deriveOrthoCamera,
} from '../../scene/index.js'

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
    const width = Math.max(1, Math.min(4096, Math.floor(canvas.clientWidth || hostWindow.innerWidth || 1)))
    const height = Math.max(1, Math.min(4096, Math.floor(canvas.clientHeight || hostWindow.innerHeight || 1)))
    const dpr = Math.min(2, Math.max(1, hostWindow.devicePixelRatio || 1))
    renderer.setPixelRatio(dpr)
    renderer.setSize(width, height, false)
    renderer.clear(true, true, true)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const release = (key) => {
    const mounted = resources.get(key)
    if (!mounted) return false
    scene.remove(mounted.projection.object)
    mounted.animations.dispose()
    mounted.signals.dispose()
    mounted.projection.dispose()
    resources.delete(key)
    return true
  }

  const activate = (key, documentInput) => {
    const document = canonicalizeSceneDocument(documentInput)
    const validation = registry.validateDocument(document)
    if (!validation.ok) throw new TypeError('Scene document requires an unavailable or invalid implementation.')
    const previous = resources.get(key)
    const projection = createGenericThreeSceneProjection({ THREE, document })
    let animations
    let signals
    try {
      animations = createSceneAnimationController(document, {
        apply: (binding, value, elapsedMs, progress) => projection.applyAnimation(binding, value, elapsedMs, progress),
      })
      signals = createSceneSignalController(document, {
        apply: (binding, value, input, at) => projection.applySignal(binding, value, input, at),
      })
    } catch (error) {
      projection.dispose()
      throw error
    }
    projection.object.position.copy(previous?.projection.object.position ?? new THREE.Vector3())
    scene.add(projection.object)
    if (previous) {
      scene.remove(previous.projection.object)
      previous.projection.dispose()
    }
    resources.set(key, {
      document,
      projection,
      signals,
      animations,
      suspended: false,
      signalWindowAt: 0,
      signalWindowCount: 0,
    })
    return document.revision
  }

  const apply = (message) => {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    if (message?.type === 'desktop_world_stage.scene.release') return release(key)
    if (message?.type !== 'desktop_world_stage.scene.operation' || typeof key !== 'string') return false
    const operation = payload.operation ?? {}
    if (operation.op === 'mount') {
      if (!resources.has(key) && resources.size >= MAX_RESOURCES) throw new RangeError('DesktopWorld scene resource budget exceeded.')
      activate(key, operation.document)
    } else if (operation.op === 'transact') {
      const mounted = resources.get(key)
      if (!mounted) throw new TypeError('Scene resource is not mounted.')
      const result = applySceneTransaction(mounted.document, operation.transaction, { lease: operation.lease })
      if (!result.ok) throw new TypeError(result.code)
      activate(key, result.document)
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
      if (mounted) mounted.playStartedAt = performance.now()
    } else if (operation.op === 'suspend' || operation.op === 'resume') {
      const mounted = resources.get(key)
      if (mounted) {
        mounted.suspended = operation.op === 'suspend'
        mounted.projection[operation.op]()
      }
    } else if (operation.op === 'remove' || operation.op === 'close') {
      release(key)
    } else if (operation.op !== 'inspect') return false
    return true
  }

  const render = (at) => {
    if (disposed) return
    if (!hidden && !contextLost) {
      for (const mounted of resources.values()) {
        if (mounted.suspended) continue
        const elapsed = at - (mounted.playStartedAt ?? at)
        mounted.animations.tick(elapsed)
      }
      renderer.render(scene, camera)
    }
    frame = hostWindow.requestAnimationFrame(render)
  }

  const onVisibility = () => { hidden = document.hidden }
  const onContextLost = (event) => { event.preventDefault(); contextLost = true }
  const onContextRestored = () => { contextLost = false; resize() }
  hostWindow.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  resize()
  frame = hostWindow.requestAnimationFrame(render)

  return Object.freeze({
    apply,
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
      renderer.dispose()
      renderer.forceContextLoss()
      return true
    },
  })
}
