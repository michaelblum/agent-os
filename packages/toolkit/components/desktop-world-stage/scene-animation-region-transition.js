export function createSceneAnimationRegionTransitionRuntime({
  entryFor,
  outlet,
  closeRadialMenu,
  settleRadialMenu,
  retireRegisteredRegions,
  retireIndexedRegions,
  syncRegions,
  prepareReplacement,
  releaseEntry,
} = {}) {
  for (const [name, value] of Object.entries({
    entryFor,
    closeRadialMenu,
    settleRadialMenu,
    retireRegisteredRegions,
    retireIndexedRegions,
    syncRegions,
    prepareReplacement,
    releaseEntry,
  })) {
    if (typeof value !== 'function') {
      throw new TypeError(`DesktopWorld animation-region transitions require ${name}.`)
    }
  }
  if (!outlet) throw new TypeError('DesktopWorld animation-region transitions require a scene outlet.')

  async function quiesce(key, generation) {
    const entry = entryFor(key)
    if (!entry || entry.disposed || !Number.isInteger(generation) || generation < 1) {
      return false
    }
    entry.animationGeneration = generation
    entry.animationQuiesced = true
    entry.animationReady = false
    entry.generation += 1
    entry.controller.cancel('resource_changed')
    closeRadialMenu(key, 'resource_changed')
    await entry.regionSync
    await settleRadialMenu(key)
    try {
      await retireRegisteredRegions(entry)
    } catch (error) {
      entry.regionSyncErrorCode = 'INPUT_REGION_CLEANUP_FAILED'
      throw error
    }
    return true
  }

  async function restore(key, generation) {
    const entry = entryFor(key)
    if (!entry || entry.disposed || entry.animationGeneration !== generation) return false
    entry.animationReady = false
    if (!entry.suspended) {
      try {
        await syncRegions(entry)
      } catch (error) {
        entry.regionSyncErrorCode = 'INPUT_REGION_SYNC_FAILED'
        try {
          await retireIndexedRegions(entry)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'DesktopWorld animation-region restoration and cleanup both failed.',
          )
        }
        throw error
      }
    }
    entry.animationGeneration = null
    entry.animationQuiesced = false
    return true
  }

  async function settle(key, generation) {
    const previous = entryFor(key)
    if (
      !previous
      || previous.disposed
      || !previous.animationQuiesced
      || previous.animationGeneration !== generation
      || outlet.animationGeneration?.(key) !== generation
    ) return false
    previous.animationReady = true
    if (previous.suspended) return false
    const document = outlet.interactionDocument?.(key)
    if (!document) return false

    let replacement = null
    let committed = false
    try {
      replacement = await prepareReplacement({
        key,
        owner: previous.owner,
        resource: previous.resource,
        document,
        interactions: previous.interactions,
        animationGeneration: generation,
      })
      await replacement.activate()
      replacement.commit(() => {})
      committed = true
      const settled = await replacement.settle()
      if (!settled) throw new Error('DesktopWorld animated input-region settlement failed.')
      return true
    } catch (error) {
      try {
        if (committed || replacement?.activationAttempted()) await replacement?.failClosed()
        else if (replacement) await replacement.rollback()
        else await releaseEntry(key, 'resource_removed')
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'DesktopWorld animated input-region settlement and cleanup both failed.',
        )
      }
      throw error
    }
  }

  return Object.freeze({ quiesce, restore, settle })
}
