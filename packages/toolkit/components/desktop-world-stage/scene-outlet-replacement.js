function sceneOutletReplacementError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export function prepareDesktopWorldSceneOutletReplacement({
  addToScene,
  createCandidate,
  faultSceneSegment,
  key,
  pendingResourceKeys,
  previous = null,
  reconcileRenderLoop,
  resources,
  retireMounted,
  segmentBudget,
  stageSuspended,
} = {}) {
  if (
    typeof addToScene !== 'function'
    || typeof createCandidate !== 'function'
    || typeof faultSceneSegment !== 'function'
    || typeof reconcileRenderLoop !== 'function'
    || typeof retireMounted !== 'function'
    || typeof stageSuspended !== 'function'
    || typeof key !== 'string'
    || !(pendingResourceKeys instanceof Set)
    || !(resources instanceof Map)
    || typeof segmentBudget?.remaining !== 'function'
  ) {
    throw new TypeError('DesktopWorld scene outlet replacement dependencies are invalid.')
  }

  const candidate = createCandidate(segmentBudget.remaining(undefined, previous))
  let resourceReservation = null
  try {
    resourceReservation = segmentBudget.reserve(candidate, previous)
    if (!previous) pendingResourceKeys.add(key)
  } catch (error) {
    if (!retireMounted(candidate, { preserveInteractionOrigins: true })) {
      faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', candidate)
      throw new AggregateError([error], 'Scene replacement admission and cleanup failed.')
    }
    throw error
  }
  let state = 'prepared'

  const releaseReservation = () => {
    if (resourceReservation !== null) {
      segmentBudget.releaseReservation(resourceReservation)
      resourceReservation = null
    }
    if (!previous) pendingResourceKeys.delete(key)
  }

  return Object.freeze({
    document: candidate.document,
    assertCurrent() {
      if (state !== 'prepared') throw new TypeError('Scene replacement is no longer pending.')
      if ((resources.get(key) ?? null) !== previous) throw new TypeError('Scene replacement base changed before commit.')
      return true
    },
    commit() {
      this.assertCurrent()
      candidate.projection.activate?.()
      const suspended = stageSuspended()
      if (candidate.suspended || suspended) {
        if (candidate.projection.suspend() === false) {
          throw sceneOutletReplacementError(
            'SCENE_EXTENSION_SUSPEND_FAILED',
            'Scene projection rejected its initial suspended state.',
          )
        }
      }
      candidate.stageSuspendedApplied = suspended
      const measured = segmentBudget.measure(candidate.projection)
      candidate.resourceMetrics = measured.metrics
      candidate.resourceMetricsSource = measured.source
      segmentBudget.updateReservation(resourceReservation, candidate)
      addToScene(candidate.projection.object)
      if (previous && !retireMounted(previous, { preserveInteractionOrigins: true })) {
        const candidateClean = retireMounted(candidate, { preserveInteractionOrigins: true })
        releaseReservation()
        state = 'failed_closed'
        faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', previous)
        const failure = sceneOutletReplacementError(
          'SCENE_EXTENSION_DISPOSE_FAILED',
          'Scene replacement cleanup failed.',
        )
        if (!candidateClean) throw new AggregateError([failure], 'Scene replacement cleanup failed closed.')
        throw failure
      }
      segmentBudget.commit(candidate, previous, resourceReservation)
      resourceReservation = null
      if (!previous) pendingResourceKeys.delete(key)
      resources.set(key, candidate)
      state = 'committed'
      reconcileRenderLoop()
      return true
    },
    rollback() {
      if (state !== 'prepared') return false
      if (!retireMounted(candidate, { preserveInteractionOrigins: true })) {
        releaseReservation()
        state = 'rollback_failed'
        faultSceneSegment('SCENE_EXTENSION_DISPOSE_FAILED', candidate)
        throw sceneOutletReplacementError(
          'SCENE_EXTENSION_DISPOSE_FAILED',
          'Scene replacement rollback cleanup failed.',
        )
      }
      releaseReservation()
      state = 'rolled_back'
      return true
    },
  })
}
