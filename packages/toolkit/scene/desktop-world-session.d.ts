import type {
  SceneDocument,
  SceneLease,
  SceneTransaction,
} from './index.js';
import type {
  SceneEventEnvelope,
  SceneInteractionDocument,
} from './scene-interaction.js';
import type { SceneExtensionReference } from './scene-extension.js';

export const DESKTOP_WORLD_SCENE_SESSION_CONTRACT_ID: 'aos.desktop-world.scene-session.snapshot.v1';
export const DESKTOP_WORLD_SCENE_SESSION_EVENT_NAMES: readonly ['gesture'];
export const DESKTOP_WORLD_SCENE_SESSION_RECOVERABLE_CODES: readonly string[];
export const DESKTOP_WORLD_SCENE_SESSION_TERMINAL_CODES: readonly string[];

export type DesktopWorldSceneSessionStatus =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'recovering'
  | 'closing'
  | 'closed'
  | 'faulted';

export type DesktopWorldSceneSessionEventName = 'gesture';

export interface DesktopWorldSceneSessionSnapshot {
  contract: typeof DESKTOP_WORLD_SCENE_SESSION_CONTRACT_ID;
  stageId: 'desktop-world/main';
  ownerId: string;
  resourceId: string;
  status: DesktopWorldSceneSessionStatus;
  generation: number;
  mounted: boolean;
  committedRevision: number | null;
  suspended: boolean;
  subscriptions: readonly DesktopWorldSceneSessionEventName[];
  recoveryAttempts: number;
  lastErrorCode: string | null;
  listenerErrors: number;
}

export type DesktopWorldSceneOperationName =
  | 'mount'
  | 'transact'
  | 'signal'
  | 'play'
  | 'suspend'
  | 'resume'
  | 'inspect'
  | 'subscribe'
  | 'unsubscribe'
  | 'remove'
  | 'close';

export type DesktopWorldSceneOperation =
  | { op: 'mount'; document: SceneDocument; interactions?: SceneInteractionDocument; extension?: SceneExtensionReference }
  | { op: 'transact'; transaction: SceneTransaction; lease: SceneLease }
  | { op: 'signal'; signalId: string; value: number; at?: number }
  | { op: 'play'; animationId?: string }
  | { op: 'subscribe'; events: DesktopWorldSceneSessionEventName[] }
  | { op: 'unsubscribe'; events?: DesktopWorldSceneSessionEventName[] }
  | { op: 'suspend' | 'resume' | 'inspect' | 'remove' | 'close' };

export interface DesktopWorldSceneOperationResult {
  operation: DesktopWorldSceneOperationName;
  resource: string;
  status: 'ok';
  snapshot?: Readonly<Record<string, unknown>>;
  events?: readonly DesktopWorldSceneSessionEventName[];
}

export interface DesktopWorldSceneFollowTransport {
  readonly completed: Promise<unknown>;
  send(operation: DesktopWorldSceneOperation): DesktopWorldSceneOperationResult | Promise<DesktopWorldSceneOperationResult>;
  subscribe(
    eventName: DesktopWorldSceneSessionEventName,
    listener: (event: SceneEventEnvelope) => void,
  ): (() => unknown) | Promise<() => unknown>;
  close(): unknown | Promise<unknown>;
}

export interface DesktopWorldSceneSession {
  open(): Promise<DesktopWorldSceneSessionSnapshot>;
  mount(input: {
    document: SceneDocument;
    interactions?: SceneInteractionDocument;
    extension?: SceneExtensionReference;
  }): Promise<DesktopWorldSceneOperationResult>;
  transact(transaction: SceneTransaction): Promise<DesktopWorldSceneOperationResult>;
  signal(signalId: string, value: number, at?: number): Promise<DesktopWorldSceneOperationResult>;
  play(animationId?: string): Promise<DesktopWorldSceneOperationResult>;
  suspend(): Promise<DesktopWorldSceneOperationResult>;
  resume(): Promise<DesktopWorldSceneOperationResult>;
  inspect(): Promise<DesktopWorldSceneOperationResult>;
  subscribe(
    eventName: DesktopWorldSceneSessionEventName,
    listener: (event: SceneEventEnvelope) => void,
  ): Promise<() => Promise<DesktopWorldSceneSessionSnapshot>>;
  remove(): Promise<DesktopWorldSceneOperationResult>;
  close(): Promise<DesktopWorldSceneSessionSnapshot>;
  snapshot(): DesktopWorldSceneSessionSnapshot;
}

export function createDesktopWorldSceneSession(options: {
  stageId?: 'desktop-world/main';
  ownerId: string;
  resourceId: string;
  connect(identity: Readonly<{
    stageId: 'desktop-world/main';
    ownerId: string;
    resourceId: string;
    generation: number;
  }>): DesktopWorldSceneFollowTransport | Promise<DesktopWorldSceneFollowTransport>;
}): Readonly<DesktopWorldSceneSession>;
