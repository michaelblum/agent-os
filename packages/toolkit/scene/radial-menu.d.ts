export * from './scene-radial-menu.js';

export interface RadialMenuLogicalItem {
  id: string;
  label: string;
  action: unknown;
  disabled: boolean;
  hidden: boolean;
  checked: boolean;
  current: boolean;
  role: string;
  shortcut: unknown;
  typeahead: string;
  close_on_select: boolean;
  target_surface: unknown;
  action_payload: unknown;
  submenu_ref: unknown;
  children: readonly RadialMenuLogicalItem[];
}

export interface RadialMenu3DItemDefinition {
  id: string;
  label: string;
  action?: unknown;
  color?: string;
  disabled?: boolean;
  hidden?: boolean;
  checked?: boolean;
  current?: boolean;
  role?: string;
  shortcut?: string;
  typeahead?: string;
  close_on_select?: boolean;
  target_surface?: Record<string, unknown> | null;
  action_payload?: unknown;
  children?: readonly RadialMenu3DItemDefinition[];
  submenu_ref?: string;
  geometry?: Record<string, unknown>;
  three?: Record<string, unknown>;
  effects?: readonly Record<string, unknown>[];
  activationTransition?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RadialMenu3DDefinition {
  kind: 'aos.radial_menu_3d';
  schema_version: string;
  id: string;
  label?: string;
  extends?: string;
  close_on_select?: boolean;
  defaults?: Record<string, unknown>;
  geometry?: Record<string, unknown>;
  scene?: {
    closeOnSelect?: boolean;
    radius?: number;
    spreadDegrees?: number;
    startAngle?: number;
    style?: {
      activeColor?: string;
      fillColor?: string;
      itemRadius?: number;
      opacity?: number;
    };
  };
  items: readonly RadialMenu3DItemDefinition[];
  [key: string]: unknown;
}

export interface ResolvedRadialMenu3DDefinition extends RadialMenu3DDefinition {
  logical_items: readonly RadialMenuLogicalItem[];
}

export interface RadialMenu3DVisualItemDefinition extends Omit<
  RadialMenu3DItemDefinition,
  'action' | 'action_payload' | 'children' | 'close_on_select' | 'role' | 'shortcut' | 'submenu_ref' | 'target_surface' | 'typeahead'
> {
  children?: readonly RadialMenu3DVisualItemDefinition[];
}

export interface RadialMenu3DVisualDefinition extends Omit<
  RadialMenu3DDefinition,
  'close_on_select' | 'extends' | 'items' | 'role' | 'typeahead'
> {
  items: readonly RadialMenu3DVisualItemDefinition[];
}

export interface SceneRadialMenuAuthoringError {
  code: string;
  path: string;
  message: string;
}

export interface CompiledSceneRadialMenuDefinition {
  contract: 'aos.scene.radial-menu-authoring.v1';
  parameters: import('./scene-radial-menu.js').SceneRadialMenuParameters;
  runtimeProjection: import('./scene-radial-menu.js').NormalizedSceneRadialMenuParameters;
  gestureProjection: Record<string, unknown>;
  logicalItems: readonly RadialMenuLogicalItem[];
  visualDefinition: RadialMenu3DVisualDefinition;
}

export const RADIAL_MENU_3D_KIND: 'aos.radial_menu_3d';
export const RADIAL_MENU_3D_SCHEMA_VERSION: string;
export function cloneRadialMenuConfig<T>(value: T): T;
export function mergeRadialMenuConfig<T>(base: T, override: unknown): T;
export function mergeRadialMenuDefinitions(base?: RadialMenu3DDefinition, override?: Partial<RadialMenu3DDefinition>): RadialMenu3DDefinition;
export function radialMenuGeometryConfig(menu?: RadialMenu3DDefinition): Record<string, unknown>;
export function resolveRadialMenuConfig(
  menu?: RadialMenu3DDefinition,
  options?: {
    base?: RadialMenu3DDefinition | null;
    allowExtends?: Record<string, RadialMenu3DDefinition>;
    strict?: boolean;
  },
): ResolvedRadialMenu3DDefinition;
export function validateRadialMenuDefinition(menu?: unknown): { ok: boolean; errors: string[] };

export const SCENE_RADIAL_MENU_AUTHORING_CONTRACT_ID: 'aos.scene.radial-menu-authoring.v1';
export const SCENE_RADIAL_MENU_AUTHORING_LIMITS: Readonly<{
  maxDefinitionBytes: number;
  maxDepth: 32;
  maxItems: 32;
  maxNodes: 4096;
}>;
export function validateSceneRadialMenuAuthoringDefinition(
  definition: RadialMenu3DDefinition,
  options?: Parameters<typeof resolveRadialMenuConfig>[1],
): Readonly<{ ok: boolean; errors: readonly SceneRadialMenuAuthoringError[] }>;
export function compileSceneRadialMenuDefinition(
  definition: RadialMenu3DDefinition,
  options?: Parameters<typeof resolveRadialMenuConfig>[1],
): Readonly<CompiledSceneRadialMenuDefinition>;

export const RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION: string;
export const DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET: string;
export const RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS: Readonly<Record<string, unknown>>;
export function normalizeRadialItemActivationTransition(value?: unknown): Record<string, unknown>;
export function radialItemActivationTransitionPreset(name?: string): Record<string, unknown>;
export function resolveRadialItemActivationTransition(item?: RadialMenu3DItemDefinition): Record<string, unknown>;
