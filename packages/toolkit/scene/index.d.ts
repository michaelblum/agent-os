import type { SceneAffordanceDescriptor } from './scene-interaction.js';

export * from './scene-interaction.js';
export * from './scene-interaction-visual.js';
export * from './scene-radial-menu.js';
export * from './scene-extension.js';
export * from './scene-extension-route-inspection.js';
export * from './desktop-world-devtools.js';
export * from './desktop-world-devtools-view.js';
export * from './desktop-world-client.js';
export * from './desktop-world-session.js';
export * from './scene-result-codes.js';

export interface ThreeRenderLimits {
  maxDevicePixelRatio: number;
  maxBackingDimension: number;
  maxBackingPixels: number;
}

export interface ThreeRenderMetrics {
  cssWidth: number;
  cssHeight: number;
  requestedDevicePixelRatio: number;
  effectiveDevicePixelRatio: number;
  backingWidth: number;
  backingHeight: number;
  backingPixels: number;
  constrained: boolean;
  limits: ThreeRenderLimits;
}

export interface DisposableResource {
  dispose(): void;
}

export const GENERIC_SCENE_IMPLEMENTATIONS: Readonly<Record<string, string>>;
export function createGenericSceneImplementationRegistry(): SceneImplementationRegistry;
export function createGenericThreeSceneProjection(input: {
  THREE: Record<string, any>;
  document: SceneDocument;
}): {
  object: unknown;
  activate(): void;
  applyAnimation(binding: { target: string }, value: number): boolean;
  applySignal(binding: { target: string }, value: number): boolean;
  tick(elapsedMs: number): number;
  suspend(): void;
  resume(): void;
  dispose(): void;
};

