import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sdkPath = path.join(repoRoot, 'packages/gateway/sdk/aos-sdk.js');

function runNode(scriptPath, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], { timeout: timeoutMs });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`node exited code=${code} signal=${signal} stderr=${stderr}`));
    });
  });
}

test('gateway SDK rejects pending calls when the socket closes without a response', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aos-gateway-sdk-'));
  const socketPath = path.join(dir, 'gateway.sock');
  const resultPath = path.join(dir, 'result.json');
  const scriptPath = path.join(dir, 'sdk-close-test.cjs');
  const sdkSource = readFileSync(sdkPath, 'utf8');
  const server = createServer((socket) => {
    socket.once('data', () => socket.destroy());
  });

  try {
    await new Promise((resolve) => server.listen(socketPath, resolve));
    writeFileSync(scriptPath, `
globalThis.__aos_config = { gatewaySocket: ${JSON.stringify(socketPath)} };
${sdkSource}
(async () => {
  try {
    await globalThis.aos.doctor();
    require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ok: true }));
  } catch (error) {
    require('node:fs').writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify({ ok: false, error: error.message }));
  } finally {
    globalThis.__aos_cleanup?.();
  }
})();
`);

    await runNode(scriptPath);

    assert.deepEqual(JSON.parse(readFileSync(resultPath, 'utf8')), {
      ok: false,
      error: 'AOS SDK socket closed',
    });
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
