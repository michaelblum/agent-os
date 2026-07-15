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
