#!/usr/bin/env node
import process from 'node:process'

import {
  clampPointToDisplays,
  computeVisibleDesktopWorldBounds,
  desktopWorldToNativePoint,
  nativeToDesktopWorldRect,
  normalizeDisplays,
} from '../../packages/toolkit/runtime/spatial.js'
import {
  pointAtAngle,
  resolveRadialGestureConfig,
} from '../../packages/toolkit/runtime/radial-gesture.js'

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function coerceRect(rect) {
  if (Array.isArray(rect) && rect.length >= 4) {
    return {
      x: finite(rect[0]),
      y: finite(rect[1]),
      w: finite(rect[2]),
      h: finite(rect[3]),
    }
  }
  return {
    x: finite(rect?.x),
    y: finite(rect?.y),
    w: finite(rect?.w ?? rect?.width),
    h: finite(rect?.h ?? rect?.height),
  }
}

function rectEdges(rect) {
  const normalized = coerceRect(rect)
  return {
    left: normalized.x,
    top: normalized.y,
    right: normalized.x + normalized.w,
    bottom: normalized.y + normalized.h,
  }
}

function displayLabel(display) {
  if (display.is_main) return 'main'
  return `extended:${display.id ?? display.display_id ?? 'unknown'}`
}

export function normalizeDisplayTopology(displays = []) {
  return normalizeDisplays(displays).map((display) => ({
    ...display,
    label: displayLabel(display),
  }))
}

export function desktopWorldPointToNative(point, displays = []) {
  const native = desktopWorldToNativePoint(point, normalizeDisplayTopology(displays))
  if (!native) {
    throw new Error(`cannot convert DesktopWorld point to native: ${JSON.stringify(point)}`)
  }
  return native
}

export function rectIntersectsVisibleDisplay(rect, displays = []) {
  const normalizedRect = coerceRect(rect)
  if (normalizedRect.w <= 1 || normalizedRect.h <= 1) return false
  const frame = rectEdges(normalizedRect)
  return normalizeDisplayTopology(displays).some((display) => {
    const visible = rectEdges(display.visibleBounds || display.bounds)
    return frame.left < visible.right
      && frame.right > visible.left
      && frame.top < visible.bottom
      && frame.bottom > visible.top
  })
}

export function nativeRectIntersectsVisibleDisplay(rect, displays = []) {
  const normalized = normalizeDisplayTopology(displays)
  const worldRect = nativeToDesktopWorldRect(coerceRect(rect), normalized)
  return rectIntersectsVisibleDisplay(worldRect, normalized)
}

export function oppositeVisibleDisplayPoint(point, displays = [], { pad = 96 } = {}) {
  const normalized = normalizeDisplayTopology(displays)
  const source = normalized.find((display) => {
    const rect = display.visibleBounds || display.bounds
    return point.x >= rect.x
      && point.x < rect.x + rect.w
      && point.y >= rect.y
      && point.y < rect.y + rect.h
  }) || normalized[0]
  if (!source) return { x: finite(point.x), y: finite(point.y) }
  const rect = source.visibleBounds || source.bounds
  const centerX = rect.x + rect.w / 2
  return clampPointToDisplays(normalized, point.x < centerX ? rect.x + rect.w - pad : rect.x + pad, point.y)
}

export function desktopWorldFigureEightPath(displays = [], { radialMenuRadius = 260, minSpan = 240 } = {}) {
  const normalized = normalizeDisplayTopology(displays)
  if (normalized.length === 0) {
    return { skipped: true, reason: 'need at least 1 display; found 0', displays: normalized }
  }
  const bounds = computeVisibleDesktopWorldBounds(normalized)
  const pad = Math.max(0, finite(radialMenuRadius, 260))
  const inset = {
    x: bounds.x + pad,
    y: bounds.y + pad,
    w: bounds.w - (pad * 2),
    h: bounds.h - (pad * 2),
  }
  if (inset.w < minSpan || inset.h < minSpan) {
    return {
      skipped: true,
      reason: `visible DesktopWorld bounds too small for ${pad}px radial menu padding and ${minSpan}px path span`,
      bounds,
      insetBounds: inset,
      displays: normalized,
    }
  }

  const left = inset.x
  const right = inset.x + inset.w
  const top = inset.y
  const bottom = inset.y + inset.h
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  const rawPoints = [
    { id: 'north-west', x: left, y: top },
    { id: 'south-east', x: right, y: bottom },
    { id: 'north-east', x: right, y: top },
    { id: 'south-west', x: left, y: bottom },
    { id: 'north-west-return', x: left, y: top },
  ]
  const points = rawPoints.map((point) => ({
    ...point,
    ...clampPointToDisplays(normalized, point.x, point.y),
  }))

  return {
    skipped: false,
    bounds,
    insetBounds: inset,
    center,
    radialMenuRadius: pad,
    points,
    steps: points.slice(1),
    displays: normalized,
  }
}

const RADIAL_DRAG_EPSILON_PX = 3

export function resolveRadialDragPoint(origin = {}, config = {}, {
  phase = 'fastTravel',
  angle = 0,
  epsilon = RADIAL_DRAG_EPSILON_PX,
  source = 'radialGestureMenu',
} = {}) {
  const resolved = resolveRadialGestureConfig(config || {})
  const thresholdField = phase === 'radial' ? 'deadZoneRadiusPx' : 'handoffRadiusPx'
  const configField = phase === 'radial' ? 'deadZoneRadius' : 'handoffRadius'
  const thresholdPx = finite(resolved[thresholdField])
  const distancePx = thresholdPx + Math.max(0, finite(epsilon, RADIAL_DRAG_EPSILON_PX))
  return {
    source,
    phase,
    configField,
    thresholdField,
    radiusBasis: resolved.radiusBasis,
    thresholdPx,
    epsilonPx: Math.max(0, finite(epsilon, RADIAL_DRAG_EPSILON_PX)),
    distancePx,
    origin: {
      x: finite(origin.x),
      y: finite(origin.y),
    },
    point: {
      ...pointAtAngle(origin, angle, distancePx),
      valid: true,
    },
  }
}

async function readStdinJson() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text ? JSON.parse(text) : {}
}

async function main() {
  const action = process.argv[2]
  const input = await readStdinJson()
  if (action === 'normalize-displays') {
    console.log(JSON.stringify(normalizeDisplayTopology(input.displays || [])))
    return
  }
  if (action === 'desktop-world-to-native') {
    console.log(JSON.stringify(desktopWorldPointToNative(input.point, input.displays || [])))
    return
  }
  if (action === 'rect-intersects-visible-display') {
    console.log(JSON.stringify({ intersects: rectIntersectsVisibleDisplay(input.rect, input.displays || []) }))
    return
  }
  if (action === 'native-rect-intersects-visible-display') {
    console.log(JSON.stringify({ intersects: nativeRectIntersectsVisibleDisplay(input.rect, input.displays || []) }))
    return
  }
  if (action === 'opposite-visible-display-point') {
    console.log(JSON.stringify(oppositeVisibleDisplayPoint(input.point, input.displays || [], input.options || {})))
    return
  }
  if (action === 'desktop-world-figure-eight-path') {
    console.log(JSON.stringify(desktopWorldFigureEightPath(input.displays || [], input.options || {})))
    return
  }
  if (action === 'radial-drag-point') {
    console.log(JSON.stringify(resolveRadialDragPoint(input.origin || {}, input.config || {}, input.options || {})))
    return
  }
  throw new Error(`unknown real-input surface primitive action: ${action}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack || String(error))
    process.exit(1)
  })
}
