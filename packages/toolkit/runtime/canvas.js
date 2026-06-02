// canvas.js — JS-side ergonomics over the canvas mutation API.
//
// spawnChild/removeSelf/evalCanvas use request_id round-trips for ack; mutateSelf
// is fire-and-forget (matches daemon semantics from the mutation-api spec).

import { emit, wireBridge } from './bridge.js'

const pending = new Map()  // request_id → { resolve, reject, timer }
let routerInstalled = false

export const CANVAS_LIFECYCLE_STATES = Object.freeze({
  COLD: 'cold',
  WARMING: 'warming',
  WARM_SUSPENDED: 'warm_suspended',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REMOVED: 'removed',
})

function installResponseRouter() {
  if (routerInstalled) {
    wireBridge()
    return
  }
  routerInstalled = true
  wireBridge((msg) => {
    if (msg?.type !== 'canvas.response') return
    const rid = msg.request_id
    const entry = pending.get(rid)
    if (!entry) return
    pending.delete(rid)
    clearTimeout(entry.timer)
    if (msg.status === 'ok') entry.resolve(msg)
    else entry.reject(new Error(`${msg.code || 'ERROR'}: ${msg.message || 'unknown'}`))
  })
}

function nextRequestId() {
  return 'r-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36)
}

function rpc(type, payload, { timeoutMs = 5000, mapResult = (msg) => msg } = {}) {
  installResponseRouter()
  const request_id = nextRequestId()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(request_id)
      reject(new Error(`TIMEOUT: ${type} (${timeoutMs}ms)`))
    }, timeoutMs)
    pending.set(request_id, {
      timer,
      resolve(msg) {
        resolve(mapResult(msg))
      },
      reject,
    })
    emit(type, { ...payload, request_id })
  })
}

export function spawnChild(opts) {
  // opts: { id, url, at: [x,y,w,h], interactive?: bool }
  return rpc('canvas.create', opts, {
    mapResult(msg) {
      return { id: msg.id }
    },
  })
}

const WARM_READY_SCRIPT = `JSON.stringify({
  readyState: document.readyState,
  manifest: window.headsup && window.headsup.manifest || null,
  ready: document.readyState === 'interactive' || document.readyState === 'complete'
})`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseReadyResult(result) {
  if (typeof result !== 'string' || !result) return { ready: false, manifest: null, readyState: null }
  try {
    const parsed = JSON.parse(result)
    return {
      ready: Boolean(parsed?.ready),
      manifest: parsed?.manifest || null,
      readyState: parsed?.readyState || null,
    }
  } catch {
    return { ready: false, manifest: null, readyState: null }
  }
}

