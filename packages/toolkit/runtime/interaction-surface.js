function randomSurfaceId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeFrame(frame, fallback) {
  const source = Array.isArray(frame) && frame.length >= 4 ? frame : fallback
  if (!Array.isArray(source) || source.length < 4) return null
  const next = source.slice(0, 4).map((value) => Math.round(Number(value) || 0))
  if (next[2] <= 0 || next[3] <= 0) return null
  return next
}

function sameFrame(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length >= 4
    && b.length >= 4
    && a[0] === b[0]
    && a[1] === b[1]
    && a[2] === b[2]
    && a[3] === b[3]
}

function offscreenFrame(size) {
  const width = Math.max(1, Math.round(Number(size?.[0]) || 1))
  const height = Math.max(1, Math.round(Number(size?.[1]) || 1))
  return [-10000, -10000, width, height]
}

function callRuntime(runtime, method, payload) {
  const fn = runtime?.[method]
  if (typeof fn !== 'function') {
    throw new Error(`InteractionSurface runtime requires ${method}`)
  }
  return fn.call(runtime, payload)
}

export function createInteractionSurface(options = {}) {
  const {
    runtime,
    id = randomSurfaceId(options.idPrefix || 'aos-surface'),
    url,
    parent = null,
    frame = [-10000, -10000, 1, 1],
    interactive = false,
    windowLevel = 'screen_saver',
    cascade = true,
  } = options

  if (!runtime) throw new Error('InteractionSurface requires runtime')
  if (!url) throw new Error('InteractionSurface requires url')

  const initialFrame = normalizeFrame(frame, [-10000, -10000, 1, 1])
  const state = {
    id,
    url,
    parent,
    ready: false,
    creating: false,
    removed: false,
    frame: initialFrame,
    interactive: !!interactive,
    windowLevel,
  }

  async function ensureCreated() {
    if (state.ready || state.creating) return state.id
    state.creating = true
    state.removed = false
    try {
      const payload = {
        id: state.id,
        url: state.url,
        frame: state.frame,
        interactive: state.interactive,
        window_level: state.windowLevel,
        cascade,
      }
      if (state.parent) payload.parent = state.parent
      await callRuntime(runtime, 'canvasCreate', payload)
      state.ready = true
      return state.id
    } catch (error) {
      if (String(error?.message || error).includes('DUPLICATE')) {
        state.ready = true
        return state.id
      }
      throw error
    } finally {
      state.creating = false
    }
  }

  function update(next = {}) {
    if (!state.ready || state.removed) return false

    const nextFrame = normalizeFrame(next.frame, state.frame)
    const nextInteractive = next.interactive === undefined ? state.interactive : !!next.interactive
    const nextWindowLevel = next.windowLevel ?? next.window_level ?? state.windowLevel
    const payload = { id: state.id }

    if (nextFrame && !sameFrame(nextFrame, state.frame)) {
      payload.frame = nextFrame
      state.frame = nextFrame
    }
    if (nextInteractive !== state.interactive) {
      payload.interactive = nextInteractive
      state.interactive = nextInteractive
    }
    if (nextWindowLevel !== state.windowLevel) {
      payload.window_level = nextWindowLevel
      state.windowLevel = nextWindowLevel
    }

    if (Object.keys(payload).length === 1) return false
    callRuntime(runtime, 'canvasUpdate', payload)
    return true
  }

  function setFrame(nextFrame) {
    return update({ frame: nextFrame })
  }

  function setInteractive(nextInteractive) {
    return update({ interactive: nextInteractive })
  }

  function setPlacement(nextFrame, nextInteractive = state.interactive) {
    return update({ frame: nextFrame, interactive: nextInteractive })
  }

  function disable(size = [state.frame?.[2], state.frame?.[3]]) {
    return setPlacement(offscreenFrame(size), false)
  }

  async function remove() {
    if ((!state.ready && !state.creating) || state.removed) return
    try {
      await callRuntime(runtime, 'canvasRemove', { id: state.id })
    } finally {
      state.ready = false
      state.creating = false
      state.interactive = false
      state.removed = true
    }
  }

  function snapshot() {
    return {
      id: state.id,
      ready: state.ready,
      creating: state.creating,
      removed: state.removed,
      frame: state.frame ? [...state.frame] : null,
      interactive: state.interactive,
      windowLevel: state.windowLevel,
      parent: state.parent,
    }
  }

  return {
    id: state.id,
    ensureCreated,
    update,
    setFrame,
    setInteractive,
    setPlacement,
    disable,
    remove,
    snapshot,
  }
}
