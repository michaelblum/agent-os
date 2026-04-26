// desktop-world-surface-2d.js — DOM/Canvas2D adapter for DesktopWorldSurface.

import { DesktopWorldSurfaceAdapter } from './desktop-world-surface.js'

function currentDisplayId() {
  return globalThis.window?.__aosSegmentDisplayId ?? null
}

function sameDisplayId(a, b) {
  return String(a) === String(b)
}

export class DesktopWorldSurface2D extends DesktopWorldSurfaceAdapter {
  _identifyOwnSegment(topology) {
    const displayId = currentDisplayId()
    return topology.find((segment) => sameDisplayId(segment.display_id, displayId)) || topology[0] || null
  }

  worldOrigin() {
    const bounds = this.segment?.dw_bounds
    if (!Array.isArray(bounds) || bounds.length < 2) return { x: 0, y: 0 }
    return { x: -bounds[0], y: -bounds[1] }
  }

  applyWorldTransform(rootNode) {
    if (!rootNode?.style) return
    const { x, y } = this.worldOrigin()
    rootNode.style.transform = `translate(${x}px, ${y}px)`
    rootNode.style.transformOrigin = '0 0'
  }
}

