export async function applyDesktopWorldSceneOperation({ extensionLoader, message, operations }) {
  if (!message || typeof message !== 'object' || !operations || typeof operations.apply !== 'function') {
    throw new TypeError('DesktopWorld scene operation admission is invalid.')
  }
  const operation = message.payload?.operation
  const phase = message.payload?.barrier_phase ?? null
  const operationId = message.payload?.operation_id
  if (phase !== null && !['apply', 'prepare', 'commit', 'abort', 'release'].includes(phase)) {
    throw new TypeError('DesktopWorld scene operation barrier phase is invalid.')
  }
  if (phase !== null && (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 128)) {
    throw new TypeError('DesktopWorld scene operation barrier ID is invalid.')
  }
  if ((phase === null || phase === 'prepare') && operation?.op === 'mount' && operation.extension) {
    if (!extensionLoader || typeof extensionLoader.ensure !== 'function') {
      throw new TypeError('DesktopWorld scene extension loader is unavailable.')
    }
    const expectedOwner = message.payload?.owner
    if (typeof expectedOwner !== 'string' || operation.extension.ownerId !== expectedOwner) {
      const error = new Error('Scene extension owner does not match the scene lease owner.')
      error.code = 'SCENE_EXTENSION_OWNER_MISMATCH'
      throw error
    }
    await extensionLoader.ensure(operation.extension, expectedOwner)
  }
  if (phase === 'prepare') return operations.prepare(operationId, message)
  if (phase === 'apply') return operations.apply(message)
  if (phase === 'commit') return operations.commit(operationId)
  if (phase === 'abort') return operations.abort(operationId)
  if (phase === 'release') {
    await operations.abort(operationId)
    return operations.apply({
      type: 'desktop_world_stage.scene.release',
      payload: { lease_key: message.payload.lease_key, reason: 'segment_failed' },
    })
  }
  return operations.apply(message)
}
