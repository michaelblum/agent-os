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
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-annotation-select-'));
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

function launch(args, stateRoot) {
  const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/aos-annotation-select.mjs'), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    child,
    stdout: () => stdout,
    completed: new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))),
  };
}

function response(ref) {
  return `${JSON.stringify({ v: 1, status: 'success', data: {}, ref })}\n`;
}

function event(name, data, ref) {
  return `${JSON.stringify({ v: 1, service: 'annotation', event: name, ts: 1, data, ref })}\n`;
}

function completedData(overrides = {}) {
  return {
    selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
    mode: 'text',
    geometry: {
      kind: 'point',
      coordinate_space: 'desktop_points_top_left',
      x: 120,
      y: 80,
    },
    application: {
      pid: 42,
      name: 'Fixture App',
      bundle_id: 'io.example.fixture',
    },
    window: {
      window_id: 17,
      title: 'Fixture Window',
      bounds: { x: 20, y: 40, width: 800, height: 600 },
    },
    text: 'Private operator annotation',
    ...overrides,
  };
}

function targetCompletedData(overrides = {}) {
  return completedData({
    mode: 'target',
    geometry: {
      kind: 'element',
      coordinate_space: 'desktop_points_top_left',
      x: 220,
      y: 140,
      width: 180,
      height: 44,
      role: 'AXButton',
      title: 'Private Settings',
      label: 'Delete private workspace',
      ancestor_roles: ['AXApplication', 'AXWindow', 'AXGroup'],
    },
    text: null,
    ...overrides,
  });
}

function ndjson(value) {
  return value.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('desktop annotation selection persists bounded evidence and redacts public text', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    assert.equal(request.service, 'annotation');
    assert.equal(request.action, 'select');
    assert.deepEqual(request.data, { mode: 'text' });
    socket.write(response(request.ref));
    socket.write(event('selection_started', { mode: 'text' }, request.ref));
    socket.write(event('selection_completed', completedData(), request.ref));
  });
  const run = launch(['--mode', 'text', '--source', 'companion', '--follow'], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 0, result.stderr);
  const events = ndjson(result.stdout);
  assert.deepEqual(events.map((item) => item.event), ['selection_started', 'selection_completed']);
  const completion = events[1].data;
  assert.match(completion.annotation_id, /^ann-/);
  assert.equal(completion.has_text, true);
  assert.equal(JSON.stringify(events).includes('Private operator annotation'), false);
  assert.equal(JSON.stringify(events).includes('path'), false);

  const recordPath = path.join(stateRoot, 'repo', 'pending-annotations', 'records', `${completion.annotation_id}.json`);
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.actor.source, 'companion');
  assert.equal(record.comment.text, 'Private operator annotation');
  assert.equal(record.desktop_selection.selection_id, completion.selection_id);
  assert.equal(record.desktop_selection.geometry.coordinate_space, 'desktop_points_top_left');
  assert.equal(record.capability.status, 'fallback_only');
});

test('semantic target selection persists native AX evidence and redacts labels publicly', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    assert.deepEqual(request.data, { mode: 'target' });
    socket.write(response(request.ref));
    socket.write(event('selection_started', { mode: 'target' }, request.ref));
    socket.write(event('selection_completed', targetCompletedData(), request.ref));
  });
  const run = launch(['--mode', 'target', '--source', 'companion', '--follow'], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 0, result.stderr);
  const events = ndjson(result.stdout);
  const completion = events[1].data;
  assert.equal(completion.mode, 'target');
  assert.equal(completion.has_text, false);
  assert.equal(completion.geometry.kind, 'element');
  assert.equal(completion.geometry.role, 'AXButton');
  assert.equal(completion.geometry.title, null);
  assert.equal(completion.geometry.label, null);
  assert.equal(JSON.stringify(events).includes('Private Settings'), false);
  assert.equal(JSON.stringify(events).includes('Delete private workspace'), false);

  const recordPath = path.join(
    stateRoot,
    'repo',
    'pending-annotations',
    'records',
    `${completion.annotation_id}.json`,
  );
  const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  assert.equal(record.target.kind, 'native_ax');
  assert.equal(record.target.summary, 'Delete private workspace');
  assert.equal(record.comment.text, null);
  assert.equal(record.desktop_selection.geometry.label, 'Delete private workspace');
  assert.deepEqual(record.desktop_selection.geometry.ancestor_roles, [
    'AXApplication',
    'AXWindow',
    'AXGroup',
  ]);
  assert.deepEqual(record.capability, {
    status: 'fallback_only',
    reasons: ['native_ax_selection_without_saved_ref'],
    fallback_used: true,
    saved_ref_available: false,
  });
});

test('semantic target selection rejects noncanonical element geometry before persistence', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(response(request.ref));
    socket.write(event('selection_completed', targetCompletedData({
      geometry: {
        ...targetCompletedData().geometry,
        private_path: '/private/target',
      },
    }), request.ref));
  });
  const result = await launch(['--mode', 'target', '--follow'], stateRoot).completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"INVALID_ANNOTATION_EVENT"/);
  assert.equal(result.stderr.includes('/private/target'), false);
  const records = path.join(stateRoot, 'repo', 'pending-annotations', 'records');
  await assert.rejects(fs.readdir(records), { code: 'ENOENT' });
});

