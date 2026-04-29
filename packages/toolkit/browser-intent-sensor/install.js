import { createBrowserIntentSensor } from './overlay.js'

export function installBrowserIntentSensor(options = {}) {
  const target = options.window ?? globalThis.window
  if (!target?.document) throw new Error('browser intent sensor install requires a browser window')

  if (target.__aosBrowserIntentSensor) return target.__aosBrowserIntentSensor

  const events = []
  const sensor = createBrowserIntentSensor({
    document: target.document,
    ...options,
    onEvent(event) {
      events.push(event)
      options.onEvent?.(event)
    },
  })

  target.__aosBrowserIntentSensor = {
    setMode: sensor.setMode,
    markElement: sensor.markElement,
    markRegion: sensor.markRegion,
    comment: sensor.comment,
    snapshot() {
      return {
        ...sensor.snapshot(),
        events: [...events],
      }
    },
    drainEvents() {
      const drained = events.splice(0, events.length)
      return drained
    },
    uninstall() {
      sensor.uninstall()
      delete target.__aosBrowserIntentSensor
      return true
    },
  }

  return target.__aosBrowserIntentSensor
}
