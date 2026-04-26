// desktop-world-surface-three.js — Three.js helpers for DesktopWorldSurface.

import { DesktopWorldSurfaceAdapter } from './desktop-world-surface.js'

function currentDisplayId() {
  return globalThis.window?.__aosSegmentDisplayId ?? null
}

function sameDisplayId(a, b) {
  return String(a) === String(b)
}

function boundsArray(segmentOrBounds) {
  if (Array.isArray(segmentOrBounds)) return segmentOrBounds
  return segmentOrBounds?.dw_bounds || segmentOrBounds?.dwBounds || [0, 0, 0, 0]
}

export function deriveOrthoCamera(segmentOrBounds, options = {}) {
  const bounds = boundsArray(segmentOrBounds)
  const x = Number(bounds[0]) || 0
  const y = Number(bounds[1]) || 0
  const w = Number(bounds[2]) || 0
  const h = Number(bounds[3]) || 0
  return {
    left: x,
    right: x + w,
    top: y,
    bottom: y + h,
    near: options.near ?? -1000,
    far: options.far ?? 1000,
    x,
    y,
    width: w,
    height: h,
  }
}

export class DesktopWorldSurfaceThree extends DesktopWorldSurfaceAdapter {
  constructor(options = {}) {
    super(options)
    this.channelName = options.channelName || `aos-dws-three:${this.canvasId || 'surface'}`
    this.channel = null
    this.camera = null
    this.renderer = null
    this.scene = null
    this._threeHandlers = {}
    this._stateLatencies = []
    this._lastStateReceivedAt = 0
    this._resizeHandler = () => this.refreshViewport()
  }

  async start(appHandlers = {}) {
    this._threeHandlers = appHandlers
    return super.start({
      ...appHandlers,
      onInit: (context) => {
        this._ensureStateChannel()
        appHandlers.onInit?.(context)
      },
      onTopologyChange: (context) => {
        appHandlers.onTopologyChange?.(context)
        this.refreshCamera()
      },
      becamePrimary: (context) => {
        appHandlers.becamePrimary?.(context)
      },
      lostPrimary: (context) => {
        appHandlers.lostPrimary?.(context)
      },
    })
  }

  stop() {
    globalThis.window?.removeEventListener?.('resize', this._resizeHandler)
    this.channel?.close?.()
    this.channel = null
    super.stop()
  }

  _identifyOwnSegment(topology) {
    const displayId = currentDisplayId()
    return topology.find((segment) => sameDisplayId(segment.display_id, displayId)) || topology[0] || null
  }

  _ensureStateChannel() {
    if (this.channel || typeof BroadcastChannel === 'undefined') return
    this.channel = new BroadcastChannel(this.channelName)
    this.channel.addEventListener('message', (event) => this._handleChannelMessage(event.data))
  }

  _handleChannelMessage(message) {
    if (!message || message.type !== 'state' || this.isPrimary) return
    const state = message.state
    const sentAt = Number(message.sent_at_epoch_ms ?? state?.sent_at_epoch_ms)
    if (Number.isFinite(sentAt)) {
      this._lastStateReceivedAt = Date.now()
      this._stateLatencies.push(Math.max(0, Date.now() - sentAt))
      if (this._stateLatencies.length > 240) {
        this._stateLatencies = this._stateLatencies.slice(-240)
      }
    }
    this._threeHandlers.onState?.(state, { surface: this })
  }

  publishState(state) {
    if (!this.isPrimary || !this.channel) return false
    this.channel.postMessage({
      type: 'state',
      state,
      sent_at_epoch_ms: Date.now(),
    })
    return true
  }

  stateLatencySnapshot() {
    const sorted = [...this._stateLatencies].sort((a, b) => a - b)
    const pick = (p) => {
      if (!sorted.length) return null
      const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
      return sorted[idx]
    }
    return {
      samples: sorted.length,
      median_ms: pick(0.5),
      p95_ms: pick(0.95),
      last_receive_age_ms: this._lastStateReceivedAt ? Date.now() - this._lastStateReceivedAt : null,
    }
  }

  mountScene({ scene = null, camera = null, renderer = null } = {}) {
    this.scene = scene
    this.camera = camera
    this.renderer = renderer
    this.refreshCamera()
    this.refreshViewport()
    globalThis.window?.addEventListener?.('resize', this._resizeHandler)
  }

  refreshCamera(camera = this.camera, segment = this.segment) {
    if (!camera || !segment) return null
    if (camera.isPerspectiveCamera) {
      camera.aspect = typeof window === 'undefined' || !window.innerHeight
        ? camera.aspect
        : window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix?.()
      return {
        type: 'perspective',
        aspect: camera.aspect,
        width: typeof window === 'undefined' ? null : window.innerWidth,
        height: typeof window === 'undefined' ? null : window.innerHeight,
      }
    }
    const frustum = deriveOrthoCamera(segment)
    for (const key of ['left', 'right', 'top', 'bottom', 'near', 'far']) {
      camera[key] = frustum[key]
    }
    camera.updateProjectionMatrix?.()
    return frustum
  }

  refreshViewport() {
    if (!this.renderer || typeof window === 'undefined') return
    this.renderer.setSize?.(window.innerWidth, window.innerHeight, false)
  }
}

export const DesktopWorldSurface3D = DesktopWorldSurfaceThree
