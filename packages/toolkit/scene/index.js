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

export {
  SCENE_RADIAL_MENU_LIMITS,
  normalizeSceneRadialMenuParameters,
  resolveSceneRadialMenuLayout,
  resolveSceneRadialMenuResponse,
  validateSceneRadialMenuParameters,
  withSceneRadialSelection,
} from './scene-radial-menu.js'

export {
  SCENE_INTERACTION_VISUAL_LIMITS,
  createSceneInteractionVisualController,
  resolveSceneAimVisualStyle,
  resolveSceneRadialVisualStyle,
} from './scene-interaction-visual.js'
export {
  DESKTOP_WORLD_DEVTOOLS_LIMITS,
  DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS,
  DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID,
  DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID,
  buildDesktopWorldMinimapLayout,
  createDesktopWorldGpuTimer,
  createDesktopWorldDevToolsStageProbe,
  evaluateDesktopWorldPerformanceAcceptance,
  normalizeDesktopWorldDevToolsSnapshot,
  normalizeDesktopWorldDevToolsStageSnapshot,
} from './desktop-world-devtools.js'
export { createDesktopWorldDevToolsView } from './desktop-world-devtools-view.js'
export {
  DESKTOP_WORLD_SCENE_REPLAY_LIMITS,
  createDesktopWorldSceneClient,
  listDesktopWorldResources,
  replayDesktopWorldSceneEvents,
  selectDesktopWorldResourceSnapshot,
} from './desktop-world-client.js'

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
  SCENE_EXTENSION_BUDGET_LIMITS,
  SCENE_EXTENSION_CONTRACT_ID,
  SCENE_EXTENSION_REGISTRY_LIMIT,
  SCENE_EXTENSION_SCENE_ABI,
  SCENE_EXTENSION_SCHEMA_VERSION,
  SCENE_EXTENSION_THREE_REVISION,
  createTrustedSceneExtensionRegistry,
  inspectSceneExtensionProjectionResources,
  serializeSceneExtensionDigestMaterial,
  validateSceneExtensionManifest,
  validateSceneExtensionReference,
  validateSceneExtensionProjection,
} from './scene-extension.js'

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
