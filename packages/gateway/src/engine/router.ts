// src/engine/router.ts
import type { ScriptEngine, ScriptRequest, ScriptResult, Intent } from './interface.js';

interface RouterConfig {
  defaultEngine: string;
  intentPolicy: Record<Intent, string[]>;
}

const DEFAULT_CONFIG: RouterConfig = {
  defaultEngine: 'node-subprocess',
  intentPolicy: {
    perception: ['node-subprocess'],
    action: ['node-subprocess'],
    coordination: ['node-subprocess'],
    mixed: ['node-subprocess'],
  },
};

export class EngineRouter {
  private engines = new Map<string, ScriptEngine>();
  private config: RouterConfig;

  constructor(config?: Partial<RouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  register(engine: ScriptEngine) {
    this.engines.set(engine.name, engine);
  }

  async route(request: ScriptRequest, preferred?: string): Promise<ScriptResult> {
    if (preferred && preferred !== 'auto') {
      const engine = this.engines.get(preferred);
      if (engine && await engine.isAvailable()) return engine.execute(request);
    }
    const candidates = this.config.intentPolicy[request.intent] ?? [];
    for (const name of candidates) {
      const engine = this.engines.get(name);
      if (engine && await engine.isAvailable()) return engine.execute(request);
    }
    const def = this.engines.get(this.config.defaultEngine);
    if (def) return def.execute(request);
    throw new Error('No available engine');
  }
}
