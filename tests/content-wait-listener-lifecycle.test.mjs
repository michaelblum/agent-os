import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

function runContentWait(stateRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'node',
      ['scripts/aos-content.mjs', 'wait', '--root', 'missing-root', '--timeout', '2s', '--json'],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AOS_STATE_ROOT: stateRoot,
          AOS_RUNTIME_MODE: 'repo',
          AOS_DISABLE_DAEMON_AUTOSTART: '1',
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('content wait does not accumulate socket listeners while polling status', async () => {
  const stateRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-content-listeners-'));
  const socketPath = path.join(stateRoot, 'repo', 'sock');
  mkdirSync(path.dirname(socketPath), { recursive: true });
  const server = net.createServer((socket) => {
    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        socket.write(`${JSON.stringify({ v: 1, data: { port: 17777, roots: {} } })}\n`);
      }
    });
  });

  try {
    await new Promise((resolve) => server.listen(socketPath, resolve));
    const result = await runContentWait(stateRoot);

    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /MaxListenersExceededWarning/);
    assert.match(result.stderr, /CONTENT_WAIT_TIMEOUT/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    rmSync(stateRoot, { recursive: true, force: true });
  }
});
