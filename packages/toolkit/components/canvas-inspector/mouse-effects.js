// Minimap pointer/mouse-event overlay state + renderer.
//
// This keeps the canvas-inspector's live cursor and mouse-gesture overlays in
// one place so the visual constants stay shared: same white center dot, same
// outer-radius anchor, and one render path for hold/drag/release/cancel
// effects.

import { projectPointToMinimap } from '../../runtime/spatial.js'

export const MINIMAP_POINTER_CENTER_SIZE_PX = 7
export const MINIMAP_POINTER_OUTER_RADIUS_PX = 6
export const MINIMAP_POINTER_CLICK_PULSE_SCALE = 3
export const MINIMAP_POINTER_ARROW_ARM_PX = 7

const PRESS_EXPAND_MS = 120
const RELEASE_MS = 180
const CANCEL_MS = 90
const CLICK_PULSE_MS = 180
const CLICK_DELTA_THRESHOLD_PX = 1.5
const MIN_ARROW_SEGMENT_PX = (MINIMAP_POINTER_OUTER_RADIUS_PX + MINIMAP_POINTER_ARROW_ARM_PX + 3) * 2

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function copyPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return { x: point.x, y: point.y }
}

function distance(a, b) {
  if (!a || !b) return 0
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.sqrt(dx * dx + dy * dy)
}

function escAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
}

function lineAngleDegrees(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI)
}

function displayRect(displayEntry) {
  if (!displayEntry) return null
  return {
    x: displayEntry.x,
    y: displayEntry.y,
    w: displayEntry.w,
    h: displayEntry.h,
  }
}

function clipLineToRect(from, to, rect) {
  if (!from || !to || !rect) return null
  const dx = to.x - from.x
  const dy = to.y - from.y
  let t0 = 0
  let t1 = 1
  const checks = [
    [-dx, from.x - rect.x],
    [dx, rect.x + rect.w - from.x],
    [-dy, from.y - rect.y],
    [dy, rect.y + rect.h - from.y],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return null
      if (r > t0) t0 = r
    } else {
      if (r < t0) return null
      if (r < t1) t1 = r
    }
  }
  return {
    from: { x: from.x + dx * t0, y: from.y + dy * t0 },
    to: { x: from.x + dx * t1, y: from.y + dy * t1 },
  }
}

function lineDisplaySegments(from, to, layout) {
  const segments = (layout?.displays || [])
    .map((display) => clipLineToRect(from, to, displayRect(display)))
    .filter((segment) => segment && distance(segment.from, segment.to) >= MIN_ARROW_SEGMENT_PX)
  return segments.length > 1 ? segments : [{ from, to }].filter((segment) => distance(segment.from, segment.to) >= MIN_ARROW_SEGMENT_PX)
}

function activeRingScale(active, now) {
  if (!active) return 0
  return clamp((now - active.startedAt) / PRESS_EXPAND_MS, 0, 1)
}

function createTransient(active, current, now, phase) {
  const origin = copyPoint(active?.origin)
  const end = copyPoint(current || active?.current || active?.origin)
  if (!origin || !end) return null
  return {
    shape: active?.shape || 'circle',
    phase,
    origin,
    current: end,
    startedAt: now,
    duration: phase === 'cancel' ? CANCEL_MS : RELEASE_MS,
    startScale: activeRingScale(active, now),
    hasLine: distance(origin, end) > 0.5,
  }
}

function createPulse(shape, point, now) {
  const origin = copyPoint(point)
  if (!origin) return null
  return {
    shape,
    phase: 'pulse',
    origin,
    current: origin,
    startedAt: now,
    duration: CLICK_PULSE_MS,
    hasLine: false,
    showDot: false,
  }
}

export function createMouseEffectsState() {
  return {
    active: null,
    transients: [],
  }
}

export function clearMouseEffectsState(state) {
  state.active = null
  state.transients = []
}

