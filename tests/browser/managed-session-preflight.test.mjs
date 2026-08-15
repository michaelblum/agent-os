import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { parseFocusDepth } from '../../scripts/lib/focus-depth.mjs';
import { EXTENSION_ID, inspectChromeExtensionProfile } from '../../scripts/lib/browser-companion/extension-profile.mjs';
import {
  createManagedSession,
  executeManagedSessionOperation,
  listManagedSessions,
  removeManagedSession,
  validateManagedSessionOperation,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { inspectManagedState } from '../../scripts/lib/browser-companion/store-state.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { readSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { writeManagedLease } from './managed-session-test-fixture.mjs';
import { installManagedRuntime } from './managed-runtime-test-fixture.mjs';

const roots = new Set();
function temporary(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.add(root);
  return root;
}
function state() {
  const root = temporary('aos-managed-preflight-');
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}
function json(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function sessionFrom(request) { return request.argv[0].slice(3); }
function startAck(request) {
  const attached = request.argv[1] === 'attach';
  const endpoint = request.argv.find((value) => value.startsWith('--cdp='))?.slice(6)
    ?? (request.argv.includes('--extension=chrome') ? 'chrome' : null);
  return {
    session: sessionFrom(request), pid: 41,
    ...(attached ? { endpoint } : {}),
    result: { snapshot: { file: '<auto>' } },
  };
}
function exactRun(overrides = {}) {
  return async (request) => {
    if (overrides[request.operation]) return overrides[request.operation](request);
    if (request.operation === 'start') return { spawned: true, exitCode: 0, stdout: json(startAck(request)) };
    if (request.operation === 'cleanup') return { spawned: true, exitCode: 0, stdout: json({
      session: sessionFrom(request), status: request.argv[1] === 'detach' ? 'detached' : 'closed',
    }) };
    if (request.operation === 'liveness') return { spawned: true, exitCode: 0, stdout: json({ result: JSON.stringify({ status: 'alive' }) }) };
    return { spawned: true, exitCode: 0, stdout: json({ snapshot: { file: '<auto>' } }) };
  };
}
function chromeRoot(home) {
  return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
}
function installExtension(home, profile = 'Default', versionName = '0.1.15_0') {
  const version = path.join(chromeRoot(home), profile, 'Extensions', EXTENSION_ID, versionName);
  fs.mkdirSync(version, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(version, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name: 'Playwright', version: versionName.replace(/_\d+$/u, ''),
  }), { mode: 0o600 });
}

after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

test('native focus depth accepts only canonical safe integers from zero through fifteen', () => {
  const reject = (message, code) => { throw Object.assign(new Error(message), { code }); };
  assert.equal(parseFocusDepth('0', reject), 0);
  assert.equal(parseFocusDepth('15', reject), 15);
  for (const value of ['-1', '16', '01', '1.0', 'NaN']) {
    assert.throws(() => parseFocusDepth(value, reject), (error) => error.code === 'INVALID_ARG');
  }
});

test('129th session is rejected before workspace, lease, runtime lookup, or worker', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  const view = inspectManagedState(isolated.env, fixture.current.digest);
  for (let index = 0; index < 128; index += 1) {
    writeManagedLease(view.store, `s${index}`, view.active, index.toString(16).padStart(32, '0'));
  }
  const beforeLeases = fs.readdirSync(view.store.paths.leases).sort();
  const beforeWorkspaces = fs.readdirSync(view.store.paths.workspaces).sort();
  let calls = 0;
  await assert.rejects(createManagedSession('overflow', {
    kind: 'attached', attach_kind: 'extension',
  }, {
    env: isolated.env,
    current: { ...fixture.current, digest: 'f'.repeat(64) },
    userHome: path.join(isolated.root, 'missing-home'), platform: 'darwin',
    run: async () => { calls += 1; },
  }), (error) => error.code === 'BROWSER_SESSION_LIMIT');
  assert.equal(calls, 0);
  assert.deepEqual(fs.readdirSync(view.store.paths.leases).sort(), beforeLeases);
  assert.deepEqual(fs.readdirSync(view.store.paths.workspaces).sort(), beforeWorkspaces);
});

