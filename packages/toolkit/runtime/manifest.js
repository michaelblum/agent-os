// manifest.js — declare what this canvas is and lifecycle handshake.
//
// declareManifest attaches {name, accepts, emits, ...} to window.headsup so
// future tooling (orchestrators, launchers) can discover canvas capabilities.
// emitReady signals the daemon the canvas is loaded — used by --focus and
// other one-shot post-load actions.

import { emit, wireBridge } from './bridge.js'

export function declareManifest(manifest) {
  window.headsup = window.headsup || {}
  window.headsup.manifest = manifest
}

export function emitReady() {
  emit('ready', window.headsup?.manifest)
}

export function emitLifecycleComplete(action, payload = {}) {
  emit('lifecycle.complete', { ...payload, action })
}

export function onReady(handler) {
  // Convenience: wire bridge + dispatch ready handler when daemon sends it back.
  // Most consumers won't need this; included for symmetry with emitReady.
  wireBridge((msg) => {
    if (msg?.type === 'ready' && typeof handler === 'function') handler(msg)
  })
}
