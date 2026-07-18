import type {
  SceneCartridgeInteraction,
  SceneCartridgeInteractionImplementation,
  SceneCartridgeInteractions,
  SceneDocument,
  SceneValidationResult,
} from './index.js';

export type GestureRecognizerDescriptor = SceneCartridgeInteractionImplementation;
export type GestureResponseDescriptor = SceneCartridgeInteractionImplementation;

export interface SceneAffordanceDescriptor {
  id: string;
  objectId: string;
  geometry: {
    kind: 'rect';
    width: number;
    height: number;
    offset: [number, number];
  };
  enabled: boolean;
  priority: number;
  consumePolicy: 'always' | 'captured' | 'down_only' | 'never';
  metadata: Record<string, string | number | boolean>;
}

export type SceneGestureKind = 'tap' | 'drag' | 'long_press' | 'radial';
export type SceneGesturePhase = 'start' | 'update' | 'end' | 'cancel';
export type SceneGestureCancellationReason =
  | 'escape'
  | 'owner_disconnected'
  | 'pointer_cancelled'
  | 'resource_changed'
  | 'resource_removed'
  | 'resource_suspended'
  | 'stage_disposed'
  | 'topology_changed';

export interface ScenePoint {
  x: number;
  y: number;
}

export interface SceneGestureFrame {
  gesture_id: string;
  gesture_type: SceneGestureKind;
  phase: SceneGesturePhase;
  affordanceId: string;
  interactionId: string;
  origin: ScenePoint | null;
  previous: ScenePoint | null;
  current: ScenePoint | null;
  delta: ScenePoint | null;
  total_delta: ScenePoint | null;
  coordinates?: { desktop_world?: ScenePoint; native?: ScenePoint };
  pointer?: { capture_id?: string | null };
  timing?: { t?: number; frame_index?: number };
  cancelReason?: SceneGestureCancellationReason | null;
}

export interface SceneTopologySnapshot {
  displays: Array<{
    displayId: number | string | null;
    index: number | null;
    bounds: [number, number, number, number] | null;
  }>;
}

export interface SceneGestureAppliedResponse {
  applied?: boolean;
  revision?: number;
}

export interface SceneTranslateResponse extends SceneGestureAppliedResponse {
  kind: 'translate';
  objectId: string;
  position: [number, number, number];
}

export interface SceneAimCommitResponse extends SceneGestureAppliedResponse {
  kind: 'aim_commit';
  objectId: string;
  origin: ScenePoint | null;
  pointer: ScenePoint | null;
  angle: number;
  distance: number;
  route: 'line' | 'wormhole';
}

export interface SceneDropResponse extends SceneGestureAppliedResponse {
  kind: 'drop';
  objectId: string;
  point: ScenePoint | null;
}

export interface SceneSignalGraphResponse extends SceneGestureAppliedResponse {
  kind: 'signal_graph';
  signals: Array<{ signalId: string; value: number }>;
  appliedSignals?: number;
}

export type SceneGestureResponse =
  | SceneAimCommitResponse
  | SceneDropResponse
  | SceneSignalGraphResponse
  | SceneTranslateResponse;

export interface SceneEventEnvelope {
  contract: typeof SCENE_EVENT_CONTRACT_ID;
  schemaVersion: 1;
  type: 'gesture';
  sequence: number;
  stageId: string;
  ownerId: string;
  resourceId: string;
  affordanceId: string;
  interactionId: string;
  gesture: {
    id: string;
    kind: SceneGestureKind;
    phase: SceneGesturePhase;
    pointerSessionId: string | null;
    cancellationReason: string | null;
  };
  coordinates: {
    origin: ScenePoint | null;
    previous: ScenePoint | null;
    current: ScenePoint | null;
    desktopWorld: ScenePoint | null;
    native: ScenePoint | null;
    delta: ScenePoint | null;
    totalDelta: ScenePoint | null;
  };
  topology: SceneTopologySnapshot | null;
  response: SceneGestureResponse;
  at: number;
}

