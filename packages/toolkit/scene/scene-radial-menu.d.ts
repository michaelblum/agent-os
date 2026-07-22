import type { SceneCartridgeInteraction, SceneGestureFrame, ScenePoint, SceneTopologySnapshot } from './scene-interaction.js';

export interface SceneRadialMenuItemDescriptor {
  id: string;
  label?: string;
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
  items: ReadonlyArray<Readonly<{
    id: string;
    color: string;
    disabled: boolean;
  }>>;
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

export interface SceneRadialMenuLayout {
  center: Readonly<ScenePoint>;
  items: ReadonlyArray<Readonly<SceneRadialMenuItemDescriptor & {
    center: Readonly<ScenePoint>;
    hitRadius: number;
    index: number;
  }>>;
  parameters: Readonly<NormalizedSceneRadialMenuParameters>;
}

export const SCENE_RADIAL_MENU_LIMITS: Readonly<{
  maxItems: 32;
  maxLabelLength: 128;
  maxRadius: 2048;
  maxItemRadius: 128;
}>;

export function normalizeSceneRadialMenuParameters(parameters?: Partial<SceneRadialMenuParameters>): Readonly<NormalizedSceneRadialMenuParameters>;
export function resolveSceneRadialMenuItemLabel(parameters: Partial<SceneRadialMenuParameters>, itemId: string): string;
export function validateSceneRadialMenuParameters(parameters: unknown, path?: string): Array<{ code: string; path: string; message: string }>;
export function resolveSceneRadialMenuLayout(response: SceneRadialMenuParameters & { origin?: ScenePoint | null }, topology?: SceneTopologySnapshot | null): Readonly<SceneRadialMenuLayout>;
export function resolveSceneRadialMenuResponse(options: { frame: SceneGestureFrame; interaction: SceneCartridgeInteraction }): Readonly<Record<string, unknown>>;
export function withSceneRadialSelection(frame: SceneGestureFrame, interaction: SceneCartridgeInteraction): SceneGestureFrame;
