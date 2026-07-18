import type { SceneCartridgeInteraction, SceneGestureFrame, ScenePoint, SceneTopologySnapshot } from './scene-interaction.js';

export interface SceneRadialMenuItemDescriptor {
  id: string;
  color?: string;
  disabled?: boolean;
}

export interface SceneRadialMenuParameters {
  menuId: string;
  items: readonly SceneRadialMenuItemDescriptor[];
  radius?: number;
  startAngle?: number;
  spreadDegrees?: number;
  closeOnSelect?: boolean;
  style?: {
    activeColor?: string;
    fillColor?: string;
    itemRadius?: number;
    opacity?: number;
  };
}

export interface NormalizedSceneRadialMenuParameters {
  menuId: string;
  items: ReadonlyArray<Readonly<Required<SceneRadialMenuItemDescriptor>>>;
  radius: number;
  startAngle: number;
  spreadDegrees: number;
  closeOnSelect: boolean;
  style: Readonly<{
    activeColor: string;
    fillColor: string;
    itemRadius: number;
    opacity: number;
  }>;
}

export const SCENE_RADIAL_MENU_LIMITS: Readonly<{
  maxItems: 32;
  maxRadius: 2048;
  maxItemRadius: 128;
}>;

export function normalizeSceneRadialMenuParameters(parameters?: Partial<SceneRadialMenuParameters>): Readonly<NormalizedSceneRadialMenuParameters>;
export function validateSceneRadialMenuParameters(parameters: unknown, path?: string): Array<{ code: string; path: string; message: string }>;
export function resolveSceneRadialMenuLayout(response: SceneRadialMenuParameters & { origin?: ScenePoint | null }, topology?: SceneTopologySnapshot | null): Readonly<{
  center: Readonly<ScenePoint>;
  items: ReadonlyArray<Readonly<SceneRadialMenuItemDescriptor & { index: number; center: Readonly<ScenePoint>; hitRadius: number }>>;
  parameters: Readonly<NormalizedSceneRadialMenuParameters>;
}>; 
export function resolveSceneRadialMenuResponse(options: { frame: SceneGestureFrame; interaction: SceneCartridgeInteraction }): Readonly<Record<string, unknown>>;
export function withSceneRadialSelection(frame: SceneGestureFrame, interaction: SceneCartridgeInteraction): SceneGestureFrame;