test('extension profile detector is bounded, trivalent, and rejects linked or decoy layouts', () => {
  const missing = temporary('aos-extension-missing-');
  assert.equal(inspectChromeExtensionProfile({ userHome: missing, platform: 'darwin' }).state, 'unavailable');

  const installed = temporary('aos-extension-installed-');
  installExtension(installed, 'Profile 2');
  const admitted = inspectChromeExtensionProfile({ userHome: installed, platform: 'darwin' });
  assert.equal(admitted.state, 'installed');
  assert.equal(admitted.userDataDir, chromeRoot(fs.realpathSync(installed)));

  const preferences = temporary('aos-extension-preferences-');
  const profile = path.join(chromeRoot(preferences), 'Default');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(profile, 'Preferences'), JSON.stringify({ note: EXTENSION_ID }), { mode: 0o600 });
  assert.equal(inspectChromeExtensionProfile({ userHome: preferences, platform: 'darwin' }).state, 'unavailable');

  const emptyDecoy = temporary('aos-extension-empty-decoy-');
  fs.mkdirSync(path.join(chromeRoot(emptyDecoy), 'Default', 'Extensions', EXTENSION_ID), { recursive: true, mode: 0o700 });
  assert.equal(inspectChromeExtensionProfile({ userHome: emptyDecoy, platform: 'darwin' }).state, 'unavailable');

  const malformed = temporary('aos-extension-malformed-');
  installExtension(malformed);
  fs.mkdirSync(path.join(chromeRoot(malformed), 'Default', 'Extensions', EXTENSION_ID, 'not-a-version'), { mode: 0o700 });
  assert.equal(inspectChromeExtensionProfile({ userHome: malformed, platform: 'darwin' }).state, 'blocked');

  const laterMalformed = temporary('aos-extension-later-malformed-');
  installExtension(laterMalformed, 'Default');
  installExtension(laterMalformed, 'Profile 2');
  fs.mkdirSync(path.join(chromeRoot(laterMalformed), 'Profile 2', 'Extensions', EXTENSION_ID, 'invalid'), { mode: 0o700 });
  assert.equal(inspectChromeExtensionProfile({ userHome: laterMalformed, platform: 'darwin' }).state, 'blocked');

  const overCap = temporary('aos-extension-over-cap-');
  for (let index = 0; index < 17; index += 1) installExtension(overCap, 'Default', `0.1.${index}_0`);
  assert.equal(inspectChromeExtensionProfile({ userHome: overCap, platform: 'darwin' }).state, 'blocked');

  const linked = temporary('aos-extension-linked-');
  const linkedProfile = path.join(chromeRoot(linked), 'Default');
  const outside = path.join(linked, 'outside');
  fs.mkdirSync(linkedProfile, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(outside, EXTENSION_ID), { recursive: true, mode: 0o700 });
  fs.symlinkSync(outside, path.join(linkedProfile, 'Extensions'));
  assert.equal(inspectChromeExtensionProfile({ userHome: linked, platform: 'darwin' }).state, 'blocked');
  assert.ok(fs.statSync(outside).isDirectory());

  const changing = temporary('aos-extension-changing-');
  installExtension(changing);
  const marker = path.join(chromeRoot(changing), 'Default', 'Extensions', EXTENSION_ID, '0.1.15_0', 'marker');
  const unstable = inspectChromeExtensionProfile({
    userHome: changing, platform: 'darwin',
    afterScan(attempt) {
      if (attempt % 2 === 0) fs.writeFileSync(marker, 'x', { mode: 0o600 });
      else fs.unlinkSync(marker);
    },
  });
  assert.equal(unstable.state, 'blocked');

  const source = fs.readFileSync(new URL('../../scripts/lib/browser-companion/extension-profile.mjs', import.meta.url), 'utf8');
  assert.match(source, /os\.userInfo\(\)\.homedir/u);
  assert.doesNotMatch(source, /process\.env\.HOME/u);
});

