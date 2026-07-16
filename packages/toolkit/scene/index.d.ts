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
}

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
