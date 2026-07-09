import { createDesktopWorldHitRegionController } from './desktop-world-hit-region.js'

function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null
  const next = {
    x: finite(rect.x, NaN),
    y: finite(rect.y, NaN),
    w: finite(rect.w ?? rect.width, NaN),
    h: finite(rect.h ?? rect.height, NaN),
  }
  if (![next.x, next.y, next.w, next.h].every(Number.isFinite)) return null
  if (next.w <= 0 || next.h <= 0) return null
  return next
}

export function semanticChildSurfaceOffscreenFrame(size = [1, 1]) {
  return [
    -10000,
    -10000,
    Math.max(1, Math.round(finite(size?.[0], 1))),
    Math.max(1, Math.round(finite(size?.[1], 1))),
  ]
}

export function semanticChildWorldRectForCenter(center, size) {
  const targetSize = Math.max(1, Math.round(finite(size, 1)))
  if (!center?.valid) return null
  return {
    x: finite(center.x) - targetSize / 2,
    y: finite(center.y) - targetSize / 2,
    w: targetSize,
    h: targetSize,
  }
}

export function semanticChildNativeFrameRect(frame) {
  if (!Array.isArray(frame) || frame.length < 4) return null
  return normalizeRect({ x: frame[0], y: frame[1], w: frame[2], h: frame[3] })
}

export function semanticChildTargetsWorldRect(targets = [], { padding = 0 } = {}) {
  if (!Array.isArray(targets) || targets.length === 0) return null
  const pad = Math.max(0, finite(padding, 0))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const target of targets) {
    const center = target.center || target
    const x = finite(center.x, NaN)
    const y = finite(center.y, NaN)
    const radius = Math.max(1, finite(target.radius, finite(target.size, 1) / 2))
    if (![x, y, radius].every(Number.isFinite)) continue
    minX = Math.min(minX, x - radius)
    minY = Math.min(minY, y - radius)
    maxX = Math.max(maxX, x + radius)
    maxY = Math.max(maxY, y + radius)
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
  return {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    w: Math.ceil((maxX - minX) + pad * 2),
    h: Math.ceil((maxY - minY) + pad * 2),
  }
}

export function projectSemanticChildTargets(targets = [], worldRect = null) {
  if (!worldRect) return []
  return targets.map((target) => ({
    ...target,
    x: Math.round(finite(target.center?.x ?? target.x, 0) - worldRect.x),
    y: Math.round(finite(target.center?.y ?? target.y, 0) - worldRect.y),
    size: Math.round(finite(target.size, finite(target.radius, 1) * 2)),
    radius: Math.round(finite(target.radius, finite(target.size, 1) / 2)),
  }))
}

export function createSemanticChildTargetSurface(options = {}) {
  const {
    runtime,
    url,
    id = null,
    idPrefix = 'semantic-child-target',
    ownerCanvasId = null,
    fallbackOwnerCanvasId = null,
    globalObject = globalThis,
    initialSize = [1, 1],
    windowLevel = 'screen_saver',
    messageType = 'semantic_child_target.update',
    resolveTargets = () => [],
    resolveWorldRect = (targets) => semanticChildTargetsWorldRect(targets),
    projectTargets = projectSemanticChildTargets,
    buildPayload = ({ targets }) => ({ items: targets }),
    buildDisabledPayload = () => undefined,
    returnDisableChange = true,
  } = options

  const controller = createDesktopWorldHitRegionController({
    runtime,
    url,
    id,
    idPrefix,
    ownerCanvasId,
    fallbackOwnerCanvasId,
    globalObject,
    initialSize,
    windowLevel,
    messageType,
  })
  const state = {
    id: controller.id,
    parent: controller.parent,
    ready: false,
    creating: false,
    interactive: false,
    frame: semanticChildSurfaceOffscreenFrame(initialSize),
    targets: [],
    pendingInput: null,
    pendingDisplays: [],
  }

  function syncControllerState() {
    const snapshot = controller.snapshot()
    state.ready = snapshot.ready
    state.creating = snapshot.creating
    state.interactive = snapshot.interactive
    state.frame = snapshot.frame || semanticChildSurfaceOffscreenFrame(initialSize)
    state.parent = snapshot.parent
  }

  async function ensureCreated() {
    if (state.ready || state.creating) return state.id
    state.creating = true
    try {
      await controller.ensureCreated()
      syncControllerState()
      return state.id
    } finally {
      state.creating = false
      syncControllerState()
    }
  }

  function syncWorldRect(worldRect, {
    displays = [],
    interactive = true,
    payload = undefined,
  } = {}) {
    if (!state.ready) return false
    const changed = controller.sync({
      worldRect,
      displays,
      interactive: !!interactive,
      payload,
    })
    syncControllerState()
    return changed
  }

  function disable({ payload = undefined } = {}) {
    if (!state.ready) return false
    const changed = controller.disable({ payload })
    syncControllerState()
    return returnDisableChange ? changed : changed && state.interactive
  }

  function apply(input, options = {}) {
    if (!state.ready) return false
    const displays = Array.isArray(options.displays) ? options.displays : []
    const targets = resolveTargets(input, {
      ...options,
      surfaceId: state.id,
      parentCanvasId: state.parent,
    }) || []
    const worldRect = normalizeRect(resolveWorldRect(targets, input, options))
    if (!worldRect || targets.length === 0) {
      state.targets = []
      const payload = buildDisabledPayload(input, {
        ...options,
        surfaceId: state.id,
        parentCanvasId: state.parent,
      })
      return disable({ payload })
    }

    state.targets = projectTargets(targets, worldRect, input, options)
    const payload = buildPayload({
      input,
      targets: state.targets,
      worldRect,
      surfaceId: state.id,
      parentCanvasId: state.parent,
    })
    return syncWorldRect(worldRect, {
      displays,
      interactive: true,
      payload,
    })
  }

  function sync(input, options = {}) {
    state.pendingInput = input || null
    state.pendingDisplays = Array.isArray(options.displays) ? options.displays : []
    if (!state.ready) {
      void ensureCreated()
        .then(() => apply(state.pendingInput, { ...options, displays: state.pendingDisplays }))
        .catch((error) => {
          options.logger?.warn?.('[toolkit] semantic child target surface create failed:', error)
        })
      return false
    }
    return apply(state.pendingInput, { ...options, displays: state.pendingDisplays })
  }

  function refreshPayload() {
    return controller.refreshPayload?.() || false
  }

  async function remove() {
    if (!state.ready && !state.creating) return
    try {
      await controller.remove()
    } finally {
      state.ready = false
      state.creating = false
      state.interactive = false
      state.targets = []
      state.frame = semanticChildSurfaceOffscreenFrame(initialSize)
    }
  }

  function handleLifecycle(message = {}) {
    if (typeof controller.handleLifecycle !== 'function') return false
    if (!controller.handleLifecycle(message)) return false
    syncControllerState()
    if (!state.ready) state.targets = []
    return true
  }

  function snapshot() {
    return {
      id: state.id,
      parent: state.parent,
      ready: state.ready,
      creating: state.creating,
      interactive: state.interactive,
      frame: state.frame ? [...state.frame] : null,
      targets: state.targets.map((target) => ({ ...target })),
    }
  }

  return {
    id: state.id,
    parent: state.parent,
    ensureCreated,
    sync,
    syncWorldRect,
    disable,
    refreshPayload,
    remove,
    handleLifecycle,
    snapshot,
  }
}
