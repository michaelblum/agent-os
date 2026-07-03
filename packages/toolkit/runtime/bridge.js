// bridge.js — wire the WKWebView ↔ daemon channel.
//
// Every surface in a canvas calls wireBridge() once at boot to install a
// router for incoming messages. emit() sends messages back to the daemon.
// esc() is the universal HTML-escape helper used by chrome and contents.

const handlers = []

export function wireBridge(handler) {
  let active = false
  if (typeof handler === 'function') {
    handlers.push(handler)
    active = true
  }
  if (!window.headsup || !window.headsup.receive) {
    window.headsup = window.headsup || {}
    window.headsup.receive = function (b64) {
      let msg
      try {
        msg = JSON.parse(atob(b64))
      } catch (e) {
        console.error('[runtime] bridge decode error', e)
        return
      }
      for (const h of handlers) {
        try { h(msg) } catch (e) { console.error('[runtime] handler error', e) }
      }
    }
  }
  return () => {
    if (!active) return
    active = false
    const index = handlers.indexOf(handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}

export function emit(type, payload) {
  const body = payload === undefined ? { type } : { type, payload }
  window.webkit?.messageHandlers?.headsup?.postMessage(body)
}

export function esc(s) {
  if (s === null || s === undefined) return ''
  const d = document.createElement('div')
  d.textContent = String(s)
  return d.innerHTML
}
