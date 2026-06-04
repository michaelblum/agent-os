// runtime/index.js — re-exports for convenient importing.
//
// Consumers can import everything from one path:
//   import { wireBridge, emit, subscribe, spawnChild, declareManifest }
//     from 'aos://toolkit/runtime/index.js'
// or import from individual modules for tighter dependencies.

export { wireBridge, emit, esc } from './bridge.js'
export { submitGateContinuation } from './gate.js'
export { subscribe, unsubscribe } from './subscribe.js'
export { CANVAS_LIFECYCLE_STATES, spawnChild, warmCanvas, waitForCanvasReady, canvasInfo, waitForCanvasStatusReady, mutateSelf, removeSelf, removeCanvas, suspendCanvas, resumeCanvas, setInteractive, evalCanvas, writeClipboardText, move } from './canvas.js'
export { canvasLifecycleCanvasID, mergeCanvasLifecycleCanvas } from './canvas-lifecycle.js'
export { DesktopWorldSurfaceAdapter } from './desktop-world-surface.js'
export { DesktopWorldSurface2D } from './desktop-world-surface-2d.js'
export {
  DesktopWorldSurface3D,
  DesktopWorldSurfaceThree,
  deriveOrthoCamera,
} from './desktop-world-surface-three.js'
export {
  createCanvasOriginInputEvent,
  isCanvasInputEventType,
  normalizeCanvasInputMessage,
  normalizeCanvasOriginInputMessage,
} from './input-events.js'
export {
  registerInputRegion,
  updateInputRegion,
  removeInputRegion,
  inputRegionContainsRect,
} from './input-region.js'
export {
  createDesktopWorldInteractionRouter,
  pointerPhase,
} from './interaction-region.js'
export { createInteractionSurface } from './interaction-surface.js'
export {
  createDesktopWorldHitRegionController,
  desktopWorldHitRegionFrame,
  resolveDesktopWorldHitRegionOwnerCanvasId,
} from './desktop-world-hit-region.js'
export {
  actionList,
  applySemanticTargetAttributes,
  compactObject,
  createSemanticTargetElement,
  extensionSource,
  normalizeAgentUiTarget,
  normalizeSemanticTarget,
  normalizeSemanticTargets,
  refForTarget,
  semanticTargetAttributeEntries,
  semanticTargetAttrString,
} from './semantic-targets.js'
export {
  createDesktopWorldRangeDrag,
  desktopWorldRangeValue,
  updateDesktopWorldRangeDrag,
} from './range-drag.js'
export { createResourceScope } from './resource-scope.js'
export {
  angleDegrees,
  createRadialGestureModel,
  distanceBetween,
  normalizeDegrees,
  pointAtAngle,
  radialItemPointerMetrics,
  resolveRadialGestureConfig,
  resolveRadialGestureItems,
  shortestAngleDelta,
} from './radial-gesture.js'
export {
  MENU_ACTIVATION_SCHEMA_VERSION,
  MENU_ACTIVATION_PHASES,
  MENU_ACTIVATION_TERMINAL_PHASES,
  advanceMenuActivation,
  createMenuActivationRequest,
  isMenuActivationPhase,
  isTerminalMenuActivationPhase,
  normalizeMenuActivationInput,
  normalizeMenuActivationPhase,
  normalizeMenuActivationSurface,
  normalizeMenuActivationTransition,
} from './menu-activation.js'
export {
  DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET,
  RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS,
  RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION,
  normalizeRadialItemActivationTransition,
  radialItemActivationTransitionPreset,
  resolveRadialItemActivationTransition,
} from './radial-item-transition.js'
export {
  RADIAL_MENU_3D_KIND,
  RADIAL_MENU_3D_SCHEMA_VERSION,
  cloneRadialMenuConfig,
  mergeRadialMenuConfig,
  mergeRadialMenuDefinitions,
  radialMenuGeometryConfig,
  resolveRadialMenuConfig,
  validateRadialMenuDefinition,
} from './radial-menu-config.js'
export {
  UX_TREE_SCHEMA,
  UX_TREE_VERSION,
  createUxTree,
  mergeUxTreeDefinitions,
  normalizeUxTreeBinding,
  normalizeUxTreeCommand,
  normalizeUxTreeNode,
  resolveUxTree,
  uxTreeBindingsForGesture,
  uxTreeCommandById,
} from './ux-tree.js'
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
  normalizeCanvasFrameToDesktopWorld,
  canvasLocalRectToDesktopWorld,
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
