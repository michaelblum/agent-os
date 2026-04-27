// radial-gesture.js — pure radial drag gesture state.
//
// This module owns gesture math and phase decisions only. Rendering, icons,
// sounds, and committed actions belong to the consuming app.

const DEFAULT_CONFIG = {
  radiusBasis: 1,
  deadZoneRadius: 0.45,
  itemRadius: 1.35,
  itemHitRadius: 0.42,
  itemVisualRadius: 0.32,
  menuRadius: 1.75,
  handoffRadius: 2.15,
  reentryRadius: 1.8,
  spreadDegrees: 95,
  startAngle: -90,
  orientation: 'fixed',
  releaseInDeadZone: 'cancel',
}

function finite(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function point(value = {}) {
  return {
    x: finite(value.x, 0),
    y: finite(value.y, 0),
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function radius(value, basis) {
  return Math.max(0, finite(value, 0) * basis)
}

function copyItem(item = {}, fallbackId) {
  return {
    ...item,
    id: item.id || fallbackId,
  }
}

function itemSlot(index, count) {
  if (count <= 1) return 0
  return -0.5 + (index / (count - 1))
}

export function normalizeDegrees(degrees) {
  const n = finite(degrees, 0) % 360
  return n < 0 ? n + 360 : n
}

export function shortestAngleDelta(a, b) {
  return ((normalizeDegrees(a) - normalizeDegrees(b) + 540) % 360) - 180
}

export function distanceBetween(a = {}, b = {}) {
  const dx = finite(a.x, 0) - finite(b.x, 0)
  const dy = finite(a.y, 0) - finite(b.y, 0)
  return Math.hypot(dx, dy)
}

export function angleDegrees(origin = {}, target = {}) {
  return normalizeDegrees(Math.atan2(finite(target.y, 0) - finite(origin.y, 0), finite(target.x, 0) - finite(origin.x, 0)) * 180 / Math.PI)
}

export function pointAtAngle(origin = {}, angle, length) {
  const radians = finite(angle, 0) * Math.PI / 180
  const r = finite(length, 0)
  return {
    x: finite(origin.x, 0) + Math.cos(radians) * r,
    y: finite(origin.y, 0) + Math.sin(radians) * r,
  }
}

export function resolveRadialGestureConfig(config = {}) {
  const radiusBasis = Math.max(1, finite(config.radiusBasis, DEFAULT_CONFIG.radiusBasis))
  const resolved = {
    ...DEFAULT_CONFIG,
    ...config,
    radiusBasis,
  }

  resolved.deadZoneRadiusPx = radius(resolved.deadZoneRadius, radiusBasis)
  resolved.itemRadiusPx = radius(resolved.itemRadius, radiusBasis)
  resolved.itemHitRadiusPx = radius(resolved.itemHitRadius, radiusBasis)
  resolved.itemVisualRadiusPx = radius(resolved.itemVisualRadius, radiusBasis)
  resolved.menuRadiusPx = radius(resolved.menuRadius, radiusBasis)
  resolved.handoffRadiusPx = radius(resolved.handoffRadius, radiusBasis)
  resolved.reentryRadiusPx = radius(resolved.reentryRadius, radiusBasis)

  if (resolved.reentryRadiusPx > resolved.handoffRadiusPx) {
    resolved.reentryRadiusPx = resolved.handoffRadiusPx
  }

  return resolved
}

export function resolveRadialGestureItems(items = [], config = {}, state = {}) {
  const resolvedConfig = resolveRadialGestureConfig(config)
  const list = Array.isArray(items) ? items.map((item, index) => copyItem(item, `item-${index + 1}`)) : []
  const origin = point(state.origin)
  const baseAngle = resolvedConfig.orientation === 'trigger-vector'
    ? finite(state.triggerAngle, resolvedConfig.startAngle)
    : finite(resolvedConfig.startAngle, DEFAULT_CONFIG.startAngle)
  const count = list.length

  return list.map((item, index) => {
    const slot = finite(item.slot, itemSlot(index, count))
    const angle = normalizeDegrees(item.angle ?? (baseAngle + slot * finite(resolvedConfig.spreadDegrees, DEFAULT_CONFIG.spreadDegrees)))
    const center = pointAtAngle(origin, angle, resolvedConfig.itemRadiusPx)
    return {
      ...item,
      slot,
      angle,
      center,
      hitRadius: resolvedConfig.itemHitRadiusPx,
      visualRadius: resolvedConfig.itemVisualRadiusPx,
    }
  })
}

export function createRadialGestureModel(options = {}) {
  const items = Array.isArray(options.items) ? options.items : []
  const config = resolveRadialGestureConfig(options)
  let phase = 'idle'
  let origin = { x: 0, y: 0 }
  let pointer = { x: 0, y: 0 }
  let activeItemId = null
  let committed = null
  let cancelReason = null
  let lastTransition = null
  let triggerAngle = finite(config.startAngle, DEFAULT_CONFIG.startAngle)

  function metrics() {
    const distance = distanceBetween(origin, pointer)
    const angle = angleDegrees(origin, pointer)
    return {
      distance,
      angle,
      menuProgress: clamp(distance / Math.max(1, config.menuRadiusPx), 0, 1),
      handoffProgress: clamp(distance / Math.max(1, config.handoffRadiusPx), 0, 1),
    }
  }

  function resolvedItems() {
    return resolveRadialGestureItems(items, config, { origin, triggerAngle })
  }

  function hitItem(nextPointer = pointer) {
    const m = metrics()
    if (m.distance < config.deadZoneRadiusPx) return null
    return resolvedItems().find((item) => distanceBetween(item.center, nextPointer) <= item.hitRadius) || null
  }

  function snapshot(extra = {}) {
    const m = metrics()
    return {
      phase,
      origin: { ...origin },
      pointer: { ...pointer },
      distance: m.distance,
      angle: m.angle,
      menuProgress: m.menuProgress,
      handoffProgress: m.handoffProgress,
      activeItemId,
      committed,
      cancelReason,
      lastTransition,
      radii: {
        deadZone: config.deadZoneRadiusPx,
        item: config.itemRadiusPx,
        itemHit: config.itemHitRadiusPx,
        itemVisual: config.itemVisualRadiusPx,
        menu: config.menuRadiusPx,
        handoff: config.handoffRadiusPx,
        reentry: config.reentryRadiusPx,
      },
      items: resolvedItems(),
      ...extra,
    }
  }

  function move(nextPointer = pointer) {
    if (phase === 'idle' || phase === 'committed' || phase === 'cancelled') return snapshot()
    pointer = point(nextPointer)
    lastTransition = null
    const m = metrics()

    if (phase === 'fastTravel') {
      if (m.distance <= config.reentryRadiusPx) {
        phase = 'radial'
        lastTransition = 'reenter_radial'
      }
    } else if (phase === 'radial' && m.distance >= config.handoffRadiusPx) {
      phase = 'fastTravel'
      activeItemId = null
      lastTransition = 'handoff_fast_travel'
    }

    activeItemId = phase === 'radial' ? hitItem(pointer)?.id || null : null
    return snapshot()
  }

  return {
    start(nextOrigin = {}, nextPointer = nextOrigin) {
      origin = point(nextOrigin)
      pointer = point(nextPointer)
      phase = 'radial'
      committed = null
      cancelReason = null
      lastTransition = 'start'
      const initialDistance = distanceBetween(origin, pointer)
      if (initialDistance > 0) triggerAngle = angleDegrees(origin, pointer)
      activeItemId = hitItem(pointer)?.id || null
      return snapshot()
    },
    move,
    release(nextPointer = pointer) {
      if (phase === 'idle') return snapshot()
      pointer = point(nextPointer)
      lastTransition = null

      if (phase === 'fastTravel') {
        phase = 'committed'
        activeItemId = null
        committed = { type: 'fastTravel', origin: { ...origin }, destination: { ...pointer } }
        lastTransition = 'commit_fast_travel'
        return snapshot()
      }

      const item = phase === 'radial' ? hitItem(pointer) : null
      if (item) {
        phase = 'committed'
        activeItemId = item.id
        committed = { type: 'item', itemId: item.id, item }
        lastTransition = 'commit_item'
        return snapshot()
      }

      phase = 'cancelled'
      activeItemId = null
      cancelReason = config.releaseInDeadZone === 'commit-none' ? 'no_selection' : 'release_without_selection'
      lastTransition = 'cancel'
      return snapshot()
    },
    cancel(reason = 'cancelled') {
      if (phase === 'idle') return snapshot()
      phase = 'cancelled'
      activeItemId = null
      committed = null
      cancelReason = reason
      lastTransition = 'cancel'
      return snapshot()
    },
    reset() {
      phase = 'idle'
      origin = { x: 0, y: 0 }
      pointer = { x: 0, y: 0 }
      activeItemId = null
      committed = null
      cancelReason = null
      lastTransition = null
      triggerAngle = finite(config.startAngle, DEFAULT_CONFIG.startAngle)
      return snapshot()
    },
    snapshot,
  }
}