test('semantic target selection rejects daemon mode substitution before persistence', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(response(request.ref));
    socket.write(event('selection_started', { mode: 'target' }, request.ref));
    socket.write(event('selection_completed', completedData({
      mode: 'rectangle',
      geometry: {
        kind: 'rectangle',
        coordinate_space: 'desktop_points_top_left',
        x: 10,
        y: 20,
        width: 100,
        height: 80,
      },
      text: null,
    }), request.ref));
  });
  const result = await launch(['--mode', 'target', '--follow'], stateRoot).completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"INVALID_ANNOTATION_EVENT"/);
  const records = path.join(stateRoot, 'repo', 'pending-annotations', 'records');
  await assert.rejects(fs.readdir(records), { code: 'ENOENT' });
});

test('semantic target selection rejects a mismatched start event', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(response(request.ref));
    socket.write(event('selection_started', { mode: 'rectangle' }, request.ref));
  });
  const result = await launch(['--mode', 'target', '--follow'], stateRoot).completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"INVALID_ANNOTATION_EVENT"/);
});

test('semantic target selection maps accessibility failures without leaking daemon detail', async () => {
  const leakedPath = '/private/accessibility-target';
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(`${JSON.stringify({
      v: 1,
      status: 'error',
      code: 'ANNOTATION_ACCESSIBILITY_UNAVAILABLE',
      error: `failed to inspect ${leakedPath}`,
      ref: request.ref,
    })}\n`);
  });
  const result = await launch(['--mode', 'target', '--follow'], stateRoot).completed;

  assert.equal(result.code, 1);
  assert.match(
    result.stderr,
    /"code":"ANNOTATION_ACCESSIBILITY_UNAVAILABLE","error":"desktop accessibility targeting is unavailable"/,
  );
  assert.equal(result.stderr.includes(leakedPath), false);
});

test('desktop annotation selection rejects malformed native evidence without persistence', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(response(request.ref));
    socket.write(event('selection_completed', {
      ...completedData({ mode: 'point', text: null }),
      capture_path: '/private/tmp/private-capture.png',
    }, request.ref));
  });
  const run = launch(['--mode', 'point', '--follow'], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"INVALID_ANNOTATION_EVENT"/);
  assert.equal(result.stderr.includes('private-capture.png'), false);
  const records = path.join(stateRoot, 'repo', 'pending-annotations', 'records');
  await assert.rejects(fs.readdir(records), { code: 'ENOENT' });
});

test('desktop annotation selection forwards cancellation and creates no record', async () => {
  let cancelSeen = false;
  let run;
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(response(request.ref));
    if (request.action === 'select') {
      socket.write(event('selection_started', { mode: 'rectangle' }, request.ref));
      setTimeout(() => run.child.kill('SIGINT'), 10);
      return;
    }
    assert.equal(request.action, 'cancel');
    cancelSeen = true;
    socket.write(event('selection_canceled', { reason: 'canceled' }, request.ref));
  });
  run = launch(['--mode', 'rectangle', '--follow'], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 0, result.stderr);
  assert.equal(cancelSeen, true);
  assert.deepEqual(ndjson(result.stdout).map((item) => item.event), ['selection_started', 'selection_canceled']);
  const records = path.join(stateRoot, 'repo', 'pending-annotations', 'records');
  await assert.rejects(fs.readdir(records), { code: 'ENOENT' });
});

test('desktop annotation selection validates mode and source before daemon startup', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-annotation-select-args-'));
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });

  const badMode = await launch(['--mode', 'polygon', '--follow'], stateRoot).completed;
  assert.equal(badMode.code, 1);
  assert.match(badMode.stderr, /"code":"INVALID_ANNOTATION_MODE"/);

  const badSource = await launch(['--mode', 'point', '--source', 'contains space', '--follow'], stateRoot).completed;
  assert.equal(badSource.code, 1);
  assert.match(badSource.stderr, /"code":"INVALID_ARG"/);
});

test('desktop annotation selection help is passive', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-annotation-select-help-'));
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });
  const result = await launch(['--help'], stateRoot).completed;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Usage: aos see annotation select/);
  assert.match(result.stdout, /point\|rectangle\|freehand\|text\|target/);
});

test('annotation manifest keeps geometry and target selection as separate forms', async () => {
  const manifest = JSON.parse(await fs.readFile(
    path.join(repoRoot, 'manifests/commands/source/aos/03-see-04-annotation.json'),
    'utf8',
  ));
  const forms = manifest.commands[0].forms;
  const geometry = forms.find((form) => form.id === 'annotation-select-follow');
  const target = forms.find((form) => form.id === 'annotation-target-select-follow');
  assert.ok(geometry);
  assert.ok(target);
  assert.deepEqual(
    geometry.args.find((arg) => arg.id === 'mode').value_type.enum.map((item) => item.value),
    ['point', 'rectangle', 'freehand', 'text'],
  );
  assert.deepEqual(
    target.args.find((arg) => arg.id === 'mode').value_type.enum.map((item) => item.value),
    ['target'],
  );
});
