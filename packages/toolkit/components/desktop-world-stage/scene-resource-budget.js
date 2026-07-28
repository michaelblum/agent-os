const RESOURCE_METRIC_KEYS = Object.freeze([
  'drawCalls',
  'geometryBytes',
  'objects',
  'resources',
  'textureBytes',
  'triangles',
  'workingBytes',
])

const RESOURCE_LIMIT_KEYS = Object.freeze([
  ['drawCalls', 'maxDrawCalls'],
  ['objects', 'maxObjects'],
  ['resources', 'maxResources'],
  ['textureBytes', 'maxTextureBytes'],
  ['triangles', 'maxTriangles'],
  ['workingBytes', 'maxWorkingBytes'],
])

export const DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS = Object.freeze({
  maxDrawCalls: 2048,
  maxObjects: 1024,
  maxResources: 1024,
  maxTextureBytes: 256 * 1024 * 1024,
  maxTriangles: 2_000_000,
  maxWorkingBytes: 256 * 1024 * 1024,
})

// Atomic replacement keeps the old projection alive until the candidate commits.
// Bound that short-lived overlap without increasing the steady-state allowance.
function replacementResourceLimits(limits) {
  return Object.freeze(Object.fromEntries(RESOURCE_LIMIT_KEYS.map(([, limitKey]) => {
    const value = Number(limits?.[limitKey])
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 2) {
      throw new TypeError(`Scene segment budget ${limitKey} cannot provide bounded replacement headroom.`)
    }
    return [limitKey, value * 2]
  })))
}

export function emptySceneResourceMetrics() {
  return {
    drawCalls: 0,
    geometryBytes: 0,
    objects: 0,
    resources: 0,
    textureBytes: 0,
    triangles: 0,
    workingBytes: 0,
  }
}

