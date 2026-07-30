function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableValue(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

function interactionObject(object) {
  return {
    id: object.id,
    parentId: object.parentId,
    transform: object.transform,
    visible: object.visible,
  }
}

// Native hit regions and gesture responses depend on interaction descriptors and
// the scene hierarchy, but not on visual resources, materials, or components.
export function sceneInteractionProjectionKey(document, interactions) {
  if (!interactions) return null
  return stableValue({
    interactions,
    objects: document.objects.map(interactionObject),
    rootObjectId: document.rootObjectId,
  })
}

export function prepareRetainedSceneInteractionReplacement({
  document,
  failClosed,
  key,
  leases,
  nextProjectionKey,
  preparations,
  previous,
}) {
  const preparation = { key, previous, state: 'prepared' }
  let commitAttempted = false
  preparations.set(key, preparation)
  return Object.freeze({
    assertCurrent() {
      if (preparation.state !== 'prepared' || preparations.get(key) !== preparation) {
        throw new TypeError('DesktopWorld scene interaction replacement is no longer pending.')
      }
      if (leases.get(key) !== previous) {
        throw new TypeError('DesktopWorld scene interaction base changed before commit.')
      }
      return true
    },
    activationAttempted() { return commitAttempted },
    async activate() {
      this.assertCurrent()
      preparation.state = 'activated'
      return true
    },
    commit(commitOutlet) {
      if (preparation.state !== 'activated' || preparations.get(key) !== preparation) {
        throw new TypeError('DesktopWorld scene interaction replacement is not activated.')
      }
      commitAttempted = true
      commitOutlet()
      previous.document = document
      previous.interactionProjectionKey = nextProjectionKey
      preparation.state = 'committed'
      return true
    },
    async rollback() {
      if (!['prepared', 'activated'].includes(preparation.state)) return false
      preparations.delete(key)
      preparation.state = 'rolled_back'
      return true
    },
    async settle() {
      if (preparation.state !== 'committed') return false
      preparations.delete(key)
      preparation.state = 'settled'
      return true
    },
    async failClosed() {
      preparations.delete(key)
      preparation.state = 'failed_closed'
      return failClosed()
    },
  })
}
