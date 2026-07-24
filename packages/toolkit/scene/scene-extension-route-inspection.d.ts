export interface SceneExtensionInteractionRouteState {
  active: boolean;
  /** Global DesktopWorld coordinates. */
  destination: readonly [number, number];
  kind: 'line' | 'wormhole';
  /** Global DesktopWorld coordinates. */
  origin: readonly [number, number];
  progress: number;
}

export function normalizeSceneExtensionInteractionRouteState(
  value: unknown,
): Readonly<SceneExtensionInteractionRouteState> | null;
