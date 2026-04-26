// range-drag.js — DesktopWorld pointer-to-range input behavior.
//
// Styling and control semantics stay with the app. This module only owns the
// repeated math of mapping a DesktopWorld pointer to a projected range input.

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function finiteNumber(value, fallback = null) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function inputRange(input) {
  const min = finiteNumber(input?.min, 0)
  const max = finiteNumber(input?.max, 100)
  const rawStep = finiteNumber(input?.step, 1)
  const step = rawStep && rawStep > 0 ? rawStep : 1
  return { min, max, step }
}

export function desktopWorldRangeValue(point, geometry = {}, options = {}) {
  const x = finiteNumber(point?.x)
  const left = finiteNumber(geometry.desktopLeft)
  const width = finiteNumber(geometry.desktopWidth)
  if (x === null || left === null || width === null || width <= 0) return null

  const min = finiteNumber(options.min, 0)
  const max = finiteNumber(options.max, 100)
  const rawStep = finiteNumber(options.step, 1)
  const step = rawStep && rawStep > 0 ? rawStep : 1
  const ratio = clamp((x - left) / width, 0, 1)
  const raw = min + (max - min) * ratio
  return clamp(Math.round(raw / step) * step, min, max)
}

export function createDesktopWorldRangeDrag(input, options = {}) {
  const desktopBounds = options.desktopBounds
  const anchor = options.anchor
  const rect = input?.getBoundingClientRect?.()
  const anchorRect = anchor?.getBoundingClientRect?.()
  if (!input || !desktopBounds || !rect || !anchorRect || rect.width <= 0) return null

  return {
    input,
    desktopLeft: desktopBounds.x + (rect.left - anchorRect.left),
    desktopWidth: rect.width,
  }
}

export function updateDesktopWorldRangeDrag(active, point, options = {}) {
  const input = active?.input || active
  if (!input) return true
  const { min, max, step } = inputRange(input)
  const next = desktopWorldRangeValue(point, active, { min, max, step })
  if (next === null) return true

  input.value = String(next)
  if (options.dispatch !== false) {
    input.dispatchEvent?.(new Event('input', { bubbles: true }))
    if (options.commit) input.dispatchEvent?.(new Event('change', { bubbles: true }))
  }
  options.onValue?.(next, { input, commit: !!options.commit })
  return true
}
