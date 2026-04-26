// runtime/index.js — re-exports for convenient importing.
//
// Consumers can import everything from one path:
//   import { wireBridge, emit, subscribe, spawnChild, declareManifest }
//     from 'aos://toolkit/runtime/index.js'
// or import from individual modules for tighter dependencies.

export { wireBridge, emit, esc } from './bridge.js'
export { subscribe, unsubscribe } from './subscribe.js'
export { spawnChild, mutateSelf, removeSelf, setInteractive, evalCanvas, move } from './canvas.js'
export { canvasLifecycleCanvasID, mergeCanvasLifecycleCanvas } from './canvas-lifecycle.js'
export { DesktopWorldSurfaceAdapter } from './desktop-world-surface.js'
export { DesktopWorldSurface2D } from './desktop-world-surface-2d.js'
export {
  DesktopWorldSurface3D,
  DesktopWorldSurfaceThree,
  deriveOrthoCamera,
} from './desktop-world-surface-three.js'
export { isCanvasInputEventType, normalizeCanvasInputMessage } from './input-events.js'
export {
  createDesktopWorldInteractionRouter,
  pointerPhase,
} from './interaction-region.js'
export {
  createStackMenu,
  createStackMenuModel,
  applyStackMenuState,
  stackMenuPushedStyle,
} from './stack-menu.js'
export {
  rectFromAt,
  normalizeDisplays,
  sortDisplaysSpatially,
  labelDisplays,
  computeUnionBounds,
  computeNativeDesktopBounds,
  computeDesktopWorldBounds,
  computeVisibleDesktopWorldBounds,
  translatePoint,
  translateRect,
  nativeToDesktopWorldPoint,
  nativeToDesktopWorldRect,
  desktopWorldToNativePoint,
  desktopWorldToNativeRect,
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
