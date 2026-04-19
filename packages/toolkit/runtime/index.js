// runtime/index.js — re-exports for convenient importing.
//
// Consumers can import everything from one path:
//   import { wireBridge, emit, subscribe, spawnChild, declareManifest }
//     from 'aos://toolkit/runtime/index.js'
// or import from individual modules for tighter dependencies.

export { wireBridge, emit, esc } from './bridge.js'
export { subscribe, unsubscribe } from './subscribe.js'
export { spawnChild, mutateSelf, removeSelf, setInteractive, evalCanvas, move } from './canvas.js'
export { isCanvasInputEventType, normalizeCanvasInputMessage } from './input-events.js'
export {
  rectFromAt,
  normalizeDisplays,
  sortDisplaysSpatially,
  labelDisplays,
  computeUnionBounds,
  computeDisplayUnion,
  translatePoint,
  translateRect,
  globalToUnionLocalPoint,
  globalToDisplayLocalPoint,
  globalToCanvasLocalPoint,
  displayContainsPoint,
  displayContainsRect,
  findContainingDisplayForPoint,
  findContainingDisplayForRect,
  findDisplayForPoint,
  clampPointToDisplays,
  ownerLabelForPoint,
  ownerLabelForRect,
  resolveCanvasFrame,
  resolveCanvasFrames,
  computeMinimapLayout,
  projectPointToMinimap,
} from './spatial.js'
export { declareManifest, emitReady, emitLifecycleComplete, onReady } from './manifest.js'
