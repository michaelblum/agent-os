// spatial.js — canonical toolkit-side spatial helpers.
//
// This module owns desktop-global rect/point normalization and the common
// geometry transforms reused by toolkit panels. App-specific spaces such as
// Sigil's stage-local transforms still live in the app until they migrate.

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

export function rectFromAt(at) {
  if (!Array.isArray(at) || at.length < 4) return null
  const [x, y, w, h] = at.map(asNumber)
  if ([x, y, w, h].some((value) => value == null)) return null
  return { x, y, w, h }
}

export function normalizeDisplays(list = []) {
  return list.map((display = {}) => {
    const rawBounds = display.bounds || {}
    const rawVisible = display.visible_bounds || display.visibleBounds || rawBounds
    const width = asNumber(display.width ?? rawBounds.w ?? rawBounds.width ?? rawVisible.w ?? rawVisible.width) ?? 0
    const height = asNumber(display.height ?? rawBounds.h ?? rawBounds.height ?? rawVisible.h ?? rawVisible.height) ?? 0
    const bounds = normalizeRect(rawBounds, { w: width, h: height })
    const visibleBounds = normalizeRect(rawVisible, bounds)
    return {
      ...display,
      id: display.id ?? display.ordinal ?? display.display_id ?? display.cgID,
      is_main: Boolean(display.is_main),
      scale_factor: asNumber(display.scale_factor ?? display.scaleFactor),
      width,
      height,
      bounds,
      visibleBounds,
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

export function computeUnionBounds(displays = []) {
  const normalized = displays.map((entry) => entry.display || entry).filter(Boolean)
  if (normalized.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const display of normalized) {
    minX = Math.min(minX, display.bounds.x)
    minY = Math.min(minY, display.bounds.y)
    maxX = Math.max(maxX, display.bounds.x + display.bounds.w)
    maxY = Math.max(maxY, display.bounds.y + display.bounds.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
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

export function displayContainsPoint(display, point) {
  if (!display || !point) return false
  const bounds = display.bounds
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x < bounds.x + bounds.w
    && point.y < bounds.y + bounds.h
}

export function displayContainsRect(display, rect) {
  if (!display || !rect) return false
  const bounds = display.bounds
  return rect.x >= bounds.x
    && rect.y >= bounds.y
    && rect.x + rect.w <= bounds.x + bounds.w
    && rect.y + rect.h <= bounds.y + bounds.h
}

export function findContainingDisplayForPoint(point, displays = []) {
  const normalized = displays.map((entry) => entry.display || entry).filter(Boolean)
  for (const display of normalized) {
    if (displayContainsPoint(display, point)) return display
  }
  return null
}

export function findContainingDisplayForRect(rect, displays = []) {
  const normalized = displays.map((entry) => entry.display || entry).filter(Boolean)
  for (const display of normalized) {
    if (displayContainsRect(display, rect)) return display
  }
  return null
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
  const resolvedCanvases = resolveCanvasFrames(canvases || [])
  const union = computeUnionBounds(normalizedDisplays)
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
      const rect = rectFromAt(canvas.atResolved ?? canvas.at)
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
