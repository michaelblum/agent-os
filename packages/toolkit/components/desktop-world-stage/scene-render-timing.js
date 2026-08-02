export function createDesktopWorldSceneRenderTiming() {
  let lastRenderAt = null

  return Object.freeze({
    record(at) {
      const frameMs = lastRenderAt === null ? null : Math.max(0, at - lastRenderAt)
      lastRenderAt = at
      return frameMs
    },
    reset() {
      lastRenderAt = null
    },
  })
}
