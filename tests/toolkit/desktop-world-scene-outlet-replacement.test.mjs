import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareDesktopWorldSceneOutletReplacement,
} from '../../packages/toolkit/components/desktop-world-stage/scene-outlet-replacement.js'
import {
  DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS,
  createSceneSegmentResourceBudget,
} from '../../packages/toolkit/components/desktop-world-stage/scene-resource-budget.js'

function projection(resourceMetrics, activatedMetrics = resourceMetrics) {
  let measured = Object.freeze({ ...resourceMetrics })
  return {
    document: { id: 'companion/main' },
    metricsAccounted: false,
    projection: {
      object: {},
      activate() { measured = Object.freeze({ ...activatedMetrics }) },
      resourceMetrics() { return measured },
      suspend() { return true },
    },
    resourceMetrics: measured,
    resourceMetricsSource: measured,
    stageSuspendedApplied: false,
    suspended: false,
  }
}

function fixture({ limits, previous, retireMounted = () => true } = {}) {
  const budget = createSceneSegmentResourceBudget(limits)
  if (previous) budget.commit(previous)
  const resources = new Map(previous ? [['companion/main', previous]] : [])
  const pendingResourceKeys = new Set()
  const added = []
  const faults = []
  return {
    added,
    budget,
    faults,
    prepare(candidate, captureBudgets = () => {}) {
      return prepareDesktopWorldSceneOutletReplacement({
        addToScene: (object) => added.push(object),
        createCandidate: (budgets) => {
          captureBudgets(budgets)
          return candidate
        },
        faultSceneSegment: (code, mounted) => faults.push({ code, mounted }),
        key: 'companion/main',
        pendingResourceKeys,
        previous: resources.get('companion/main') ?? null,
        reconcileRenderLoop: () => {},
        resources,
        retireMounted,
        segmentBudget: budget,
        stageSuspended: () => false,
      })
    },
    resources,
  }
}

test('outlet replacement commits a rich projection with post-commit headroom', () => {
  const richMetrics = {
    drawCalls: 209,
    geometryBytes: 0,
    objects: 397,
    resources: 536,
    textureBytes: 0,
    triangles: 20_948,
    workingBytes: 0,
  }
  const previous = projection(richMetrics)
  const retired = []
  const subject = fixture({
    previous,
    retireMounted: (mounted) => {
      retired.push(mounted)
      return true
    },
  })
  const candidate = projection(richMetrics)
  let admittedBudgets = null
  const replacement = subject.prepare(candidate, (budgets) => { admittedBudgets = budgets })

  assert.equal(admittedBudgets.maxResources, DESKTOP_WORLD_SCENE_SEGMENT_RESOURCE_LIMITS.maxResources)
  assert.equal(replacement.commit(), true)
  assert.equal(subject.resources.get('companion/main'), candidate)
  assert.deepEqual(retired, [previous])
  assert.deepEqual(subject.added, [candidate.projection.object])
  assert.equal(previous.metricsAccounted, false)
  assert.equal(candidate.metricsAccounted, true)
  assert.equal(subject.budget.snapshot().resources, richMetrics.resources)
})

test('outlet replacement releases failed activation accounting before retry', () => {
  const limits = {
    maxDrawCalls: 4,
    maxObjects: 4,
    maxResources: 4,
    maxTextureBytes: 400,
    maxTriangles: 400,
    maxWorkingBytes: 400,
  }
  const metrics = {
    drawCalls: 2,
    geometryBytes: 20,
    objects: 2,
    resources: 2,
    textureBytes: 20,
    triangles: 20,
    workingBytes: 20,
  }
  const overBudget = { ...metrics, drawCalls: 5, objects: 5, resources: 5 }
  const previous = projection(metrics)
  const retired = []
  const subject = fixture({
    limits,
    previous,
    retireMounted: (mounted) => {
      retired.push(mounted)
      return true
    },
  })
  const failedCandidate = projection(metrics, overBudget)
  const failedReplacement = subject.prepare(failedCandidate)

  assert.throws(() => failedReplacement.commit(), /segment resource budget exceeded/u)
  assert.equal(failedReplacement.rollback(), true)
  assert.equal(subject.resources.get('companion/main'), previous)
  assert.deepEqual(retired, [failedCandidate])

  const retryCandidate = projection(metrics)
  const retry = subject.prepare(retryCandidate)
  assert.equal(retry.commit(), true)
  assert.equal(subject.resources.get('companion/main'), retryCandidate)
  assert.deepEqual(retired, [failedCandidate, previous])
  assert.equal(subject.budget.snapshot().resources, metrics.resources)
})

test('outlet rollback failures retain cleanup ownership without stale reservations', () => {
  const metrics = {
    drawCalls: 2,
    geometryBytes: 20,
    objects: 2,
    resources: 2,
    textureBytes: 20,
    triangles: 20,
    workingBytes: 20,
  }
  const previous = projection(metrics)
  const cleanupFailures = new Set()
  const subject = fixture({
    previous,
    retireMounted: (mounted) => {
      cleanupFailures.add(mounted)
      return false
    },
  })
  const candidate = projection(metrics)
  const replacement = subject.prepare(candidate)

  assert.throws(() => replacement.rollback(), /rollback cleanup failed/u)
  assert.deepEqual([...cleanupFailures], [candidate])
  assert.deepEqual(subject.faults, [{ code: 'SCENE_EXTENSION_DISPOSE_FAILED', mounted: candidate }])
  const later = projection(metrics)
  const reservation = subject.budget.reserve(later, previous)
  assert.equal(subject.budget.releaseReservation(reservation), true)
})