export async function waitForCanvasReady(id, {
  timeoutMs = 5000,
  intervalMs = 50,
  evalTimeoutMs = 500,
  requireManifest = false,
} = {}) {
  const deadline = Date.now() + timeoutMs
  let last = { ready: false, manifest: null, readyState: null }
  let lastError = null

  while (Date.now() <= deadline) {
    try {
      last = parseReadyResult(await evalCanvas(id, WARM_READY_SCRIPT, { timeoutMs: evalTimeoutMs }))
      if (last.ready && (!requireManifest || last.manifest)) {
        return { id, ...last }
      }
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }

  const detail = lastError ? `; last error: ${lastError.message || lastError}` : ''
  throw new Error(`TIMEOUT: canvas.ready ${id} (${timeoutMs}ms)${detail}`)
}

function normalizeCanvasInfoResponse(msg = {}) {
  const canvas = msg.canvas || null
  const ready = msg.ready || {}
  const manifest = ready.manifest || canvas?.ready_manifest || canvas?.manifest || null
  const lifecycleState = ready.lifecycle_state || canvas?.lifecycle_state || canvas?.lifecycleState || null
  const suspended = ready.suspended ?? canvas?.suspended ?? null
  return {
    id: canvas?.id || msg.id || null,
    exists: msg.exists !== false && Boolean(canvas || msg.exists),
    canvas,
    ready: Boolean(ready.ready || manifest),
    manifest,
    lifecycle_state: lifecycleState,
    suspended,
  }
}

export function canvasInfo(id, opts = {}) {
  const payload = {}
  if (id) payload.id = id
  return rpc('canvas.info', payload, {
    timeoutMs: opts.timeoutMs ?? 1000,
    mapResult: normalizeCanvasInfoResponse,
  })
}

export async function waitForCanvasStatusReady(id, {
  timeoutMs = 5000,
  intervalMs = 50,
  infoTimeoutMs = 500,
  requireManifest = false,
  manifestName = null,
  allowedLifecycleStates = [
    CANVAS_LIFECYCLE_STATES.ACTIVE,
    CANVAS_LIFECYCLE_STATES.WARM_SUSPENDED,
    CANVAS_LIFECYCLE_STATES.SUSPENDED,
  ],
} = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  let lastError = null

  while (Date.now() <= deadline) {
    try {
      last = await canvasInfo(id, { timeoutMs: infoTimeoutMs })
      const lifecycleOk = !allowedLifecycleStates
        || allowedLifecycleStates.length === 0
        || allowedLifecycleStates.includes(last.lifecycle_state)
      const manifestOk = !requireManifest
        || Boolean(last.manifest && (!manifestName || last.manifest.name === manifestName))
      if (last.exists && lifecycleOk && manifestOk) {
        return { id, ...last }
      }
    } catch (error) {
      lastError = error
    }
    await sleep(intervalMs)
  }

  const detail = lastError ? `; last error: ${lastError.message || lastError}` : ''
  const observed = last ? `; last status: ${JSON.stringify(last)}` : ''
  throw new Error(`TIMEOUT: canvas.info ${id} (${timeoutMs}ms)${observed}${detail}`)
}

export async function warmCanvas({
  id,
  url,
  frame,
  at,
  interactive = true,
  focus = false,
  parent,
  cascade = true,
  timeoutMs = 5000,
  intervalMs = 50,
  evalTimeoutMs = 500,
  requireManifest = false,
  cleanupOnFailure = true,
  ...rest
} = {}) {
  if (!id) throw new Error('warmCanvas requires id')
  if (!url) throw new Error('warmCanvas requires url')
  const resolvedFrame = frame || at
  if (!Array.isArray(resolvedFrame) || resolvedFrame.length !== 4) {
    throw new Error('warmCanvas requires frame [x,y,w,h]')
  }

  try {
    await spawnChild({
      ...rest,
      id,
      url,
      frame: resolvedFrame,
      interactive,
      focus,
      parent,
      cascade,
      suspended: true,
    })
    const ready = await waitForCanvasReady(id, {
      timeoutMs,
      intervalMs,
      evalTimeoutMs,
      requireManifest,
    })
    return {
      id,
      lifecycle_state: CANVAS_LIFECYCLE_STATES.WARM_SUSPENDED,
      suspended: true,
      ready,
    }
  } catch (error) {
    if (cleanupOnFailure) {
      try { await removeCanvas(id, { orphan_children: true }) } catch {}
    }
    throw error
  }
}

export function mutateSelf(opts) {
  // opts: { frame?: [x,y,w,h], interactive?: bool, geometry?: object }
  // fire-and-forget; daemon defaults id to caller (this canvas) when omitted
  emit('canvas.update', opts)
}

export function removeSelf(opts = {}) {
  // opts: { orphan_children?: bool }
  return rpc('canvas.remove', opts, {
    mapResult() {
      return undefined
    },
  })
}

export function removeCanvas(id, opts = {}) {
  const payload = { ...opts }
  if (id) payload.id = id
  return rpc('canvas.remove', payload, {
    mapResult() {
      return undefined
    },
  })
}

export function suspendCanvas(id) {
  const payload = {}
  if (id) payload.id = id
  return rpc('canvas.suspend', payload, {
    mapResult() {
      return undefined
    },
  })
}

export function resumeCanvas(id) {
  const payload = {}
  if (id) payload.id = id
  return rpc('canvas.resume', payload, {
    mapResult() {
      return undefined
    },
  })
}

export function setInteractive(interactive) {
  mutateSelf({ interactive: !!interactive })
}

export function evalCanvas(id, js, opts = {}) {
  const payload = { js }
  if (id) payload.id = id
  return rpc('canvas.eval', payload, {
    timeoutMs: opts.timeoutMs ?? 5000,
    mapResult(msg) {
      return msg.result
    },
  })
}

export function aosAction(action, payload = {}, opts = {}) {
  if (typeof action !== 'string' || !action.trim()) {
    throw new Error('INVALID_ACTION: aosAction requires action')
  }
  return rpc('aos.action', {
    ...payload,
    action: action.trim(),
  }, {
    timeoutMs: opts.timeoutMs ?? 5000,
    mapResult: opts.mapResult || ((msg) => msg),
  })
}

export async function writeClipboardText(text, opts = {}) {
  if (typeof text !== 'string') {
    throw new Error('INVALID_PAYLOAD: writeClipboardText requires plain text')
  }
  try {
    await rpc('clipboard.write', { text }, {
      timeoutMs: opts.timeoutMs ?? 1000,
      mapResult() {
        return true
      },
    })
    return true
  } catch (error) {
    if (opts.browserFallback === false) throw error
    const writeText = globalThis.navigator?.clipboard?.writeText
    if (typeof writeText !== 'function') throw error
    await writeText.call(globalThis.navigator.clipboard, text)
    return true
  }
}

export function move(dx, dy) {
  // Daemon's legacy relative-move action — auto-targets the calling canvas
  // and accepts integer/float deltas at the TOP level of the message (NOT
  // wrapped in payload — see canvas.swift handler at line ~516). Distinct
  // from mutateSelf({frame}) which requires absolute coordinates.
  window.webkit?.messageHandlers?.headsup?.postMessage({ type: 'move', dx, dy })
}

export function moveAbsolute(screenX, screenY, offsetX, offsetY, geometry = null) {
  // Absolute drag path — the daemon derives the true global mouse position
  // from AppKit and uses the provided in-canvas offset to position the window.
  const payload = {
    type: 'move_abs',
    screenX,
    screenY,
    offsetX,
    offsetY,
  }
  if (geometry && typeof geometry === 'object') {
    if (geometry.change) payload.geometry_change = geometry.change
    if (geometry.cause) payload.geometry_cause = geometry.cause
    if (geometry.phase) payload.geometry_phase = geometry.phase
    if (geometry.transaction_id) payload.geometry_transaction_id = geometry.transaction_id
  }
  window.webkit?.messageHandlers?.headsup?.postMessage(payload)
}
