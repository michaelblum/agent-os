import type {
  SceneAnimationBinding,
  SceneDocument,
  SceneSignalBinding,
  SceneValidationResult,
} from './index.js';
import type { SceneInteractionVisualEvent } from './scene-interaction-visual.js';
import type { SceneExtensionInteractionRouteState } from './scene-extension-route-inspection.js';

export type SceneExtensionReadonly<T> =
  T extends (...args: never[]) => unknown ? never
    : T extends readonly (infer Item)[] ? readonly SceneExtensionReadonly<Item>[]
      : T extends object ? { readonly [Key in keyof T]: SceneExtensionReadonly<T[Key]> }
        : T;

export interface SceneExtensionBudgets {
  maxDrawCalls: number;
  maxObjects: number;
  maxResources: number;
  maxTextureBytes: number;
  maxTriangles: number;
  maxWorkingBytes: number;
}

export interface SceneExtensionManifest {
  contract: typeof SCENE_EXTENSION_CONTRACT_ID;
  schemaVersion: typeof SCENE_EXTENSION_SCHEMA_VERSION;
  id: string;
  ownerId: string;
  digest: string;
  sceneAbi: typeof SCENE_EXTENSION_SCENE_ABI;
  implementationIds: readonly string[];
  threeRevision: typeof SCENE_EXTENSION_THREE_REVISION;
  budgets: SceneExtensionBudgets;
  capabilities?: readonly SceneExtensionCapability[];
  framebufferProofs?: readonly SceneExtensionFramebufferProofDescriptor[];
}

export type SceneExtensionCapability =
  | 'aos.scene.desktop_frame_texture'
  | 'aos.scene.framebuffer_proof'
  | 'aos.scene.native_sheet_effect';

export interface SceneExtensionFramebufferProofDescriptor {
  id: string;
  matchingPixels: readonly [number, number];
  uvPermille: readonly [number, number];
  sampleSize: readonly [number, number];
  rgbaMin: readonly [number, number, number, number];
  rgbaMax: readonly [number, number, number, number];
}

export interface SceneDesktopFrameTextureSnapshot {
  bounds: readonly [number, number, number, number];
  captureDurationMs: number | null;
  capturedAtEpochMs: number | null;
  committedAtEpochMs: number | null;
  epochId: string | null;
  errorCode: string | null;
  generation: number;
  height: number;
  readyAtMs: number | null;
  status: 'empty' | 'loading' | 'refreshing' | 'staging' | 'presenting' | 'ready' | 'consent_required' | 'failed' | 'disposed';
  width: number;
}

export interface SceneDesktopFrameTextureSource {
  readonly texture: object;
  request(): boolean;
  clear(): boolean;
  snapshot(): Readonly<SceneDesktopFrameTextureSnapshot>;
}

export interface SceneExtensionReference {
  ownerId: string;
  id: string;
  digest: string;
  sceneAbi: typeof SCENE_EXTENSION_SCENE_ABI;
  threeRevision: typeof SCENE_EXTENSION_THREE_REVISION;
}

export interface SceneExtensionThreeNamespace {
  readonly REVISION: typeof SCENE_EXTENSION_THREE_REVISION;
  readonly [exportName: string]: unknown;
}

export interface SceneExtensionProjectionContext {
  THREE: SceneExtensionThreeNamespace;
  budgets: Readonly<SceneExtensionBudgets>;
  document: SceneDocument;
  desktopFrame?: Readonly<SceneDesktopFrameTextureSource> | null;
}

export interface SceneExtensionObject3D {
  readonly isObject3D: true;
  traverse(visitor: (object: object) => void): void;
}

export interface SceneExtensionProjectionResourceMetrics {
  drawCalls: number;
  geometryBytes: number;
  objects: number;
  resources: number;
  textureBytes: number;
  triangles: number;
  workingBytes: number;
}

export interface TrustedSceneExtensionFactoryContext
  extends SceneExtensionProjectionContext {
  inspectProjectionResources?(
    object: SceneExtensionObject3D,
  ): Readonly<SceneExtensionProjectionResourceMetrics>;
}

/**
 * Projection hooks are synchronous stage callbacks. The host ignores their
 * return value and rejects Promise-like results at runtime.
 */
