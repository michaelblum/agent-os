// src/tools/execution.ts
import type { EngineRouter } from '../engine/router.js';
import type { ScriptRegistry } from '../scripts.js';
import type { Intent } from '../engine/interface.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TYPES_PATH = resolve(__dirname, '..', '..', 'sdk', 'aos-sdk.d.ts');

export function registerExecutionTools(
  router: EngineRouter,
  registry: ScriptRegistry,
  gatewaySocket: string,
) {
  return {
    run_os_script: async (args: any) => {
      let script: string;
      if (args.script_id) {
        script = registry.load(args.script_id);
      } else if (args.script) {
        script = args.script;
      } else {
        return { error: 'Either script or script_id is required' };
      }

      return router.route({
        script,
        params: args.params ?? {},
        intent: (args.intent ?? 'mixed') as Intent,
        timeout: args.timeout ?? 10000,
        context: { gatewaySocket, sessionId: args.__sessionId ?? 'anonymous' },
      }, args.engine);
    },

    save_script: (args: any) => {
      registry.save(args.name, args.script, {
        description: args.description,
        intent: args.intent,
        portable: args.portable,
        parameters: args.parameters,
        note: args.note,
      }, args.overwrite ?? false, args.__sessionId);
      return { saved: true, name: args.name };
    },

    list_scripts: (args: any) =>
      registry.list({ intent: args?.intent, query: args?.query }),

    discover_capabilities: (_args: any) => {
      let types: string;
      try { types = readFileSync(TYPES_PATH, 'utf-8'); } catch { types = '(type definitions not found)'; }
      return {
        namespaces: ['perception', 'action', 'voice', 'coordination'],
        description: 'Use the `aos` global object in scripts. Call with a namespace filter for full method signatures.',
        types,
        scripts: registry.list(),
      };
    },
  };
}
