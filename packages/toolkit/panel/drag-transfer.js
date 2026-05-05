// drag-transfer.js — cross-display transfer affordance for panel drags.

import { emit, wireBridge } from '../runtime/bridge.js'
import { subscribe } from '../runtime/subscribe.js'
import {
  findDisplayForPoint,
  nativeToDesktopWorldRect,
  normalizeDisplays,
} from '../runtime/spatial.js'

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function displayID(display) {
  return display?.id ?? display?.display_id ?? display?.cgID ?? null
}

function sameDisplay(a, b) {
  return String(a) === String(b)
}

function frameToRect(frame = []) {
  return {
    x: finiteNumber(frame[0], 0),
    y: finiteNumber(frame[1], 0),
    w: Math.max(1, finiteNumber(frame[2], 1)),
    h: Math.max(1, finiteNumber(frame[3], 1)),
  }
}

function rectToFrame(rect = {}) {
  return [
    Math.round(finiteNumber(rect.x, 0)),
    Math.round(finiteNumber(rect.y, 0)),
    Math.round(Math.max(1, finiteNumber(rect.w ?? rect.width, 1))),
    Math.round(Math.max(1, finiteNumber(rect.h ?? rect.height, 1))),
  ]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function visibleNativeBounds(display) {
  return display?.nativeVisibleBounds || display?.native_visible_bounds || display?.visibleBounds || display?.visible_bounds || display?.bounds || null
}

function clampFrameToDisplay(frame, display) {
  const source = frameToRect(frame)
  const bounds = visibleNativeBounds(display)
  if (!bounds) return rectToFrame(source)
  const width = Math.min(source.w, Math.max(1, finiteNumber(bounds.w ?? bounds.width, source.w)))
  const height = Math.min(source.h, Math.max(1, finiteNumber(bounds.h ?? bounds.height, source.h)))
  const minX = finiteNumber(bounds.x, 0)
  const minY = finiteNumber(bounds.y, 0)
  const maxX = minX + Math.max(0, finiteNumber(bounds.w ?? bounds.width, width) - width)
  const maxY = minY + Math.max(0, finiteNumber(bounds.h ?? bounds.height, height) - height)
  return [
    Math.round(clamp(source.x, minX, maxX)),
    Math.round(clamp(source.y, minY, maxY)),
    Math.round(width),
    Math.round(height),
  ]
}

function pointerPoint(pointer = {}) {
  return {
    x: finiteNumber(pointer.screenX ?? pointer.x, 0),
    y: finiteNumber(pointer.screenY ?? pointer.y, 0),
  }
}

export function computePanelTransfer(displays = [], {
  frame,
  pointer,
  offsetX = 0,
  offsetY = 0,
  originDisplayId = null,
  layerId = 'aos-panel-transfer-outline',
  label = 'Move here',
} = {}) {
  const normalizedDisplays = normalizeDisplays(displays)
  if (normalizedDisplays.length < 2) return null
  const point = pointerPoint(pointer)
  const targetDisplay = findDisplayForPoint(normalizedDisplays, point.x, point.y, {
    rectKey: 'nativeVisibleBounds',
    nearest: false,
  })
  if (!targetDisplay) return null
  const targetId = displayID(targetDisplay)
  if (originDisplayId != null && sameDisplay(targetId, originDisplayId)) return null

  const source = frameToRect(frame)
  const candidate = [
    point.x - finiteNumber(offsetX, 0),
    point.y - finiteNumber(offsetY, 0),
    source.w,
    source.h,
  ]
  const nativeFrame = clampFrameToDisplay(candidate, targetDisplay)
  const worldRect = nativeToDesktopWorldRect(frameToRect(nativeFrame), normalizedDisplays)
  if (!worldRect) return null
  const worldFrame = rectToFrame(worldRect)
  return {
    targetDisplayId: targetId,
    nativeFrame,
    frame: worldFrame,
    layer: {
      id: layerId,
      kind: 'outline',
      label,
      frame: worldFrame,
      zIndex: 10_000,
      style: {
        color: 'rgba(122, 241, 255, 0.9)',
        fill: 'rgba(122, 241, 255, 0.08)',
        strokeWidth: 2,
      },
    },
  }
}

export function sendDesktopWorldStageLayer(stageCanvasId, message, { send = emit } = {}) {
  if (!stageCanvasId || !message) return
  send('canvas.send', {
    target: stageCanvasId,
    message,
  })
}

export function createPanelTransferController({
  enabled = false,
  stageCanvasId = 'aos-desktop-world-stage',
  layerId = null,
  label = 'Move here',
  getDisplays = () => [],
  sendStageMessage = (message) => sendDesktopWorldStageLayer(stageCanvasId, message),
} = {}) {
  let displays = normalizeDisplays(getDisplays())
  let originDisplayId = null
  let active = null
  const outlineLayerId = layerId || `aos-panel-transfer-outline-${Math.random().toString(36).slice(2, 8)}`

  function updateDisplays(nextDisplays = []) {
    displays = normalizeDisplays(nextDisplays)
    return displays
  }

  function clear() {
    if (!active) return
    sendStageMessage({
      type: 'desktop_world_stage.layer.remove',
      payload: { id: outlineLayerId },
    })
    active = null
  }

  return {
    setDisplays: updateDisplays,
    start({ frame } = {}) {
      if (!enabled) return null
      const freshDisplays = normalizeDisplays(getDisplays())
      if (freshDisplays.length) displays = freshDisplays
      const rect = frameToRect(frame)
      const origin = findDisplayForPoint(
        displays,
        rect.x + Math.min(rect.w / 2, 80),
        rect.y + Math.min(rect.h / 2, 44),
        { rectKey: 'nativeVisibleBounds', nearest: true }
      )
      originDisplayId = displayID(origin)
      clear()
      return originDisplayId
    },
    move({ frame, pointer, offsetX, offsetY } = {}) {
      if (!enabled) return null
      const next = computePanelTransfer(displays, {
        frame,
        pointer,
        offsetX,
        offsetY,
        originDisplayId,
        layerId: outlineLayerId,
        label,
      })
      if (!next) {
        clear()
        return null
      }
      active = next
      sendStageMessage({
        type: 'desktop_world_stage.layer.upsert',
        payload: next.layer,
      })
      return next
    },
    end() {
      const result = active
      clear()
      originDisplayId = null
      return result
    },
    getState() {
      return {
        enabled,
        originDisplayId,
        active,
        displays: [...displays],
        stageCanvasId,
        layerId: outlineLayerId,
      }
    },
  }
}

export function wirePanelTransferDisplayGeometry(controller) {
  wireBridge((message) => {
    const payload = message?.payload || message?.data || message
    if (message?.type !== 'display_geometry' && payload?.type !== 'display_geometry') return
    if (payload?.displays) controller.setDisplays(payload.displays)
  })
  subscribe(['display_geometry'], { snapshot: true })
}
