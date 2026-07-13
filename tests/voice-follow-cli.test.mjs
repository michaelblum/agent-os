import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function fakeDaemon(onRequest) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-voice-cli-'));
  const modeRoot = path.join(stateRoot, 'repo');
  await fs.mkdir(modeRoot, { recursive: true });
  const socketPath = path.join(modeRoot, 'sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onRequest(JSON.parse(line), socket);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(stateRoot, { recursive: true, force: true });
  });
  return stateRoot;
}

function launch(script, args, stateRoot, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, completed };
}

function success(ref) {
  return `${JSON.stringify({ v: 1, status: 'success', data: {}, ref })}\n`;
}

function event(name, data, ref) {
  return `${JSON.stringify({ v: 1, service: 'voice', event: name, ts: 1, data, ref })}\n`;
}

const startingDaemonSource = `#!/usr/bin/env node
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const root = process.env.AOS_STATE_ROOT;
const mode = process.env.AOS_RUNTIME_MODE || 'repo';
const modeRoot = path.join(root, mode);
const socketPath = path.join(modeRoot, 'sock');
const lockPath = path.join(modeRoot, 'daemon.lock');
fs.mkdirSync(modeRoot, { recursive: true });
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, mode, socket_path: socketPath }));
let server = null;
let closing = false;
const startupTimer = setTimeout(() => {
  try { fs.rmSync(socketPath, { force: true }); } catch {}
  server = net.createServer((socket) => socket.on('data', () => {}));
  server.listen(socketPath);
}, Number(process.env.AOS_FAKE_START_DELAY_MS || 2000));
const keepalive = setInterval(() => {}, 1000);
function finish() {
  clearInterval(keepalive);
  try { fs.rmSync(socketPath, { force: true }); } catch {}
  try { fs.rmSync(lockPath, { force: true }); } catch {}
  process.exit(0);
}
function shutdown() {
  if (process.env.AOS_FAKE_IGNORE_SIGTERM === '1') return;
  if (closing) return;
  closing = true;
  clearTimeout(startupTimer);
  if (server) server.close(finish);
  else finish();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
`;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function socketReachable(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 100);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function runStartupCancellation({ command, signal = null, parentLoss = false, ignoreSigterm = false }) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), `aos-voice-startup-${command}-`));
  const fakeAOS = path.join(stateRoot, 'fake-aos.cjs');
  const lockPath = path.join(stateRoot, 'repo', 'daemon.lock');
  const socketPath = path.join(stateRoot, 'repo', 'sock');
  await fs.writeFile(fakeAOS, startingDaemonSource);
  await fs.chmod(fakeAOS, 0o755);
  const args = command === 'listen'
    ? ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow']
    : ['--follow'];
  const script = command === 'listen' ? 'scripts/aos-tell-listen.mjs' : 'scripts/aos-say.mjs';
  const run = launch(script, args, stateRoot, {
    AOS_PATH: fakeAOS,
    AOS_ALLOW_DAEMON_AUTOSTART: '1',
    AOS_DISABLE_DAEMON_AUTOSTART: '0',
    AOS_FAKE_START_DELAY_MS: '5000',
    AOS_FAKE_IGNORE_SIGTERM: ignoreSigterm ? '1' : '0',
    ...(parentLoss ? { AOS_EXTERNAL_DISPATCH_PARENT_PID: '2147483647' } : {}),
  });
  if (command === 'say') run.child.stdin.end('startup cancellation speech');

  let daemonPID;
  try {
    await waitForFile(lockPath);
    daemonPID = JSON.parse(await fs.readFile(lockPath, 'utf8')).pid;
    if (signal) run.child.kill(signal);
    const timeoutMs = ignoreSigterm ? 5000 : 3000;
    let timer;
    const result = await Promise.race([
      run.completed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${command} wrapper did not exit during managed startup cancellation`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(processAlive(daemonPID), false, `managed daemon ${daemonPID} survived ${command} startup cancellation`);
    assert.equal(await socketReachable(socketPath), false, `${command} startup socket remained reachable`);
  } finally {
    if (daemonPID && processAlive(daemonPID)) {
      try { process.kill(daemonPID, 'SIGKILL'); } catch {}
    }
    if (processAlive(run.child.pid)) {
      try { run.child.kill('SIGKILL'); } catch {}
    }
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
}

test('listen and say repeatedly cancel managed daemon startup on SIGINT and SIGTERM', async () => {
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const command of ['listen', 'say']) {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        await runStartupCancellation({ command, signal });
      }
    }
  }
});

test('listen and say cancel managed daemon startup when the external dispatcher disappears', async () => {
  for (let cycle = 0; cycle < 2; cycle += 1) {
    for (const command of ['listen', 'say']) {
      await runStartupCancellation({ command, parentLoss: true });
    }
  }
});

test('managed startup cancellation escalates to SIGKILL and still awaits daemon exit', async () => {
  await runStartupCancellation({ command: 'listen', signal: 'SIGTERM', ignoreSigterm: true });
});

test('hotkey follow emits only canonical dictation events and ignores fragmentation', async () => {
  let firstRequest;
  const stateRoot = await fakeDaemon((request, socket) => {
    firstRequest = request;
    socket.write(success(request.ref));
    const opened = event('dictation_opened', { source: 'hotkey' }, request.ref);
    socket.write(opened.slice(0, 7));
    socket.write(opened.slice(7));
    socket.write(event('dictation_closed_send', { reason: 'key_release' }, request.ref));
  });
  const run = launch('scripts/aos-tell-listen.mjs', ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow'], stateRoot);
  await new Promise((resolve) => setTimeout(resolve, 100));
  run.child.kill('SIGTERM');
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(firstRequest.service, 'listen');
  assert.equal(firstRequest.action, 'hotkey');
  assert.deepEqual(firstRequest.data, { shortcut: 'Control+Option+Space' });
  const events = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(events.map((item) => item.event), ['dictation_opened', 'dictation_closed_send']);
  assert.ok(events.every((item) => !JSON.stringify(item).includes('keyCode')));
});

test('voice follow cancels when its external-dispatch owner disappears', async () => {
  let requestSeen = false;
  const stateRoot = await fakeDaemon((request, socket) => {
    requestSeen = true;
    socket.write(success(request.ref));
    socket.write(event('dictation_opened', { source: 'hotkey' }, request.ref));
  });
  const run = launch(
    'scripts/aos-tell-listen.mjs',
    ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow'],
    stateRoot,
    { AOS_EXTERNAL_DISPATCH_PARENT_PID: '2147483647' },
  );
  let timeout;
  const result = await Promise.race([
    run.completed,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('voice client did not exit after owner loss')), 3000);
    }),
  ]).finally(() => clearTimeout(timeout));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requestSeen, true);
  assert.match(result.stdout, /"event":"dictation_opened"/);
});

test('SIGINT finalizes microphone capture and output events never reveal its path', async () => {
  const requests = [];
  let captureSocket;
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    if (request.action === 'microphone') {
      captureSocket = socket;
      socket.write(success(request.ref));
      socket.write(event('capture_started', { sample_rate: 16000, channels: 1, max_duration_ms: 120000 }, request.ref));
      socket.write(event('audio_frame', { stream: 'capture', rms: 0.1, peak: 0.2, sequence: 1 }, request.ref));
    } else if (request.action === 'stop') {
      socket.write(success(request.ref));
      socket.write(event('capture_completed', { reason: 'explicit_stop', duration_ms: 500, bytes: 16044 }, request.ref));
    }
  });
  const outputPath = path.join(stateRoot, 'private.wav');
  const run = launch('scripts/aos-tell-listen.mjs', ['listen', '--source', 'microphone', '--output', outputPath, '--follow'], stateRoot);
  while (!captureSocket) await new Promise((resolve) => setTimeout(resolve, 10));
  run.child.kill('SIGINT');
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests.map((item) => item.action), ['microphone', 'stop']);
  assert.ok(!result.stdout.includes(outputPath));
  assert.ok(!result.stderr.includes(outputPath));
  assert.match(result.stdout, /"event":"capture_completed"/);
});

test('say follow keeps stdin text out of output while streaming same-run meters', async () => {
  const secret = 'private spoken response';
  let receivedText;
  const stateRoot = await fakeDaemon((request, socket) => {
    receivedText = request.data.text;
    socket.write(success(request.ref));
    socket.write(event('speech_started', { rate_wpm: 180 }, request.ref));
    socket.write(event('audio_frame', { stream: 'speech', rms: 0.2, peak: 0.4, sequence: 1 }, request.ref));
    socket.write(event('speech_finished', { reason: 'completed' }, request.ref));
  });
  const run = launch('scripts/aos-say.mjs', ['--follow', '--rate', '180'], stateRoot);
  run.child.stdin.end(secret);
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(receivedText, secret);
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse).map((item) => item.event), [
    'speech_started',
    'audio_frame',
    'speech_finished',
  ]);
});

test('daemon errors are code-projected without echoing request text or paths', async () => {
  const secret = 'never echo this sentence';
  const leakedPath = '/private/tmp/never-echo.wav';
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(`${JSON.stringify({
      v: 1,
      status: 'error',
      code: 'VOICE_TRANSPORT_FAILED',
      error: `failed for ${request.data.text} at ${leakedPath}`,
      ref: request.ref,
    })}\n`);
  });
  const run = launch('scripts/aos-say.mjs', ['--follow'], stateRoot);
  run.child.stdin.end(secret);
  const result = await run.completed;
  assert.equal(result.code, 1);
  assert.ok(!result.stderr.includes(secret));
  assert.ok(!result.stderr.includes(leakedPath));
  assert.match(result.stderr, /"code":"VOICE_TRANSPORT_FAILED"/);
});

test('terminal native failure events produce a nonzero process exit', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(success(request.ref));
    socket.write(event('capture_failed', { code: 'MICROPHONE_PERMISSION_LOST' }, request.ref));
  });
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--follow',
  ], stateRoot);
  const result = await run.completed;
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /"event":"capture_failed"/);
});