export interface SceneExtensionProjection {
  object: SceneExtensionObject3D;
  overlayObject?: SceneExtensionObject3D;
  activate?(): void;
  /**
   * Optional product-owned visual response hook. Gesture recognition,
   * placement commits, hit regions, and event publication remain engine-owned.
   */
  applyInteraction?(event: SceneExtensionReadonly<SceneInteractionVisualEvent>):
    | boolean
    | Readonly<{ handled: boolean; routeStarted?: boolean }>;
  /**
   * Optional passive visual-only pointer notification. It cannot consume
   * input, select a gesture, or alter the canonical interaction response.
   */
  applyPointerVisual?(event: Readonly<{
    affordanceId: string;
    at: number;
    phase: 'down' | 'up';
    point: Readonly<{ x: number; y: number }>;
  }>): void;
  /**
   * Optional product-owned cursor art. AOS remains authoritative for region
   * arbitration and system-cursor visibility.
   */
  applyCursorPresentation?(event: Readonly<{
    affordanceId: string;
    at: number;
    mode: 'hover' | 'captured';
    phase: 'enter' | 'move' | 'leave';
    point: Readonly<{ x: number; y: number }>;
    visual: string | null;
  }>): void;
  /**
   * Optional bounded observability hook. It exposes only engine-defined
   * interaction facts and is sampled only while DesktopWorld inspection is
   * enabled.
   */
  inspectInteractionRoute?(): Readonly<SceneExtensionInteractionRouteState> | null;
  /**
   * Optional global DesktopWorld damage declaration. A missing declaration
   * preserves correctness by rendering the full display segment.
   */
  renderDamage?(): Readonly<
    | { kind: 'full_stage' }
    | { kind: 'bounded'; regions: ReadonlyArray<readonly [number, number, number, number]>; padding?: number }
  >;
  applySignal(binding: Readonly<SceneSignalBinding>, value: number): void;
  applyAnimation(binding: Readonly<SceneAnimationBinding>, value: number): void;
  tick(playbackElapsedMs: number, stageClockMs: number): void;
  suspend(): void;
  resume(): void;
  contextLost(): void;
  contextRestored(): void;
  dispose(): void;
}

export interface TrustedSceneExtensionFactory {
  manifest: SceneExtensionManifest;
  createProjection(
    context: Readonly<TrustedSceneExtensionFactoryContext>,
  ): SceneExtensionProjection;
}

export interface TrustedSceneExtensionHandle {
  readonly manifest: Readonly<SceneExtensionManifest>;
  createProjection(context: SceneExtensionProjectionContext): SceneExtensionProjection;
}

export interface TrustedSceneExtensionRegistrySnapshot {
  count: number;
  extensions: ReadonlyArray<Readonly<SceneExtensionManifest>>;
}

export interface TrustedSceneExtensionRegistry {
  register(factory: TrustedSceneExtensionFactory): Readonly<TrustedSceneExtensionHandle>;
  resolve(reference: SceneExtensionReference): Readonly<TrustedSceneExtensionHandle> | null;
  retain(reference: SceneExtensionReference): Readonly<{
    handle: Readonly<TrustedSceneExtensionHandle>;
    release(): boolean;
  }> | null;
  snapshot(): Readonly<TrustedSceneExtensionRegistrySnapshot>;
}

export const SCENE_EXTENSION_CONTRACT_ID: 'aos.scene.extension.v1';
export const SCENE_EXTENSION_REGISTRY_LIMIT: 64;
export const SCENE_EXTENSION_SCHEMA_VERSION: 1;
export const SCENE_EXTENSION_SCENE_ABI: 'aos.scene.projection.v1';
export const SCENE_EXTENSION_THREE_REVISION: '183';
export const SCENE_EXTENSION_CAPABILITIES: readonly SceneExtensionCapability[];
export const SCENE_EXTENSION_BUDGET_LIMITS: Readonly<SceneExtensionBudgets>;

export function validateSceneExtensionManifest(manifest: unknown): SceneValidationResult;
export function validateSceneExtensionReference(reference: unknown): SceneValidationResult;
export function validateSceneExtensionProjection(projection: unknown): SceneValidationResult;
export function inspectSceneExtensionProjectionResources(
  object: SceneExtensionObject3D,
): Readonly<SceneExtensionProjectionResourceMetrics>;
export function serializeSceneExtensionDigestMaterial(
  manifest: SceneExtensionManifest,
  bodyDigest: string,
): string;
export function createTrustedSceneExtensionRegistry(input?: {
  factories?: TrustedSceneExtensionFactory[];
}): Readonly<TrustedSceneExtensionRegistry>;
