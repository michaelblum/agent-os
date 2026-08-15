import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { spawnSync } from 'node:child_process';

import {
  captureManagedBrowserEvidence,
  createManagedSession,
  executeManagedSessionOperation,
  listManagedSessions,
  managedSessionIdentity,
  removeManagedSession,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { readSession, writeSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { companionStatus, uninstallCompanion } from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { runnerEnvironmentForTest } from '../../scripts/lib/browser-companion/session-runner.mjs';
import { EXTENSION_ID } from '../../scripts/lib/browser-companion/extension-profile.mjs';
import { installManagedRuntime, repoRoot } from './managed-runtime-test-fixture.mjs';

const roots = new Set();
function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-browser-session-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

function assertSessionSchema(receipt) {
  const result = spawnSync('python3', ['-c', `
import json,sys
from jsonschema import Draft202012Validator
schema=json.load(open(sys.argv[1],encoding='utf-8'))
errors=list(Draft202012Validator(schema).iter_errors(json.load(sys.stdin)))
assert not errors,[error.message for error in errors]
`, path.join(repoRoot, 'shared/schemas/aos-browser-session-result-v1.schema.json')], {
    input: JSON.stringify(receipt), encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
}

function resultJSON(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`);
}

function extensionHome(root) {
  const home = path.join(root, 'login-home');
  const extension = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Extensions', EXTENSION_ID, '0.1.15_0');
  fs.mkdirSync(extension, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Playwright', version: '0.1.15' }), { mode: 0o600 });
  return home;
}

function fakeRunner(calls, overrides = {}) {
  return async (request) => {
    calls.push(request);
    if (overrides[request.operation]) return overrides[request.operation](request);
    const session = request.argv[0].slice(3);
    const verb = request.argv[1];
    if (request.operation === 'start') return { spawned: true, exitCode: 0, stdout: resultJSON({
      session, pid: 41,
      ...(request.argv.some((arg) => arg.startsWith('--extension=')) ? { endpoint: 'chrome' } : {}),
      ...(request.argv.some((arg) => arg.startsWith('--cdp=')) ? { endpoint: request.argv.find((arg) => arg.startsWith('--cdp=')).slice(6) } : {}),
      result: { snapshot: { file: '<auto>' } },
    }) };
    if (request.operation === 'cleanup') return { spawned: true, exitCode: 0, stdout: resultJSON({ session, status: verb === 'detach' ? 'detached' : 'closed' }) };
    if (request.operation === 'liveness') return { spawned: true, exitCode: 0, stdout: resultJSON({ result: JSON.stringify({ status: 'alive' }) }) };
    if (request.operation === 'evidence_query') return { spawned: true, exitCode: 0, stdout: resultJSON({ result: JSON.stringify(overrides.evidenceResult ?? {
      status: 'captured', extracted_text: 'Evidence', visible: true, bounding_box: { x: 1, y: 2, width: 3, height: 4 },
      selector_resolution: { strategy: 'css', candidates: [{ kind: 'css', value: '#hero', match_count: 1, error: null }], used: { kind: 'css', value: '#hero', index: 0, match_count: 1 } },
    }) }) };
    const filename = request.argv.find((arg) => arg.startsWith('--filename='))?.slice('--filename='.length);
    if (filename) fs.writeFileSync(filename, request.operation === 'snapshot' ? '# snapshot\n' : Buffer.from('png'), { mode: 0o600 });
    const body = request.operation === 'page_identity'
      ? { result: JSON.stringify({ schema: 'aos.agent-workspace.browser-identity.v1', page_url: 'https://example.test', frame_url: 'https://example.test', top_frame_url: 'https://example.test', document_title: null }) }
      : request.operation === 'snapshot' ? { snapshot: { file: filename } }
        : request.operation === 'screenshot' ? { screenshot: { file: filename } }
          : { snapshot: { file: '<auto>' } };
    return { spawned: true, exitCode: 0, stdout: resultJSON(body) };
  };
}

test('launched and attached sessions bind random upstream authority and ownership-correct cleanup', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const calls = [];
  const run = fakeRunner(calls);
  const launched = await createManagedSession('work', { kind: 'launched', headless: false, persistent: true, url: 'https://example.test' }, { env: state.env, current: fixture.current, run });
  assertSessionSchema(launched);
  assert.equal(launched.status, 'active');
  assert.equal(launched.session.id, 'work');
  assert.equal(launched.session.persistent, true);
  const store = inspectStore(state.env);
  const launchedRecord = readSession(store, 'work');
  assert.notEqual(launchedRecord.upstream_session_id, 'work');
  assert.match(launchedRecord.upstream_session_id, /^aos-[a-f0-9]{32}$/u);
  assert.ok(fs.statSync(path.join(store.paths.workspaces, launchedRecord.workspace, 'profile')).isDirectory());
  assert.deepEqual(calls[0].argv.slice(1), ['open', '--browser=chrome', '--headed', '--persistent', 'https://example.test', '--json']);
  assert.equal(calls[0].cwd, path.join(store.paths.workspaces, launchedRecord.workspace));
  assert.equal(calls[0].env.HOME.startsWith(calls[0].cwd), true);
  assert.equal(calls[0].env.PLAYWRIGHT_BROWSERS_PATH.startsWith(calls[0].cwd), true);
  assert.equal(calls[0].env.NO_UPDATE_NOTIFIER, '1');
  assert.equal(calls[0].env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
  assert.equal(Object.hasOwn(calls[0].env, 'AOS_PLAYWRIGHT_CLI'), false);

  const futureAuthority = { ...fixture.current, digest: 'b'.repeat(64) };
  const identity = await managedSessionIdentity('work', { env: state.env, current: futureAuthority, run });
  assert.equal(identity.backend_identity.session_generation, launched.session.generation);
  assert.equal(calls.at(-1).operation, 'liveness');
  await assert.rejects(
    createManagedSession('future', { kind: 'launched', headless: true, persistent: false }, { env: state.env, current: futureAuthority, run }),
    (error) => error.code === 'COMPANION_UPDATE_REQUIRED',
  );
  const removed = await removeManagedSession('work', { env: state.env, current: futureAuthority, run });
  assertSessionSchema(removed);
  assert.equal(removed.status, 'removed');
  assert.equal(calls.at(-1).argv[1], 'close');

  await createManagedSession('chrome', { kind: 'attached', attach_kind: 'extension' }, {
    env: state.env, current: fixture.current, run, userHome: extensionHome(state.root), platform: 'darwin',
  });
  assert.deepEqual(calls.at(-1).argv.slice(1), ['attach', '--extension=chrome', '--json']);
  const detached = await removeManagedSession('chrome', { env: state.env, current: fixture.current, run });
  assert.equal(detached.status, 'removed');
  assert.equal(calls.at(-1).argv[1], 'detach');

  await createManagedSession('remote', { kind: 'attached', attach_kind: 'cdp', cdp_url: 'http://127.0.0.1:9222' }, { env: state.env, current: fixture.current, run });
  assert.deepEqual(calls.at(-1).argv.slice(1), ['attach', '--cdp=http://127.0.0.1:9222', '--json']);
  await assert.rejects(
    createManagedSession('bad-remote', { kind: 'attached', attach_kind: 'cdp', cdp_url: 'file:///tmp/socket' }, { env: state.env, current: fixture.current, run }),
    (error) => error.code === 'BROWSER_SESSION_INVALID',
  );
  await assert.rejects(
    createManagedSession('bad-file', { kind: 'launched', headless: true, persistent: false, url: 'file:///tmp/page.html' }, { env: state.env, current: fixture.current, run }),
    (error) => error.code === 'BROWSER_SESSION_INVALID',
  );
  assert.equal(readSession(inspectStore(state.env), 'bad-remote'), null);
  assert.equal(readSession(inspectStore(state.env), 'bad-file'), null);
  await removeManagedSession('remote', { env: state.env, current: fixture.current, run });
  assert.equal((await listManagedSessions({ env: state.env, current: fixture.current })).sessions.length, 0);
});

test('post-spawn ambiguity and cleanup loss retain record, workspace, lease, and immutable runtime', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const failedStart = fakeRunner([], { start: async () => ({ spawned: true, exitCode: null, timedOut: true, stdout: Buffer.alloc(0) }) });
  const created = await createManagedSession('ambiguous', { kind: 'launched', headless: true, persistent: false }, { env: state.env, current: fixture.current, run: failedStart });
  assert.equal(created.status, 'cleanup_required');
  const store = inspectStore(state.env);
  const retained = readSession(store, 'ambiguous');
  assert.equal(retained.state, 'cleanup_required');
  assert.ok(fs.statSync(path.join(store.paths.workspaces, retained.workspace)).isDirectory());
  const beforeRejectedUninstall = companionStatus({ env: state.env, current: fixture.current }).state;
  await assert.rejects(uninstallCompanion({ env: state.env, current: fixture.current }), (error) => error.code === 'COMPANION_LEASES_ACTIVE');
  assert.equal(fs.existsSync(store.paths.removal), false);
  assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, beforeRejectedUninstall);

  const cleanupLost = fakeRunner([], { cleanup: async (request) => ({ spawned: true, exitCode: 0, stdout: resultJSON({ session: request.argv[0].slice(3), status: 'unknown' }) }) });
  const removal = await removeManagedSession('ambiguous', { env: state.env, current: fixture.current, run: cleanupLost });
  assert.equal(removal.status, 'cleanup_required');
  assert.equal(readSession(store, 'ambiguous').state, 'cleanup_required');
  assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'partial');

  const recovered = await removeManagedSession('ambiguous', { env: state.env, current: fixture.current, run: fakeRunner([]) });
  assert.equal(recovered.status, 'removed');
});

test('fixed operations, liveness, and evidence use bounded managed commands with no generic escape hatch', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const calls = [];
  const run = fakeRunner(calls);
  await createManagedSession('ops', { kind: 'launched', headless: true, persistent: false }, { env: state.env, current: fixture.current, run });
  const navigated = await executeManagedSessionOperation('ops', 'navigate', { url: 'data:text/html,<main id="hero">x</main>' }, { env: state.env, current: fixture.current, run });
  assert.equal(navigated.receipt.operation, 'navigate');
  await assert.rejects(
    executeManagedSessionOperation('ops', 'navigate', { url: 'file:///tmp/page.html' }, { env: state.env, current: fixture.current, run }),
    (error) => error.code === 'BROWSER_SESSION_INVALID',
  );
  const snapshot = await executeManagedSessionOperation('ops', 'snapshot', {}, { env: state.env, current: fixture.current, run });
  assert.equal(snapshot.worker.artifact, '# snapshot\n');
  const evidence = await captureManagedBrowserEvidence('ops', { url: 'data:text/html,<main></main>', candidates: [{ kind: 'css', value: '#hero' }] }, { env: state.env, current: fixture.current, run });
  assert.equal(evidence.receipt.operation, 'evidence_capture');
  assert.equal(evidence.result.status, 'captured');
  assert.deepEqual(evidence.screenshot, Buffer.from('png'));
  await assert.rejects(executeManagedSessionOperation('ops', 'run-code', { source: 'arbitrary' }, { env: state.env, current: fixture.current, run }), (error) => error.code === 'BROWSER_SESSION_OPERATION_UNSUPPORTED');
  assert.equal(calls.some((call) => call.argv.includes('list') || call.argv.includes('run-code')), false);
  await removeManagedSession('ops', { env: state.env, current: fixture.current, run });
});

test('liveness failure becomes cleanup-required and public errors do not carry worker content', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('stale', { kind: 'launched', headless: true, persistent: false }, { env: state.env, current: fixture.current, run: fakeRunner([]) });
  const raw = '/private/path https://secret.invalid upstream output';
  const failed = fakeRunner([], { liveness: async () => ({ spawned: true, exitCode: 1, stderr: Buffer.from(raw), stdout: Buffer.alloc(0) }) });
  await assert.rejects(managedSessionIdentity('stale', { env: state.env, current: fixture.current, run: failed }), (error) => {
    assert.equal(error.code, 'BROWSER_SESSION_CLEANUP_REQUIRED');
    assert.equal(error.message.includes(raw), false);
    return true;
  });
  assert.equal(readSession(inspectStore(state.env), 'stale').state, 'cleanup_required');
  await removeManagedSession('stale', { env: state.env, current: fixture.current, run: fakeRunner([]) });
});

test('list preserves empty legacy state while the next mutation retires it; nonempty or linked state blocks', async () => {
  const empty = isolated();
  const fixture = await installManagedRuntime(empty.env);
  const emptyStore = inspectStore(empty.env);
  const legacy = path.join(emptyStore.paths.browser, 'sessions.json');
  fs.writeFileSync(legacy, '[]\n', { mode: 0o600 });
  await listManagedSessions({ env: empty.env, current: fixture.current });
  assert.equal(fs.existsSync(legacy), true);
  await createManagedSession('retire-legacy', { kind: 'launched', headless: true, persistent: false }, {
    env: empty.env, current: fixture.current, run: fakeRunner([]),
  });
  assert.equal(fs.existsSync(legacy), false);

  for (const kind of ['nonempty', 'linked']) {
    const state = isolated();
    const installed = await installManagedRuntime(state.env);
    const store = inspectStore(state.env);
    const file = path.join(store.paths.browser, 'sessions.json');
    if (kind === 'linked') {
      const outside = path.join(state.root, 'outside.json');
      fs.writeFileSync(outside, '[]\n', { mode: 0o600 });
      fs.symlinkSync(outside, file);
    } else fs.writeFileSync(file, '[{"id":"legacy"}]\n', { mode: 0o600 });
    await assert.rejects(listManagedSessions({ env: state.env, current: installed.current }), (error) => error.code === 'BROWSER_SESSION_MIGRATION_REQUIRED');
  }
});

test('managed session workspace mode and symlink drift fail closed', async () => {
  for (const kind of ['mode', 'symlink']) {
    const state = isolated();
    const fixture = await installManagedRuntime(state.env);
    await createManagedSession('owned', { kind: 'launched', headless: true, persistent: false }, {
      env: state.env, current: fixture.current, run: fakeRunner([]),
    });
    const store = inspectStore(state.env);
    const record = readSession(store, 'owned');
    const temp = path.join(store.paths.workspaces, record.workspace, 'temp');
    if (kind === 'mode') fs.chmodSync(temp, 0o755);
    else {
      const outside = path.join(state.root, 'outside');
      fs.mkdirSync(outside, { mode: 0o700 });
      fs.rmdirSync(temp);
      fs.symlinkSync(outside, temp);
    }
    assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'blocked');
  }
});

test('session lease must bind the exact immutable closure and entrypoint', async () => {
  for (const field of ['closure_sha256', 'entrypoint']) {
    const state = isolated();
    const fixture = await installManagedRuntime(state.env);
    await createManagedSession('bound', { kind: 'launched', headless: true, persistent: false }, {
      env: state.env, current: fixture.current, run: fakeRunner([]),
    });
    const store = inspectStore(state.env);
    const record = readSession(store, 'bound');
    writeSession(store, {
      ...record,
      [field]: field === 'closure_sha256' ? 'c'.repeat(64) : 'node_modules/playwright/package.json',
    });
    assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'corrupt');
  }
});

test('runner environment is closed over private session roots', () => {
  const env = runnerEnvironmentForTest('/private/session', {
    HOME: '/user/home', PATH: '/custom/bin', AOS_PLAYWRIGHT_CLI: '/tmp/fallback',
    HTTP_PROXY: 'http://secret.invalid', LANG: 'en_US.UTF-8',
  });
  assert.equal(env.HOME, '/private/session/home');
  assert.equal(env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin');
  assert.equal(env.TMPDIR, '/private/session/temp');
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/private/session/browser-cache');
  assert.equal(Object.hasOwn(env, 'AOS_PLAYWRIGHT_CLI'), false);
  assert.equal(Object.hasOwn(env, 'HTTP_PROXY'), false);
});
