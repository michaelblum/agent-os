// src/engine/node-subprocess.ts
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScriptEngine, ScriptRequest, ScriptResult } from './interface.js';
import { stripTypeAnnotations } from '../strip-ts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// SDK lives at packages/gateway/sdk/aos-sdk.js
// From src/engine/ that's ../../sdk/, from dist/engine/ that's also ../../sdk/
const SDK_PATH = resolve(__dirname, '..', '..', 'sdk', 'aos-sdk.js');

export class NodeSubprocessEngine implements ScriptEngine {
  readonly name = 'node-subprocess';

  async isAvailable(): Promise<boolean> { return true; }
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async execute(request: ScriptRequest): Promise<ScriptResult> {
    const start = Date.now();
    // Wrap in a function before stripping so esbuild doesn't reject top-level
    // `return` statements (which are valid in script/function body context).
    const wrapped = `(async function __body__() { ${request.script} })`;
    const strippedWrapped = stripTypeAnnotations(wrapped);
    // Extract the function body content back out
    const bodyMatch = strippedWrapped.match(/\(async function __body__\(\)\s*\{([\s\S]*)\}\)[\s;]*$/);
    const js = bodyMatch ? bodyMatch[1] : strippedWrapped;
    const resultFile = join(tmpdir(), `aos-result-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

    const wrapper = `
globalThis.__aos_config = ${JSON.stringify(request.context)};
${readFileSync(SDK_PATH, 'utf-8')}
const params = ${JSON.stringify(request.params)};
(async () => {
  try {
    const __result = await (async () => { ${js} })();
    require('fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ok: true, value: __result }));
  } catch (err) {
    require('fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ ok: false, error: err.message }));
  } finally {
    globalThis.__aos_cleanup?.();
  }
})();
`;

    const scriptFile = join(tmpdir(), `aos-script-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
    writeFileSync(scriptFile, wrapper);

    return new Promise<ScriptResult>((resolvePromise) => {
      const logs: string[] = [];
      const child = spawn('node', ['--no-warnings', scriptFile], { timeout: request.timeout });

      child.stdout.on('data', (d) => logs.push(d.toString().trimEnd()));
      child.stderr.on('data', (d) => logs.push(`[stderr] ${d.toString().trimEnd()}`));

      child.on('close', () => {
        let result: unknown = null;
        try {
          const raw = readFileSync(resultFile, 'utf-8');
          const parsed = JSON.parse(raw);
          result = parsed.ok ? parsed.value : { error: parsed.error };
          unlinkSync(resultFile);
        } catch {}
        try { unlinkSync(scriptFile); } catch {}

        resolvePromise({ result, logs, durationMs: Date.now() - start, engine: this.name });
      });
    });
  }
}
