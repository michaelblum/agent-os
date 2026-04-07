// test/engine.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { NodeSubprocessEngine } from '../src/engine/node-subprocess.js';
import { EngineRouter } from '../src/engine/router.js';
import { CoordinationDB } from '../src/db.js';
import { startSDKSocket } from '../src/sdk-socket.js';
import { unlinkSync } from 'node:fs';

const TEST_DB = '/tmp/aos-gw-engine-test.db';
const TEST_SOCK = '/tmp/aos-gw-engine-test.sock';

describe('NodeSubprocessEngine', () => {
  let db: CoordinationDB;
  let sdkServer: ReturnType<typeof startSDKSocket>;
  let engine: NodeSubprocessEngine;

  before(() => {
    db = new CoordinationDB(TEST_DB);
    sdkServer = startSDKSocket({ socketPath: TEST_SOCK, db });
    engine = new NodeSubprocessEngine();
  });

  after(() => {
    sdkServer.close();
    db.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_SOCK); } catch {}
  });

  it('executes a simple script and returns result', async () => {
    const r = await engine.execute({
      script: 'return 2 + 2;',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 4);
    assert.equal(r.engine, 'node-subprocess');
  });

  it('passes params to script', async () => {
    const r = await engine.execute({
      script: 'return params.x + params.y;',
      params: { x: 10, y: 20 },
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 30);
  });

  it('captures console.log as logs', async () => {
    const r = await engine.execute({
      script: 'console.log("hello from script"); return "done";',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.ok(r.logs.some(l => l.includes('hello from script')));
  });

  it('strips TypeScript annotations', async () => {
    const r = await engine.execute({
      script: 'const x: number = 42; return x;',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.equal(r.result, 42);
  });

  it('accesses coordination via SDK', async () => {
    const r = await engine.execute({
      script: `
        await aos.coordination.setState("test-key", { from: "script" }, { mode: "set" });
        const entries = await aos.coordination.getState("test-key");
        return entries[0]?.value;
      `,
      params: {},
      intent: 'coordination',
      timeout: 5000,
      context: { gatewaySocket: TEST_SOCK, sessionId: 'test' },
    });
    assert.deepEqual(r.result, { from: 'script' });
  });
});

describe('EngineRouter', () => {
  it('routes to the only registered engine', async () => {
    const router = new EngineRouter();
    const engine = new NodeSubprocessEngine();
    router.register(engine);
    // Use a dummy socket — the script doesn't use the SDK
    const r = await router.route({
      script: 'return "routed";',
      params: {},
      intent: 'mixed',
      timeout: 5000,
      context: { gatewaySocket: '/tmp/nonexistent.sock', sessionId: 'test' },
    });
    assert.equal(r.result, 'routed');
    assert.equal(r.engine, 'node-subprocess');
  });
});
