import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('show wait bounds daemon read stalls by caller timeout', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-show-wait-timeout-'));
  const runtimeDir = path.join(root, 'repo');
  const socketPath = path.join(runtimeDir, 'sock');
  await mkdir(runtimeDir, { recursive: true });

  const server = net.createServer((socket) => {
    socket.on('data', () => {
      // Accept the request but never send a newline-delimited response.
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });

  try {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [
      'scripts/aos-show-client.mjs',
      'wait',
      '--id', 'never-ready',
      '--timeout', '200ms',
      '--json',
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        AOS_STATE_ROOT: root,
        AOS_DISABLE_DAEMON_AUTOSTART: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    const exitCode = await new Promise((resolve) => {
      child.on('exit', (code) => resolve(code));
    });
    const elapsed = Date.now() - startedAt;

    assert.notEqual(exitCode, 0);
    assert.match(stderr, /CANVAS_WAIT_TIMEOUT/);
    const payload = JSON.parse(stderr);
    assert.equal(payload.status, 'failure');
    assert.equal(payload.code, 'CANVAS_WAIT_TIMEOUT');
    assert.equal(payload.operation_id, 'show.wait');
    assert.equal(payload.pending_condition.id, 'never-ready');
    assert.equal(payload.pending_condition.observed.last_state, 'no_response');
    assert.equal(payload.pending_condition.observed.eval_attempts, 1);
    assert.equal(payload.pending_condition.observed.no_response_count, 1);
    assert.equal(payload.timeout_ms, 200);
    assert.equal(typeof payload.next_action, 'string');
    assert.ok(elapsed < 900, `show wait exceeded caller timeout boundary: ${elapsed}ms`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
