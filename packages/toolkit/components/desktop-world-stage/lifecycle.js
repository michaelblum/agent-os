const LIFECYCLE_ACTIONS = new Set(['resume', 'suspend'])

function requireFunction(value, label) {
  if (typeof value !== 'function') {
    throw new TypeError(`DesktopWorld stage fault retirement requires ${label}.`)
  }
}

export function createDesktopWorldStageFaultRetirement({
  cleanup,
  publish,
  record,
  schedule,
} = {}) {
  requireFunction(cleanup, 'cleanup')
  requireFunction(publish, 'fault publication')
  requireFunction(record, 'fault recording')
  requireFunction(schedule, 'serialized scheduling')

  let retirement = null
  return function retireDesktopWorldStage(fault) {
    if (retirement) return retirement
    if (typeof fault?.code !== 'string' || fault.code.length === 0) {
      throw new TypeError('DesktopWorld stage fault retirement requires a code.')
    }

    let resolveRetirement
    let rejectRetirement
    retirement = new Promise((resolve, reject) => {
      resolveRetirement = resolve
      rejectRetirement = reject
    })

    const failures = []
    try { record(fault) } catch (error) { failures.push(error) }

    let cleanupResult
    try {
      cleanupResult = Promise.resolve(schedule(() => cleanup(fault)))
    } catch (error) {
      cleanupResult = Promise.reject(error)
    }

    try { publish(fault) } catch (error) { failures.push(error) }

    void cleanupResult.then(
      () => {
        if (failures.length > 0) {
          rejectRetirement(new AggregateError(failures, 'DesktopWorld stage fault retirement failed.'))
          return
        }
        resolveRetirement(true)
      },
      (error) => {
        failures.push(error)
        rejectRetirement(new AggregateError(failures, 'DesktopWorld stage fault retirement failed.'))
      },
    )
    return retirement
  }
}

export function createDesktopWorldStageStartupGate(readLifecycle) {
  requireFunction(readLifecycle, 'lifecycle state')
  const admitted = readLifecycle()
  return function isDesktopWorldStageStartupCurrent() {
    const current = readLifecycle()
    return current?.state === 'active'
      && current?.generation === admitted?.generation
  }
}

export function handleDesktopWorldStageLifecycle(message, complete, outlet = null) {
  if (message?.type !== 'lifecycle' || !LIFECYCLE_ACTIONS.has(message.action)) {
    return false
  }
  if (typeof complete !== 'function') {
    throw new TypeError('desktop world lifecycle completion requires a callback')
  }
  const transition = outlet?.[message.action]
  const result = transition?.call(outlet)
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).then((settled) => {
      if (settled === false) throw new Error(`desktop world lifecycle ${message.action} was rejected`)
      complete(message.action)
      return true
    })
  }
  if (result === false) {
    throw new Error(`desktop world lifecycle ${message.action} was rejected`)
  }
  complete(message.action)
  return true
}

export function createDesktopWorldStageDisposer({
  desktopFrameClient,
  devtools,
  interactions,
  operations,
  outlet,
  surface,
} = {}) {
  let disposal = null
  return function disposeDesktopWorldStage() {
    if (disposal) return disposal
    disposal = (async () => {
      const failures = []
      try { await operations?.failClosed('stage_disposed') } catch (error) { failures.push(error) }
      for (const operation of [
        () => surface?.stop(),
        () => devtools?.dispose(),
        () => interactions?.cancelAll('stage_disposed'),
      ]) {
        try { operation() } catch (error) { failures.push(error) }
      }
      try {
        if (outlet?.dispose() === false) failures.push(new Error('DesktopWorld scene outlet cleanup was not settled.'))
      } catch (error) { failures.push(error) }
      try { desktopFrameClient?.dispose() } catch (error) { failures.push(error) }
      try { await interactions?.dispose('stage_disposed') } catch (error) { failures.push(error) }
      if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld stage disposal failed.')
      return true
    })()
    return disposal
  }
}
