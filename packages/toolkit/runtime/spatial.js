// spatial.js — canonical toolkit-side spatial helpers.
//
// This module owns desktop-global rect/point normalization and the common
// geometry transforms reused by toolkit panels and app consumers. App-specific
// spaces such as Sigil's final 3D scene projection still live in the app, but
// the global -> local rect/point transforms belong here.

function asNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeRect(bounds = {}, fallback = {}) {
  return {
    x: asNumber(bounds.x) ?? asNumber(fallback.x) ?? 0,
    y: asNumber(bounds.y) ?? asNumber(fallback.y) ?? 0,
    w: asNumber(bounds.w ?? bounds.width) ?? asNumber(fallback.w ?? fallback.width) ?? 0,
    h: asNumber(bounds.h ?? bounds.height) ?? asNumber(fallback.h ?? fallback.height) ?? 0,
  }
}

function unwrapDisplay(entry) {
  return entry?.display || entry
}

function isNormalizedDisplay(display) {
  return Boolean(display
    && typeof display === 'object'
    && display.bounds
    && display.visibleBounds
    && display.nativeBounds
    && display.nativeVisibleBounds)
}

function normalizeNativeDisplay(display = {}) {
  const rawBounds = display.nativeBounds || display.native_bounds || display.bounds || {}
  const rawVisible = display.nativeVisibleBounds
    || display.native_visible_bounds
    || display.visible_bounds
    || display.visibleBounds
    || rawBounds
  const rawDesktopWorld = display.desktopWorldBounds
    || display.desktop_world_bounds
    || null
  const rawVisibleDesktopWorld = display.visibleDesktopWorldBounds
    || display.visible_desktop_world_bounds
    || null
  const width = asNumber(
    display.width
      ?? rawBounds.w
      ?? rawBounds.width
      ?? rawVisible.w
      ?? rawVisible.width,
  ) ?? 0
  const height = asNumber(
    display.height
      ?? rawBounds.h
      ?? rawBounds.height
      ?? rawVisible.h
      ?? rawVisible.height,
  ) ?? 0
  const nativeBounds = normalizeRect(rawBounds, { w: width, h: height })
  const nativeVisibleBounds = normalizeRect(rawVisible, nativeBounds)
  return {
    ...display,
    id: display.id ?? display.ordinal ?? display.display_id ?? display.cgID,
    is_main: Boolean(display.is_main),
    scale_factor: asNumber(display.scale_factor ?? display.scaleFactor),
    width,
    height,
    nativeBounds,
    nativeVisibleBounds,
    desktopWorldBounds: rawDesktopWorld ? normalizeRect(rawDesktopWorld) : null,
    visibleDesktopWorldBounds: rawVisibleDesktopWorld ? normalizeRect(rawVisibleDesktopWorld) : null,
  }
}

function normalizeDisplayEntries(displays = []) {
  const entries = displays.map(unwrapDisplay).filter(Boolean)
  if (entries.length === 0) return []
  if (entries.every(isNormalizedDisplay)) return entries
  return normalizeDisplays(entries)
}

function rectForDisplay(display, rectKey = 'bounds') {
  if (!display) return null
  if (rectKey === 'nativeBounds' || rectKey === 'native_bounds') {
    return display.nativeBounds || display.native_bounds || display.bounds || null
  }
  if (rectKey === 'nativeVisibleBounds' || rectKey === 'native_visible_bounds') {
    return display.nativeVisibleBounds || display.native_visible_bounds || display.visibleBounds || display.visible_bounds || display.bounds || null
  }
  if (rectKey === 'visibleBounds' || rectKey === 'visible_bounds') {
    return display.visibleBounds || display.visible_bounds || display.bounds || null
  }
  return display[rectKey] || display.bounds || null
}

function distanceSquaredToRect(rect, point) {
  if (!rect || !point) return Infinity
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.w - 1))
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.h - 1))
  return ((point.x - cx) ** 2) + ((point.y - cy) ** 2)
}

