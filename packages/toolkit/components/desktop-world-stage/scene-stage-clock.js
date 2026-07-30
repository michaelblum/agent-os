function finiteTime(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number.`)
  }
  return value
}

export function createDesktopWorldStageClock({ timeOrigin = performance.timeOrigin } = {}) {
  const origin = finiteTime(timeOrigin, 'DesktopWorld stage clock time origin')
  let latest = origin

  return Object.freeze({
    at(frameAt) {
      const candidate = origin + finiteTime(frameAt, 'DesktopWorld stage frame time')
      latest = Math.max(latest, candidate)
      return latest
    },
    snapshot() {
      return Object.freeze({ latest, timeOrigin: origin })
    },
  })
}
