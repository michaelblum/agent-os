function validTime(value) {
  return Number.isFinite(value) ? value : null
}

export function createScenePlaybackClock() {
  let startedAt = null
  let pausedAt = null

  return Object.freeze({
    elapsed(at) {
      const now = validTime(at)
      if (startedAt === null || now === null) return 0
      return Math.max(0, (pausedAt ?? now) - startedAt)
    },
    restart(at) {
      const now = validTime(at)
      if (now === null) return false
      startedAt = now
      pausedAt = null
      return true
    },
    suspend(at) {
      const now = validTime(at)
      if (startedAt === null || pausedAt !== null || now === null) return false
      pausedAt = now
      return true
    },
    resume(at) {
      const now = validTime(at)
      if (startedAt === null || pausedAt === null || now === null) return false
      startedAt += Math.max(0, now - pausedAt)
      pausedAt = null
      return true
    },
    snapshot() {
      return Object.freeze({ paused: pausedAt !== null, pausedAt, startedAt })
    },
  })
}
