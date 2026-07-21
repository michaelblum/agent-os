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
) {
  const metrics = emptySceneResourceMetrics()
  const reservations = new Map()
  let nextReservation = 0

  const prospectiveMetrics = (excluding = null) => {
    const prospective = { ...metrics }
    for (const [token, reserved] of reservations) {
      if (token !== excluding) accumulateSceneResourceMetrics(prospective, reserved)
    }
    return prospective
  }

  const assertWithinLimits = (prospective) => {
    if (sceneResourceBudgetViolations(prospective, limits).length > 0) {
      throw sceneSegmentResourceError(
        'SCENE_SEGMENT_RESOURCE_BUDGET_EXCEEDED',
        'DesktopWorld scene segment resource budget exceeded.',
      )
    }
    return prospective
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

  const assertCandidate = (candidate) => {
    const prospective = prospectiveMetrics()
    accumulateSceneResourceMetrics(prospective, candidate.resourceMetrics)
    return assertWithinLimits(prospective)
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
      if (reservation !== null && !reservations.delete(reservation)) {
        throw sceneSegmentResourceError(
          'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
          'Scene projection resource reservation is unavailable.',
        )
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
      const prospective = prospectiveMetrics()
      if (mounted.metricsAccounted) accumulateSceneResourceMetrics(prospective, mounted.resourceMetrics, -1)
      accumulateSceneResourceMetrics(prospective, measured.metrics)
      assertWithinLimits(prospective)
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
    reserve(candidate) {
      assertCandidate(candidate)
      const reservation = `scene-resource-reservation-${++nextReservation}`
      reservations.set(reservation, candidate.resourceMetrics)
      return reservation
    },
    remaining(requested = limits) {
      return remainingSceneSegmentResourceBudgets(prospectiveMetrics(), requested, limits)
    },
    snapshot() { return Object.freeze({ ...metrics }) },
    unaccount,
    updateReservation(reservation, candidate) {
      if (!reservations.has(reservation)) {
        throw sceneSegmentResourceError(
          'SCENE_SEGMENT_RESOURCE_ACCOUNTING_FAILED',
          'Scene projection resource reservation is unavailable.',
        )
      }
      const prospective = prospectiveMetrics(reservation)
      accumulateSceneResourceMetrics(prospective, candidate.resourceMetrics)
      assertWithinLimits(prospective)
      reservations.set(reservation, candidate.resourceMetrics)
      return true
    },
  })
}
