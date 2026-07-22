import type { SceneCartridgeInteraction } from './index.js';
import type { SceneGestureFrame, SceneGestureResponse, SceneTopologySnapshot } from './scene-interaction.js';
import type { SceneRadialMenuLayout } from './scene-radial-menu.js';

export interface SceneAimArrowVisualStyle {
  accentColor: string;
  color: string;
  dashColor: string;
  dashGap: number;
  dashLength: number;
  dashOpacity: number;
  dashSpeed: number;
  dashWidth: number;
  glowColor: string;
  glowOpacity: number;
  glowWidth: number;
  headLength: number;
  headLengthDistanceFactor: number;
  headLengthMax: number;
  headLengthMin: number;
  headWingRadians: number;
  headWidth: number;
  originInset: number;
  originRingColor: string;
  originRingOpacity: number;
  originRingRadius: number;
  pulseHz: number;
  reticleColor: string;
  reticlePulse: number;
  reticleRadius: number;
  shaftWidth: number;
  trailCount: number;
  trailOpacity: number;
  trailSpacing: number;
}

export interface SceneWormholeVisualStyle {
  color: string;
  flash: number;
  ringRadius: number;
  spin: number;
}

export interface SceneAimVisualStyle {
  arrow: Readonly<SceneAimArrowVisualStyle>;
  durationMs: number;
  easing: 'ease_in_out_cubic' | 'ease_out_quart' | 'linear' | 'smoothstep';
  route: 'line' | 'wormhole';
  wormhole: Readonly<SceneWormholeVisualStyle>;
}

export interface SceneRadialVisualItem {
  color: string | null;
  disabled: boolean;
  index: number;
}

export interface SceneRadialVisualStyle {
  activeColor: string;
  fillColor: string;
  itemRadius: number;
  items: readonly Readonly<SceneRadialVisualItem>[];
  opacity: number;
  radius: number;
}

export interface SceneInteractionVisualEvent {
  frame: SceneGestureFrame;
  response: SceneGestureResponse;
  interaction?: SceneCartridgeInteraction;
  radialLayout?: Readonly<SceneRadialMenuLayout>;
  topology?: SceneTopologySnapshot | null;
}

export interface SceneInteractionVisualModel {
  arrow: {
    visible: boolean;
    origin: Float64Array;
    pointer: Float64Array;
    angle: number;
    distance: number;
    pulse: number;
    style: Readonly<SceneAimArrowVisualStyle>;
  };
  radial: {
    visible: boolean;
    center: Float64Array;
    positions: Float64Array;
    colors: Array<string | null>;
    disabled: Uint8Array;
    itemCount: number;
    selectionIndex: number;
    style: Readonly<SceneRadialVisualStyle>;
  };
  route: {
    active: boolean;
    kind: 'line' | 'wormhole';
    objectId: string | null;
    origin: Float64Array;
    destination: Float64Array;
    localDestination: Float64Array;
    position: Float64Array;
    progress: number;
    opacity: number;
    scale: number;
    originRing: number;
    destinationRing: number;
    flash: number;
    generation: number;
    startedAt: number;
    durationMs: number;
    style: Readonly<SceneAimVisualStyle>;
  };
}

export interface SceneInteractionVisualSnapshot {
  arrow: Readonly<{ visible: boolean; origin: number[]; pointer: number[]; distance: number }>;
  disposed: boolean;
  radial: Readonly<{ visible: boolean; center: number[]; itemCount: number; selectionIndex: number }>;
  route: Readonly<{ active: boolean; kind: 'line' | 'wormhole'; objectId: string | null; position: number[]; progress: number }>;
  suspended: boolean;
}

export interface SceneInteractionVisualController {
  apply(event: SceneInteractionVisualEvent): Readonly<{ accepted: boolean; routeStarted: boolean }>;
  cancel(): boolean;
  dispose(): boolean;
  resume(at?: number): boolean;
  snapshot(): Readonly<SceneInteractionVisualSnapshot>;
  suspend(at?: number): boolean;
  tick(at?: number): boolean;
}

export const SCENE_INTERACTION_VISUAL_LIMITS: Readonly<{
  maxRadialItems: number;
  maxRouteDurationMs: number;
  maxTrailCount: number;
}>;

export function resolveSceneAimVisualStyle(parameters?: Record<string, unknown>): Readonly<SceneAimVisualStyle>;
export function resolveSceneRadialVisualStyle(parameters?: Record<string, unknown>): Readonly<SceneRadialVisualStyle>;
export function createSceneInteractionVisualController(options?: {
  now?: () => number;
  onFrame?: (model: SceneInteractionVisualModel, at: number) => void;
}): SceneInteractionVisualController;
