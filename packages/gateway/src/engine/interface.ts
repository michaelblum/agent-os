// src/engine/interface.ts
export type Intent = 'perception' | 'action' | 'coordination' | 'mixed';

export interface ScriptRequest {
  script: string;
  params: Record<string, unknown>;
  intent: Intent;
  timeout: number;
  context: { gatewaySocket: string; sessionId: string };
}

export interface ScriptResult {
  result: unknown;
  logs: string[];
  durationMs: number;
  engine: string;
}

export interface ScriptEngine {
  readonly name: string;
  execute(request: ScriptRequest): Promise<ScriptResult>;
  isAvailable(): Promise<boolean>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}
