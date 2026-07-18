import type { DesktopWorldDevToolsSnapshot } from './desktop-world-devtools.js';

export interface DesktopWorldDevToolsViewCommand {
  action: 'close' | 'detach' | 'update';
  session: string;
  expectedRevision: number;
  active_tab?: string;
  selected_resource?: string | null;
  recording?: boolean;
  filters?: Readonly<{ query: string; event_kinds: readonly string[]; errors_only: boolean }>;
}

export function createDesktopWorldDevToolsView(options: {
  root: HTMLElement;
  onCommand?: (command: DesktopWorldDevToolsViewCommand) => void;
}): Readonly<{
  dispose(): boolean;
  request(action: DesktopWorldDevToolsViewCommand['action'], data?: Record<string, unknown>): boolean;
  setActive(active: boolean): void;
  update(snapshot: unknown): DesktopWorldDevToolsSnapshot;
}>;