function coerceOriginRect(originRect) {
  if (!originRect) return null
  if (Array.isArray(originRect)) return rectFromAt(originRect)
  if (Array.isArray(originRect.atResolved)) return rectFromAt(originRect.atResolved)
  if (Array.isArray(originRect.at)) return rectFromAt(originRect.at)
  if (typeof originRect === 'object') {
    const rect = normalizeRect(originRect)
    if ([rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return rect
  }
  return null
}

export function rectFromAt(at) {
  if (!Array.isArray(at) || at.length < 4) return null
  const [x, y, w, h] = at.map(asNumber)
  if ([x, y, w, h].some((value) => value == null)) return null
  return { x, y, w, h }
}

function computeRectUnion(rects = []) {
  if (rects.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    if (!rect) continue
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.w)
    maxY = Math.max(maxY, rect.y + rect.h)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function computeNativeDesktopBounds(displays = []) {
  const nativeDisplays = displays.map(unwrapDisplay).filter(Boolean).map(normalizeNativeDisplay)
  const union = computeRectUnion(nativeDisplays.map((display) => rectForDisplay(display, 'nativeBounds')))
  if (!union) {
    return { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  return {
    ...union,
    minX: union.x,
    minY: union.y,
    maxX: union.x + union.w,
    maxY: union.y + union.h,
  }
}

export function normalizeDisplays(list = []) {
  const nativeDisplays = list.map(unwrapDisplay).filter(Boolean).map(normalizeNativeDisplay)

  const nativeDesktopBounds = computeNativeDesktopBounds(nativeDisplays)

  return nativeDisplays.map((display) => {
    const bounds = display.desktopWorldBounds
      ?? translateRect(display.nativeBounds, nativeDesktopBounds)
      ?? { x: 0, y: 0, w: 0, h: 0 }
    const visibleBounds = display.visibleDesktopWorldBounds
      ?? translateRect(display.nativeVisibleBounds, nativeDesktopBounds)
      ?? bounds
    return {
      ...display,
      bounds,
      visibleBounds,
      native_bounds: display.nativeBounds,
      native_visible_bounds: display.nativeVisibleBounds,
      visible_bounds: visibleBounds,
      desktop_world_bounds: bounds,
      visible_desktop_world_bounds: visibleBounds,
    }
  })
}

export function sortDisplaysSpatially(displays = []) {
  return [...normalizeDisplays(displays)].sort((a, b) => {
    if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y
    return a.bounds.x - b.bounds.x
  })
}

export function labelDisplays(list = []) {
  const displays = sortDisplaysSpatially(list)
  let extendedOrdinal = 0
  return displays.map((display) => {
    if (display.is_main) {
      return { id: display.id, label: 'main', display }
    }
    extendedOrdinal += 1
    return { id: display.id, label: `extended [${extendedOrdinal}]`, display }
  })
}

export function computeUnionBounds(displays = [], { rectKey = 'bounds' } = {}) {
  const normalized = normalizeDisplayEntries(displays)
  return computeRectUnion(normalized.map((display) => rectForDisplay(display, rectKey)))
}

export function computeDesktopWorldBounds(displays = []) {
  const union = computeUnionBounds(displays, { rectKey: 'bounds' })
  if (!union) {
    return { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  return {
    ...union,
    minX: union.x,
    minY: union.y,
    maxX: union.x + union.w,
    maxY: union.y + union.h,
  }
}

export function computeVisibleDesktopWorldBounds(displays = []) {
  const union = computeUnionBounds(displays, { rectKey: 'visibleBounds' })
  if (!union) {
    return { x: 0, y: 0, w: 0, h: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }
  return {
    ...union,
    minX: union.x,
    minY: union.y,
    maxX: union.x + union.w,
    maxY: union.y + union.h,
  }
}

export function computeDisplayUnion(displays = []) {
  return computeVisibleDesktopWorldBounds(displays)
}

export function translatePoint(point, originRect) {
  if (!point || !originRect) return null
  const x = asNumber(point.x)
  const y = asNumber(point.y)
  if (x == null || y == null) return null
  return {
    x: x - originRect.x,
    y: y - originRect.y,
  }
}

export function translateRect(rect, originRect) {
  if (!rect || !originRect) return null
  return {
    x: rect.x - originRect.x,
    y: rect.y - originRect.y,
    w: rect.w,
    h: rect.h,
  }
}

function resolveNativeDesktopBounds(displaysOrBounds) {
  if (Array.isArray(displaysOrBounds)) return computeNativeDesktopBounds(displaysOrBounds)
  if (displaysOrBounds && typeof displaysOrBounds === 'object' && 'x' in displaysOrBounds && 'y' in displaysOrBounds && 'w' in displaysOrBounds && 'h' in displaysOrBounds) {
    return normalizeRect(displaysOrBounds)
  }
  return null
}

export function nativeToDesktopWorldPoint(point, displaysOrNativeDesktopBounds) {
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds) return null
  return translatePoint(point, nativeDesktopBounds)
}

export function nativeToDesktopWorldRect(rect, displaysOrNativeDesktopBounds) {
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds) return null
  return translateRect(rect, nativeDesktopBounds)
}

export function desktopWorldToNativePoint(point, displaysOrNativeDesktopBounds) {
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds || !point) return null
  const x = asNumber(point.x)
  const y = asNumber(point.y)
  if (x == null || y == null) return null
  return {
    x: x + nativeDesktopBounds.x,
    y: y + nativeDesktopBounds.y,
  }
}

export function desktopWorldToNativeRect(rect, displaysOrNativeDesktopBounds) {
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds || !rect) return null
  return {
    x: rect.x + nativeDesktopBounds.x,
    y: rect.y + nativeDesktopBounds.y,
    w: rect.w,
    h: rect.h,
  }
}

export function globalToUnionLocalPoint(point, unionBounds) {
  const originRect = coerceOriginRect(unionBounds)
  if (!originRect) return null
  return translatePoint(point, originRect)
}

export function globalToDisplayLocalPoint(point, display, { rectKey = 'visibleBounds' } = {}) {
  const originRect = rectForDisplay(display, rectKey)
  if (!originRect) return null
  return translatePoint(point, originRect)
}

export function globalToCanvasLocalPoint(point, canvasOrRect) {
  const originRect = coerceOriginRect(canvasOrRect)
  if (!originRect) return null
  return translatePoint(point, originRect)
}

export function displayContainsPoint(display, point, { rectKey = 'bounds' } = {}) {
  if (!display || !point) return false
  const rect = rectForDisplay(display, rectKey)
  if (!rect) return false
  return point.x >= rect.x
    && point.y >= rect.y
    && point.x < rect.x + rect.w
    && point.y < rect.y + rect.h
}

export function displayContainsRect(display, rect, { rectKey = 'bounds' } = {}) {
  if (!display || !rect) return false
  const bounds = rectForDisplay(display, rectKey)
  if (!bounds) return false
  return rect.x >= bounds.x
    && rect.y >= bounds.y
    && rect.x + rect.w <= bounds.x + bounds.w
    && rect.y + rect.h <= bounds.y + bounds.h
}

export function findContainingDisplayForPoint(point, displays = [], { rectKey = 'bounds' } = {}) {
  const normalized = normalizeDisplayEntries(displays)
  for (const display of normalized) {
    if (displayContainsPoint(display, point, { rectKey })) return display
  }
  return null
}

export function findContainingDisplayForRect(rect, displays = [], { rectKey = 'bounds' } = {}) {
  const normalized = normalizeDisplayEntries(displays)
  for (const display of normalized) {
    if (displayContainsRect(display, rect, { rectKey })) return display
  }
  return null
}

export function findDisplayForPoint(displays = [], x, y, { rectKey = 'visibleBounds', nearest = true } = {}) {
  const point = { x, y }
  const normalized = normalizeDisplayEntries(displays)
  let best = null
  let bestDistance = Infinity
  for (const display of normalized) {
    if (displayContainsPoint(display, point, { rectKey })) return display
    if (!nearest) continue
    const rect = rectForDisplay(display, rectKey)
    const distance = distanceSquaredToRect(rect, point)
    if (distance < bestDistance) {
      best = display
      bestDistance = distance
    }
  }
  return best
}

export function clampPointToDisplays(displays = [], x, y, { rectKey = 'visibleBounds' } = {}) {
  const display = findDisplayForPoint(displays, x, y, { rectKey, nearest: true })
  const rect = rectForDisplay(display, rectKey)
  if (!rect) return { x, y }
  return {
    x: Math.max(rect.x, Math.min(x, rect.x + rect.w - 1)),
    y: Math.max(rect.y, Math.min(y, rect.y + rect.h - 1)),
  }
}

export function ownerLabelForPoint(point, labeledDisplays = []) {
  const owner = labeledDisplays.find(({ display }) => displayContainsPoint(display, point))
  return owner?.label ?? 'union'
}

export function ownerLabelForRect(rect, labeledDisplays = []) {
  const owner = labeledDisplays.find(({ display }) => displayContainsRect(display, rect))
  return owner?.label ?? 'union'
}

export function resolveCanvasFrame(canvas, canvasById, resolving = new Set()) {
  const explicitResolved = Array.isArray(canvas?.atResolved) && canvas.atResolved.length >= 4 ? canvas.atResolved : null
  if (explicitResolved) return explicitResolved
  const at = Array.isArray(canvas?.at) && canvas.at.length >= 4 ? canvas.at : null
  if (!at) return null
  if (!canvas?.parent) return at
  if (resolving.has(canvas.id)) return at
  const parent = canvasById.get(canvas.parent)
  if (!parent) return at
  resolving.add(canvas.id)
  const parentAt = resolveCanvasFrame(parent, canvasById, resolving)
  resolving.delete(canvas.id)
  if (!parentAt) return at
  return [
    at[0] - parentAt[0],
    at[1] - parentAt[1],
    at[2],
    at[3],
  ]
}

export function resolveCanvasFrames(list = []) {
  const canvasById = new Map(list.map((canvas) => [canvas.id, canvas]))
  return list.map((canvas) => ({
    ...canvas,
    atResolved: resolveCanvasFrame(canvas, canvasById),
  }))
}

export function computeMinimapLayout(displays, canvases, mapW, { selfId = 'canvas-inspector', border = 1, inset = 2 } = {}) {
  if (!displays || displays.length === 0) return null
  const normalizedDisplays = sortDisplaysSpatially(displays)
  const nativeDesktopBounds = computeNativeDesktopBounds(normalizedDisplays)
  const resolvedCanvases = resolveCanvasFrames(canvases || [])
  const union = computeDesktopWorldBounds(normalizedDisplays)
  if (!union) return null

  const totalW = Math.max(1, union.w)
  const totalH = Math.max(1, union.h)
  const contentW = Math.max(1, mapW - border * 2)
  const innerW = Math.max(1, contentW - inset * 2)
  const scale = innerW / totalW
  const contentH = Math.round(totalH * scale) + inset * 2
  const mapH = contentH + border * 2

  return {
    mapW,
    mapH,
    inset,
    minX: union.x,
    minY: union.y,
    scale,
    displays: normalizedDisplays.map((display) => ({
      display,
      x: inset + Math.round((display.bounds.x - union.x) * scale),
      y: inset + Math.round((display.bounds.y - union.y) * scale),
      w: Math.round(display.bounds.w * scale),
      h: Math.round(display.bounds.h * scale),
      visibleX: inset + Math.round((display.visibleBounds.x - union.x) * scale),
      visibleY: inset + Math.round((display.visibleBounds.y - union.y) * scale),
      visibleW: Math.max(1, Math.round(display.visibleBounds.w * scale)),
      visibleH: Math.max(1, Math.round(display.visibleBounds.h * scale)),
    })),
    canvases: resolvedCanvases.flatMap((canvas) => {
      const nativeRect = rectFromAt(canvas.atResolved ?? canvas.at)
      const rect = nativeToDesktopWorldRect(nativeRect, nativeDesktopBounds)
      if (!rect) return []
      return [{
        canvas,
        x: inset + Math.round((rect.x - union.x) * scale),
        y: inset + Math.round((rect.y - union.y) * scale),
        w: Math.max(2, Math.round(rect.w * scale)),
        h: Math.max(2, Math.round(rect.h * scale)),
        isSelf: selfId != null && canvas.id === selfId,
      }]
    }),
  }
}

export function projectPointToMinimap(layout, point) {
  if (!layout || !point) return null
  const x = asNumber(point.x)
  const y = asNumber(point.y)
  if (x == null || y == null) return null
  return {
    x: layout.inset + Math.round((x - layout.minX) * layout.scale),
    y: layout.inset + Math.round((y - layout.minY) * layout.scale),
  }
}
