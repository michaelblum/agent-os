export {
  DesktopWorldSurface3D,
  DesktopWorldSurfaceThree,
  deriveOrthoCamera,
} from '../runtime/desktop-world-surface-three.js'

export {
  canvasGeometryCanvasID,
  canvasLifecycleCanvasID,
  mergeCanvasGeometryCanvas,
  mergeCanvasLifecycleCanvas,
  normalizeCanvasGeometry,
} from '../runtime/canvas-lifecycle.js'

export {
  DEFAULT_THREE_RENDER_LIMITS,
  createThreeRenderLifecycle,
  disposeThreeObjectTree,
  disposeThreeRenderer,
  resolveThreeRenderMetrics,
} from '../runtime/three-render-lifecycle.js'

export {
  VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID,
  VISUAL_OBJECT_PROJECTION_REASONS,
  VISUAL_OBJECT_SUPPORTED_TECHNOLOGIES,
  applyVisualObjectDescriptorMutation,
  coerceVisualObjectDescriptorValue,
  createVisualObjectDescriptor,
  validateVisualObjectDescriptor,
  validateVisualObjectDescriptors,
  visualObjectDescriptorRequiredFields,
} from '../workbench/visual-object-contract.js'

export { applyVisualObjectControllerUpdate } from '../workbench/visual-object-controller.js'

export {
  applyVisualObjectFormFieldChange,
  bindVisualObjectForm,
  findVisualObjectFormDescriptor,
} from '../workbench/visual-object-form-binding.js'

export {
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID,
  VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS,
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../workbench/visual-object-resource-lifecycle.js'

export {
  SCENE_DOCUMENT_CONTRACT_ID,
  SCENE_DOCUMENT_LIMITS,
  SCENE_LEASE_CONTRACT_ID,
  SCENE_TRANSACTION_CONTRACT_ID,
  canonicalizeSceneDocument,
  createSceneLease,
  sceneDocumentRequiredImplementations,
  validateSceneDocument,
  validateSceneLease,
  validateSceneTransaction,
} from './scene-document.js'

export {
  SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID,
  SCENE_CARTRIDGE_CONTRACT_ID,
  SCENE_CARTRIDGE_IMPLEMENTATIONS,
  SCENE_CARTRIDGE_INTERACTIONS_CONTRACT_ID,
  SCENE_CARTRIDGE_LIMITS,
  resolveSceneCartridge,
  validateSceneCartridge,
  validateSceneCartridgeManifest,
} from './scene-cartridge.js'

export {
  SCENE_AFFORDANCE_LIMITS,
  SCENE_EVENT_CONTRACT_ID,
  SCENE_INTERACTIONS_CONTRACT_ID,
  SCENE_GESTURE_CANCELLATION_REASONS,
  SCENE_GESTURE_KINDS,
  SCENE_GESTURE_PHASES,
  createSceneEventEnvelope,
  createSceneGestureArena,
  createSceneInteractionController,
  resolveSceneAffordanceFrame,
  resolveSceneGestureResponse,
  validateSceneAffordanceDescriptor,
  validateSceneInteractionDocument,
} from './scene-interaction.js'

export { applySceneTransaction } from './scene-transaction.js'

export {
  SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID,
  compileSceneAnimationBindings,
  createSceneAnimationController,
} from './scene-animation.js'

export {
  SCENE_IMPLEMENTATION_KINDS,
  createSceneImplementationRegistry,
} from './scene-registry.js'

export {
  GENERIC_SCENE_IMPLEMENTATIONS,
  createGenericSceneImplementationRegistry,
  createGenericThreeSceneProjection,
} from './scene-generic-three.js'

export {
  SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID,
  compileSceneSignalBindings,
  createSceneSignalController,
} from './scene-signal.js'

export {
  DEFAULT_SCENE_HOST_BUDGETS,
  SCENE_INSPECTION_CONTRACT_ID,
  createDesktopWorldSceneHost,
  createLocalSceneViewportHost,
} from './scene-host.js'
