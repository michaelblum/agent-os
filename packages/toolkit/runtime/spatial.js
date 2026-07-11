// spatial.js — canonical toolkit-side spatial helpers.
//
// This module owns desktop-global rect/point normalization and the common
// geometry transforms reused by toolkit panels and app consumers. App-specific
// spaces such as a product's final 3D scene projection still live in the app, but
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

function rectCenter(rect) {
  if (!rect) return null
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  }
}

function rectToAt(rect) {
  return rect ? [rect.x, rect.y, rect.w, rect.h] : null
}

function rectsEqual(a, b, epsilon = 0.001) {
  if (!a || !b) return false
  return Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.w - b.w) <= epsilon
    && Math.abs(a.h - b.h) <= epsilon
}

function normalizeCoordinateSpace(value = '') {
  const space = String(value || '').trim().toLowerCase()
  if (!space) return ''
  if (space === 'desktopworld') return 'desktop_world'
  if (space === 'native' || space === 'screen' || space === 'native_desktop' || space === 'global_cg') return 'native_display'
  return space
}

function isDesktopWorldSpace(value = '') {
  return normalizeCoordinateSpace(value) === 'desktop_world'
}

function isNativeDisplaySpace(value = '') {
  return normalizeCoordinateSpace(value) === 'native_display'
}

function canvasFrameCoordinateSpace(canvas = {}, field = 'at') {
  if (!canvas || typeof canvas !== 'object') return ''
  if (field === 'atResolved') {
    return normalizeCoordinateSpace(
      canvas.atResolvedCoordinateSpace
        ?? canvas.at_resolved_coordinate_space
        ?? canvas.resolvedCoordinateSpace
        ?? canvas.resolved_coordinate_space
        ?? canvas.frame_coordinate_spaces?.atResolved
        ?? canvas.frame_coordinate_spaces?.at_resolved
        ?? canvas.coordinate_spaces?.atResolved
        ?? canvas.coordinate_spaces?.at_resolved,
    )
  }
  return normalizeCoordinateSpace(
    canvas.atCoordinateSpace
      ?? canvas.at_coordinate_space
      ?? canvas.frameCoordinateSpace
      ?? canvas.frame_coordinate_space
      ?? canvas.coordinateSpace
      ?? canvas.coordinate_space
      ?? canvas.frame_coordinate_spaces?.at
      ?? canvas.coordinate_spaces?.at,
  )
}

function displayForNativeRect(rect, displays = []) {
  if (!rect) return null
  const point = rectCenter(rect)
  const normalized = normalizeDisplayEntries(displays)
  return normalized.find((display) => displayContainsRect(display, rect, { rectKey: 'nativeBounds' }))
    || normalized.find((display) => point && displayContainsPoint(display, point, { rectKey: 'nativeBounds' }))
    || null
}

function displayForDesktopWorldRect(rect, displays = []) {
  if (!rect) return null
  const point = rectCenter(rect)
  const normalized = normalizeDisplayEntries(displays)
  return normalized.find((display) => displayContainsRect(display, rect, { rectKey: 'bounds' }))
    || normalized.find((display) => point && displayContainsPoint(display, point, { rectKey: 'bounds' }))
    || null
}

function nativeToDesktopWorldViaDisplays(rect, displays = []) {
  const display = displayForNativeRect(rect, displays)
  if (!display) return null
  const nativeBounds = rectForDisplay(display, 'nativeBounds')
  const desktopBounds = rectForDisplay(display, 'bounds')
  if (!nativeBounds || !desktopBounds) return null
  return {
    x: rect.x - nativeBounds.x + desktopBounds.x,
    y: rect.y - nativeBounds.y + desktopBounds.y,
    w: rect.w,
    h: rect.h,
  }
}

export function nativeToDesktopWorldPoint(point, displaysOrNativeDesktopBounds) {
  if (Array.isArray(displaysOrNativeDesktopBounds)) {
    const nativeRect = point ? { x: point.x, y: point.y, w: 1, h: 1 } : null
    const rect = nativeToDesktopWorldViaDisplays(nativeRect, displaysOrNativeDesktopBounds)
    if (rect) return { x: rect.x, y: rect.y }
  }
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds) return null
  return translatePoint(point, nativeDesktopBounds)
}

export function nativeToDesktopWorldRect(rect, displaysOrNativeDesktopBounds) {
  if (Array.isArray(displaysOrNativeDesktopBounds)) {
    const mapped = nativeToDesktopWorldViaDisplays(rect, displaysOrNativeDesktopBounds)
    if (mapped) return mapped
  }
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds) return null
  return translateRect(rect, nativeDesktopBounds)
}