export interface ThreeRendererLike {
  domElement?: EventTarget & { parentElement?: Element | null };
  render?(scene: unknown, camera: unknown): void;
  getContext?(): { isContextLost?(): boolean };
  setAnimationLoop?(callback: null): void;
  setPixelRatio?(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  renderLists?: { dispose?(): void };
  dispose?(): void;
  forceContextLoss?(): void;
}

export interface ThreeCameraLike {
  isPerspectiveCamera?: boolean;
  aspect?: number;
  updateProjectionMatrix?(): void;
  [key: string]: unknown;
}

export interface ThreeRenderLifecycleSnapshot {
  started: boolean;
  disposed: boolean;
  suspended: boolean;
  contextLost: boolean;
  hidden: boolean;
  frameScheduled: boolean;
  metrics: ThreeRenderMetrics | null;
}

export interface ThreeObjectDisposalSummary {
  objects: number;
  geometries: number;
  materials: number;
  textures: number;
}

export interface ThreeRendererDisposalSummary {
  disposed: boolean;
  contextLost: boolean;
}

export interface ThreeRenderDisposalSummary {
  sceneResources: ThreeObjectDisposalSummary;
  additionalResources: number;
  renderer: ThreeRendererDisposalSummary;
}

export interface ThreeRenderFrame {
  at: number;
  deltaMs: number;
  metrics: ThreeRenderMetrics | null;
  renderer: ThreeRendererLike;
  scene: unknown;
  camera: ThreeCameraLike | null;
}

export interface ThreeRenderLifecycleOptions {
  renderer: ThreeRendererLike;
  scene?: unknown;
  camera?: ThreeCameraLike | null;
  canvas?: EventTarget | null;
  container?: Element | null;
  document?: Document;
  window?: Window;
  ResizeObserver?: typeof ResizeObserver;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  measure?: () => { width?: number; height?: number };
  updateCamera?: (camera: ThreeCameraLike | null, metrics: ThreeRenderMetrics) => void;
  onFrame?: (frame: ThreeRenderFrame) => void;
  onResize?: (metrics: ThreeRenderMetrics) => void;
  onContextLost?: (snapshot: ThreeRenderLifecycleSnapshot) => void;
  onContextRestored?: (snapshot: ThreeRenderLifecycleSnapshot) => void;
  onVisibilityChange?: (snapshot: ThreeRenderLifecycleSnapshot) => void;
  additionalDisposables?: readonly DisposableResource[];
  limits?: Partial<ThreeRenderLimits>;
}

export interface ThreeRenderLifecycle {
  start(): ThreeRenderLifecycleSnapshot;
  stop(): ThreeRenderLifecycleSnapshot;
  resize(): ThreeRenderMetrics | null;
  suspend(): ThreeRenderLifecycleSnapshot;
  resume(): ThreeRenderLifecycleSnapshot;
  snapshot(): ThreeRenderLifecycleSnapshot;
  dispose(options?: { forceContextLoss?: boolean }): ThreeRenderDisposalSummary;
}

export const DEFAULT_THREE_RENDER_LIMITS: Readonly<ThreeRenderLimits>;

export function resolveThreeRenderMetrics(input?: Partial<ThreeRenderLimits> & {
  width?: number;
  height?: number;
  devicePixelRatio?: number;
}): ThreeRenderMetrics | null;

export function disposeThreeObjectTree(
  root: unknown,
  options?: { clear?: boolean },
): ThreeObjectDisposalSummary;

export function disposeThreeRenderer(
  renderer: ThreeRendererLike | null,
  options?: { forceContextLoss?: boolean },
): ThreeRendererDisposalSummary;

export function createThreeRenderLifecycle(
  options: ThreeRenderLifecycleOptions,
): ThreeRenderLifecycle;

export interface DesktopWorldSegment {
  display_id?: string | number;
  dw_bounds?: readonly number[];
  dwBounds?: readonly number[];
  [key: string]: unknown;
}

export interface OrthoCameraProjection {
  left: number;
  right: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function deriveOrthoCamera(
  segmentOrBounds: DesktopWorldSegment | readonly number[],
  options?: { near?: number; far?: number },
): OrthoCameraProjection;

export class DesktopWorldSurfaceThree {
  constructor(options?: Record<string, unknown>);
  channelName: string;
  camera: ThreeCameraLike | null;
  renderer: ThreeRendererLike | null;
  scene: unknown;
  segment?: DesktopWorldSegment | null;
  isPrimary?: boolean;
  start(handlers?: Record<string, (...args: readonly unknown[]) => unknown>): Promise<unknown>;
  stop(): void;
  publishState(state: unknown): boolean;
  stateLatencySnapshot(): {
    samples: number;
    median_ms: number | null;
    p95_ms: number | null;
    last_receive_age_ms: number | null;
  };
  mountScene(input?: {
    scene?: unknown;
    camera?: ThreeCameraLike | null;
    renderer?: ThreeRendererLike | null;
    manageViewport?: boolean;
  }): void;
  refreshCamera(
    camera?: ThreeCameraLike | null,
    segment?: DesktopWorldSegment | null,
  ): OrthoCameraProjection | { type: 'perspective'; aspect: number; width: number | null; height: number | null } | null;
  refreshViewport(): void;
}

export const DesktopWorldSurface3D: typeof DesktopWorldSurfaceThree;

export interface CanvasLifecycleProjection {
  id: string;
  at: unknown;
  parent: unknown;
  track: unknown;
  interactive: boolean;
  scope: unknown;
  ttl: unknown;
  cascade: unknown;
  suspended: unknown;
  lifecycle_state: unknown;
  [key: string]: unknown;
}

export interface CanvasGeometryProjection {
  canvas_id: string;
  change: string;
  cause: string;
  phase: string;
  transaction_id: unknown;
  frame: readonly unknown[];
  previous_frame: readonly unknown[] | null;
  canvas: Record<string, unknown> | null;
}

export function canvasLifecycleCanvasID(data: unknown): string | null;
export function mergeCanvasLifecycleCanvas(
  existing: Record<string, unknown> | null,
  data: unknown,
): CanvasLifecycleProjection | null;
export function canvasGeometryCanvasID(data: unknown): string | null;
export function normalizeCanvasGeometry(data?: unknown): CanvasGeometryProjection | null;
export function mergeCanvasGeometryCanvas(
  existing: Record<string, unknown> | null,
  data: unknown,
): CanvasLifecycleProjection | null;

export type VisualObjectTechnology = 'threejs-3d' | 'canvas-2d' | 'dom-toolkit';
export type VisualObjectProjectionClassification = 'editable' | 'projection_only';

export interface VisualObjectDescriptor {
  contract: string;
  id: string;
  label: string;
  kind: string;
  technology: string;
  state_path: string | null;
  route: string | null;
  coerce: string | null;
  renderer_sync: string[];
  group_key: string | null;
  object_ids: string[];
  projection: {
    classification: VisualObjectProjectionClassification;
    reason: string | null;
  };
  range?: { min?: unknown; max?: unknown; step?: unknown };
  options?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface VisualObjectValidationError {
  code: string;
  field: string;
  message: string;
}

export interface VisualObjectValidationResult {
  ok: boolean;
  errors: VisualObjectValidationError[];
}

export const VISUAL_OBJECT_DESCRIPTOR_CONTRACT_ID: string;
export const VISUAL_OBJECT_SUPPORTED_TECHNOLOGIES: readonly VisualObjectTechnology[];
export const VISUAL_OBJECT_PROJECTION_REASONS: readonly string[];

export function createVisualObjectDescriptor(
  source?: Record<string, unknown>,
): VisualObjectDescriptor;
export function visualObjectDescriptorRequiredFields(
  descriptor?: Partial<VisualObjectDescriptor>,
): readonly string[];
export function validateVisualObjectDescriptor(
  descriptor?: Partial<VisualObjectDescriptor>,
): VisualObjectValidationResult;
export function validateVisualObjectDescriptors(
  descriptors?: readonly Partial<VisualObjectDescriptor>[],
): {
  ok: boolean;
  results: Array<VisualObjectValidationResult & { id: string | null }>;
  errors: Array<VisualObjectValidationError & { id: string | null }>;
};
export function coerceVisualObjectDescriptorValue(
  descriptor: Partial<VisualObjectDescriptor>,
  value: unknown,
): unknown;
export function applyVisualObjectDescriptorMutation(
  state: Record<string, unknown>,
  descriptor: VisualObjectDescriptor,
  value: unknown,
  options?: { validate?: boolean },
): Record<string, unknown>;
export function applyVisualObjectControllerUpdate(
  descriptor: VisualObjectDescriptor,
  value: unknown,
  state?: Record<string, unknown>,
  options?: {
    routeHandlers?: Record<string, (context: unknown) => unknown> | Map<string, (context: unknown) => unknown>;
    rendererSyncHandlers?: Record<string, (context: unknown) => unknown> | Map<string, (context: unknown) => unknown>;
    validate?: boolean;
  },
): Record<string, unknown>;

export function findVisualObjectFormDescriptor(
  change: Record<string, unknown>,
  descriptors?: readonly VisualObjectDescriptor[],
): VisualObjectDescriptor | null;
export function applyVisualObjectFormFieldChange(
  change: Record<string, unknown>,
  options?: Record<string, unknown>,
): Record<string, unknown>;
export function bindVisualObjectForm(
  form: Record<string, unknown>,
  options?: Record<string, unknown>,
): unknown;

export const VISUAL_OBJECT_RESOURCE_LIFECYCLE_CONTRACT_ID: string;
export const VISUAL_OBJECT_RESOURCE_LIFECYCLE_TERMS: readonly string[];
export function createVisualObjectResourceLifecycleEvidence(
  input?: Record<string, unknown>,
): Record<string, unknown>;
export function validateVisualObjectResourceLifecycleEvidence(
  evidence?: Record<string, unknown>,
): { ok: boolean; errors: Array<{ code: string; field: string }> };

export type SceneJsonValue =
  | null
  | boolean
  | number
  | string
  | SceneJsonValue[]
  | { [key: string]: SceneJsonValue };

export interface SceneComponentDescriptor {
  id: string;
  implementation: string;
  parameters: Record<string, SceneJsonValue>;
  enabled: boolean;
}

export interface SceneTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SceneObjectDescriptor {
  id: string;
  parentId: string | null;
  kind: 'group' | 'mesh' | 'points' | 'line' | 'light' | 'camera';
  transform: SceneTransform;
  visible: boolean;
  geometryId: string | null;
  materialId: string | null;
  components: SceneComponentDescriptor[];
}

export interface SceneAssetDescriptor {
  sha256: string;
  mediaType: string;
  bytes: number;
}

export interface SceneResourceDescriptor {
  id: string;
  kind: 'geometry' | 'material' | 'texture' | 'shader' | 'effect';
  implementation: string;
  parameters: Record<string, SceneJsonValue>;
  asset: SceneAssetDescriptor | null;
}

export interface SceneDocument {
  contract: typeof SCENE_DOCUMENT_CONTRACT_ID;
  schemaVersion: 1;
  id: string;
  revision: number;
  rootObjectId: string;
  objects: SceneObjectDescriptor[];
  resources: SceneResourceDescriptor[];
  metadata: Record<string, SceneJsonValue>;
  renderPass?: SceneRenderPassDescriptor;
}

export interface ScenePerspectiveCameraProfile {
  fovYDegrees: number;
  near: number;
  far: number;
  targetZ: number;
}

export type SceneRenderPassDescriptor =
  | { kind: 'orthographic_overlay' }
  | { kind: 'perspective_resource'; camera: ScenePerspectiveCameraProfile };

export interface PerspectiveResourceCameraProjection {
  aspect: number;
  far: number;
  fovYDegrees: number;
  near: number;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  up: readonly [number, number, number];
  viewOffset: Readonly<{
    fullWidth: number;
    fullHeight: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  }>;
  worldBounds: readonly [number, number, number, number];
}

export const SCENE_RENDER_PASS_KINDS: readonly ['orthographic_overlay', 'perspective_resource'];
export const DEFAULT_SCENE_RENDER_PASS: Readonly<{ kind: 'orthographic_overlay' }>;
export function validateSceneRenderPass(value: unknown): SceneValidationResult;
export function resolveSceneRenderPass(document: Pick<SceneDocument, 'renderPass'>): Readonly<SceneRenderPassDescriptor>;
export function derivePerspectiveResourceCamera(
  topology: readonly DesktopWorldSegment[],
  segment: DesktopWorldSegment,
  profile: ScenePerspectiveCameraProfile,
): Readonly<PerspectiveResourceCameraProjection> | null;

export interface SceneValidationError {
  code: string;
  path: string;
  message: string;
}

export interface SceneValidationResult {
  ok: boolean;
  errors: SceneValidationError[];
}

export type SceneTransactionOperation =
  | { op: 'put_object'; object: SceneObjectDescriptor }
  | { op: 'remove_object'; objectId: string }
  | { op: 'set_property'; objectId: string; path: string; value: SceneJsonValue }
  | { op: 'put_resource'; resource: SceneResourceDescriptor }
  | { op: 'remove_resource'; resourceId: string };

export interface SceneTransaction {
  contract: typeof SCENE_TRANSACTION_CONTRACT_ID;
  transactionId: string;
  stageId: string;
  ownerId: string;
  resourceId: string;
  expectedRevision: number;
  operations: SceneTransactionOperation[];
}

export interface SceneLease {
  contract: typeof SCENE_LEASE_CONTRACT_ID;
  stageId: string;
  ownerId: string;
  resourceId: string;
  scopeId: string;
}

export const SCENE_DOCUMENT_CONTRACT_ID: 'aos.scene.document.v1';
export const SCENE_TRANSACTION_CONTRACT_ID: 'aos.scene.transaction.v1';
export const SCENE_LEASE_CONTRACT_ID: 'aos.scene.lease.v1';
export const SCENE_DOCUMENT_LIMITS: Readonly<{
  maxObjects: number;
  maxResources: number;
  maxComponentsPerObject: number;
  maxOperationsPerTransaction: number;
  maxParameterDepth: number;
  maxParameterKeys: number;
  maxParameterArrayLength: number;
  maxParameterStringLength: number;
  maxAssetBytes: number;
}>;

export function validateSceneDocument(document: unknown): SceneValidationResult;
export function canonicalizeSceneDocument(document: unknown): SceneDocument;
export function sceneDocumentRequiredImplementations(document: unknown): string[];
export function validateSceneTransaction(transaction: unknown): SceneValidationResult;
export function validateSceneLease(lease: unknown): SceneValidationResult;
export function createSceneLease(input: Omit<SceneLease, 'contract'>): Readonly<SceneLease>;

export type SceneCartridgeImplementationKind =
  | SceneImplementationKind
  | 'effect'
  | 'interaction'
  | 'recognizer'
  | 'response';

export interface SceneCartridgeDigestFile {
  path: string;
  sha256: string;
}

export interface SceneCartridgeAsset extends SceneCartridgeDigestFile {
  bytes: number;
  mediaType: 'image/avif' | 'image/jpeg' | 'image/png' | 'image/webp' | 'model/gltf-binary';
}

export interface SceneCartridgeBudgets {
  maxAnimations: number;
  maxAssets: number;
  maxAssetBytes: number;
  maxInteractions: number;
  maxObjects: number;
  maxResources: number;
}

export interface SceneCartridgeImplementationDeclaration {
  id: string;
  kind: SceneCartridgeImplementationKind;
}

export interface SceneCartridgeManifest {
  contract: typeof SCENE_CARTRIDGE_CONTRACT_ID;
  schemaVersion: 1;
  id: string;
  revision: number;
  files: {
    animations: SceneCartridgeDigestFile & { path: 'animations.json' };
    interactions: SceneCartridgeDigestFile & { path: 'interactions.json' };
    scene: SceneCartridgeDigestFile & { path: 'scene.json' };
  };
  implementations: SceneCartridgeImplementationDeclaration[];
  assets: SceneCartridgeAsset[];
  budgets: SceneCartridgeBudgets;
  metadata: Record<string, SceneJsonValue>;
}

export interface SceneCartridgeAnimation {
  id: string;
  bindingIds: string[];
  autoplay: boolean;
}

export interface SceneCartridgeAnimations {
  contract: typeof SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID;
  schemaVersion: 1;
  animations: SceneCartridgeAnimation[];
}

export interface SceneCartridgeInteractionImplementation {
  implementation: string;
  parameters: Record<string, SceneJsonValue>;
}

interface SceneCartridgeInteractionBase {
  id: string;
  affordanceId: string;
  recognizer: SceneCartridgeInteractionImplementation;
  response: SceneCartridgeInteractionImplementation;
}

export type SceneCartridgeInteraction = SceneCartridgeInteractionBase & (
  | { nativeEffect?: SceneNativeEffectDescriptor; nativeEffects?: never }
  | { nativeEffect?: never; nativeEffects: SceneNativeEffectDescriptorList }
);

export interface SceneNativeEffectProgramParameter {
  id: string;
  default: number;
  min: number;
  max: number;
}

export type SceneNativeEffectProgramReference = string;

export type SceneNativeEffectProgramV1Node =
  | { id: string; op: 'constant'; value: number | [number, number] }
  | {
      id: string;
      op:
        | 'absolute'
        | 'add'
        | 'clamp01'
        | 'cosine'
        | 'distance_to_segment'
        | 'divide'
        | 'dot'
        | 'exponential'
        | 'length'
        | 'maximum'
        | 'minimum'
        | 'mix'
        | 'multiply'
        | 'negate'
        | 'normalize'
        | 'one_minus'
        | 'perpendicular'
        | 'sine'
        | 'smoothstep'
        | 'subtract';
      inputs: SceneNativeEffectProgramReference[];
    };

export type SceneNativeEffectProgramV2Node =
  | { id: string; op: 'constant'; value: number | [number, number] | [number, number, number] }
  | Exclude<SceneNativeEffectProgramV1Node, { op: 'constant' }>
  | {
      id: string;
      op:
        | 'component_x'
        | 'component_y'
        | 'component_z'
        | 'compose2'
        | 'compose3';
      inputs: SceneNativeEffectProgramReference[];
    };

export type SceneNativeEffectProgramNode =
  | SceneNativeEffectProgramV1Node
  | SceneNativeEffectProgramV2Node;

export interface SceneNativeEffectProgramV1 {
  contract: 'aos.scene.native-effect-program.v1';
  schemaVersion: 1;
  id: string;
  revision: number;
  durationMs: number;
  parameters: SceneNativeEffectProgramParameter[];
  nodes: SceneNativeEffectProgramV1Node[];
  outputs: {
    displacement: SceneNativeEffectProgramReference;
    opacity: SceneNativeEffectProgramReference;
  };
}

type SceneNativeEffectProgramMaterialBase = {
  ambient: number;
  diffuse: number;
  lightDirection: [number, number, number];
  normalSampleDistance: number;
  perspectiveDistance: number;
};

export type SceneNativeEffectProgramMaterial = SceneNativeEffectProgramMaterialBase & (
  | { lighting: 'lambert' | 'unlit' }
  | {
      lighting: 'standard';
      fresnel: number;
      refraction: number;
      roughness: number;
      specular: number;
    }
);

export type SceneNativeEffectProgramGeometry =
  | { kind: 'surface'; cellSize: number }
  | {
      kind: 'event_point' | 'event_endpoints';
      cellSize: number;
      padding: number;
      radius: number;
    }
  | {
      kind: 'event_segment';
      cellSize: number;
      padding: number;
      width: number;
    };

export interface SceneNativeEffectProgramV2 {
  contract: 'aos.scene.native-effect-program.v2';
  schemaVersion: 2;
  id: string;
  revision: number;
  durationMs: number;
  parameters: SceneNativeEffectProgramParameter[];
  nodes: SceneNativeEffectProgramV2Node[];
  outputs: {
    positionOffset: SceneNativeEffectProgramReference;
    textureDisplacement: SceneNativeEffectProgramReference;
    opacity: SceneNativeEffectProgramReference;
  };
  geometry?: SceneNativeEffectProgramGeometry;
  material: SceneNativeEffectProgramMaterial;
}

export interface SceneNativeEffectHeightFieldLobe {
  offsetRadiusScale: number;
  radiusScale: number;
  strengthScale: number;
}

export interface SceneNativeEffectHeightFieldState {
  kind: 'damped_height_field';
  maxDimension: number;
  minDimension: number;
  fixedStepHz: number;
  maxSubsteps: number;
  edgeAbsorptionCells: number;
  dampingParameter: string;
  propagationParameter: string;
  surfaceTensionParameter: string;
  emitter: {
    kind: 'swept_brush';
    durationParameter: string;
    pressureParameter: string;
    radiusParameter: string;
    leadParameter: string;
    spacingRadiusScale: number;
    speedReference: number;
    speedScaleMin: number;
    speedScaleMax: number;
    lobes: SceneNativeEffectHeightFieldLobe[];
  };
}

export interface SceneNativeEffectProgramV3
  extends Omit<SceneNativeEffectProgramV2, 'contract' | 'schemaVersion'> {
  contract: 'aos.scene.native-effect-program.v3';
  schemaVersion: 3;
  state: SceneNativeEffectHeightFieldState;
}

export type SceneNativeEffectProgram =
  | SceneNativeEffectProgramV1
  | SceneNativeEffectProgramV2
  | SceneNativeEffectProgramV3;

export type SceneNativeEffectPointerDownTrigger = {
  input: 'pointer_down';
  button?: 'left' | 'middle' | 'right';
};
export type SceneNativeEffectGestureTrigger = { phase: 'start' | 'end' };
export type SceneNativeEffectTrigger =
  | SceneNativeEffectPointerDownTrigger
  | SceneNativeEffectGestureTrigger;

export interface SceneTimedNativeEffectLifecycle {
  kind: 'timed';
}

export interface SceneGestureNativeEffectLifecycle {
  kind: 'gesture';
}

export type SceneNativeEffectLifecycle =
  | SceneTimedNativeEffectLifecycle
  | SceneGestureNativeEffectLifecycle;

export const SCENE_NATIVE_EFFECT_BINDING_LIMITS: Readonly<{
  maxBindingsPerDocument: 256;
  maxBindingsPerInteraction: 5;
}>;

export const SCENE_NATIVE_EFFECT_LIFECYCLES: Readonly<{
  gesture: 'gesture';
  timed: 'timed';
}>;

type SceneTimedNativeEffectBinding = {
  trigger: SceneNativeEffectTrigger;
  lifecycle?: SceneTimedNativeEffectLifecycle;
};

type SceneGestureNativeEffectBinding = {
  trigger: { phase: 'start' };
  lifecycle: SceneGestureNativeEffectLifecycle;
};

type SceneNativeEffectBinding =
  | SceneTimedNativeEffectBinding
  | SceneGestureNativeEffectBinding;

type SceneDesktopRippleNativeEffect = {
  implementation: 'aos.scene.effect.desktop-ripple';
  parameters: {
    amplitude?: number;
    decay?: number;
    durationMs?: number;
    frequency?: number;
    radius?: number;
    speed?: number;
  };
};

type SceneProgramNativeEffect = {
  implementation: 'aos.scene.effect.program';
  programId: string;
  parameters: Record<string, number>;
};

export type SceneNativeEffectDescriptor = SceneNativeEffectBinding & (
  | SceneDesktopRippleNativeEffect
  | SceneProgramNativeEffect
);

export type SceneNativeEffectDescriptorList =
  | [SceneNativeEffectDescriptor]
  | [SceneNativeEffectDescriptor, SceneNativeEffectDescriptor]
  | [SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor]
  | [SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor]
  | [SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor, SceneNativeEffectDescriptor];

export const SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID: 'aos.scene.native-effect-program.v1';
export const SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID: 'aos.scene.native-effect-program.v2';
export const SCENE_NATIVE_EFFECT_PROGRAM_V3_CONTRACT_ID: 'aos.scene.native-effect-program.v3';
export const SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_IDS: readonly [
  typeof SCENE_NATIVE_EFFECT_PROGRAM_CONTRACT_ID,
  typeof SCENE_NATIVE_EFFECT_PROGRAM_V2_CONTRACT_ID,
  typeof SCENE_NATIVE_EFFECT_PROGRAM_V3_CONTRACT_ID,
];
export const SCENE_NATIVE_EFFECT_PROGRAM_IMPLEMENTATION: 'aos.scene.effect.program';
export const SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID: 'aos.scene.native-effect-glsl.v1';
export const SCENE_NATIVE_EFFECT_PROGRAM_DIGEST_CONTRACT_ID: 'aos.scene.native-effect-program-digest.v1';
export const SCENE_NATIVE_EFFECT_PROGRAM_LIMITS: Readonly<{
  maxConstantMagnitude: 1000000;
  maxDurationMs: 3000;
  maxGeometryCellSize: 64;
  maxGeometryPadding: 512;
  maxHeightFieldDimension: 256;
  maxHeightFieldLobes: 4;
  maxHeightFieldSubsteps: 4;
  maxGeometryExtent: 5000;
  maxNodes: 64;
  maxNormalSampleDistance: 64;
  maxParameters: 16;
  maxPerspectiveDistance: 20000;
  maxPositionOffset: 512;
  maxPrograms: 8;
  maxSerializedBytes: 32768;
  maxTextureDisplacement: 96;
  maxTranscendentalOperations: 16;
  minDurationMs: 100;
  minGeometryCellSize: 2;
  minHeightFieldDimension: 32;
  minNormalSampleDistance: 0.25;
  minPerspectiveDistance: 256;
}>;
export const SCENE_NATIVE_EFFECT_PROGRAM_OPERATORS: readonly SceneNativeEffectProgramNode['op'][];
export function validateSceneNativeEffectProgram(program: unknown): SceneValidationResult;
export function digestSceneNativeEffectProgram(
  program: SceneNativeEffectProgram,
): Promise<string>;
export function validateSceneNativeEffectParameters(
  program: SceneNativeEffectProgram,
  values: unknown,
  path?: string,
): SceneValidationResult;
export function createSceneNativeEffectProgram(program: SceneNativeEffectProgram): Readonly<SceneNativeEffectProgram>;
export interface SceneNativeEffectGLSLProgram {
  contract: typeof SCENE_NATIVE_EFFECT_GLSL_CONTRACT_ID;
  schemaVersion: 1;
  geometry: Readonly<SceneNativeEffectProgramGeometry> | null;
  material: Readonly<SceneNativeEffectProgramMaterial> | null;
  parameterIds: readonly string[];
  source: string;
}
export function compileSceneNativeEffectProgramGLSL(
  program: SceneNativeEffectProgram,
): Readonly<SceneNativeEffectGLSLProgram>;

export interface SceneCartridgeInteractions {
  contract: typeof SCENE_CARTRIDGE_INTERACTIONS_CONTRACT_ID;
  schemaVersion: 1;
  affordances?: SceneAffordanceDescriptor[];
  nativeEffectPrograms?: SceneNativeEffectProgram[];
  interactions: SceneCartridgeInteraction[];
}

export interface SceneCartridge {
  manifest: SceneCartridgeManifest;
  scene: SceneDocument;
  animations: SceneCartridgeAnimations;
  interactions: SceneCartridgeInteractions;
  assets?: SceneCartridgeAsset[];
}

export interface ResolvedSceneCartridge {
  manifest: SceneCartridgeManifest;
  document: SceneDocument;
  animations: SceneCartridgeAnimations;
  interactions: SceneCartridgeInteractions;
  assets: SceneCartridgeAsset[];
  requiredImplementations: string[];
}

export const SCENE_CARTRIDGE_CONTRACT_ID: 'aos.scene.cartridge.v1';
export const SCENE_CARTRIDGE_ANIMATIONS_CONTRACT_ID: 'aos.scene.cartridge.animations.v1';
export const SCENE_CARTRIDGE_INTERACTIONS_CONTRACT_ID: 'aos.scene.cartridge.interactions.v1';
export const SCENE_CARTRIDGE_IMPLEMENTATIONS: Readonly<{
  dragRecognizer: 'aos.scene.gesture.drag';
  longPressRecognizer: 'aos.scene.gesture.long-press';
  radialRecognizer: 'aos.scene.gesture.radial';
  tapRecognizer: 'aos.scene.gesture.tap';
  aimCommitResponse: 'aos.scene.response.aim-commit';
  dropResponse: 'aos.scene.response.drop';
  radialMenuResponse: 'aos.scene.response.radial-menu';
  signalGraphResponse: 'aos.scene.response.signal-graph';
  translateResponse: 'aos.scene.response.translate';
  nativeEffectProgram: 'aos.scene.effect.program';
  desktopRippleEffect: 'aos.scene.effect.desktop-ripple';
}>;
export const SCENE_CARTRIDGE_LIMITS: Readonly<SceneCartridgeBudgets>;

export function validateSceneCartridgeManifest(manifest: unknown): SceneValidationResult;
export function validateSceneCartridge(
  cartridge: unknown,
  options?: { registry?: SceneImplementationRegistry },
): SceneValidationResult;
export function resolveSceneCartridge(
  cartridge: SceneCartridge,
  options?: { registry?: SceneImplementationRegistry },
): Readonly<ResolvedSceneCartridge>;

export interface SceneTransactionSuccess {
  ok: true;
  document: SceneDocument;
  previousRevision: number;
  revision: number;
  transactionId: string;
}

export interface SceneOperationFailure {
  ok: false;
  code: string;
  errors: SceneValidationError[];
}

export function applySceneTransaction(
  document: unknown,
  transaction: unknown,
  options?: { lease?: SceneLease },
): SceneTransactionSuccess | SceneOperationFailure;

export type SceneImplementationKind =
  | 'component'
  | 'effect'
  | 'geometry'
  | 'material'
  | 'shader'
  | 'texture';

export interface SceneImplementationContext {
  [key: string]: unknown;
}

export interface SceneImplementationEntry {
  id: string;
  kind: SceneImplementationKind;
  builtin?: boolean;
  create?: (context: SceneImplementationContext) => unknown;
  update?: (context: SceneImplementationContext) => unknown;
  dispose?: (context: SceneImplementationContext) => unknown;
  validateParameters?: (parameters: Record<string, SceneJsonValue>) => true | string;
}

export interface SceneImplementationRequirement {
  id: string;
  kind: SceneImplementationKind;
  sourceId: string;
  sourceKind: 'component' | 'resource';
}

export interface SceneImplementationRegistry {
  register(entry: SceneImplementationEntry & { create: NonNullable<SceneImplementationEntry['create']> }): Readonly<SceneImplementationEntry>;
  unregister(id: string): boolean;
  resolve(id: string, expectedKind?: SceneImplementationKind | null): Readonly<SceneImplementationEntry> | null;
  validateDocument(document: unknown): {
    ok: boolean;
    errors: SceneValidationError[];
    missing: SceneImplementationRequirement[];
    mismatched: Array<SceneImplementationRequirement & { registeredKind: SceneImplementationKind; reason?: string }>;
  };
  required(document: unknown): SceneImplementationRequirement[];
  snapshot(): {
    count: number;
    implementations: Array<{ id: string; kind: SceneImplementationKind; builtin: boolean }>;
  };
}

export const SCENE_IMPLEMENTATION_KINDS: readonly SceneImplementationKind[];
export function createSceneImplementationRegistry(input?: {
  entries?: Array<SceneImplementationEntry & { create: NonNullable<SceneImplementationEntry['create']> }>;
}): Readonly<SceneImplementationRegistry>;

export type SceneAnimationPlayback = 'once' | 'loop' | 'ping_pong';
export type SceneAnimationEasing = 'linear' | 'ease_in_out';

export interface SceneAnimationBinding {
  id: string;
  objectId: string;
  componentId: string;
  target: string;
  from: number;
  to: number;
  durationMs: number;
  delayMs: number;
  playback: SceneAnimationPlayback;
  easing: SceneAnimationEasing;
}

export interface SceneAnimationController {
  tick(elapsedMs: number): number;
  snapshot(): {
    bindings: Array<Pick<SceneAnimationBinding, 'id' | 'objectId' | 'componentId' | 'target' | 'playback'>>;
    completed: number;
    disposed: boolean;
    failures: number;
    frames: number;
  };
  restart(): boolean;
  dispose(): boolean;
}

export const SCENE_ANIMATION_BINDING_IMPLEMENTATION_ID: 'aos.scene.animation.bind';
export function compileSceneAnimationBindings(
  document: unknown,
  options?: { maxBindings?: number },
): { ok: boolean; bindings: Readonly<SceneAnimationBinding>[]; errors: SceneValidationError[] };
export function createSceneAnimationController(
  document: unknown,
  options: {
    apply: (
      binding: Readonly<SceneAnimationBinding>,
      value: number,
      elapsedMs: number,
      progress: number,
    ) => unknown;
    onComplete?: (
      binding: Readonly<SceneAnimationBinding>,
      value: number,
      elapsedMs: number,
    ) => unknown;
    maxBindings?: number;
  },
): Readonly<SceneAnimationController>;

export interface SceneSignalBinding {
  id: string;
  objectId: string;
  componentId: string;
  signalId: string;
  target: string;
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  smoothingMs: number;
  clamp: boolean;
}

export interface SceneSignalController {
  publish(signalId: string, input: number, at?: number): number;
  snapshot(): {
    bindings: Array<Pick<SceneSignalBinding, 'id' | 'objectId' | 'componentId' | 'signalId' | 'target'>>;
    disposed: boolean;
    failures: number;
    publications: number;
  };
  dispose(): boolean;
}

export const SCENE_SIGNAL_BINDING_IMPLEMENTATION_ID: 'aos.scene.signal.bind';
export function compileSceneSignalBindings(
  document: unknown,
  options?: { maxBindings?: number },
): { ok: boolean; bindings: Readonly<SceneSignalBinding>[]; errors: SceneValidationError[] };
export function createSceneSignalController(
  document: unknown,
  options: {
    apply: (
      binding: Readonly<SceneSignalBinding>,
      value: number,
      input: number,
      at: number,
    ) => unknown;
    maxBindings?: number;
    now?: () => number;
  },
): Readonly<SceneSignalController>;

export interface SceneHostBudgets {
  maxAnimationBindings: number;
  maxObjects: number;
  maxResources: number;
  maxSignalBindings: number;
}

export type SceneHostStatus =
  | 'idle'
  | 'mounting'
  | 'ready'
  | 'suspended'
  | 'context_lost'
  | 'recovering'
  | 'error'
  | 'disposed';

export interface SceneProjection {
  scene?: unknown;
  camera?: ThreeCameraLike | null;
  renderer?: ThreeRendererLike | null;
  manageViewport?: boolean;
  lifecycle?: ThreeRenderLifecycle;
  activate?(): unknown | Promise<unknown>;
  suspend?(): unknown;
  resume?(): unknown;
  contextLost?(): unknown;
  applyAnimation?(
    binding: Readonly<SceneAnimationBinding>,
    value: number,
    elapsedMs: number,
    progress: number,
  ): unknown;
  applySignal?(
    binding: Readonly<SceneSignalBinding>,
    value: number,
    input: number,
    at: number,
  ): unknown;
  dispose(): unknown | Promise<unknown>;
}

export interface SceneProjectionContext {
  budgets: Readonly<SceneHostBudgets>;
  document: SceneDocument;
  hostKind: 'local' | 'desktop-world' | string;
  lease: Readonly<SceneLease>;
  reason: 'mount' | 'transaction' | 'context_recovery';
  registry: SceneImplementationRegistry;
  reportContextLost(): SceneHostSnapshot;
  tickAnimation(elapsedMs: number): number;
}

export interface SceneHostSnapshot {
  hostKind: string;
  status: SceneHostStatus;
  disposed: boolean;
  suspended: boolean;
  revision: number;
  objects: number;
  resources: number;
  budgets: Readonly<SceneHostBudgets>;
  transactions: number;
  contextLosses: number;
  recoveries: number;
  signalPublications: number;
  signalFailures: number;
  animationFrames: number;
  animationFailures: number;
  disposalErrors: Array<{ kind: string; message: string }>;
}

export interface SceneInspection {
  contract: typeof SCENE_INSPECTION_CONTRACT_ID;
  hostKind: string;
  lease: Readonly<SceneLease>;
  status: SceneHostStatus;
  revision: number;
  rootObjectId: string;
  objects: Array<Pick<SceneObjectDescriptor, 'id' | 'parentId' | 'kind' | 'visible'>>;
  resources: Array<Pick<SceneResourceDescriptor, 'id' | 'kind' | 'implementation' | 'asset'>>;
  metadataKeys: string[];
  implementations: {
    missing: Array<{ id: string; kind: SceneImplementationKind }>;
    mismatched: Array<{ id: string; kind: SceneImplementationKind; registeredKind: SceneImplementationKind }>;
  };
  signals: ReturnType<SceneSignalController['snapshot']>;
  animations: ReturnType<SceneAnimationController['snapshot']>;
  lifecycle: ThreeRenderLifecycleSnapshot | null;
}

export type SceneHostResult =
  | { ok: true; snapshot: SceneHostSnapshot }
  | SceneOperationFailure;

export interface SceneHost {
  mount(): Promise<SceneHostResult>;
  transact(transaction: SceneTransaction): Promise<(
    SceneTransactionSuccess & { snapshot: SceneHostSnapshot }
  ) | SceneOperationFailure>;
  publishSignal(signalId: string, value: number, at?: number): number;
  tick(elapsedMs: number): number;
  suspend(): SceneHostSnapshot;
  resume(): SceneHostSnapshot;
  markContextLost(): SceneHostSnapshot;
  recoverContext(): Promise<SceneHostResult>;
  inspect(): SceneInspection;
  snapshot(): SceneHostSnapshot;
  dispose(): Promise<SceneHostSnapshot>;
}

export interface SceneHostOptions {
  document: SceneDocument;
  lease: SceneLease;
  registry: SceneImplementationRegistry;
  prepareProjection(context: Readonly<SceneProjectionContext>): SceneProjection | Promise<SceneProjection>;
  budgets?: Partial<SceneHostBudgets>;
  now?: () => number;
  onStatusChange?: (status: SceneHostStatus) => void;
}

export const DEFAULT_SCENE_HOST_BUDGETS: Readonly<SceneHostBudgets>;
export const SCENE_INSPECTION_CONTRACT_ID: 'aos.scene.inspection.v1';
export function createLocalSceneViewportHost(options: SceneHostOptions): Readonly<SceneHost>;
export function createDesktopWorldSceneHost(options: SceneHostOptions & {
  surface: DesktopWorldSurfaceThree;
  surfaceHandlers?: Record<string, (...args: readonly unknown[]) => unknown>;
}): Readonly<SceneHost>;
