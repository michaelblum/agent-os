import type {
  SceneAnimationBinding,
  SceneDocument,
  SceneSignalBinding,
  SceneValidationResult,
} from './index.js';

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

/**
 * Projection hooks are synchronous stage callbacks. The host ignores their
 * return value and rejects Promise-like results at runtime.
 */
export interface SceneExtensionProjection {
  object: SceneExtensionObject3D;
  activate?(): void;
  applySignal(binding: Readonly<SceneSignalBinding>, value: number): void;
  applyAnimation(binding: Readonly<SceneAnimationBinding>, value: number): void;
  tick(elapsedMs: number): void;
  suspend(): void;
  resume(): void;
  contextLost(): void;
  contextRestored(): void;
  dispose(): void;
}

export interface TrustedSceneExtensionFactory {
  manifest: SceneExtensionManifest;
  createProjection(context: Readonly<SceneExtensionProjectionContext>): SceneExtensionProjection;
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