test('extension unavailability fails before session workspace, lease, or worker', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  const store = inspectStore(isolated.env);
  let calls = 0;
  await assert.rejects(createManagedSession('bridge', {
    kind: 'attached', attach_kind: 'extension',
  }, {
    env: isolated.env, current: fixture.current,
    userHome: path.join(isolated.root, 'missing-home'), platform: 'darwin',
    run: async () => { calls += 1; },
  }), (error) => error.code === 'BROWSER_SESSION_EXTENSION_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.equal(readSession(store, 'bridge'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).length, 0);
});

test('fail-before-registration retires local authority while post-spawn decoys remain cleanup-required', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await assert.rejects(createManagedSession('never-spawned', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ start: async () => ({ spawned: false, exitCode: null, stdout: Buffer.alloc(0) }) }),
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  const store = inspectStore(isolated.env);
  assert.equal(readSession(store, 'never-spawned'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).length, 0);

  const nested = await createManagedSession('nested-decoy', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ start: async (request) => ({
      spawned: true, exitCode: 0,
      stdout: json({ session: 'wrong', pid: 41, result: { snapshot: { file: '<auto>' }, session: sessionFrom(request) } }),
    }) }),
  });
  assert.equal(nested.status, 'cleanup_required');
  assert.equal(readSession(store, 'nested-decoy').state, 'cleanup_required');

  const cleanupDecoy = await removeManagedSession('nested-decoy', {
    env: isolated.env, current: fixture.current,
    run: exactRun({ cleanup: async (request) => ({
      spawned: true, exitCode: 0,
      stdout: json({ session: sessionFrom(request), status: { status: 'closed' } }),
    }) }),
  });
  assert.equal(cleanupDecoy.status, 'cleanup_required');
});

test('worker death during an active operation makes actual durable state cleanup-required', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await createManagedSession('dies', { kind: 'launched', headless: true, persistent: false }, {
    env: isolated.env, current: fixture.current, run: exactRun(),
  });
  await assert.rejects(executeManagedSessionOperation('dies', 'navigate', { url: 'about:blank' }, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ navigate: async () => ({ spawned: true, exitCode: 1, stdout: Buffer.alloc(0) }) }),
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  assert.equal(readSession(inspectStore(isolated.env), 'dies').state, 'cleanup_required');
});

test('active-less cleanup still binds leases and intents to immutable package state', async () => {
  const valid = state();
  const validFixture = await installManagedRuntime(valid.env);
  await createManagedSession('cleanup', { kind: 'launched', headless: true, persistent: false }, {
    env: valid.env, current: validFixture.current, run: exactRun(),
  });
  const validStore = inspectStore(valid.env);
  fs.unlinkSync(validStore.paths.active);
  const removed = await removeManagedSession('cleanup', {
    env: valid.env, current: validFixture.current, run: exactRun(),
  });
  assert.equal(removed.status, 'removed');

  const corrupt = state();
  const corruptFixture = await installManagedRuntime(corrupt.env);
  await createManagedSession('bound', { kind: 'launched', headless: true, persistent: false }, {
    env: corrupt.env, current: corruptFixture.current, run: exactRun(),
  });
  const corruptStore = inspectStore(corrupt.env);
  fs.unlinkSync(corruptStore.paths.active);
  const leaseFile = path.join(corruptStore.paths.leases, 'bound.json');
  const lease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
  fs.writeFileSync(leaseFile, `${JSON.stringify({ ...lease, closure_sha256: 'b'.repeat(64) })}\n`);
  let calls = 0;
  await assert.rejects(removeManagedSession('bound', {
    env: corrupt.env, current: corruptFixture.current,
    run: async () => { calls += 1; },
  }), (error) => error.code === 'COMPANION_STORE_CORRUPT');
  assert.equal(calls, 0);
});

