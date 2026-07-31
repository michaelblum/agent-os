const MAX_DAMAGE_REGIONS = 8
const MAX_DAMAGE_PADDING = 512

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function rect(value) {
  if (!Array.isArray(value) || value.length < 4) return null
  const result = value.slice(0, 4).map(finite)
  if (result.some((entry) => entry === null) || result[2] <= 0 || result[3] <= 0) return null
  return result
}

function expand(value, padding) {
  return [
    value[0] - padding,
    value[1] - padding,
    value[2] + padding * 2,
    value[3] + padding * 2,
  ]
}

function union(left, right) {
  if (!left) return right ? [...right] : null
  if (!right) return [...left]
  const minX = Math.min(left[0], right[0])
  const minY = Math.min(left[1], right[1])
  const maxX = Math.max(left[0] + left[2], right[0] + right[2])
  const maxY = Math.max(left[1] + left[3], right[1] + right[3])
  return [minX, minY, maxX - minX, maxY - minY]
}

function intersection(left, right) {
  if (!left || !right) return null
  const minX = Math.max(left[0], right[0])
  const minY = Math.max(left[1], right[1])
  const maxX = Math.min(left[0] + left[2], right[0] + right[2])
  const maxY = Math.min(left[1] + left[3], right[1] + right[3])
  return maxX > minX && maxY > minY ? [minX, minY, maxX - minX, maxY - minY] : null
}

function descriptor(value) {
  if (value?.kind === 'full_stage') return Object.freeze({ kind: 'full_stage' })
  if (value?.kind !== 'bounded' || !Array.isArray(value.regions)) return null
  const padding = finite(value.padding ?? 0)
  if (padding === null || padding < 0 || padding > MAX_DAMAGE_PADDING) return null
  const regions = value.regions.slice(0, MAX_DAMAGE_REGIONS).map(rect)
  if (regions.length < 1 || regions.some((entry) => entry === null)) return null
  return Object.freeze({
    kind: 'bounded',
    padding,
    regions: Object.freeze(regions.map((entry) => Object.freeze(entry))),
  })
}

function descriptorBounds(value) {
  if (value?.kind === 'full_stage') return null
  let result = null
  for (const region of value?.regions ?? []) result = union(result, expand(region, value.padding))
  return result
}

function resourceDamage(mounted) {
  if (mounted?.suspended) return null
  if (typeof mounted?.projection?.renderDamage !== 'function') {
    return Object.freeze({ kind: 'full_stage' })
  }
  return descriptor(mounted.projection.renderDamage()) ?? Object.freeze({ kind: 'full_stage' })
}

export function createDesktopWorldRenderDamageTracker() {
  let previous = new Map()
  let segmentBounds = null
  let invalidated = true

  function updateSegment(segment) {
    segmentBounds = rect(segment?.dw_bounds ?? segment?.dwBounds)
    invalidated = true
    previous = new Map()
    return segmentBounds !== null
  }

  function frame(resources) {
    if (!segmentBounds) return Object.freeze({ kind: 'none', damagedPixelPercentage: 0 })
    const current = new Map()
    let fullStage = invalidated
    let globalBounds = null

    for (const [key, mounted] of resources) {
      const value = resourceDamage(mounted)
      if (!value) continue
      current.set(key, value)
      if (value.kind === 'full_stage') fullStage = true
      else globalBounds = union(globalBounds, descriptorBounds(value))
    }
    for (const value of previous.values()) {
      if (value.kind === 'full_stage') fullStage = true
      else globalBounds = union(globalBounds, descriptorBounds(value))
    }

    previous = current
    invalidated = false
    if (fullStage) {
      return Object.freeze({
        damagedPixelPercentage: 100,
        globalBounds: Object.freeze([...segmentBounds]),
        kind: 'full_stage',
        localBounds: Object.freeze([0, 0, segmentBounds[2], segmentBounds[3]]),
      })
    }
    const clipped = intersection(globalBounds, segmentBounds)
    if (!clipped) return Object.freeze({ kind: 'none', damagedPixelPercentage: 0 })
    const localBounds = [
      clipped[0] - segmentBounds[0],
      clipped[1] - segmentBounds[1],
      clipped[2],
      clipped[3],
    ]
    return Object.freeze({
      damagedPixelPercentage: Math.min(
        100,
        (clipped[2] * clipped[3] * 100) / (segmentBounds[2] * segmentBounds[3]),
      ),
      globalBounds: Object.freeze(clipped),
      kind: 'bounded',
      localBounds: Object.freeze(localBounds),
    })
  }

  return Object.freeze({
    frame,
    hasPendingCleanup(resources) {
      if (invalidated) return true
      for (const key of previous.keys()) {
        if (!resources.has(key) || resources.get(key)?.suspended) return true
      }
      return false
    },
    invalidate() {
      invalidated = true
      return true
    },
    snapshot() {
      return Object.freeze({
        invalidated,
        retainedRegions: previous.size,
        segmentBounds: segmentBounds ? Object.freeze([...segmentBounds]) : null,
      })
    },
    updateSegment,
  })
}

export const DESKTOP_WORLD_RENDER_DAMAGE_LIMITS = Object.freeze({
  maxPadding: MAX_DAMAGE_PADDING,
  maxRegions: MAX_DAMAGE_REGIONS,
})
