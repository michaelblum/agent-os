import type {
  DesktopWorldDevToolsHostKind,
  DesktopWorldDevToolsSnapshot,
  DesktopWorldDevToolsStageSnapshot,
  DesktopWorldDevToolsTab,
} from './desktop-world-devtools.js';
import type { SceneEventEnvelope } from './scene-interaction.js';

export type DesktopWorldSceneMaybePromise<T> = T | Promise<T>;

export const DESKTOP_WORLD_SCENE_REPLAY_LIMITS: Readonly<{ events: 10000; resources: 128 }>;

export interface DesktopWorldSceneResourceSummary {
  id: string;
  owner: string;
  sceneId: string;
  revision: number;
  lifecycle: string;
  suspended: boolean;
  errorCode: string | null;
}

export interface DesktopWorldSceneResourceList {
  stage: 'desktop-world/main';
  sequence: number;
  status: DesktopWorldDevToolsStageSnapshot['status'];
  resources: ReadonlyArray<Readonly<DesktopWorldSceneResourceSummary>>;
}

export interface DesktopWorldScenePerformanceSnapshot {
  status: 'ok';
  scope: 'stage-segment';
  resource: DesktopWorldDevToolsStageSnapshot['resources'][number];
  displays: DesktopWorldDevToolsStageSnapshot['displayPerformance'];
}

export interface DesktopWorldSceneReplaySummary {
  status: 'ok';
  contract: 'aos.scene.replay.v1';
  eventCount: number;
  resourceCount: number;
  resources: readonly string[];
  completedGestures: number;
  canceledGestures: number;
  finalPositions: Readonly<Record<string, readonly [number, number, number]>>;
}

export interface DesktopWorldSceneMonitorEnvelope {
  v: 1;
  service: 'scene';
  event: 'monitor';
  ref?: string;
  ts?: number;
  data: Readonly<{ resource: string; snapshot: DesktopWorldDevToolsStageSnapshot }>;
}

export interface DesktopWorldDevToolsMutationResponse {
  status: 'ok';
  session: DesktopWorldDevToolsSnapshot;
}

export type DesktopWorldDevToolsStatusResponse =
  | Readonly<{ status: 'ok'; session: DesktopWorldDevToolsSnapshot }>
  | Readonly<{ status: 'ok'; sessions: ReadonlyArray<DesktopWorldDevToolsSnapshot> }>;

export interface DesktopWorldDevToolsCloseResponse {
  status: 'ok';
  session: string;
  closed: true;
}

export interface DesktopWorldDevToolsHostInput {
  kind: DesktopWorldDevToolsHostKind;
  id: string;
}

export interface DesktopWorldDevToolsUpdateInput {
  selected_resource?: string | null;
  active_tab?: DesktopWorldDevToolsTab;
  filters?: Readonly<{ query?: string; event_kinds?: readonly string[]; errors_only?: boolean }>;
  recording?: boolean;
}

export interface DesktopWorldSceneTransportRequest {
  service: 'scene';
  action: string;
  data: Record<string, unknown>;
}

export interface DesktopWorldSceneMonitorOptions {
  follow?: boolean;
}

export type DesktopWorldSceneEffectTriggerPhase =
  | 'pointer_down'
  | 'start'
  | 'update'
  | 'end'
  | 'cancel';

export interface DesktopWorldSceneEffectProgramIdentity {
  id: string;
  revision: number;
  digest: string;
}

export interface DesktopWorldSceneEffectTriggerInput {
  owner: string;
  resource: string;
  affordance: string;
  interaction: string;
  phase: DesktopWorldSceneEffectTriggerPhase;
  origin: Readonly<{ x: number; y: number }>;
  current: Readonly<{ x: number; y: number }>;
  pointerSession: string;
  sequence: number;
  expectedRevision: number;
  expectedProgram: Readonly<DesktopWorldSceneEffectProgramIdentity>;
  dryRun?: boolean;
}

export interface DesktopWorldSceneEffectTriggerResult {
  status: 'ok';
  contract: 'aos.scene.effect-trigger.v1';
  owner: string;
  resource: string;
  affordance: string;
  interaction: string;
  phase: DesktopWorldSceneEffectTriggerPhase;
  resource_revision: number;
  program: Readonly<DesktopWorldSceneEffectProgramIdentity>;
  dry_run: boolean;
  binding_validated: true;
  accepted: boolean;
}

export interface DesktopWorldSceneClient<TSubscription = unknown> {
  list(): Promise<Readonly<DesktopWorldSceneResourceList>>;
  inspect(resource: string): Promise<DesktopWorldDevToolsStageSnapshot>;
  perf(resource: string): Promise<Readonly<DesktopWorldScenePerformanceSnapshot>>;
  monitor(resource: string, options?: DesktopWorldSceneMonitorOptions): TSubscription;
  effect: Readonly<{
    trigger(
      input: DesktopWorldSceneEffectTriggerInput,
    ): DesktopWorldSceneMaybePromise<Readonly<DesktopWorldSceneEffectTriggerResult>>;
  }>;
  replay: typeof replayDesktopWorldSceneEvents;
  devtools: Readonly<{
    open(options?: {
      resource?: string | null;
      host?: DesktopWorldDevToolsHostInput | null;
      headless?: boolean;
    }): DesktopWorldSceneMaybePromise<DesktopWorldDevToolsMutationResponse>;
    status(session?: string | null): DesktopWorldSceneMaybePromise<DesktopWorldDevToolsStatusResponse>;
    update(
      session: string,
      expectedRevision: number,
      changes?: DesktopWorldDevToolsUpdateInput,
    ): DesktopWorldSceneMaybePromise<DesktopWorldDevToolsMutationResponse>;
    transfer(
      session: string,
      expectedRevision: number,
      host: DesktopWorldDevToolsHostInput,
    ): DesktopWorldSceneMaybePromise<DesktopWorldDevToolsMutationResponse>;
    close(
      session: string,
      expectedRevision?: number | null,
    ): DesktopWorldSceneMaybePromise<DesktopWorldDevToolsCloseResponse>;
  }>;
}

export function selectDesktopWorldResourceSnapshot(
  input: unknown,
  resource: string,
): DesktopWorldDevToolsStageSnapshot;

export function listDesktopWorldResources(input: unknown): Readonly<DesktopWorldSceneResourceList>;

export function normalizeDesktopWorldSceneEvent(input: unknown): SceneEventEnvelope;

export function replayDesktopWorldSceneEvents(
  events: readonly unknown[],
  options?: { onEvent?: (event: SceneEventEnvelope) => void },
): DesktopWorldSceneReplaySummary;

export function createDesktopWorldSceneClient<TSubscription = unknown>(options: {
  request: (request: DesktopWorldSceneTransportRequest) => DesktopWorldSceneMaybePromise<unknown>;
  subscribe?: (request: DesktopWorldSceneTransportRequest & Record<string, unknown>) => TSubscription;
}): Readonly<DesktopWorldSceneClient<TSubscription>>;
