const LIFECYCLE_ACTIONS = new Set(['resume', 'suspend'])

export function handleDesktopWorldStageLifecycle(message, complete) {
  if (message?.type !== 'lifecycle' || !LIFECYCLE_ACTIONS.has(message.action)) {
    return false
  }
  if (typeof complete !== 'function') {
    throw new TypeError('desktop world lifecycle completion requires a callback')
  }
  complete(message.action)
  return true
}
