const LIFECYCLE_ACTIONS = new Set(['resume', 'suspend'])

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

export function createDesktopWorldStageDisposer({ devtools, interactions, operations, outlet, surface } = {}) {
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
      try { await interactions?.dispose('stage_disposed') } catch (error) { failures.push(error) }
      if (failures.length > 0) throw new AggregateError(failures, 'DesktopWorld stage disposal failed.')
      return true
    })()
    return disposal
  }
}