export function applyMouseEffectsInput(state, input, point, now = Date.now()) {
  if (!state || !input || typeof input.type !== 'string') return false
  const nextPoint = copyPoint(point)

  switch (input.type) {
    case 'left_mouse_down':
      if (!nextPoint) return false
      state.active = {
        shape: 'circle',
        origin: nextPoint,
        current: nextPoint,
        startedAt: now,
      }
      return true
    case 'left_mouse_dragged':
      if (!state.active || !nextPoint) return false
      state.active.current = nextPoint
      return true
    case 'left_mouse_up':
      if (!state.active) return false
      {
        const release = createTransient(state.active, nextPoint, now, 'release')
        if (release) state.transients.push(release)
        if (distance(state.active.origin, nextPoint || state.active.current || state.active.origin) <= CLICK_DELTA_THRESHOLD_PX) {
          const pulse = createPulse('circle', nextPoint || state.active.current || state.active.origin, now)
          if (pulse) state.transients.push(pulse)
        }
      }
      state.active = null
      return true
    case 'right_mouse_up':
      if (!nextPoint) return false
      state.active = null
      {
        const pulse = createPulse('square', nextPoint, now)
        if (pulse) state.transients.push(pulse)
      }
      return true
    case 'key_down':
      if (input.keyCode !== 53 || !state.active) return false
      {
        const cancel = createTransient(state.active, state.active.current, now, 'cancel')
        if (cancel) state.transients.push(cancel)
      }
      state.active = null
      return true
    default:
      return false
  }
}

export function sweepMouseEffectsState(state, now = Date.now()) {
  if (!state?.transients?.length) return false
  const before = state.transients.length
  state.transients = state.transients.filter((transient) => now - transient.startedAt < transient.duration)
  return state.transients.length !== before
}

export function mouseEffectsNeedAnimationFrame(state, now = Date.now()) {
  if (state?.active && activeRingScale(state.active, now) < 1) return true
  if (state?.transients?.length) {
    return state.transients.some((transient) => now - transient.startedAt < transient.duration)
  }
  return false
}

function ringMetrics(entry, now) {
  if (!entry) return null
  if (entry.phase === 'pulse') {
    const progress = clamp((now - entry.startedAt) / entry.duration, 0, 1)
    return {
      scale: MINIMAP_POINTER_CLICK_PULSE_SCALE * progress,
      opacity: 1 - progress,
    }
  }
  if (entry.phase === 'release' || entry.phase === 'cancel') {
    const progress = clamp((now - entry.startedAt) / entry.duration, 0, 1)
    return {
      scale: Math.max(0.02, (entry.startScale || 1) * (1 - progress * 0.98)),
      opacity: 1 - progress,
    }
  }
  return {
    scale: activeRingScale(entry, now),
    opacity: 1,
  }
}

function dotOpacity(entry, now) {
  if (!entry) return 0
  if (entry.showDot === false) return 0
  if (entry.phase === 'release' || entry.phase === 'cancel') {
    const progress = clamp((now - entry.startedAt) / entry.duration, 0, 1)
    return 1 - progress
  }
  return 1
}

function lineMetrics(entry, now) {
  if (!entry) return null
  if (!entry.phase) {
    return {
      scale: 1,
      opacity: 1,
      origin: '0%',
    }
  }
  if (!entry.hasLine) return null
  if (entry.phase === 'release' || entry.phase === 'cancel') {
    const progress = clamp((now - entry.startedAt) / entry.duration, 0, 1)
    return {
      scale: Math.max(0.001, 1 - progress),
      opacity: 1 - progress * 0.9,
      origin: entry.phase === 'cancel' ? '0%' : '100%',
    }
  }
  return null
}

function renderPointerCenter(point, { className = '', opacity = 1 } = {}) {
  if (!point) return ''
  return `<div class="minimap-pointer-anchor ${escAttr(className)}" style="left:${formatNumber(point.x)}px;top:${formatNumber(point.y)}px">`
    + `<span class="minimap-pointer-center" style="opacity:${formatNumber(opacity)}"></span>`
    + `</div>`
}

function renderPointerRing(point, shape, metrics, className = '') {
  if (!point || !metrics) return ''
  const shapeClass = shape === 'square' ? 'square' : 'circle'
  return `<div class="minimap-pointer-anchor ${escAttr(className)}" style="left:${formatNumber(point.x)}px;top:${formatNumber(point.y)}px">`
    + `<span class="minimap-pointer-ring ${shapeClass}" style="--ring-scale:${formatNumber(metrics.scale)};--ring-opacity:${formatNumber(metrics.opacity)}"></span>`
    + `</div>`
}

