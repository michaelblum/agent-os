import * as THREE from '../../vendor/three/three.module.min.js'
import {
  canonicalizeSceneDocument,
  createSceneAnimationController,
  createSceneSignalController,
} from '../../scene/index.js'
import { createSceneAnimationInteractionState } from './scene-animation-interaction-state.js'
import { createDesktopWorldSceneProjection } from './scene-extension-projection.js'
import { createScenePlaybackClock } from './scene-playback-clock.js'

const EXTENSION_IDENTITY_KEYS = Object.freeze(['digest', 'id', 'ownerId', 'sceneAbi', 'threeRevision'])

function cleanupError(errors) {
  const failure = new AggregateError(errors, 'Scene projection admission and cleanup failed.')
  failure.code = 'SCENE_EXTENSION_DISPOSE_FAILED'
  return failure
}

export function sameSceneExtensionReference(left, right) {
  if (left === null || right === null) return left === right
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  return EXTENSION_IDENTITY_KEYS.every((key) => left[key] === right[key])
}

export function disposeDesktopWorldSceneMountedResource(
  mounted,
  { scene, preserveInteractionOrigins = false, onFailure = () => {} } = {},
) {
  const cleanup = mounted.cleanup ??= {
    animations: false,
    interactionVisuals: false,
    projection: false,
    removed: false,
    signals: false,
  }
  const operations = [
    ['removed', () => scene.remove(mounted.projection.object)],
    ['animations', () => mounted.animations.dispose()],
    ['signals', () => mounted.signals.dispose()],
    ['interactionVisuals', () => mounted.interactionVisuals?.dispose()],
    ['projection', () => mounted.projection.dispose()],
  ]
  let failed = false
  for (const [name, operation] of operations) {
    if (cleanup[name]) continue
    try {
      operation()
      cleanup[name] = true
    } catch {
      failed = true
    }
  }
  if (!preserveInteractionOrigins) mounted.interactionOrigins.clear()
  if (failed) onFailure(mounted, 'SCENE_EXTENSION_DISPOSE_FAILED')
  return !failed
}

export function createDesktopWorldSceneMountedResource({
  documentInput,
  extensionReference = null,
  extensionRegistry,
  identity = {},
  key,
  onCleanupFailure = () => {},
  previous = null,
  segmentBudget,
} = {}) {
  const document = canonicalizeSceneDocument(documentInput)
  const preparedProjection = createDesktopWorldSceneProjection({
    budgets: extensionReference ? segmentBudget.remaining() : null,
    THREE,
    document,
    expectedOwner: identity.owner ?? previous?.owner ?? '',
    extensionReference,
    extensionRegistry,
  })
  const projection = preparedProjection.projection
  const interactionState = createSceneAnimationInteractionState(document)
  let animations
  let resourceMetrics
  let resourceMetricsSource
  let signals
  try {
    animations = createSceneAnimationController(document, {
      apply: (binding, value, elapsedMs, progress) => projection.applyAnimation(binding, value, elapsedMs, progress),
      onComplete: (binding, value) => interactionState.complete(binding, value),
    })
    signals = createSceneSignalController(document, {
      apply: (binding, value, input, at) => projection.applySignal(binding, value, input, at),
    })
    const measured = segmentBudget.measure(projection)
    resourceMetrics = measured.metrics
    resourceMetricsSource = measured.source
  } catch (error) {
    const failures = []
    for (const cleanup of [
      () => animations?.dispose(),
      () => signals?.dispose(),
      () => projection.dispose(),
    ]) {
      try { cleanup() } catch (cleanupFailure) { failures.push(cleanupFailure) }
    }
    if (failures.length > 0) {
      onCleanupFailure('SCENE_EXTENSION_DISPOSE_FAILED')
      throw cleanupError([error, ...failures])
    }
    throw error
  }
  projection.object.position.copy(previous?.projection.object.position ?? new THREE.Vector3())
  return {
    key,
    owner: identity.owner ?? previous?.owner ?? '',
    resource: identity.resource ?? previous?.resource ?? key,
    extensionReference: preparedProjection.extension
      ? Object.freeze({
        digest: preparedProjection.extension.digest,
        id: preparedProjection.extension.id,
        ownerId: preparedProjection.extension.ownerId,
        sceneAbi: preparedProjection.extension.sceneAbi,
        threeRevision: preparedProjection.extension.threeRevision,
      })
      : null,
    document,
    projection,
    signals,
    animations,
    interactionState,
    interactionVisuals: null,
    playGeneration: null,
    playClock: createScenePlaybackClock(),
    suspended: previous?.suspended ?? false,
    stageSuspendedApplied: false,
    signalWindowAt: 0,
    signalWindowCount: 0,
    interactionOrigins: previous?.interactionOrigins ?? new Map(),
    metricsAccounted: false,
    resourceMetrics,
    resourceMetricsSource,
  }
}
