import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';

import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import {
  installManagedRuntime,
  managedRuntimeFixture,
  repoRoot,
} from './managed-runtime-test-fixture.mjs';

const roots = new Set();
const sessionSchema = path.join(repoRoot, 'shared/schemas/aos-browser-session-result-v1.schema.json');
const TIMEOUT_MS = 10_000;

function temporaryRoot(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.add(root);
  return root;
}

function runNode(script, args, { cwd, env, input } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, env, input, encoding: 'utf8', timeout: TIMEOUT_MS,
  });
}

function parseSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  return JSON.parse(result.stdout);
}

function parseError(result) {
  assert.equal(result.status, 1, result.stdout);
  assert.equal(result.signal, null);
  return JSON.parse(result.stderr);
}

function assertSessionReceipt(value) {
  assert.deepEqual(validateJsonSchema(sessionSchema, value), []);
}

function readWorkerLog(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('installed public focus and broker commands use only the managed fake worker', async () => {
  const staged = temporaryRoot('aos-managed-command-stage-');
  const caller = temporaryRoot('aos-managed-command-caller-');
  const state = temporaryRoot('aos-managed-command-state-');
  const workerLog = path.join(state, 'worker-log.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  const env = {
    ...process.env,
    AOS_STATE_ROOT: state,
    AOS_RUNTIME_MODE: 'installed',
    AOS_DISABLE_DAEMON_AUTOSTART: '1',
    AOS_PATH: '/hostile/aos',
    AOS_PLAYWRIGHT_CLI: '/hostile/playwright-cli',
    PLAYWRIGHT_CLI_SESSION: 'hostile-session',
    HTTP_PROXY: 'http://secret.invalid',
    PATH: '/hostile/path',
  };

  await installManagedRuntime(env, fixture);
  const stagedResult = runNode(path.join(repoRoot, 'scripts/stage-browser-companion-runtime.mjs'), [staged], {
    cwd: caller, env: process.env,
  });
  assert.equal(stagedResult.status, 0, stagedResult.stderr);
  fs.writeFileSync(
    path.join(staged, 'manifests/companions/playwright-cli-v1.json'),
    `${JSON.stringify(fixture.current.descriptor, null, 2)}\n`,
  );

  const focus = path.join(staged, 'scripts/aos-focus-graph.mjs');
  const broker = path.join(staged, 'scripts/aos-browser-broker.mjs');
  const publicBytes = [];
  const invoke = (script, args, input) => {
    const result = runNode(script, args, { cwd: caller, env, input });
    publicBytes.push(result.stdout, result.stderr);
    return result;
  };

  const launched = parseSuccess(invoke(focus, [
    'focus', 'create', '--id', 'launch', '--target', 'browser://new',
    '--headless', '--url', 'https://example.test',
  ]));
  assertSessionReceipt(launched);
  assert.equal(launched.status, 'active');
  assert.equal(launched.session.ownership, 'launched');

  const attached = parseSuccess(invoke(focus, [
    'focus', 'create', '--id', 'remote', '--target', 'browser://attach',
    '--cdp', 'http://127.0.0.1:9222',
  ]));
  assertSessionReceipt(attached);
  assert.equal(attached.session.ownership, 'attached');
  assert.equal(attached.session.attach_kind, 'cdp');

  const listed = parseSuccess(invoke(focus, ['focus', 'list']));
  assert.equal(listed.status, 'ok');
  assert.deepEqual(listed.channels.map((channel) => channel.session).sort(), ['launch', 'remote']);

  const operated = parseSuccess(invoke(broker, [], `${JSON.stringify({
    session_id: 'launch', operation: 'page_identity', input: {},
  })}\n`));
  assert.equal(operated.status, 'ok');
  assert.equal(operated.result.schema, 'aos.agent-workspace.browser-identity.v1');
  assertSessionReceipt(operated.receipt);
  assert.deepEqual(Object.keys(operated).sort(), ['receipt', 'result', 'status']);

  const identity = parseSuccess(invoke(broker, [], `${JSON.stringify({
    session_id: 'launch', operation: 'identity', input: {},
  })}\n`));
  assert.equal(identity.status, 'ok');
  assert.equal(identity.receipt.operation, 'liveness');
  assertSessionReceipt(identity.receipt);
  assert.deepEqual(Object.keys(identity).sort(), ['backend_identity', 'receipt', 'session', 'status']);

  const doBrowser = path.join(staged, 'scripts/aos-do-browser.mjs');
  const seeBrowser = path.join(staged, 'scripts/aos-see-native.mjs');
  const leaseFile = path.join(inspectStore(env).paths.leases, 'launch.json');
  const beforeDryRun = fs.readFileSync(leaseFile);
  const beforeDryCalls = readWorkerLog(workerLog).length;
  const dryScroll = parseSuccess(invoke(doBrowser, ['scroll', 'browser:launch', '0,-200', '--dry-run']));
  assert.equal(dryScroll.status, 'dry_run');
  assert.equal(dryScroll.mutation_performed, false);
  assert.deepEqual(fs.readFileSync(leaseFile), beforeDryRun);
  assert.equal(readWorkerLog(workerLog).length, beforeDryCalls);
  for (const verb of ['navigate', 'type', 'key']) {
    const args = verb === 'navigate' ? ['browser:launch', 'about:blank', '--dry-run']
      : [`browser:launch`, 'value', '--dry-run'];
    assert.equal(parseError(invoke(doBrowser, [verb, ...args])).code, 'UNKNOWN_FLAG');
  }

  for (const args of [
    ['focus', 'create', '--id', 'mixed', '--target', 'browser://new', '--pid', '12'],
    ['focus', 'create', '--id', 'mixed', '--window', '12', '--headless'],
    ['focus', 'create', '--id', 'mixed', '--target', 'browser://new', '--backend', 'managed'],
    ['focus', 'create', '--id', 'mixed', '--target', 'browser://new', '--mode', 'browser'],
  ]) assert.equal(parseError(invoke(focus, args)).code, args.includes('--backend') || args.includes('--mode') ? 'UNKNOWN_FLAG' : 'INVALID_ARG');
  for (const target of ['browser://NEW', 'browser://new/', 'browser://new?mode=1', 'browser://attach:9222']) {
    assert.equal(parseError(invoke(focus, ['focus', 'create', '--id', 'literal', '--target', target])).code, 'INVALID_ARG');
  }
  for (const depth of ['-1', '16', '1.5', '01', 'NaN']) {
    assert.equal(parseError(invoke(focus, [
      'focus', 'create', '--id', 'native-depth', '--window', '12', '--depth', depth,
    ])).code, 'INVALID_ARG');
  }
  for (const extra of [
    ['--extension=firefox'], ['--cdp', 'http://127.0.0.1:9222', '--headless'],
    ['--cdp', 'http://127.0.0.1:9222', '--persistent'],
    ['--extension=chrome', '--url', 'about:blank'],
  ]) {
    assert.equal(parseError(invoke(focus, [
      'focus', 'create', '--id', 'attach-flags', '--target', 'browser://attach', ...extra,
    ])).code, 'INVALID_ARG');
  }

  const unsupported = parseError(invoke(broker, [], `${JSON.stringify({
    session_id: 'launch', operation: 'run-code', input: {},
  })}\n`));
  assert.equal(unsupported.code, 'BROWSER_SESSION_OPERATION_UNSUPPORTED');
  assert.equal(unsupported.operation, 'broker');
  assertSessionReceipt(unsupported);

  const beforeCaptureRejections = readWorkerLog(workerLog).length;
  for (const args of [
    ['capture', 'browser:launch', '--region', '1,2,3,4'],
    ['capture', 'browser:launch', '--base64'],
    ['capture', 'browser:launch', '--out', 'capture.png', '--xray'],
    ['capture', 'browser:launch', '--save', '--out', 'capture.png'],
  ]) assert.equal(parseError(invoke(seeBrowser, args)).code, 'INVALID_ARG');
  assert.equal(readWorkerLog(workerLog).length, beforeCaptureRejections);

  const rejectedFile = parseError(invoke(focus, [
    'focus', 'create', '--id', 'local-file', '--target', 'browser://new',
    '--url', 'file:///private/input.html',
  ]));
  assert.equal(rejectedFile.code, 'BROWSER_SESSION_INVALID');
  assertSessionReceipt(rejectedFile);

  assert.equal(parseError(invoke(focus, ['focus', 'remove', '--id', 'remote'])).code, 'MISSING_ARG');
  const detached = parseSuccess(invoke(focus, ['focus', 'remove', '--id', 'remote', '--backend', 'browser']));
  const closed = parseSuccess(invoke(focus, ['focus', 'remove', '--id', 'launch', '--backend', 'browser']));
  assertSessionReceipt(detached);
  assertSessionReceipt(closed);
  assert.equal(detached.status, 'removed');
  assert.equal(closed.status, 'removed');

  const calls = readWorkerLog(workerLog);
  assert.deepEqual(calls.find((call) => call.argv[1] === 'open').argv.slice(1), [
    'open', '--browser=chrome', 'https://example.test', '--json',
  ]);
  assert.deepEqual(calls.find((call) => call.argv[1] === 'attach').argv.slice(1), [
    'attach', '--cdp=http://127.0.0.1:9222', '--json',
  ]);
  assert.deepEqual(calls.find((call) => call.argv[1] === 'close').argv.slice(1), ['close', '--json']);
  assert.deepEqual(calls.find((call) => call.argv[1] === 'detach').argv.slice(1), ['detach', '--json']);
  assert.ok(calls.some((call) => call.argv[1] === 'eval'));
  for (const call of calls) {
    assert.equal(call.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
    assert.equal(call.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
    assert.equal(call.env.NO_UPDATE_NOTIFIER, '1');
    for (const key of ['AOS_PATH', 'AOS_PLAYWRIGHT_CLI', 'PLAYWRIGHT_CLI_SESSION', 'HTTP_PROXY']) {
      assert.equal(Object.hasOwn(call.env, key), false);
    }
  }

  const output = publicBytes.join('');
  for (const secret of [staged, caller, state, workerLog, '/hostile/', 'secret.invalid']) {
    assert.equal(output.includes(secret), false);
  }
  assert.doesNotMatch(output, /aos-[a-f0-9]{32}/u);
  assert.doesNotMatch(output, /file:\/\/|https:\/\//u);
  assert.doesNotMatch(output, /acknowledgement|guardian|pendingDetails|guardian_retirement/u);
});