export interface SceneGestureArena {
  handle(message: unknown, options?: { now?: number }): boolean;
  tick(at?: number): boolean;
  flush(): boolean;
  cancel(reason?: string, at?: number): boolean;
  dispose(reason?: string): boolean;
  snapshot(): Readonly<{
    affordanceId: string;
    active: boolean;
    interactionId: string | null;
    pendingUpdate: boolean;
    pointerSessionId: string | null;
  }>;
}

export const SCENE_EVENT_CONTRACT_ID: 'aos.scene.event.v1';
export const SCENE_INTERACTIONS_CONTRACT_ID: 'aos.scene.cartridge.interactions.v1';
export const SCENE_GESTURE_KINDS: Readonly<{
  drag: 'drag';
  longPress: 'long_press';
  radial: 'radial';
  tap: 'tap';
}>;
export const SCENE_GESTURE_PHASES: Readonly<{
  start: 'start';
  update: 'update';
  end: 'end';
  cancel: 'cancel';
}>;
export const SCENE_GESTURE_CANCELLATION_REASONS: readonly SceneGestureCancellationReason[];
export const SCENE_AFFORDANCE_LIMITS: Readonly<{
  maxAffordances: 256;
  maxExtent: 4096;
  maxOffset: 1000000;
  maxPriority: 1000;
  maxRecognizersPerAffordance: 16;
}>;

export function validateSceneAffordanceDescriptor(
  descriptor: unknown,
  options?: { objectIds?: Set<string>; path?: string },
): SceneValidationResult;
export function validateSceneInteractionDocument(
  interactions: unknown,
  options?: { scene?: SceneDocument; maxInteractions?: number },
): SceneValidationResult;
export function resolveSceneAffordanceFrame(
  document: SceneDocument,
  descriptor: SceneAffordanceDescriptor,
): readonly [number, number, number, number];
export function createSceneGestureArena(options: {
  affordance: SceneAffordanceDescriptor;
  interactions: SceneCartridgeInteraction[];
  now?: () => number;
  scheduleFrame?: (callback: () => void) => void;
  scheduleTimer?: (callback: () => void, delay: number) => unknown;
  cancelTimer?: (timer: unknown) => void;
  onFrame?: (frame: SceneGestureFrame, interaction: SceneCartridgeInteraction) => void;
}): SceneGestureArena;
export function createSceneInteractionController(options: {
  identity: { stageId: string; ownerId: string; resourceId: string };
  document: SceneDocument | (() => SceneDocument);
  interactions: SceneCartridgeInteractions;
  topology?: SceneTopologySnapshot | (() => SceneTopologySnapshot | null) | null;
  now?: () => number;
  scheduleFrame?: (callback: () => void) => void;
  scheduleTimer?: (callback: () => void, delay: number) => unknown;
  cancelTimer?: (timer: unknown) => void;
  onResponse?: (event: Readonly<{
    affordance: SceneAffordanceDescriptor;
    document: SceneDocument;
    frame: SceneGestureFrame;
    interaction: SceneCartridgeInteraction;
    response: Readonly<SceneGestureResponse>;
  }>) => Readonly<{ applied?: boolean; appliedSignals?: number; revision?: number }> | null | void;
  onEvent?: (event: SceneEventEnvelope) => void;
}): Readonly<{
  affordances(): ReadonlyArray<Readonly<{ descriptor: SceneAffordanceDescriptor; frame: readonly [number, number, number, number] }>>;
  handle(affordanceId: string, message: unknown, options?: { now?: number }): boolean;
  tick(at?: number): boolean;
  cancel(reason?: string, at?: number): boolean;
  dispose(reason?: string): boolean;
  snapshot(): Readonly<Record<string, unknown>>;
}>;
export function resolveSceneGestureResponse(options: {
  document: SceneDocument;
  affordance: SceneAffordanceDescriptor;
  interaction: SceneCartridgeInteraction;
  frame: SceneGestureFrame;
}): Readonly<SceneGestureResponse>;
export function createSceneEventEnvelope(options: {
  identity: { stageId: string; ownerId: string; resourceId: string };
  frame: SceneGestureFrame;
  response: SceneGestureResponse;
  sequence: number;
  topology?: SceneTopologySnapshot | null;
  at?: number;
}): SceneEventEnvelope;
