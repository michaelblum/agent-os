// sdk/aos-sdk.d.ts
declare const aos: {
  getWindows(filter?: { app?: string; title?: string }): Promise<Array<{
    id: string; app: string; title: string;
    frame: { x: number; y: number; width: number; height: number };
    focused: boolean;
  }>>;
  click(target: { x: number; y: number }): Promise<void>;
  say(text: string): Promise<void>;

  coordination: {
    register(name: string, role: string, harness: string, capabilities?: string[]): Promise<{
      id: string; name: string; role: string; harness: string; status: string;
    }>;
    whoIsOnline(): Promise<Array<{
      id: string; name: string; role: string; harness: string; status: string;
    }>>;
    getState(key: string): Promise<Array<{
      key: string; value: unknown; version: number; owner?: string;
    }>>;
    setState(key: string, value: unknown, options?: {
      mode?: 'set' | 'cas' | 'acquire_lock' | 'release_lock';
      expectedVersion?: number; owner?: string; ttl?: number;
    }): Promise<{ ok: boolean; version?: number; reason?: string }>;
    postMessage(channel: string, payload: unknown, from?: string): Promise<{ id: string }>;
    readStream(channel: string, options?: { since?: string; limit?: number }): Promise<Array<{
      id: string; channel: string; from: string; payload: unknown; createdAt: string;
    }>>;
  };
};

declare const params: Record<string, unknown>;