function renderPointerLine(from, to, metrics, className = '') {
  if (!from || !to || !metrics) return ''
  const length = distance(from, to)
  if (length <= 0.5) return ''
  return `<div class="minimap-pointer-line-shell ${escAttr(className)}" style="left:${formatNumber(from.x)}px;top:${formatNumber(from.y)}px;transform:translateY(-0.5px) rotate(${formatNumber(lineAngleDegrees(from, to))}deg)">`
    + `<span class="minimap-pointer-line" style="width:${formatNumber(length)}px;--line-scale:${formatNumber(metrics.scale)};--line-opacity:${formatNumber(metrics.opacity)};--line-origin:${metrics.origin}"></span>`
    + `</div>`
}

function renderDirectionArrow(from, to, className = '') {
  if (!from || !to) return ''
  const length = distance(from, to)
  if (length < MIN_ARROW_SEGMENT_PX) return ''
  const midpoint = {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  }
  return `<div class="minimap-pointer-arrow ${escAttr(className)}" style="left:${formatNumber(midpoint.x)}px;top:${formatNumber(midpoint.y)}px;transform:rotate(${formatNumber(lineAngleDegrees(from, to))}deg)">`
    + `<span class="minimap-pointer-arrow-arm up"></span>`
    + `<span class="minimap-pointer-arrow-arm down"></span>`
    + `</div>`
}

function renderDirectionArrows(from, to, layout, className = '') {
  if (!from || !to || distance(from, to) < MIN_ARROW_SEGMENT_PX) return ''
  return lineDisplaySegments(from, to, layout)
    .map((segment) => renderDirectionArrow(segment.from, segment.to, className))
    .join('')
}

function renderActiveOverlay(active, layout, now) {
  if (!active) return ''
  const origin = projectPointToMinimap(layout, active.origin)
  const current = projectPointToMinimap(layout, active.current)
  if (!origin) return ''
  const ring = renderPointerRing(origin, active.shape, ringMetrics(active, now), 'mouse-events active')
  const dot = renderPointerCenter(origin, { className: 'mouse-events active-origin', opacity: 1 })
  const line = origin && current
    ? renderPointerLine(origin, current, lineMetrics(active, now), 'mouse-events active')
    : ''
  const arrows = origin && current
    ? renderDirectionArrows(origin, current, layout, 'mouse-events active')
    : ''
  return line + arrows + ring + dot
}

function renderTransientOverlay(transient, layout, now) {
  if (!transient) return ''
  const origin = projectPointToMinimap(layout, transient.origin)
  const current = projectPointToMinimap(layout, transient.current)
  if (!origin) return ''
  const ring = renderPointerRing(origin, transient.shape, ringMetrics(transient, now), `mouse-events ${transient.phase}`)
  const dot = transient.showDot === false ? '' : renderPointerCenter(origin, {
    className: `mouse-events ${transient.phase}`,
    opacity: dotOpacity(transient, now),
  })
  const line = origin && current
    ? renderPointerLine(origin, current, lineMetrics(transient, now), `mouse-events ${transient.phase}`)
    : ''
  return line + ring + dot
}

export function renderMinimapCursor(projectedCursor) {
  if (!projectedCursor) return ''
  return `<div class="minimap-pointer-anchor minimap-cursor" style="left:${formatNumber(projectedCursor.x)}px;top:${formatNumber(projectedCursor.y)}px" title="cursor">`
    + `<span class="minimap-pointer-ring cursor circle" style="--ring-scale:1;--ring-opacity:1"></span>`
    + `<span class="minimap-pointer-center"></span>`
    + `</div>`
}

export function renderMouseEffectsOverlay(state, layout, now = Date.now()) {
  if (!state || !layout) return ''
  return (state.transients || []).map((transient) => renderTransientOverlay(transient, layout, now)).join('')
    + renderActiveOverlay(state.active, layout, now)
}
