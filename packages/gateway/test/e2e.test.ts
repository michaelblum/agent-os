// test/e2e.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CoordinationDB } from '../src/db.js';
import { EngineRouter } from '../src/engine/router.js';
import { NodeSubprocessEngine } from '../src/engine/node-subprocess.js';
import { ScriptRegistry } from '../src/scripts.js';
import { startSDKSocket } from '../src/sdk-socket.js';
import { registerCoordinationTools } from '../src/tools/coordination.js';
import { registerExecutionTools } from '../src/tools/execution.js';
import { unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_DB = '/tmp/aos-gw-e2e.db';
const TEST_SOCK = '/tmp/aos-gw-e2e.sock';

describe('E2E: Cross-harness coordination', () => {
  let db: CoordinationDB;
  let sdkServer: ReturnType<typeof startSDKSocket>;
  let coord: ReturnType<typeof registerCoordinationTools>;
  let exec: ReturnType<typeof registerExecutionTools>;
  let scriptsDir: string;

  before(() => {
    db = new CoordinationDB(TEST_DB);
    sdkServer = startSDKSocket({ socketPath: TEST_SOCK, db });
    const engine = new NodeSubprocessEngine();
    const router = new EngineRouter();
    router.register(engine);
    scriptsDir = mkdtempSync(join(tmpdir(), 'aos-e2e-scripts-'));
    const registry = new ScriptRegistry(scriptsDir);
    coord = registerCoordinationTools(db);
    exec = registerExecutionTools(router, registry, TEST_SOCK);
  });

  after(() => {
    sdkServer.close();
    db.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_SOCK); } catch {}
    rmSync(scriptsDir, { recursive: true, force: true });
  });

  it('full coordination scenario: register → lock → message → release', async () => {
    // 1. Two sessions register
    const leadDev = await coord.register_session({ name: 'lead-dev', role: 'architecture', harness: 'claude-code' });
    const uiDesigner = await coord.register_session({ name: 'ui-designer', role: 'studio-refactor', harness: 'codex' });
    assert.equal(leadDev.status, 'online');
    assert.equal(uiDesigner.status, 'online');

    // 2. ui-designer acquires a lock
    const lock = await coord.set_state({
      key: 'lock:sigil/studio/js/ui.js',
      value: { task: 'refactoring sidebar' },
      mode: 'acquire_lock', owner: 'ui-designer', ttl: 3600,
    });
    assert.equal(lock.ok, true);

    // 3. lead-dev checks locks
    const locks = await coord.get_state({ key: 'lock:sigil/*' });
    assert.equal(locks.length, 1);
    assert.equal(locks[0].owner, 'ui-designer');

    // 4. lead-dev tries to acquire same lock — fails
    const contested = await coord.set_state({
      key: 'lock:sigil/studio/js/ui.js',
      value: { task: 'touching events' },
      mode: 'acquire_lock', owner: 'lead-dev',
    });
    assert.equal(contested.ok, false);
    assert.equal(contested.reason, 'owned_by_other');

    // 5. ui-designer posts a message
    const posted = await coord.post_message({
      channel: 'all', payload: { type: 'file-claim', files: ['ui.js'] }, from: 'ui-designer',
    });
    assert.ok(posted.id);

    // 6. lead-dev reads the stream
    const msgs = await coord.read_stream({ channel: 'all' });
    assert.ok(msgs.some((m: any) => m.payload.type === 'file-claim'));

    // 7. ui-designer releases the lock
    const released = await coord.set_state({
      key: 'lock:sigil/studio/js/ui.js', value: null,
      mode: 'release_lock', owner: 'ui-designer',
    });
    assert.equal(released.ok, true);
  });

  it('run_os_script with coordination via SDK', async () => {
    const result = await exec.run_os_script({
      script: `
        await aos.coordination.setState("from-script", { hello: "world" }, { mode: "set" });
        const entries = await aos.coordination.getState("from-script");
        return entries[0]?.value;
      `,
      intent: 'coordination',
      timeout: 10000,
    }) as { result: unknown; logs: string[]; durationMs: number; engine: string };
    assert.deepEqual(result.result, { hello: 'world' });
  });

  it('save_script then run via script_id', async () => {
    // Save a coordination script
    exec.save_script({
      name: 'check-locks',
      script: 'const s = await aos.coordination.getState("lock:*"); return s.length;',
      description: 'Count active locks',
      intent: 'coordination',
    });

    // Set up a lock first
    await coord.set_state({
      key: 'lock:test-file', value: 'locked',
      mode: 'acquire_lock', owner: 'tester',
    });

    // Run saved script by ID
    const result = await exec.run_os_script({
      script_id: 'check-locks',
      intent: 'coordination',
      timeout: 10000,
    }) as { result: unknown; logs: string[]; durationMs: number; engine: string };
    assert.ok((result.result as number) >= 1);
  });
});
