// packages/host/src/provider/adapter.ts
import type { ProviderAdapter } from '../types.ts';

const adapters = new Map<string, ProviderAdapter>();

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}
