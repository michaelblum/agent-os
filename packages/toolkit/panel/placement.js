// placement.js — shared panel/window placement policy.
//
// The daemon owns display geometry and canvas frames. Toolkit chrome consumes
// that truth here so panels, chips, maximize, resize, and restore do not each
// invent their own display ownership rules.

import { findDisplayForPoint, normalizeDisplays } from '../runtime/spatial.js'

export function finiteNumber(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function positiveNumber(value, fallback = 1) {
  const number = finiteNumber(value, fallback)
  return Math.max(1, number)
}

export function cloneFrame(frame) {
  return [
    Math.round(finiteNumber(frame?.[0], 0)),
    Math.round(finiteNumber(frame?.[1], 0)),
    Math.round(positiveNumber(frame?.[2], 1)),
    Math.round(positiveNumber(frame?.[3], 1)),
  ]
}

export function frameFromRect(rect = {}) {
  return cloneFrame([rect.x, rect.y, rect.w ?? rect.width, rect.h ?? rect.height])
}

export function frameFromWindow(view = window, { currentFrame = null } = {}) {
  if (currentFrame) return cloneFrame(currentFrame)
  return cloneFrame([
    finiteNumber(view.screenX ?? view.screenLeft, 0),
    finiteNumber(view.screenY ?? view.screenTop, 0),
    positiveNumber(view.outerWidth || view.innerWidth || view.document?.documentElement?.clientWidth, 1),
    positiveNumber(view.outerHeight || view.innerHeight || view.document?.documentElement?.clientHeight, 1),
  ])
}

export function workAreaFromWindow(view = window, fallbackFrame = frameFromWindow(view)) {
  const screen = view.screen || {}
  const x = finiteNumber(screen.availLeft ?? screen.left, fallbackFrame[0])
  const y = finiteNumber(screen.availTop ?? screen.top, fallbackFrame[1])
  const width = positiveNumber(screen.availWidth || screen.width, fallbackFrame[2])
  const height = positiveNumber(screen.availHeight || screen.height, fallbackFrame[3])
  return cloneFrame([x, y, width, height])
}

export function normalizePanelDisplays(displays = []) {
  return normalizeDisplays(Array.isArray(displays) ? displays : [])
}

export function displayOwnerForTopLeft(frame = [0, 0, 1, 1], displays = []) {
  const source = cloneFrame(frame)
  const normalized = normalizePanelDisplays(displays)
  if (normalized.length === 0) return null
  return findDisplayForPoint(normalized, source[0], source[1], {
    rectKey: 'nativeBounds',
    nearest: true,
  })
}

export function displayOwnerForPoint(point = null, displays = [], { rectKey = 'nativeBounds', nearest = true } = {}) {
  const x = finiteNumber(point?.x, null)
  const y = finiteNumber(point?.y, null)
  const normalized = normalizePanelDisplays(displays)
  if (x == null || y == null || normalized.length === 0) return null
  return findDisplayForPoint(normalized, x, y, { rectKey, nearest })
}

export function sameDisplay(lhs, rhs) {
  if (!lhs || !rhs) return false
  const lhsID = lhs.id ?? lhs.display_id
  const rhsID = rhs.id ?? rhs.display_id
  if (lhsID === undefined || rhsID === undefined) return false
  return String(lhsID) === String(rhsID)
}

export function workAreaForFrameTopLeft(frame = [0, 0, 1, 1], displays = [], fallback = null) {
  const owner = displayOwnerForTopLeft(frame, displays)
  if (owner?.nativeVisibleBounds) return frameFromRect(owner.nativeVisibleBounds)
  if (owner?.native_visible_bounds) return frameFromRect(owner.native_visible_bounds)
  return fallback ? cloneFrame(fallback) : null
}

export function workAreaForPoint(point = null, displays = [], fallback = null) {
  const owner = displayOwnerForPoint(point, displays)
  if (owner?.nativeVisibleBounds) return frameFromRect(owner.nativeVisibleBounds)
  if (owner?.native_visible_bounds) return frameFromRect(owner.native_visible_bounds)
  return fallback ? cloneFrame(fallback) : null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function rectsOverlap(a, b) {
  return !!(a && b
    && a.x < b.x + b.w
    && a.x + a.w > b.x
    && a.y < b.y + b.h
    && a.y + a.h > b.y)
}

export function rectOverlapArea(a, b) {
  if (!rectsOverlap(a, b)) return 0
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return x * y
}

function rectCenter(rect) {
  if (!rect) return null
  return {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
  }
}

function clampCenterToViewport(center, size, viewport) {
  if (!center || !viewport) return center
  const halfW = size.w / 2
  const halfH = size.h / 2
  return {
    x: clamp(center.x, viewport.x + halfW, viewport.x + Math.max(halfW, viewport.w - halfW)),
    y: clamp(center.y, viewport.y + halfH, viewport.y + Math.max(halfH, viewport.h - halfH)),
  }
}

export function avoidAnchorPanelOverlap({
  anchorRect,
  panelRect,
  viewport,
  margin = 12,
} = {}) {
  if (!anchorRect || !panelRect || !viewport) return null
  if (!rectsOverlap(anchorRect, panelRect)) return null
  const size = { w: anchorRect.w, h: anchorRect.h }
  const current = rectCenter(anchorRect)
  const gap = finiteNumber(margin, 12)
  const candidates = [
    { side: 'left', x: panelRect.x - gap - size.w / 2, y: current.y },
    { side: 'right', x: panelRect.x + panelRect.w + gap + size.w / 2, y: current.y },
    { side: 'above', x: current.x, y: panelRect.y - gap - size.h / 2 },
    { side: 'below', x: current.x, y: panelRect.y + panelRect.h + gap + size.h / 2 },
  ].map((candidate, index) => {
    const center = clampCenterToViewport(candidate, size, viewport)
    const rect = {
      x: center.x - size.w / 2,
      y: center.y - size.h / 2,
      w: size.w,
      h: size.h,
    }
    const dx = center.x - current.x
    const dy = center.y - current.y
    return {
      ...center,
      side: candidate.side,
      index,
      rect,
      overlap: rectOverlapArea(rect, panelRect),
      distanceSquared: dx * dx + dy * dy,
    }
  })
  const separated = candidates.filter((candidate) => candidate.overlap === 0)
  const best = (separated.length > 0 ? separated : candidates)
    .sort((a, b) => (
      (a.overlap - b.overlap)
      || (a.distanceSquared - b.distanceSquared)
      || (a.index - b.index)
    ))[0]
  return best ? {
    x: best.x,
    y: best.y,
    side: best.side,
    overlap: best.overlap,
  } : null
}

export function clampFrameToWorkArea(frame, {
  workArea = null,
  minVisibleWidth = 120,
  minVisibleHeight = 44,
} = {}) {
  const next = cloneFrame(frame)
  if (!workArea) return next
  const area = cloneFrame(workArea)
  const areaRight = area[0] + area[2]
  const areaBottom = area[1] + area[3]
  next[2] = Math.min(next[2], area[2])
  next[3] = Math.min(next[3], area[3])
  const maxX = Math.max(area[0], areaRight - next[2])
  const maxY = Math.max(area[1], areaBottom - next[3])
  if (next[2] <= area[2]) next[0] = clamp(next[0], area[0], maxX)
  else next[0] = clamp(next[0], area[0] - next[2] + minVisibleWidth, areaRight - minVisibleWidth)
  if (next[3] <= area[3]) next[1] = clamp(next[1], area[1], maxY)
  else next[1] = clamp(next[1], area[1] - next[3] + minVisibleHeight, areaBottom - minVisibleHeight)
  return cloneFrame(next)
}

export const VIEWPORT_OVERFLOW_POLICIES = Object.freeze({
  ALLOW: 'allow',
  CLAMP: 'clamp',
  SHIFT: 'shift',
  FLIP: 'flip',
  FLIP_SHIFT: 'flip-shift',
})

export function normalizeViewportOverflowPolicy(policy = VIEWPORT_OVERFLOW_POLICIES.CLAMP) {
  const normalized = String(policy || VIEWPORT_OVERFLOW_POLICIES.CLAMP).trim().toLowerCase()
  return Object.values(VIEWPORT_OVERFLOW_POLICIES).includes(normalized)
    ? normalized
    : VIEWPORT_OVERFLOW_POLICIES.CLAMP
}

function shiftFrameIntoWorkArea(frame, workArea = null) {
  const next = cloneFrame(frame)
  if (!workArea) return next
  const area = cloneFrame(workArea)
  const areaRight = area[0] + area[2]
  const areaBottom = area[1] + area[3]
  const right = next[0] + next[2]
  const bottom = next[1] + next[3]
  if (next[0] < area[0]) next[0] = area[0]
  else if (right > areaRight) next[0] -= right - areaRight
  if (next[1] < area[1]) next[1] = area[1]
  else if (bottom > areaBottom) next[1] -= bottom - areaBottom
  return cloneFrame(next)
}

function frameRight(frame) {
  return frame[0] + frame[2]
}

function frameBottom(frame) {
  return frame[1] + frame[3]
}

function frameOverlapArea(lhs, rhs) {
  if (!lhs || !rhs) return 0
  const x = Math.max(0, Math.min(frameRight(lhs), frameRight(rhs)) - Math.max(lhs[0], rhs[0]))
  const y = Math.max(0, Math.min(frameBottom(lhs), frameBottom(rhs)) - Math.max(lhs[1], rhs[1]))
  return x * y
}

function frameInsideWorkArea(frame, workArea = null) {
  if (!workArea) return false
  const source = cloneFrame(frame)
  const area = cloneFrame(workArea)
  return source[0] >= area[0]
    && source[1] >= area[1]
    && frameRight(source) <= frameRight(area)
    && frameBottom(source) <= frameBottom(area)
}

function flipFrameIntoWorkArea(frame, {
  workArea = null,
  anchor = null,
  gap = 0,
} = {}) {
  const next = cloneFrame(frame)
  if (!workArea || !anchor) return shiftFrameIntoWorkArea(next, workArea)
  const area = cloneFrame(workArea)
  const anchorFrame = cloneFrame(anchor)
  const areaRight = area[0] + area[2]
  const areaBottom = area[1] + area[3]
  const gapSize = finiteNumber(gap, 0)
  if (next[0] + next[2] > areaRight) {
    next[0] = anchorFrame[0] - next[2] - gapSize
  } else if (next[0] < area[0]) {
    next[0] = anchorFrame[0] + anchorFrame[2] + gapSize
  }
  if (next[1] + next[3] > areaBottom) {
    next[1] = anchorFrame[1] - next[3] - gapSize
  } else if (next[1] < area[1]) {
    next[1] = anchorFrame[1] + anchorFrame[3] + gapSize
  }
  return shiftFrameIntoWorkArea(next, area)
}

export function createPlacementPlan({
  requestedFrame,
  workArea = null,
  viewportOverflowPolicy = VIEWPORT_OVERFLOW_POLICIES.CLAMP,
  anchorFrame = null,
  gap = 0,
  minVisibleWidth = 120,
  minVisibleHeight = 44,
  cause = 'placement.policy',
} = {}) {
  const requested = cloneFrame(requestedFrame)
  const policy = normalizeViewportOverflowPolicy(viewportOverflowPolicy)
  let adjusted = cloneFrame(requested)
  if (policy === VIEWPORT_OVERFLOW_POLICIES.CLAMP) {
    adjusted = clampFrameToWorkArea(requested, { workArea, minVisibleWidth, minVisibleHeight })
  } else if (policy === VIEWPORT_OVERFLOW_POLICIES.SHIFT) {
    adjusted = shiftFrameIntoWorkArea(requested, workArea)
  } else if (policy === VIEWPORT_OVERFLOW_POLICIES.FLIP || policy === VIEWPORT_OVERFLOW_POLICIES.FLIP_SHIFT) {
    adjusted = flipFrameIntoWorkArea(requested, { workArea, anchor: anchorFrame, gap })
  }
  const finalSettled = cloneFrame(adjusted)
  return {
    requested_frame: requested,
    policy_adjusted_frame: adjusted,
    final_settled_frame: finalSettled,
    viewport_overflow_policy: policy,
    cause,
  }
}

function normalizePanelSize(size = {}) {
  if (Array.isArray(size)) return [positiveNumber(size[0], 1), positiveNumber(size[1], 1)]
  return [
    positiveNumber(size.w ?? size.width, 1),
    positiveNumber(size.h ?? size.height, 1),
  ]
}

function displayWorkArea(display = null, fallback = null) {
  if (display?.visibleBounds) return frameFromRect(display.visibleBounds)
  if (display?.visible_bounds) return frameFromRect(display.visible_bounds)
  if (display?.nativeVisibleBounds) return frameFromRect(display.nativeVisibleBounds)
  if (display?.native_visible_bounds) return frameFromRect(display.native_visible_bounds)
  if (display?.bounds) return frameFromRect(display.bounds)
  return fallback ? cloneFrame(fallback) : null
}

function anchorDisplayForRect(anchorFrame, displays = [], {
  rectKey = 'visibleBounds',
  nearest = true,
} = {}) {
  const anchor = cloneFrame(anchorFrame)
  const center = {
    x: anchor[0] + (anchor[2] / 2),
    y: anchor[1] + (anchor[3] / 2),
  }
  return displayOwnerForPoint(center, displays, { rectKey, nearest })
}

function anchoredCandidateFrame(placement, anchor, [width, height], gap, offset) {
  const dx = finiteNumber(offset?.x, 0)
  const dy = finiteNumber(offset?.y, 0)
  const anchorCenterX = anchor[0] + (anchor[2] / 2)
  const anchorCenterY = anchor[1] + (anchor[3] / 2)
  if (placement === 'left') {
    return [anchor[0] - width - gap + dx, anchorCenterY - (height / 2) + dy, width, height]
  }
  if (placement === 'above' || placement === 'top') {
    return [anchorCenterX - (width / 2) + dx, anchor[1] - height - gap + dy, width, height]
  }
  if (placement === 'below' || placement === 'bottom') {
    return [anchorCenterX - (width / 2) + dx, anchor[1] + anchor[3] + gap + dy, width, height]
  }
  return [anchor[0] + anchor[2] + gap + dx, anchorCenterY - (height / 2) + dy, width, height]
}

function normalizeAnchoredPlacements(placements = []) {
  const source = Array.isArray(placements) && placements.length
    ? placements
    : ['right', 'left']
  const normalized = []
  for (const placement of source) {
    const value = String(placement || '').trim().toLowerCase()
    if (!value) continue
    const canonical = value === 'top' ? 'above' : value === 'bottom' ? 'below' : value
    if (['right', 'left', 'above', 'below'].includes(canonical) && !normalized.includes(canonical)) {
      normalized.push(canonical)
    }
  }
  for (const fallback of ['right', 'left', 'below', 'above']) {
    if (!normalized.includes(fallback)) normalized.push(fallback)
  }
  return normalized
}

export function createAnchoredPanelPlacementPlan({
  anchorRect,
  anchorFrame = anchorRect,
  panelSize,
  displays = [],
  preferredPlacements = ['right', 'left'],
  gap = 12,
  offset = { x: 0, y: 0 },
  constrainTo = 'anchor-display',
  viewportOverflowPolicy = VIEWPORT_OVERFLOW_POLICIES.FLIP_SHIFT,
  cause = 'placement.anchor',
  display = null,
  workArea = null,
  displayRectKey = 'visibleBounds',
} = {}) {
  const anchor = Array.isArray(anchorFrame) ? cloneFrame(anchorFrame) : frameFromRect(anchorFrame)
  const size = normalizePanelSize(panelSize)
  const policy = normalizeViewportOverflowPolicy(viewportOverflowPolicy)
  const normalizedDisplays = normalizePanelDisplays(displays)
  const owner = display
    || (constrainTo === 'anchor-display'
      ? anchorDisplayForRect(anchor, normalizedDisplays, { rectKey: displayRectKey, nearest: true })
      : null)
  const anchorWorkArea = workArea
    ? cloneFrame(workArea)
    : displayWorkArea(owner, null)
  const placements = normalizeAnchoredPlacements(preferredPlacements)
  const gapSize = finiteNumber(gap, 0)

  const candidates = placements.map((placement, index) => {
    const requested = cloneFrame(anchoredCandidateFrame(placement, anchor, size, gapSize, offset))
    const plan = createPlacementPlan({
      requestedFrame: requested,
      workArea: anchorWorkArea,
      viewportOverflowPolicy: policy === VIEWPORT_OVERFLOW_POLICIES.ALLOW ? policy : VIEWPORT_OVERFLOW_POLICIES.SHIFT,
      anchorFrame: anchor,
      gap: gapSize,
      cause,
    })
    const adjusted = plan.final_settled_frame
    const requestedInside = !anchorWorkArea || frameInsideWorkArea(requested, anchorWorkArea)
    const adjustedInside = !anchorWorkArea || frameInsideWorkArea(adjusted, anchorWorkArea)
    const overlap = frameOverlapArea(adjusted, anchor)
    const requestedOverlap = frameOverlapArea(requested, anchor)
    return {
      index,
      placement,
      requested,
      adjusted,
      requestedInside,
      adjustedInside,
      overlap,
      requestedOverlap,
    }
  })

  const clean = candidates.filter((candidate) => candidate.adjustedInside && candidate.overlap === 0)
  const cleanSide = clean.filter((candidate) => candidate.placement === 'right' || candidate.placement === 'left')
  const requestedClean = clean.filter((candidate) => candidate.requestedInside && candidate.requestedOverlap === 0)
  const requestedCleanSide = cleanSide.filter((candidate) => candidate.requestedInside && candidate.requestedOverlap === 0)
  const pool = requestedCleanSide.length
    ? requestedCleanSide
    : cleanSide.length
      ? cleanSide
      : requestedClean.length
        ? requestedClean
        : clean.length
          ? clean
          : candidates
  const best = [...pool].sort((a, b) => (
    (a.overlap - b.overlap)
    || (Number(!a.requestedInside) - Number(!b.requestedInside))
    || (a.index - b.index)
  ))[0] || candidates[0]

  const requested = best?.requested || cloneFrame([anchor[0] + anchor[2] + gapSize, anchor[1], size[0], size[1]])
  const adjusted = best?.adjusted || shiftFrameIntoWorkArea(requested, anchorWorkArea)
  const finalSettled = cloneFrame(adjusted)
  const displayId = owner?.id ?? owner?.display_id ?? null
  return {
    requested_frame: cloneFrame(requested),
    policy_adjusted_frame: cloneFrame(adjusted),
    final_settled_frame: finalSettled,
    viewport_overflow_policy: policy,
    anchor_frame: cloneFrame(anchor),
    anchor_display_id: displayId == null ? null : String(displayId),
    chosen_placement: best?.placement || placements[0] || 'right',
    cause,
  }
}

export function resizeFrameFromTopLeft(frame, {
  width = null,
  height = null,
  minWidth = 1,
  minHeight = 1,
  maxWidth = Infinity,
  maxHeight = Infinity,
  workArea = null,
} = {}) {
  const source = cloneFrame(frame)
  const nextWidth = width == null
    ? source[2]
    : Math.max(finiteNumber(minWidth, 1), Math.min(finiteNumber(maxWidth, Infinity), positiveNumber(width, source[2])))
  const nextHeight = height == null
    ? source[3]
    : Math.max(finiteNumber(minHeight, 1), Math.min(finiteNumber(maxHeight, Infinity), positiveNumber(height, source[3])))
  return clampFrameToWorkArea([source[0], source[1], nextWidth, nextHeight], { workArea })
}

export function chipFrameForPanelFrame(frame, {
  displays = [],
  fallbackWorkArea = null,
  sourceWidth = null,
  margin = 10,
  minWidth = 180,
  maxWidth = 280,
  height = 38,
} = {}) {
  const source = cloneFrame(frame)
  const area = workAreaForFrameTopLeft(source, displays, fallbackWorkArea) || cloneFrame(source)
  const widthSource = positiveNumber(sourceWidth ?? source[2], minWidth)
  const width = Math.min(maxWidth, Math.max(minWidth, widthSource * 0.42))
  const minX = area[0] + margin
  const minY = area[1] + margin
  const maxX = area[0] + area[2] - width - margin
  const maxY = area[1] + area[3] - height - margin
  return [
    Math.round(clamp(source[0], Math.min(minX, maxX), Math.max(minX, maxX))),
    Math.round(clamp(source[1], Math.min(minY, maxY), Math.max(minY, maxY))),
    Math.round(width),
    Math.round(height),
  ]
}

export function restoredPanelFrameForChip({
  restoreFrame = null,
  chipFrame = [0, 0, 280, 38],
  displays = [],
  fallbackWorkArea = null,
} = {}) {
  const chip = cloneFrame(chipFrame)
  const saved = restoreFrame ? cloneFrame(restoreFrame) : [chip[0], chip[1], 640, 420]
  const chipOwner = displayOwnerForTopLeft(chip, displays)
  const restoreOwner = displayOwnerForTopLeft(saved, displays)
  const desired = chipOwner && restoreOwner && sameDisplay(chipOwner, restoreOwner)
    ? saved
    : [chip[0], chip[1], saved[2], saved[3]]
  const area = workAreaForFrameTopLeft(chip, displays, fallbackWorkArea)
  return clampFrameToWorkArea(desired, { workArea: area })
}
