// test/e2e.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EngineRouter } from '../src/engine/router.js';
import { NodeSubprocessEngine } from '../src/engine/node-subprocess.js';
import { ScriptRegistry } from '../src/scripts.js';
import { startSDKSocket } from '../src/sdk-socket.js';
import { registerExecutionTools } from '../src/tools/execution.js';
import { unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_SOCK = '/tmp/aos-gw-e2e.sock';

describe('E2E: Gateway script execution surface', () => {
  let sdkServer: ReturnType<typeof startSDKSocket>;
  let exec: ReturnType<typeof registerExecutionTools>;
  let scriptsDir: string;

  before(() => {
    sdkServer = startSDKSocket({ socketPath: TEST_SOCK });
    const engine = new NodeSubprocessEngine();
    const router = new EngineRouter();
    router.register(engine);
    scriptsDir = mkdtempSync(join(tmpdir(), 'aos-e2e-scripts-'));
    const registry = new ScriptRegistry(scriptsDir);
    exec = registerExecutionTools(router, registry, TEST_SOCK);
  });

  after(() => {
    sdkServer.close();
    try { unlinkSync(TEST_SOCK); } catch {}
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('run_os_script executes bounded local automation', async () => {
    const result = await exec.run_os_script({
      script: `
        return { hello: params.name, doubled: params.count * 2 };
      `,
      params: { name: 'gateway', count: 2 },
      intent: 'automation',
      timeout: 10000,
    }) as { result: unknown; logs: string[]; durationMs: number; engine: string };
    assert.deepEqual(result.result, { hello: 'gateway', doubled: 4 });
  });

  it('save_script then run via script_id', async () => {
    exec.save_script({
      name: 'sum-values',
      script: 'return params.values.reduce((sum, value) => sum + value, 0);',
      description: 'Sum numeric input values',
      intent: 'automation',
    });

    const result = await exec.run_os_script({
      script_id: 'sum-values',
      params: { values: [1, 2, 3] },
      intent: 'automation',
      timeout: 10000,
    }) as { result: unknown; logs: string[]; durationMs: number; engine: string };
    assert.equal(result.result, 6);
  });
});
