import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readOneJSON } from '../../scripts/lib/browser-companion/worker-group-sentinel.mjs';

const FRAME_LIMIT = 4 * 1024;
const SENTINEL = fileURLToPath(new URL('../../scripts/aos-browser-worker-group.mjs', import.meta.url));
const roots = new Set();
const VALUE = Object.freeze({
  entrypoint: '/private/worker.mjs', argv: [], cwd: '/private', env: {},
  max_output_bytes: 65_536,
});

function frame(value = VALUE) {
  return `${JSON.stringify(value)}\n`;
}

function exactSentinelRun(transform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-worker-request-'));
  roots.add(root);
  const marker = path.join(root, 'worker-spawned');
  const worker = path.join(root, 'worker.mjs');
  fs.writeFileSync(worker, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'spawned',{mode:0o600});\n`, { mode: 0o600 });
  const request = frame({ entrypoint: worker, argv: [], cwd: root, env: { PATH: '/usr/bin:/bin' }, max_output_bytes: 65_536 });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SENTINEL], {
      cwd: root, env: { PATH: '/usr/bin:/bin' }, detached: true,
      stdio: ['pipe', 'ignore', 'ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    let spawned = false;
    let control = '';
    const timeout = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('sentinel framing test deadline expired'));
    }, 5_000);
    child.stdio[3].on('data', (chunk) => {
      control += chunk.toString('utf8');
      while (control.includes('\n')) {
        const newline = control.indexOf('\n');
        const value = JSON.parse(control.slice(0, newline));
        control = control.slice(newline + 1);
        if (value.event === 'ready') {
          ready = true;
          child.stdio[4].write(`${JSON.stringify({ schema_version: 'aos.browser.worker-group-activation.v1', event: 'execute' })}\n`);
        } else if (value.event === 'spawned') spawned = true;
        else if (value.event === 'terminal') child.stdio[4].end();
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, ready, spawned, marker: fs.existsSync(marker) });
    });
    transform(child.stdin, request);
  });
}

after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

test('worker-group request remains unaccepted until exact split frame EOF', async () => {
  const input = new PassThrough();
  let accepted = false;
  const pending = readOneJSON(input, FRAME_LIMIT).then((value) => {
    accepted = true;
    return value;
  });
  const bytes = frame();
  input.write(bytes.slice(0, 11));
  input.write(bytes.slice(11, -1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accepted, false);
  input.end(bytes.slice(-1));
  assert.deepEqual(await pending, VALUE);
  assert.equal(accepted, true);
});

test('worker-group request rejects trailing bytes and a second frame before admission', async () => {
  for (const bytes of [`${frame()}x`, `${frame()}${frame()}`]) {
    const input = new PassThrough();
    let accepted = false;
    const pending = readOneJSON(input, FRAME_LIMIT).then((value) => {
      accepted = true;
      return value;
    });
    input.end(bytes);
    await assert.rejects(pending, /worker group frame differs/u);
    assert.equal(accepted, false);
  }
});

test('real sentinel admits split EOF frame and never readies or spawns for trailing or second frames', async () => {
  const split = await exactSentinelRun((input, bytes) => {
    input.write(bytes.slice(0, 13));
    input.end(bytes.slice(13));
  });
  assert.deepEqual(split, { code: 0, ready: true, spawned: true, marker: true });
  for (const suffix of ['x', frame()]) {
    const rejected = await exactSentinelRun((input, bytes) => input.end(`${bytes}${suffix}`));
    assert.equal(rejected.code, 1);
    assert.equal(rejected.ready, false);
    assert.equal(rejected.spawned, false);
    assert.equal(rejected.marker, false);
  }
});
