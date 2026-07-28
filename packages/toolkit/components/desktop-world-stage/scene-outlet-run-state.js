export const DESKTOP_WORLD_SCENE_RENDER_LIMITS = Object.freeze({
  maxDevicePixelRatio: 2,
  maxBackingDimension: 4096,
  maxBackingPixels: 2_097_152,
})

export function sceneResourceCanRun(resourceSuspended, stageHidden, contextLost) {
  return !resourceSuspended && !stageHidden && !contextLost
}

export function sceneStageShouldRender(
  resources,
  stageHidden,
  contextLost,
  stageSuspended = false,
  faulted = false,
) {
  if (stageHidden || contextLost || stageSuspended || faulted) return false
  for (const mounted of resources.values()) {
    if (!mounted.suspended) return true
  }
  return false
}

export function reconcileSceneStageRunState(
  resources,
  previous,
  next,
  at = performance.now(),
) {
  const wasRunnable = !previous.hidden && !previous.contextLost
    && !previous.suspended && !previous.faulted
  const isRunnable = !next.hidden && !next.contextLost
    && !next.suspended && !next.faulted
  if (wasRunnable === isRunnable) return false
  for (const mounted of resources.values()) {
    if (!isRunnable) {
      mounted.playClock.suspend(at)
      mounted.interactionVisuals?.suspend(at)
    } else if (sceneResourceCanRun(
      mounted.suspended,
      next.hidden || next.suspended,
      next.contextLost || next.faulted,
    )) {
      mounted.playClock.resume(at)
      mounted.interactionVisuals?.resume(at)
    }
  }
  return true
}
