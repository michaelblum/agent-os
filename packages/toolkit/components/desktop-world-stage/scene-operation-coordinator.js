function operationName(message) {
  return message?.payload?.operation?.op
    ?? (message?.type === 'desktop_world_stage.scene.release' ? 'release' : 'unknown')
}

export function createDesktopWorldSceneOperationCoordinator({ outlet, interactions } = {}) {
  if (!outlet || !interactions) {
    throw new TypeError('DesktopWorld scene operation coordinator requires outlet and interaction runtimes.')
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
        operation: { op: 'mount', document: previous.document },
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

  async function replace(message, op) {
    const payload = message?.payload ?? {}
    const operation = payload.operation ?? {}
    const outletReplacement = outlet.prepareReplacement(message)
    let interactionReplacement = null
    let committed = false
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
      interactionReplacement.commit(() => outletReplacement.commit())
      committed = true
      const settled = await interactionReplacement.settle()
      if (!settled) throw new Error('DesktopWorld scene input-region settlement failed.')
      return { applied: true, op }
    } catch (error) {
      const rollbackFailures = []
      if (committed) {
        try { await interactionReplacement?.failClosed() } catch (rollbackError) { rollbackFailures.push(rollbackError) }
        try {
          outlet.apply({ type: 'desktop_world_stage.scene.release', payload: { lease_key: payload.lease_key } })
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError)
        }
      } else if (interactionReplacement) {
        try { await interactionReplacement.rollback() } catch (rollbackError) { rollbackFailures.push(rollbackError) }
      }
      if (!committed) {
        try { outletReplacement.rollback() } catch (rollbackError) { rollbackFailures.push(rollbackError) }
      }
      if (rollbackFailures.length > 0) {
        throw new AggregateError([error, ...rollbackFailures], 'DesktopWorld scene replacement and rollback both failed.')
      }
      throw error
    }
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
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    const op = operationName(message)
    if (op === 'mount' || op === 'transact') return replace(message, op)
    if (op === 'play') return play(message, key)

    const previousOutlet = outlet.configuration(key)
    const previous = {
      configuration: interactions.configuration(key),
      document: previousOutlet?.document ?? null,
      suspended: previousOutlet?.suspended ?? false,
    }

    try {
      if (op === 'suspend') await interactions.suspend(key)
      if (op === 'remove' || op === 'close' || op === 'release') {
        await interactions.release(key, payload.reason ?? 'resource_removed')
      }

      const applied = outlet.apply(message)
      if (op === 'resume') {
        await interactions.resume(key)
      }
      return { applied, op }
    } catch (error) {
      if (op === 'resume') {
        return rollback(key, previous, error)
      }
      throw error
    }
  }

  return Object.freeze({
    apply,
    handleInput(message) { return interactions.handleInput(message) },
  })
}