export function desktopWorldToNativePoint(point, displaysOrNativeDesktopBounds) {
  if (Array.isArray(displaysOrNativeDesktopBounds)) {
    const worldRect = point ? { x: point.x, y: point.y, w: 1, h: 1 } : null
    const rect = desktopWorldToNativeViaDisplays(worldRect, displaysOrNativeDesktopBounds)
    if (rect) return { x: rect.x, y: rect.y }
  }
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
  if (Array.isArray(displaysOrNativeDesktopBounds)) {
    const mapped = desktopWorldToNativeViaDisplays(rect, displaysOrNativeDesktopBounds)
    if (mapped) return mapped
  }
  const nativeDesktopBounds = resolveNativeDesktopBounds(displaysOrNativeDesktopBounds)
  if (!nativeDesktopBounds || !rect) return null
  return {
    x: rect.x + nativeDesktopBounds.x,
    y: rect.y + nativeDesktopBounds.y,
    w: rect.w,
    h: rect.h,
  }
}

function desktopWorldToNativeViaDisplays(rect, displays = []) {
  const source = normalizeRect(rect)
  if (!rect || source.w <= 0 || source.h <= 0) return null
  const display = displayForDesktopWorldRect(source, displays)
  if (!display) return null
  const nativeBounds = rectForDisplay(display, 'nativeBounds')
  const desktopBounds = rectForDisplay(display, 'bounds')
  if (!nativeBounds || !desktopBounds) return null
  return {
    x: source.x - desktopBounds.x + nativeBounds.x,
    y: source.y - desktopBounds.y + nativeBounds.y,
    w: source.w,
    h: source.h,
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
  return at
}

export function resolveCanvasFrames(list = []) {
  const canvasById = new Map(list.map((canvas) => [canvas.id, canvas]))
  return list.map((canvas) => ({
    ...canvas,
    atResolved: resolveCanvasFrame(canvas, canvasById),
  }))
}

export function normalizeCanvasFrameToDesktopWorld(canvas = {}, displaysOrNativeDesktopBounds = []) {
  const at = rectFromAt(canvas?.at)
  const atResolved = rectFromAt(canvas?.atResolved)
  const atSpace = canvasFrameCoordinateSpace(canvas, 'at')
  const resolvedSpace = canvasFrameCoordinateSpace(canvas, 'atResolved')
  const nativeAtWorld = at
    ? (isDesktopWorldSpace(atSpace) ? at : nativeToDesktopWorldRect(at, displaysOrNativeDesktopBounds))
    : null

  function result(rect, metadata = {}) {
    if (!rect) return null
    return {
      rect,
      at: rectToAt(rect),
      coordinate_space: 'desktop_world',
      status: 'projectable',
      projectable: true,
      can_project_display_overlay: true,
      ...metadata,
    }
  }

  function blocked(reason, metadata = {}) {
    return {
      rect: null,
      at: null,
      coordinate_space: 'desktop_world',
      status: 'blocked',
      projectable: false,
      can_project_display_overlay: false,
      blocker_reason: reason,
      blocker: {
        reason,
        ...(metadata.blocker || {}),
      },
      ...metadata,
    }
  }

  if (atResolved) {
    if (isDesktopWorldSpace(resolvedSpace)) {
      return result(atResolved, {
        source_frame: 'atResolved',
        source_coordinate_space: 'desktop_world',
        source_rect: atResolved,
      })
    }
    if (isNativeDisplaySpace(resolvedSpace)) {
      return result(nativeToDesktopWorldRect(atResolved, displaysOrNativeDesktopBounds), {
        source_frame: 'atResolved',
        source_coordinate_space: 'native_display',
        native_rect: atResolved,
        source_rect: atResolved,
      })
    }
    if (nativeAtWorld && rectsEqual(atResolved, nativeAtWorld)) {
      return result(atResolved, {
        source_frame: 'atResolved',
        source_coordinate_space: 'desktop_world',
        source_rect: atResolved,
        native_rect: at,
        inference: 'atResolved_matches_projected_at',
      })
    }
    if (nativeAtWorld && at && rectsEqual(atResolved, at)) {
      return result(nativeAtWorld, {
        source_frame: 'atResolved',
        source_coordinate_space: isDesktopWorldSpace(atSpace) ? 'desktop_world' : 'native_display',
        native_rect: isDesktopWorldSpace(atSpace) ? null : atResolved,
        source_rect: atResolved,
        inference: 'atResolved_duplicates_at',
      })
    }
    if (!at && Array.isArray(displaysOrNativeDesktopBounds)
        && findContainingDisplayForRect(atResolved, displaysOrNativeDesktopBounds, { rectKey: 'bounds' })
        && !findContainingDisplayForRect(atResolved, displaysOrNativeDesktopBounds, { rectKey: 'nativeBounds' })) {
      return result(atResolved, {
        source_frame: 'atResolved',
        source_coordinate_space: 'desktop_world',
        source_rect: atResolved,
        inference: 'atResolved_only_fits_desktop_world',
      })
    }
    if (nativeAtWorld) {
      return blocked('ambiguous_canvas_frame_coordinate_space', {
        source_frame: 'at',
        source_coordinate_space: isDesktopWorldSpace(atSpace) ? 'desktop_world' : 'native_display',
        native_rect: isDesktopWorldSpace(atSpace) ? null : at,
        source_rect: at,
        ignored_frame: 'atResolved',
        ambiguity: {
          frame: 'atResolved',
          reason: 'missing_or_unknown_coordinate_space',
          rect: atResolved,
        },
      })
    }
    return blocked('ambiguous_canvas_frame_coordinate_space', {
      source_frame: 'atResolved',
      source_rect: atResolved,
      ambiguity: {
        frame: 'atResolved',
        reason: 'missing_or_unknown_coordinate_space',
        rect: atResolved,
      },
    })
  }

  if (!at) return null
  if (isDesktopWorldSpace(atSpace)) {
    return result(at, {
      source_frame: 'at',
      source_coordinate_space: 'desktop_world',
      source_rect: at,
    })
  }
  return result(nativeToDesktopWorldRect(at, displaysOrNativeDesktopBounds), {
    source_frame: 'at',
    source_coordinate_space: 'native_display',
    native_rect: at,
    source_rect: at,
  })
}

export function canvasLocalRectToDesktopWorld(canvas = {}, localRect = null, displaysOrNativeDesktopBounds = []) {
  const frame = normalizeCanvasFrameToDesktopWorld(canvas, displaysOrNativeDesktopBounds)
  const rect = normalizeRect(localRect)
  if (!frame?.rect || !rect || rect.w <= 0 || rect.h <= 0) return null
  return {
    x: frame.rect.x + rect.x,
    y: frame.rect.y + rect.y,
    w: rect.w,
    h: rect.h,
  }
}

export function computeMinimapLayout(displays, canvases, mapW, {
  selfId = 'surface-inspector',
  border = 1,
  inset = 2,
  maxH = Infinity,
  minW = 120,
  minH = 96,
} = {}) {
  if (!displays || displays.length === 0) return null
  const normalizedDisplays = sortDisplaysSpatially(displays)
  const nativeDesktopBounds = computeNativeDesktopBounds(normalizedDisplays)
  const resolvedCanvases = resolveCanvasFrames(canvases || [])
  const union = computeDesktopWorldBounds(normalizedDisplays)
  if (!union) return null

  const totalW = Math.max(1, union.w)
  const totalH = Math.max(1, union.h)
  const requestedW = Math.max(1, Number(mapW) || 1)
  const boundedMaxH = Number.isFinite(Number(maxH)) ? Math.max(1, Number(maxH)) : Infinity
  const lowerW = Math.max(1, Number(minW) || 1)
  const lowerH = Math.max(1, Number(minH) || 1)
  const contentW = Math.max(1, requestedW - border * 2)
  const innerW = Math.max(1, contentW - inset * 2)
  const maxInnerH = Number.isFinite(boundedMaxH)
    ? Math.max(1, boundedMaxH - border * 2 - inset * 2)
    : Infinity
  const widthScale = innerW / totalW
  const heightScale = maxInnerH / totalH
  const scale = Math.min(widthScale, heightScale)
  const worldW = Math.round(totalW * scale)
  const worldH = Math.round(totalH * scale)
  const mapWOut = Math.max(lowerW, worldW + inset * 2 + border * 2)
  const mapH = Math.max(lowerH, worldH + inset * 2 + border * 2)
  const offsetX = Math.max(inset, Math.round((mapWOut - border * 2 - worldW) / 2))
  const offsetY = Math.max(inset, Math.round((mapH - border * 2 - worldH) / 2))

  return {
    mapW: mapWOut,
    mapH,
    inset,
    offsetX,
    offsetY,
    minX: union.x,
    minY: union.y,
    scale,
    displays: normalizedDisplays.map((display) => ({
      display,
      x: offsetX + Math.round((display.bounds.x - union.x) * scale),
      y: offsetY + Math.round((display.bounds.y - union.y) * scale),
      w: Math.round(display.bounds.w * scale),
      h: Math.round(display.bounds.h * scale),
      visibleX: offsetX + Math.round((display.visibleBounds.x - union.x) * scale),
      visibleY: offsetY + Math.round((display.visibleBounds.y - union.y) * scale),
      visibleW: Math.max(1, Math.round(display.visibleBounds.w * scale)),
      visibleH: Math.max(1, Math.round(display.visibleBounds.h * scale)),
    })),
    canvases: resolvedCanvases.flatMap((canvas) => {
      const frame = normalizeCanvasFrameToDesktopWorld(canvas, normalizedDisplays)
        ?? normalizeCanvasFrameToDesktopWorld(canvas, nativeDesktopBounds)
      const rect = frame?.rect
      if (!rect) return []
      return [{
        canvas,
        x: offsetX + Math.round((rect.x - union.x) * scale),
        y: offsetY + Math.round((rect.y - union.y) * scale),
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
    x: (layout.offsetX ?? layout.inset) + Math.round((x - layout.minX) * layout.scale),
    y: (layout.offsetY ?? layout.inset) + Math.round((y - layout.minY) * layout.scale),
  }
}
