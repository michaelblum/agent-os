const COLLISION_RE = /ID_COLLISION|DUPLICATE|already exists/i

function normalizeFrame(frame, fallback = null) {
  const source = Array.isArray(frame) && frame.length >= 4 ? frame : fallback
  if (!Array.isArray(source) || source.length < 4) return null
  const next = source.slice(0, 4).map((value) => Number(value))
  if (!next.every(Number.isFinite) || next[2] <= 0 || next[3] <= 0) return null
  return next
}

function cloneState(state = {}) {
  return {
    ...state,
    at: normalizeFrame(state.at, null),
  }
}

function canvasIdFromLifecycle(message = {}) {
  return String(message.canvas_id || message.id || message.canvas?.id || '').trim()
}

function canvasStateFromLifecycle(message = {}) {
  const id = canvasIdFromLifecycle(message)
  if (!id) return null
  return {
    ...(message.canvas && typeof message.canvas === 'object' ? message.canvas : {}),
    id,
    suspended: message.suspended ?? message.canvas?.suspended ?? false,
    at: normalizeFrame(message.at ?? message.canvas?.at, null),
  }
}

function isCollision(error) {
  return COLLISION_RE.test(String(error?.message || error))
}

export function createUtilitySurfaceManager({
  host,
  resolveConfig,
  states = new Map(),
  openPromises = new Map(),
  managedIds = null,
  onChange = () => {},
  onSuspend = () => {},
  onResume = () => {},
  onCreate = () => {},
  onRemove = () => {},
  logger = console,
} = {}) {
  if (!host) throw new Error('createUtilitySurfaceManager requires host')
  if (typeof resolveConfig !== 'function') {
    throw new Error('createUtilitySurfaceManager requires resolveConfig')
  }

  const idSet = managedIds instanceof Set ? managedIds : new Set(Array.isArray(managedIds) ? managedIds : [])

  function configFor(kindOrConfig) {
    const config = typeof kindOrConfig === 'string' ? resolveConfig(kindOrConfig) : kindOrConfig
    if (!config?.id) throw new Error('utility surface config requires id')
    if (!config?.frame) throw new Error(`utility surface config requires frame: ${config.id}`)
    return config
  }

  function remember(configOrId, state) {
    const id = typeof configOrId === 'string' ? configOrId : configOrId.id
    const next = cloneState({ ...(states.get(id) || {}), ...state, id })
    states.set(id, next)
    return next
  }

  function forget(id) {
    return states.delete(id)
  }

  function isManagedId(id) {
    if (!id) return false
    return idSet.size === 0 || idSet.has(id)
  }

  function current(id) {
    return states.get(id) || null
  }

  function frameFor(config, currentState = null) {
    return normalizeFrame(currentState?.at, null) || normalizeFrame(config.frame, null)
  }

  function createPayload(config, {
    frame = config.frame,
    focus = true,
    suspended = false,
  } = {}) {
    const payload = {
      id: config.id,
      url: config.url,
      frame,
      interactive: config.interactive ?? true,
      focus,
    }
    if (suspended) payload.suspended = true
    if (config.window_level || config.windowLevel) payload.window_level = config.window_level || config.windowLevel
    if (config.parent) payload.parent = config.parent
    if (config.cascade !== undefined) payload.cascade = config.cascade
    return payload
  }

  async function resume(config, currentState, { focus = true, recovered = false } = {}) {
    const frame = frameFor(config, currentState)
    host.canvasUpdate({ id: config.id, frame })
    if (currentState?.suspended === true || recovered) await host.canvasResume(config.id)
    const next = remember(config, { ...(currentState || {}), suspended: false, at: frame })
    onResume({ config, state: next, frame, recovered, focus })
    return { id: config.id, frame, created: false, recovered }
  }

  async function create(config, { focus = true, suspended = false } = {}) {
    const frame = normalizeFrame(config.frame, null)
    await host.canvasCreate(createPayload(config, { frame, focus, suspended }))
    const next = remember(config, { suspended, at: frame })
    onCreate({ config, state: next, frame, suspended, focus })
    return { id: config.id, frame, created: true }
  }

  async function recoverExisting(config, { focus = true } = {}) {
    const frame = normalizeFrame(config.frame, null)
    host.canvasUpdate({ id: config.id, frame })
    await host.canvasResume(config.id)
    const next = remember(config, { suspended: false, at: frame })
    onResume({ config, state: next, frame, recovered: true, focus })
    return { id: config.id, frame, created: false, recovered: true }
  }

  async function toggle(kindOrConfig) {
    const config = configFor(kindOrConfig)
    const currentState = current(config.id)
    try {
      if (currentState && currentState.suspended !== true) {
        await host.canvasSuspend(config.id)
        const next = remember(config, { ...currentState, suspended: true })
        onSuspend({ config, state: next })
        return { id: config.id, suspended: true }
      }
      if (currentState) {
        return await resume(config, currentState, { focus: true })
      }
      return await create(config, { focus: true, suspended: false })
    } catch (error) {
      if (!currentState) {
        try {
          const result = await recoverExisting(config, { focus: true })
          return result
        } catch (_) {
          // Keep the original error below.
        }
      }
      logger?.warn?.('[toolkit] utility surface toggle failed:', config.id, error)
      throw error
    } finally {
      onChange({ id: config.id, config, state: current(config.id) })
    }
  }

  function ensureVisible(kindOrConfig, { focus = true } = {}) {
    const config = configFor(kindOrConfig)
    const existingPromise = openPromises.get(config.id)
    if (existingPromise) return existingPromise

    const promise = (async () => {
      const currentState = current(config.id)
      try {
        if (currentState) return await resume(config, currentState, { focus })
        return await create(config, { focus, suspended: false })
      } catch (error) {
        if (!currentState && isCollision(error)) {
          return recoverExisting(config, { focus })
        }
        throw error
      }
    })().finally(() => {
      if (openPromises.get(config.id) === promise) openPromises.delete(config.id)
      onChange({ id: config.id, config, state: current(config.id) })
    })

    openPromises.set(config.id, promise)
    return promise
  }

  async function prewarm(kindOrConfig, { focus = false } = {}) {
    const config = configFor(kindOrConfig)
    if (current(config.id)) return { id: config.id, frame: current(config.id).at, created: false }
    try {
      return await create(config, { focus, suspended: true })
    } catch (error) {
      if (!isCollision(error)) throw error
      return { id: config.id, frame: normalizeFrame(config.frame, null), created: false, recovered: true }
    } finally {
      onChange({ id: config.id, config, state: current(config.id) })
    }
  }

  function handleLifecycle(message = {}) {
    const id = canvasIdFromLifecycle(message)
    if (!isManagedId(id)) return { handled: false, id }
    if (message.action === 'removed') {
      forget(id)
      onRemove({ id, message })
    } else {
      const next = canvasStateFromLifecycle(message)
      if (next) states.set(id, next)
    }
    onChange({ id, message, state: current(id) })
    return { handled: true, id, state: current(id) }
  }

  function isVisible(id) {
    const state = current(id)
    return !!state && state.suspended !== true
  }

  function snapshot() {
    return Object.fromEntries([...states.entries()].map(([id, state]) => [id, cloneState(state)]))
  }

  return {
    states,
    openPromises,
    current,
    isVisible,
    toggle,
    ensureVisible,
    prewarm,
    handleLifecycle,
    snapshot,
  }
}