export function normalizeSceneProjectionResourceMetrics(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Scene projection resource metrics are unavailable.')
  }
  const metrics = emptySceneResourceMetrics()
  for (const key of RESOURCE_METRIC_KEYS) {
    const value = Number(input[key])
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Scene projection resource metric ${key} must be a non-negative safe integer.`)
    }
    metrics[key] = value
  }
  return Object.freeze(metrics)
}

export function accumulateSceneResourceMetrics(target, metrics, direction = 1) {
  for (const key of RESOURCE_METRIC_KEYS) target[key] += direction * metrics[key]
  return target
}

export function sceneResourceBudgetViolations(
  metrics,
  limits = DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
) {
  const violations = []
  for (const [metricKey, limitKey] of RESOURCE_LIMIT_KEYS) {
    if (metrics[metricKey] > limits[limitKey]) {
      violations.push(Object.freeze({ metric: metricKey, observed: metrics[metricKey], limit: limits[limitKey] }))
    }
  }
  return violations
}

export function remainingSceneSegmentResourceBudgets(
  metrics,
  requested = DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  limits = DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
) {
  const normalized = normalizeSceneProjectionResourceMetrics(metrics)
  const budgets = {}
  for (const [metricKey, limitKey] of RESOURCE_LIMIT_KEYS) {
    const requestedLimit = Number(requested?.[limitKey])
    const hostLimit = Number(limits?.[limitKey])
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 0) {
      throw new TypeError(`Scene projection budget ${limitKey} must be a non-negative safe integer.`)
    }
    if (!Number.isSafeInteger(hostLimit) || hostLimit < 0) {
      throw new TypeError(`Scene segment budget ${limitKey} must be a non-negative safe integer.`)
    }
    budgets[limitKey] = Math.min(requestedLimit, Math.max(0, hostLimit - normalized[metricKey]))
  }
  return Object.freeze(budgets)
}

export function evaluateSceneSegmentResourceBudget(
  projections,
  limits = DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
) {
  if (!Array.isArray(projections)) throw new TypeError('Scene segment resource projections must be an array.')
  const metrics = emptySceneResourceMetrics()
  for (const projection of projections) {
    accumulateSceneResourceMetrics(metrics, normalizeSceneProjectionResourceMetrics(projection))
  }
  const violations = sceneResourceBudgetViolations(metrics, limits)
  return Object.freeze({
    ok: violations.length === 0,
    metrics: Object.freeze(metrics),
    violations: Object.freeze(violations),
  })
}

function sceneSegmentResourceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function createSceneSegmentResourceBudget(
  limits = DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  replacementLimits = replacementResourceLimits(limits),
) {
  const metrics = emptySceneResourceMetrics()
  const reservations = new Map()
  let nextReservation = 0

  const actualMetrics = (override = null) => {
    const prospective = { ...metrics }
    if (override?.mounted?.metricsAccounted) {
      accumulateSceneResourceMetrics(prospective, override.mounted.resourceMetrics, -1)
      accumulateSceneResourceMetrics(prospective, override.resourceMetrics)
    }
    return prospective
  }

  const mountedMetrics = (mounted, override = null) => {
    if (!mounted?.metricsAccounted) return null
    return override?.mounted === mounted ? override.resourceMetrics : mounted.resourceMetrics
  }

  const committedMetrics = (excluding = null, override = null) => {
    const prospective = actualMetrics(override)
    for (const [token, reserved] of reservations) {
      if (token === excluding) continue
      const replaced = mountedMetrics(reserved.previous, override)
      if (replaced) accumulateSceneResourceMetrics(prospective, replaced, -1)
      accumulateSceneResourceMetrics(prospective, reserved.resourceMetrics)
    }
    return prospective
  }

  const transientMetrics = (excluding = null, override = null) => {
    const prospective = actualMetrics(override)
    for (const [token, reserved] of reservations) {
      if (token !== excluding) accumulateSceneResourceMetrics(prospective, reserved.resourceMetrics)
    }
    return prospective
  }

  const assertWithinLimits = (prospective, effectiveLimits = limits) => {
    if (sceneResourceBudgetViolations(prospective, effectiveLimits).length > 0) {
      throw sceneSegmentResourceError(
        'SCENE_SEGMENT_RESOURCE_BUDGET_EXCEEDED',
        'DesktopWorld scene segment resource budget exceeded.',
      )
    }
    return prospective
  }

  const assertPreviousAvailable = (previous, excluding = null) => {
    if (previous == null) return
    if (!previous?.metricsAccounted) {
      throw sceneSegmentResourceError(
        'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
        'Scene replacement base resource metrics are unavailable.',
      )
    }
    for (const [token, reserved] of reservations) {
      if (token !== excluding && reserved.previous === previous) {
        throw sceneSegmentResourceError(
          'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
          'Scene replacement base already has a resource reservation.',
        )
      }
    }
  }

  const assertCandidate = (candidate, previous = null, excluding = null) => {
    assertPreviousAvailable(previous, excluding)
    const committed = committedMetrics(excluding)
    const replaced = mountedMetrics(previous)
    if (replaced) accumulateSceneResourceMetrics(committed, replaced, -1)
    accumulateSceneResourceMetrics(committed, candidate.resourceMetrics)
    assertWithinLimits(committed)

    const transient = transientMetrics(excluding)
    accumulateSceneResourceMetrics(transient, candidate.resourceMetrics)
    assertWithinLimits(transient, replacementLimits)
    return committed
  }

  const measure = (projection) => {
    if (typeof projection?.resourceMetrics !== 'function') {
      throw sceneSegmentResourceError(
        'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
        'Scene projection resource metrics are unavailable.',
      )
    }
    try {
      const source = projection.resourceMetrics()
      return { metrics: normalizeSceneProjectionResourceMetrics(source), source }
    } catch {
      throw sceneSegmentResourceError(
        'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
        'Scene projection resource metrics are invalid.',
      )
    }
  }

  const unaccount = (mounted) => {
    if (!mounted?.metricsAccounted) return false
    accumulateSceneResourceMetrics(metrics, mounted.resourceMetrics, -1)
    mounted.metricsAccounted = false
    return true
  }

  return Object.freeze({
    assertCandidate,
    commit(mounted, previous = null, reservation = null) {
      if (reservation !== null) {
        const reserved = reservations.get(reservation)
        if (!reserved || (reserved.previous ?? null) !== (previous ?? null)) {
          throw sceneSegmentResourceError(
            'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
            'Scene projection resource reservation does not match its replacement base.',
          )
        }
        reservations.delete(reservation)
      }
      unaccount(previous)
      accumulateSceneResourceMetrics(metrics, mounted.resourceMetrics)
      mounted.metricsAccounted = true
    },
    measure,
    refresh(mounted) {
      let measured
      try {
        measured = measure(mounted.projection)
      } catch (error) {
        throw error
      }
      if (measured.source === mounted.resourceMetricsSource) return false
      const override = { mounted, resourceMetrics: measured.metrics }
      assertWithinLimits(committedMetrics(null, override))
      assertWithinLimits(transientMetrics(null, override), replacementLimits)
      unaccount(mounted)
      accumulateSceneResourceMetrics(metrics, measured.metrics)
      mounted.metricsAccounted = true
      mounted.resourceMetrics = measured.metrics
      mounted.resourceMetricsSource = measured.source
      return true
    },
    releaseReservation(reservation) {
      return reservations.delete(reservation)
    },
    reserve(candidate, previous = null) {
      assertCandidate(candidate, previous)
      const reservation = `scene-resource-reservation-${++nextReservation}`
      reservations.set(reservation, { previous: previous ?? null, resourceMetrics: candidate.resourceMetrics })
      return reservation
    },
    remaining(requested = limits, previous = null) {
      assertPreviousAvailable(previous)
      const committed = committedMetrics()
      const replaced = mountedMetrics(previous)
      if (replaced) accumulateSceneResourceMetrics(committed, replaced, -1)
      const steady = remainingSceneSegmentResourceBudgets(committed, requested, limits)
      const transient = remainingSceneSegmentResourceBudgets(
        transientMetrics(),
        requested,
        replacementLimits,
      )
      return Object.freeze(Object.fromEntries(RESOURCE_LIMIT_KEYS.map(([, limitKey]) => [
        limitKey,
        Math.min(steady[limitKey], transient[limitKey]),
      ])))
    },
    snapshot() { return Object.freeze({ ...metrics }) },
    unaccount,
    updateReservation(reservation, candidate) {
      const reserved = reservations.get(reservation)
      if (!reserved) {
        throw sceneSegmentResourceError(
          'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
          'Scene projection resource reservation is unavailable.',
        )
      }
      assertCandidate(candidate, reserved.previous, reservation)
      reservations.set(reservation, { ...reserved, resourceMetrics: candidate.resourceMetrics })
      return true
    },
  })
}
