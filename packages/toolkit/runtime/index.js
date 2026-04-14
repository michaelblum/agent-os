// runtime/index.js — re-exports for convenient importing.
//
// Consumers can import everything from one path:
//   import { wireBridge, emit, subscribe, spawnChild, declareManifest }
//     from 'aos://toolkit/runtime/index.js'
// or import from individual modules for tighter dependencies.

export { wireBridge, emit, esc } from './bridge.js'
export { subscribe, unsubscribe } from './subscribe.js'
export { spawnChild, mutateSelf, removeSelf, setInteractive, move } from './canvas.js'
export { declareManifest, emitReady, onReady } from './manifest.js'
