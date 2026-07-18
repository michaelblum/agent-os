export type DesktopWorldDevToolsTab = 'world' | 'resources' | 'interactions' | 'performance' | 'events';
export type DesktopWorldDevToolsHostKind = 'compatibility' | 'external' | 'panel';
export type DesktopWorldDevToolsHostState = 'activating' | 'active' | 'suspended';

export interface DesktopWorldDevToolsEvent {
  sequence: number;
  kind: string;
  resourceId: string | null;
  code: string | null;
  at: number;
}

export interface DesktopWorldDevToolsStageSnapshot {
  contract: typeof DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID;
  sequence: number;
  status: 'available' | 'unavailable' | 'unknown';
  world: {
    displays: ReadonlyArray<Readonly<{ id: string; index: number; bounds: readonly [number, number, number, number] }>>;
    nodes: ReadonlyArray<Readonly<{ id: string; resourceId: string; parentId: string | null; kind: string; implementation: string | null; position: readonly [number, number, number]; visible: boolean }>>;
    hitRegions: ReadonlyArray<Readonly<{ id: string; resourceId: string; affordanceId: string; frame: readonly [number, number, number, number]; registered: boolean }>>;
    affordances: ReadonlyArray<Readonly<{ id: string; resourceId: string; objectId: string; enabled: boolean; priority: number }>>;
    gestures: ReadonlyArray<Readonly<{ id: string; resourceId: string; affordanceId: string; interactionId: string; kind: string; phase: string; pointerSessionId: string | null }>>;
    routes: ReadonlyArray<Readonly<{ resourceId: string; kind: 'line' | 'wormhole'; active: boolean; progress: number; origin: readonly [number, number]; destination: readonly [number, number] }>>;
  };
  resources: ReadonlyArray<Readonly<{
    id: string;
    owner: string;
    sceneId: string;
    revision: number;
    suspended: boolean;
    objectCount: number;
    descriptorCount: number;
    animationCount: number;
    signalCount: number;
    interactionCount: number;
    implementations: readonly string[];
    allocations: Readonly<{ geometries: number; materials: number; textures: number; programs: number }>;
    lifecycle: string;
    errorCode: string | null;
  }>>;
  interactions: ReadonlyArray<Readonly<{
    id: string;
    resourceId: string;
    owner: string;
    active: boolean;
    suspended: boolean;
    recognizers: readonly string[];
    regionCount: number;
    errorCode: string | null;
  }>>;
  performance: Readonly<{
    enabled: boolean;
    recording: boolean;
    sampleCount: number;
    currentFps: number | null;
    p95FrameMs: number | null;
    avgFrameMs: number | null;
    avgRenderMs: number | null;
    avgUpdateMs: number | null;
    avgGpuMs: number | null;
    drawCalls: number | null;
    triangles: number | null;
    geometries: number | null;
    textures: number | null;
    programs: number | null;
    backingPixels: number | null;
    state: 'hot' | 'idle' | 'stable' | 'warn';
  }>;
  counters: Readonly<Record<'displays' | 'resources' | 'nodes' | 'hitRegions' | 'affordances' | 'activeGestures' | 'activeRoutes' | 'errors', number>>;
  events: ReadonlyArray<Readonly<DesktopWorldDevToolsEvent>>;
  lastError: Readonly<{ code: string; at: number }> | null;
}

export interface DesktopWorldDevToolsSnapshot {
  contract: typeof DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID;
  schemaVersion: 1;
  session: Readonly<DesktopWorldDevToolsSession>;
  stage: DesktopWorldDevToolsStageSnapshot;
}

export interface DesktopWorldDevToolsSession {
  id: string;
  revision: number;
  activeTab: DesktopWorldDevToolsTab;
  selectedResource: string | null;
  filters: Readonly<{ query: string; eventKinds: readonly string[]; errorsOnly: boolean }>;
  recording: boolean;
  host: Readonly<{ kind: DesktopWorldDevToolsHostKind; id: string; state: DesktopWorldDevToolsHostState }> | null;
}

export const DESKTOP_WORLD_DEVTOOLS_STAGE_CONTRACT_ID: 'aos.desktop-world.devtools.stage.v1';
export const DESKTOP_WORLD_DEVTOOLS_SNAPSHOT_CONTRACT_ID: 'aos.desktop-world.devtools.snapshot.v1';
export const DESKTOP_WORLD_DEVTOOLS_LIMITS: Readonly<{
  events: 256;
  filters: 16;
  hitRegions: 256;
  interactions: 256;
  nodes: 1024;
  performanceSamples: 240;
  resources: 32;
  string: 256;
}>;

export function normalizeDesktopWorldDevToolsStageSnapshot(input: unknown): DesktopWorldDevToolsStageSnapshot;
export function normalizeDesktopWorldDevToolsSnapshot(input: unknown): DesktopWorldDevToolsSnapshot;
export function createDesktopWorldGpuTimer(context: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): Readonly<{
  begin(): boolean;
  dispose(): boolean;
  end(): number | null;
  poll(): number | null;
  state(): Readonly<{ active: boolean; available: number; disposed: boolean; pending: number; supported: boolean }>;
}>;
export function buildDesktopWorldMinimapLayout(
  snapshot: DesktopWorldDevToolsSnapshot | DesktopWorldDevToolsStageSnapshot,
  options?: { width?: number; height?: number; padding?: number },
): Readonly<{
  bounds: readonly [number, number, number, number] | null;
  scale: number;
  displays: ReadonlyArray<Readonly<{ id: string; index: number; bounds: readonly [number, number, number, number]; frame: readonly number[] }>>;
  nodes: ReadonlyArray<Readonly<Record<string, unknown>>>;
  hitRegions: ReadonlyArray<Readonly<Record<string, unknown>>>;
}>;
export function createDesktopWorldDevToolsStageProbe(options?: {
  now?: () => number;
  emit?: (snapshot: DesktopWorldDevToolsStageSnapshot) => void;
  getStageFacts?: () => Readonly<{
    status?: DesktopWorldDevToolsStageSnapshot['status'];
    world?: Partial<DesktopWorldDevToolsStageSnapshot['world']>;
    resources?: DesktopWorldDevToolsStageSnapshot['resources'];
    interactions?: DesktopWorldDevToolsStageSnapshot['interactions'];
    lastError?: DesktopWorldDevToolsStageSnapshot['lastError'];
  }>;
}): Readonly<{
  configure(value?: { enabled?: boolean; recording?: boolean }): boolean;
  dispose(): boolean;
  emitSnapshot(reason?: string, at?: number): boolean;
  isEnabled(): boolean;
  isRecording(): boolean;
  recordEvent(value?: Partial<DesktopWorldDevToolsEvent>): boolean;
  sampleFrame(value?: Record<string, number | null | undefined>): boolean;
  snapshot(reason?: string): DesktopWorldDevToolsStageSnapshot;
  state(): Readonly<{ disposed: boolean; enabled: boolean; recording: boolean; eventCount: number; sampleCount: number; hasOwnFrameLoop: false }>;
}>;
