import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

async function runShowClient(stateRoot, args) {
  const child = spawn(process.execPath, ['scripts/aos-show-client.mjs', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      AOS_SESSION_ID: 'show-client-contract',
      AOS_SESSION_HARNESS: 'node-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  return { exitCode, stdout, stderr };
}

async function withFakeDaemon(respond, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-show-client-contract-'));
  const runtimeDir = path.join(root, 'repo');
  const socketPath = path.join(runtimeDir, 'sock');
  await mkdir(runtimeDir, { recursive: true });
  const requests = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = JSON.parse(line);
        requests.push(request);
        respond(request, socket, requests);
      }
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
    await run({ root, requests });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

function sendSuccess(socket, data = {}) {
  socket.end(`${JSON.stringify({ v: 1, status: 'success', data })}\n`);
}

test('show create reconciles a lost response only against its exact global owner', async () => {
  let createdOwner;
  await withFakeDaemon((request, socket) => {
    if (request.action === 'create') {
      createdOwner = request.data.owner;
      socket.end();
      return;
    }
    assert.equal(request.action, 'list');
    sendSuccess(socket, {
      canvases: [{ id: 'cold-canvas', scope: 'global', owner: createdOwner }],
    });
  }, async ({ root, requests }) => {
    const result = await runShowClient(root, [
      'create', '--id', 'cold-canvas', '--at', '10,20,200,100',
      '--html', '<main>cold create</main>',
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { status: 'success' });
    assert.deepEqual(requests.map((request) => request.action), ['create', 'list']);
    assert.equal(createdOwner.pid > 0, true);
  });
});

test('show create fails closed when timeout reconciliation finds a different owner', async () => {
  const secretHTML = '<main>private payload</main>';
  let createdOwner;
  await withFakeDaemon((request, socket) => {
    if (request.action === 'create') {
      createdOwner = request.data.owner;
      socket.end();
      return;
    }
    sendSuccess(socket, {
      canvases: [{
        id: 'owned-elsewhere',
        scope: 'global',
        owner: { ...createdOwner, pid: createdOwner.pid + 1 },
      }],
    });
  }, async ({ root, requests }) => {
    const result = await runShowClient(root, [
      'create', '--id', 'owned-elsewhere', '--at', '10,20,200,100', '--html', secretHTML,
    ]);
    assert.equal(result.exitCode, 1);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.code, 'IPC_RESPONSE_UNAVAILABLE');
    assert.match(failure.error, /show\.create/);
    assert.doesNotMatch(result.stderr, /private payload/);
    assert.deepEqual(requests.map((request) => request.action), ['create', 'list']);
  });
});

test('show create does not reconcile connection-scoped ownership across sockets', async () => {
  await withFakeDaemon((_request, socket) => socket.end(), async ({ root, requests }) => {
    const result = await runShowClient(root, [
      'create', '--id', 'connection-canvas', '--scope', 'connection',
      '--at', '10,20,200,100', '--html', '<main>connection</main>',
    ]);
    assert.equal(result.exitCode, 1);
    assert.equal(JSON.parse(result.stderr).code, 'IPC_RESPONSE_UNAVAILABLE');
    assert.deepEqual(requests.map((request) => request.action), ['create']);
  });
});

test('show wait evaluates a JavaScript predicate without requiring the headsup bridge', async () => {
  await withFakeDaemon((request, socket) => {
    assert.equal(request.action, 'eval');
    assert.match(request.data.js, /document\.body\.dataset\.ready/);
    assert.doesNotMatch(request.data.js, /window\.headsup/);
    sendSuccess(socket, { result: 'ready' });
  }, async ({ root, requests }) => {
    const result = await runShowClient(root, [
      'wait', '--id', 'inline-html',
      '--js', 'document.body.dataset.ready === "yes"',
      '--timeout', '500ms', '--json',
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'success',
      ready: true,
      id: 'inline-html',
    });
    assert.equal(requests.length, 1);
  });
});

test('show wait combines bridge, manifest, and JavaScript conditions when requested', async () => {
  await withFakeDaemon((request, socket) => {
    assert.equal(request.action, 'eval');
    assert.match(request.data.js, /window\.headsup/);
    assert.match(request.data.js, /window\.headsup\.manifest/);
    assert.match(request.data.js, /inline-manifest/);
    assert.match(request.data.js, /document\.body\.dataset\.ready/);
    sendSuccess(socket, { result: 'ready' });
  }, async ({ root, requests }) => {
    const result = await runShowClient(root, [
      'wait', '--id', 'bridged-html', '--manifest', 'inline-manifest',
      '--js', 'document.body.dataset.ready === "yes"',
      '--timeout', '500ms', '--json',
    ]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ready, true);
    assert.equal(requests.length, 1);
  });
});
