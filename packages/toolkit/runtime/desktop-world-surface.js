// desktop-world-surface.js — base runtime for segmented DesktopWorld surfaces.
//
// One adapter instance runs inside each physical segment web view. The daemon
// owns the logical surface and segment topology; adapters use the topology to
// elect a primary segment and gate once-per-surface app side effects.

import { wireBridge } from './bridge.js'
import { subscribe, unsubscribe } from './subscribe.js'
import { nativeToDesktopWorldPoint } from './spatial.js'

function defaultCanvasId() {
  return globalThis.window?.__aosSurfaceCanvasId || null
}

function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object') return null
  return {
    ...segment,
    display_id: segment.display_id ?? segment.displayID ?? segment.displayId,
    index: Number(segment.index ?? 0),
    dw_bounds: segment.dw_bounds ?? segment.dwBounds ?? segment.desktop_world_bounds,
    native_bounds: segment.native_bounds ?? segment.nativeBounds,
  }
}

function normalizeTopology(segments) {
  if (!Array.isArray(segments)) return []
  return segments
    .map(normalizeSegment)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index
      return Number(a.display_id ?? 0) - Number(b.display_id ?? 0)
    })
}

function lifecyclePayload(message) {
  if (!message || typeof message !== 'object') return null

  if (message.event === 'canvas_topology_settled') {
    return message.data && typeof message.data === 'object'
      ? { event: message.event, ...message.data }
      : message
  }

  if (message.type === 'canvas_lifecycle') {
    const payload = message.payload || message.data || message
    return payload && typeof payload === 'object' ? payload : null
  }

  return null
}

function displayFromSegment(segment) {
  const native = segment?.native_bounds
  const dw = segment?.dw_bounds
  if (!Array.isArray(native) || native.length < 4) return null
  return {
    id: segment.display_id,
    display_id: segment.display_id,
    native_bounds: { x: native[0], y: native[1], w: native[2], h: native[3] },
    bounds: Array.isArray(dw) && dw.length >= 4
      ? { x: dw[0], y: dw[1], w: dw[2], h: dw[3] }
      : { x: native[0], y: native[1], w: native[2], h: native[3] },
  }
}

export class DesktopWorldSurfaceAdapter {
  constructor({ host = null, canvasId = defaultCanvasId() } = {}) {
    this.host = host
    this.canvasId = canvasId
    this.segment = null
    this.topology = []
    this._appHandlers = {}
    this._started = false
    this._firstSettled = null
    this._stopHostListener = null
  }

  async start(appHandlers = {}) {
    this._appHandlers = appHandlers
    const firstSettled = new Promise((resolve) => {
      this._firstSettled = resolve
    })
    if (!this._started) {
      this._started = true
      this._wireMessages()
      this._subscribeLifecycle()
    }
    return firstSettled
  }

  stop() {
    this._stopHostListener?.()
    this._stopHostListener = null
    if (!this.host?.subscribe) unsubscribe(['canvas_lifecycle'])
    this._started = false
    this._firstSettled = null
  }

  handleMessage(message) {
    const payload = lifecyclePayload(message)
    if (!payload || payload.event !== 'canvas_topology_settled') return false
    if (this.canvasId && payload.canvas_id !== this.canvasId) return false
    this._applyTopology(payload.segments || [])
    return true
  }

  _wireMessages() {
    if (this.host?.onMessage) {
      const result = this.host.onMessage((message) => this.handleMessage(message))
      if (typeof result === 'function') this._stopHostListener = result
      return
    }
    if (this.host?.subscribe) return
    wireBridge((message) => this.handleMessage(message))
  }

  _subscribeLifecycle() {
    if (this.host?.subscribe) {
      const result = this.host.subscribe(['canvas_lifecycle'], { snapshot: true })
      if (result?.on) {
        const maybeStop = result.on((message) => this.handleMessage(message))
        if (typeof maybeStop === 'function') this._stopHostListener = maybeStop
      }
      return
    }
    subscribe(['canvas_lifecycle'], { snapshot: true })
  }

  _applyTopology(segments) {
    const priorPrimary = this.isPrimary
    const priorSegment = this.segment
    const firstSettled = this._firstSettled
    this._firstSettled = null

    this.topology = normalizeTopology(segments)
    this.segment = this._identifyOwnSegment(this.topology)

    const isNowPrimary = this.isPrimary
    if (firstSettled) {
      this._appHandlers.onInit?.({
        segment: this.segment,
        topology: this.topology,
        surface: this,
      })
      firstSettled(this)
      return
    }

    this._appHandlers.onTopologyChange?.({
      segment: this.segment,
      previousSegment: priorSegment,
      topology: this.topology,
      surface: this,
    })
    if (!priorPrimary && isNowPrimary) this._appHandlers.becamePrimary?.({ surface: this })
    if (priorPrimary && !isNowPrimary) this._appHandlers.lostPrimary?.({ surface: this })
  }

  _identifyOwnSegment(_topology) {
    throw new Error('DesktopWorldSurfaceAdapter subclasses must implement _identifyOwnSegment')
  }

  get isPrimary() {
    return this.segment?.index === 0
  }

  runOnPrimary(fn) {
    if (!this.isPrimary) return undefined
    return fn()
  }

  feedInput(nativeEvent) {
    const x = Number(nativeEvent?.x)
    const y = Number(nativeEvent?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    const displays = this.topology.map(displayFromSegment).filter(Boolean)
    const dw = nativeToDesktopWorldPoint({ x, y }, displays)
    const event = {
      ...nativeEvent,
      dwX: dw?.x,
      dwY: dw?.y,
      desktopWorld: dw || null,
    }
    this._appHandlers.onInput?.(event)
    return event
  }
}
