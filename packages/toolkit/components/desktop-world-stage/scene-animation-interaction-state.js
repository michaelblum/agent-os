import {
  canonicalizeSceneDocument,
  compileSceneAnimationBindings,
} from '../../scene/index.js'

const SPATIAL_TARGETS = Object.freeze({
  'position.x': ['position', 0],
  'position.y': ['position', 1],
  'rotation.z': ['rotation', 2],
  'scale.x': ['scale', 0],
  'scale.y': ['scale', 1],
})

export function createSceneAnimationInteractionState(documentInput) {
  let document = canonicalizeSceneDocument(documentInput)
  const spatialBindingIds = new Set(compileSceneAnimationBindings(document).bindings
    .filter((binding) => binding.playback === 'once' && SPATIAL_TARGETS[binding.target])
    .map((binding) => binding.id))
  const completedBindingIds = new Set()
  let dirty = false

  function object(objectId) {
    return document.objects.find((entry) => entry.id === objectId) ?? null
  }

  return Object.freeze({
    complete(binding, value) {
      const target = SPATIAL_TARGETS[binding?.target]
      const descriptor = object(binding?.objectId)
      if (
        !target
        || !descriptor
        || !Number.isFinite(value)
        || binding?.playback !== 'once'
        || !spatialBindingIds.has(binding.id)
      ) return false
      const [property, index] = target
      descriptor.transform[property][index] = value
      completedBindingIds.add(binding.id)
      dirty = completedBindingIds.size === spatialBindingIds.size
      return true
    },
    document() {
      return document
    },
    reset(nextDocument) {
      document = canonicalizeSceneDocument(nextDocument)
      completedBindingIds.clear()
      dirty = false
      return document
    },
    hasSpatialAnimation() {
      return spatialBindingIds.size > 0
    },
    setObjectPosition(objectId, position) {
      const descriptor = object(objectId)
      if (!descriptor || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) {
        return false
      }
      descriptor.transform.position = [...position]
      dirty = true
      return true
    },
    takeDirty() {
      const value = dirty
      dirty = false
      return value
    },
  })
}
