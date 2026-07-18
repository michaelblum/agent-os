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

  async function apply(message) {
    const payload = message?.payload ?? {}
    const key = payload.lease_key
    const operation = payload.operation ?? {}
    const op = operationName(message)
    const previousOutlet = outlet.configuration(key)
    const previous = {
      configuration: interactions.configuration(key),
      document: previousOutlet?.document ?? null,
      suspended: previousOutlet?.suspended ?? false,
    }

    try {
      if (op === 'transact') interactions.cancel(key, 'resource_changed')
      if (op === 'suspend') await interactions.suspend(key)
      if (op === 'remove' || op === 'close' || op === 'release') {
        await interactions.release(key, payload.reason ?? 'resource_removed')
      }

      const applied = outlet.apply(message)
      if (op === 'mount' || op === 'transact') {
        await interactions.reconcile({
          key,
          owner: payload.owner,
          resource: payload.resource,
          document: outlet.document(key),
          interactions: op === 'mount' ? operation.interactions ?? null : operation.interactions,
        })
      } else if (op === 'resume') {
        await interactions.resume(key)
      }
      return { applied, op }
    } catch (error) {
      if (['mount', 'transact', 'resume'].includes(op)) {
        return rollback(key, previous, error)
      }
      throw error
    }
  }

  return Object.freeze({ apply })
}
