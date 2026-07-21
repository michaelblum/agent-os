function operationName(message) {
  return message?.payload?.operation?.op
    ?? (message?.type === 'desktop_world_stage.scene.release' ? 'release' : 'unknown')
}

const MAX_PENDING_REPLACEMENTS = 8

function candidateFingerprint(document, extension) {
  const source = JSON.stringify({ document, extension: extension ?? null })
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${source.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createDesktopWorldSceneOperationCoordinator({ outlet, interactions } = {}) {
  if (!outlet || !interactions) {
    throw new TypeError('DesktopWorld scene operation coordinator requires outlet and interaction runtimes.')
  }
  const pendingReplacements = new Map()
  let directReplacementGeneration = 0
  let aggregateClosed = false

  async function retireResource(key, reason = 'resource_removed') {
    const failures = []
    let applied = false
    try {
      applied = await interactions.release(key, reason) || applied
    } catch (error) {
      failures.push(error)
    }
    try {
      applied = outlet.apply({
        type: 'desktop_world_stage.scene.release',
        payload: { lease_key: key, reason },
      }) || applied
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'DesktopWorld scene resource retirement failed.')
    }
    return applied
  }

  async function failClosed(reason = 'stage_fault') {
    if (aggregateClosed) return false
    aggregateClosed = true
    const failures = []
    for (const pending of pendingReplacements.values()) {
      if (pending.interactionReplacement.activationAttempted()) {
        try { await pending.interactionReplacement.failClosed() } catch (error) { failures.push(error) }
        try { pending.outletReplacement.rollback() } catch (error) { failures.push(error) }
      } else {
        try { await pending.interactionReplacement.rollback() } catch (error) { failures.push(error) }
        try { pending.outletReplacement.rollback() } catch (error) { failures.push(error) }
      }
    }
    pendingReplacements.clear()
    try { interactions.cancelAll(reason) } catch (error) { failures.push(error) }
    try { await interactions.dispose(reason) } catch (error) { failures.push(error) }
    try { outlet.releaseAll() } catch (error) { failures.push(error) }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'DesktopWorld scene stage failed closed with cleanup errors.')
    }
    return true
  }

  async function transitionStage(action) {
    if (aggregateClosed) throw new Error('DesktopWorld scene operation coordinator is closed.')
    try {
      if (action === 'suspend') {
        await interactions.suspendStage()
        if (outlet.suspend() === false) throw new Error('DesktopWorld scene outlet rejected stage suspension.')
      } else {
        if (outlet.resume() === false) throw new Error('DesktopWorld scene outlet rejected stage resume.')
        await interactions.resumeStage()
      }
      return true
    } catch (error) {
      try {
        await failClosed(`stage_${action}_failed`)
      } catch (retirementError) {
        throw new AggregateError([error, retirementError], `DesktopWorld stage ${action} failed closed with cleanup errors.`)
      }
      throw error
    }
  }

  async function restore(key, previous) {
    await interactions.release(key, 'resource_changed')
    if (!previous.document) {
      outlet.apply({ type: 'desktop_world_stage.scene.release', payload: { lease_key: key } })
      return
    }

    outlet.apply({
      type: 'desktop_world_stage.scene.operation',
      payload: {
        lease_key: key,
        owner: previous.configuration?.owner,
        resource: previous.configuration?.resource,
        operation: {
          op: 'mount',
          document: previous.document,
          ...(previous.extension ? { extension: previous.extension } : {}),
        },
      },
    })
    if (previous.configuration) {
      await interactions.mount({
        key,
        owner: previous.configuration.owner,
        resource: previous.configuration.resource,
        document: previous.document,
        interactions: previous.configuration.interactions,
      })
    }
    if (previous.configuration?.suspended) await interactions.suspend(key)
    if (previous.suspended) {
      outlet.apply({
        type: 'desktop_world_stage.scene.operation',
        payload: { lease_key: key, operation: { op: 'suspend' } },
      })
    }
  }

  async function rollback(key, previous, cause) {
    try {
      await restore(key, previous)
    } catch (rollbackError) {
      await interactions.release(key, 'resource_removed')
      outlet.apply({ type: 'desktop_world_stage.scene.release', payload: { lease_key: key } })
      throw new AggregateError([cause, rollbackError], 'DesktopWorld scene activation and rollback both failed.')
    }
    throw cause
  }

  async function prepareReplacement(operationId, message, op) {
    if (aggregateClosed) throw new Error('DesktopWorld scene operation coordinator is closed.')
    if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 128) {
      throw new TypeError('DesktopWorld scene replacement operation ID is invalid.')
    }
    const payload = message?.payload ?? {}
    const operation = payload.operation ?? {}
    if (pendingReplacements.has(operationId)
      || [...pendingReplacements.values()].some((entry) => entry.key === payload.lease_key)) {
      throw new TypeError('DesktopWorld scene replacement is already pending.')
    }
    if (pendingReplacements.size >= MAX_PENDING_REPLACEMENTS) {
      throw new RangeError('DesktopWorld scene replacement preparation budget exceeded.')
    }
    const outletReplacement = outlet.prepareReplacement(message)
    let interactionReplacement = null
    try {
      interactionReplacement = await interactions.prepareReplacement({
        key: payload.lease_key,
        owner: payload.owner,
        resource: payload.resource,
        document: outletReplacement.document,
        interactions: op === 'mount' ? operation.interactions ?? null : operation.interactions,
      })
      outletReplacement.assertCurrent()
      interactionReplacement.assertCurrent()
    } catch (error) {
      const rollbackFailures = []
      if (interactionReplacement) {
        try { await interactionReplacement.rollback() } catch (rollbackError) { rollbackFailures.push(rollbackError) }
      }
      try { outletReplacement.rollback() } catch (rollbackError) { rollbackFailures.push(rollbackError) }
      if (rollbackFailures.length > 0) {
        throw new AggregateError([error, ...rollbackFailures], 'DesktopWorld scene replacement and rollback both failed.')
      }
      throw error
    }
    const fingerprint = candidateFingerprint(outletReplacement.document, operation.extension ?? null)
    pendingReplacements.set(operationId, {
      fingerprint,
      interactionReplacement,
      key: payload.lease_key,
      op,
      outletReplacement,
    })
    return { applied: true, candidateFingerprint: fingerprint, op }
  }

  async function commitReplacement(operationId) {
    const pending = pendingReplacements.get(operationId)
    if (!pending) throw new TypeError('DesktopWorld scene replacement preparation is unavailable.')
    let committed = false
    try {
      pending.outletReplacement.assertCurrent()
      pending.interactionReplacement.assertCurrent()
      await pending.interactionReplacement.activate()
      pending.interactionReplacement.commit(() => pending.outletReplacement.commit())
      committed = true
      const settled = await pending.interactionReplacement.settle()
      if (!settled) throw new Error('DesktopWorld scene input-region settlement failed.')
      return { applied: true, candidateFingerprint: pending.fingerprint, op: pending.op }
    } catch (error) {
      const failures = []
      if (committed || pending.interactionReplacement.activationAttempted()) {
        try { await pending.interactionReplacement.failClosed() } catch (failure) { failures.push(failure) }
        try { pending.outletReplacement.rollback() } catch (failure) { failures.push(failure) }
        try {
          outlet.apply({ type: 'desktop_world_stage.scene.release', payload: { lease_key: pending.key } })
        } catch (failure) {
          failures.push(failure)
        }
      } else {
        try { await pending.interactionReplacement.rollback() } catch (failure) { failures.push(failure) }
        try { pending.outletReplacement.rollback() } catch (failure) { failures.push(failure) }
      }
      if (failures.length > 0) {
        throw new AggregateError([error, ...failures], 'DesktopWorld scene replacement and cleanup both failed.')
      }
      throw error
    } finally {
      pendingReplacements.delete(operationId)
    }
  }

  async function abortReplacement(operationId) {
    const pending = pendingReplacements.get(operationId)
    if (!pending) return { applied: true, candidateFingerprint: null, op: 'abort' }
    const failures = []
    try { await pending.interactionReplacement.rollback() } catch (error) { failures.push(error) }
    try { pending.outletReplacement.rollback() } catch (error) { failures.push(error) }
    pendingReplacements.delete(operationId)
    if (failures.length === 0) {
      return { applied: true, candidateFingerprint: pending.fingerprint, op: pending.op }
    }
    try { await interactions.release(pending.key, 'resource_removed') } catch (error) { failures.push(error) }
    try {
      outlet.apply({ type: 'desktop_world_stage.scene.release', payload: { lease_key: pending.key } })
    } catch (error) {
      failures.push(error)
    }
    throw new AggregateError(failures, 'DesktopWorld scene replacement abort failed closed.')
  }

  async function replace(message, op) {
    const operationId = `direct-${++directReplacementGeneration}`
    await prepareReplacement(operationId, message, op)
    return commitReplacement(operationId)
  }

  async function play(message, key) {
    const generation = outlet.hasInteractionAnimation?.(key)
      ? outlet.nextAnimationGeneration?.(key) ?? null
      : null
    let quiesced = false
    if (Number.isInteger(generation)) {
      quiesced = await interactions.quiesceAnimation(key, generation)
    }

    let applied
    try {
      applied = outlet.apply(message)
    } catch (error) {
      if (!quiesced) throw error
      try {
        await interactions.restoreAnimation(key, generation)
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], 'DesktopWorld scene play and interaction restoration both failed.')
      }
      throw error
    }
    if (!applied && quiesced) {
      try {
        await interactions.restoreAnimation(key, generation)
      } catch (restoreError) {
        throw new AggregateError(
          [new Error('DesktopWorld scene play was not applied.'), restoreError],
          'DesktopWorld scene play rejection and interaction restoration both failed.',
        )
      }
    }
    return { applied, op: 'play' }
  }

  async function apply(message) {
    if (aggregateClosed) throw new Error('DesktopWorld scene operation coordinator is closed.')
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    const op = operationName(message)
    if (op === 'mount' || op === 'transact') return replace(message, op)
    if (op === 'play') return play(message, key)

    const previousOutlet = outlet.configuration(key)
    const previous = {
      configuration: interactions.configuration(key),
      document: previousOutlet?.document ?? null,
      extension: previousOutlet?.extension ?? null,
      suspended: previousOutlet?.suspended ?? false,
    }

    try {
      if (op === 'remove' || op === 'close' || op === 'release') {
        return { applied: await retireResource(key, payload.reason ?? 'resource_removed'), op }
      }

      if (op === 'suspend') await interactions.suspend(key)

      const applied = outlet.apply(message)
      if (op === 'resume') {
        await interactions.resume(key)
      }
      return { applied, op }
    } catch (error) {
      if (op === 'resume') {
        return rollback(key, previous, error)
      }
      if (['signal', 'suspend'].includes(op)) {
        try {
          await retireResource(key, `scene_${op}_failed`)
        } catch (retirementError) {
          throw new AggregateError([error, retirementError], `DesktopWorld scene ${op} failed closed with cleanup errors.`)
        }
      }
      throw error
    }
  }

  return Object.freeze({
    abort: abortReplacement,
    apply,
    commit: commitReplacement,
    failClosed,
    handleInput(message) { return aggregateClosed ? false : interactions.handleInput(message) },
    prepare(operationId, message) {
      const op = operationName(message)
      if (op !== 'mount' && op !== 'transact') {
        throw new TypeError('Only scene mount and transact operations can be prepared.')
      }
      return prepareReplacement(operationId, message, op)
    },
    retire: retireResource,
    resume() { return transitionStage('resume') },
    suspend() { return transitionStage('suspend') },
  })
}