test('operation acknowledgement rejects extra or nested session/status decoys', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await createManagedSession('operation-decoy', { kind: 'launched', headless: true, persistent: false }, {
    env: isolated.env, current: fixture.current, run: exactRun(),
  });
  await assert.rejects(executeManagedSessionOperation('operation-decoy', 'navigate', { url: 'about:blank' }, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ navigate: async (request) => ({
      spawned: true, exitCode: 0,
      stdout: json({ snapshot: { file: '<auto>' }, session: sessionFrom(request), status: { status: 'success' } }),
    }) }),
  }), (error) => error.code === 'BROWSER_SESSION_OUTPUT_INVALID');
  assert.equal(readSession(inspectStore(isolated.env), 'operation-decoy').state, 'cleanup_required');
});

test('page identity rejects an exact-envelope decoy and retains cleanup authority', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await createManagedSession('identity-decoy', { kind: 'launched', headless: true, persistent: false }, {
    env: isolated.env, current: fixture.current, run: exactRun(),
  });
  await assert.rejects(executeManagedSessionOperation('identity-decoy', 'page_identity', {}, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ page_identity: async () => ({
      spawned: true, exitCode: 0, stdout: json({ result: JSON.stringify({
        schema: 'aos.agent-workspace.browser-identity.v1', page_url: 'about:blank',
        frame_url: 'about:blank', top_frame_url: 'about:blank', document_title: '',
        status: 'alive',
      }) }),
    }) }),
  }), (error) => error.code === 'BROWSER_SESSION_OUTPUT_INVALID');
  assert.equal(readSession(inspectStore(isolated.env), 'identity-decoy').state, 'cleanup_required');
});

test('decoded screenshots are bounded to 32 MiB before broker projection', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await createManagedSession('oversized-shot', { kind: 'launched', headless: true, persistent: false }, {
    env: isolated.env, current: fixture.current, run: exactRun(),
  });
  await assert.rejects(executeManagedSessionOperation('oversized-shot', 'screenshot', {}, {
    env: isolated.env, current: fixture.current,
    run: exactRun({ screenshot: async (request) => {
      const filename = request.argv.find((arg) => arg.startsWith('--filename=')).slice(11);
      fs.writeFileSync(filename, Buffer.alloc((32 * 1024 * 1024) + 1), { mode: 0o600 });
      return { spawned: true, exitCode: 0, stdout: json({ screenshot: { file: filename } }) };
    } }),
  }), (error) => error.code === 'BROWSER_SESSION_OUTPUT_INVALID');
  assert.equal(readSession(inspectStore(isolated.env), 'oversized-shot').state, 'cleanup_required');
});

test('focus list of a missing managed root is truly noncreating', async () => {
  const root = path.join(temporary('aos-list-parent-'), 'missing', 'state');
  const env = { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' };
  const fixture = await installManagedRuntime(state().env);
  const result = await listManagedSessions({ env, current: fixture.current });
  assert.deepEqual(result.sessions, []);
  assert.equal(fs.existsSync(root), false);
});

test('scroll validation is read-only and preserves exact empty legacy state', async () => {
  const isolated = state();
  const fixture = await installManagedRuntime(isolated.env);
  await createManagedSession('dry', { kind: 'launched', headless: true, persistent: false }, {
    env: isolated.env, current: fixture.current, run: exactRun(),
  });
  const store = inspectStore(isolated.env);
  const legacy = path.join(store.paths.browser, 'sessions.json');
  fs.writeFileSync(legacy, '[]\n', { mode: 0o600 });
  const before = fs.readFileSync(path.join(store.paths.leases, 'dry.json'));
  const validated = await validateManagedSessionOperation('dry', 'scroll', { delta_x: 0, delta_y: -200 }, {
    env: isolated.env, current: fixture.current,
  });
  assert.deepEqual(validated.input, { delta_x: 0, delta_y: -200 });
  assert.equal(fs.existsSync(legacy), true);
  assert.deepEqual(fs.readFileSync(path.join(store.paths.leases, 'dry.json')), before);
  assert.equal(fs.existsSync(store.paths.lock), false);
});
