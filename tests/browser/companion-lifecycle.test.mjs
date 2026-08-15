import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

import { inspectTarball } from '../../scripts/lib/browser-companion/archive.mjs';
import { descriptorDigest, validateDescriptor } from '../../scripts/lib/browser-companion/descriptor.mjs';
import { installCompanion, companionStatus, uninstallCompanion, updateCompanion } from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import { buildPackageInventory } from '../../scripts/lib/browser-companion/store-package.mjs';
import { ensureStore, inspectStore, writePrivateRecordAtomic } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { cleanupRecoveryState, readActive } from '../../scripts/lib/browser-companion/store-state.mjs';
import { recoveryState, retireManagedPath } from '../../scripts/lib/browser-companion/store-retirement.mjs';
import {
  activateStage, cleanupStage, createStage, finalizeStage, materializePackage,
} from '../../scripts/lib/browser-companion/store-writer.mjs';
import { removeManagedLease, writeManagedLease } from './managed-session-test-fixture.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceDescriptor = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/companions/playwright-cli-v1.json'), 'utf8'));
const resultSchema = path.join(repoRoot, 'shared/schemas/aos-browser-companion-result-v1.schema.json');
const temporaryRoots = new Set();
const SUBPROCESS_TIMEOUT_MS = 5_000;

function temporaryRoot(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryRoots) fs.rmSync(directory, { recursive: true, force: true });
});

function assertSchemaValid(receipt) {
  const result = spawnSync('python3', ['-c', `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding='utf-8'))
Draft202012Validator.check_schema(schema)
errors = list(Draft202012Validator(schema).iter_errors(json.load(sys.stdin)))
sys.exit(1 if errors else 0)
`, resultSchema], {
    input: JSON.stringify(receipt), encoding: 'utf8', timeout: SUBPROCESS_TIMEOUT_MS,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

async function collectChild(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, SUBPROCESS_TIMEOUT_MS);
  const [code] = await once(child, 'close');
  clearTimeout(timer);
  assert.equal(timedOut, false, 'bounded child timed out');
  assert.equal(code, 0, stderr);
  return stdout;
}

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarHeader(name, size, type = '0') {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, type === '5' ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function tarball(entries) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes ?? '');
    chunks.push(tarHeader(entry.name, bytes.length, entry.type ?? '0'), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function packageManifest(pkg, version, options = {}) {
  if (pkg === '@playwright/cli') return {
    name: pkg,
    version,
    engines: { node: '>=18' },
    scripts: options.lifecycleScript ? { install: 'exit 91' } : { test: 'playwright test' },
    dependencies: {
      playwright: '1.62.0-alpha-2026-06-29',
      'playwright-core': options.badDependency ? '9.9.9' : '1.62.0-alpha-2026-06-29',
    },
    bin: { 'playwright-cli': 'playwright-cli.js' },
  };
  if (pkg === 'playwright') return {
    name: pkg,
    version: '1.62.0-alpha-2026-06-29',
    engines: { node: '>=18' },
    dependencies: { 'playwright-core': '1.62.0-alpha-2026-06-29' },
    optionalDependencies: { fsevents: '2.3.2' },
    bin: { playwright: 'cli.js' },
  };
  return {
    name: pkg,
    version: '1.62.0-alpha-2026-06-29',
    engines: { node: '>=18' },
    bin: { 'playwright-core': 'cli.js' },
  };
}

function fixture(options = {}) {
  const version = options.version ?? '0.1.15';
  const descriptor = structuredClone(sourceDescriptor);
  descriptor.version = version;
  descriptor.packages[0].version = version;
  descriptor.packages[0].tarball = `https://registry.npmjs.org/@playwright/cli/-/cli-${version}.tgz`;
  const archives = new Map();
  for (const pkg of descriptor.packages) {
    const manifest = packageManifest(pkg.name, version, options);
    if (options.swappedPackageIdentity) {
      if (pkg.name === '@playwright/cli') manifest.name = 'playwright';
      else if (pkg.name === 'playwright') manifest.name = '@playwright/cli';
    }
    if (options.duplicatePackageIdentity && pkg.name === 'playwright') manifest.name = '@playwright/cli';
    const entries = [{ name: 'package/package.json', bytes: JSON.stringify(manifest) }];
    if (!(options.missingEntrypoint && pkg.name === '@playwright/cli')) {
      entries.push({ name: `package/${Object.values(pkg.bin)[0]}`, bytes: `#!/usr/bin/env node\n// ${pkg.name} ${options.payload ?? 'fixture'}\n` });
    }
    if (pkg.name === '@playwright/cli') entries.push({ name: 'package/skills/playwright-cli/SKILL.md', bytes: 'must not install\n' });
    if (options.traversal && pkg.name === '@playwright/cli') entries.push({ name: 'package/../escape', bytes: 'escape\n' });
    if (options.special && pkg.name === '@playwright/cli') entries.push({ name: 'package/link', type: '2', bytes: '' });
    const archive = tarball(entries);
    pkg.integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`;
    archives.set(pkg.name, archive);
  }
  const current = validateDescriptor(descriptor);
  const calls = [];
  const download = async (request) => {
    calls.push(request.packageName);
    assert.equal(request.environment.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1');
    assert.equal(request.environment.PLAYWRIGHT_BROWSERS_PATH, '0');
    assert.match(request.environment.TMPDIR, /\.staging/u);
    return archives.get(request.packageName);
  };
  return { current, archives, download, calls };
}

function state({ sharedParents = false, mode = 'repo' } = {}) {
  const root = temporaryRoot('aos-browser-companion-v1-');
  const env = { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: mode };
  if (sharedParents) {
    fs.mkdirSync(path.join(root, mode, 'browser'), { recursive: true });
    fs.chmodSync(path.join(root, mode), 0o755);
    fs.chmodSync(path.join(root, mode, 'browser'), 0o755);
  }
  return { root, env };
}

function expectCode(error, code) {
  return error?.code === code;
}

test('source descriptor is exact and fake acquisition excludes skills without network or lifecycle scripts', async () => {
  const exact = validateDescriptor(sourceDescriptor);
  assert.equal(exact.descriptor.version, '0.1.15');
  assert.deepEqual([...exact.byName], sourceDescriptor.packages.map((pkg) => [pkg.name, pkg]));
  assert.doesNotMatch(JSON.stringify(sourceDescriptor), /latest/iu);
  const local = fixture();
  const isolated = state({ sharedParents: true });
  const receipt = await installCompanion({ env: isolated.env, current: local.current, download: local.download });
  assert.equal(receipt.status, 'installed');
  assert.deepEqual(local.calls, ['@playwright/cli', 'playwright', 'playwright-core']);
  const paths = inspectStore(isolated.env).paths;
  const active = readActive(inspectStore(isolated.env));
  const runtime = path.join(paths.versions, active.version_key);
  assert.equal(fs.existsSync(path.join(runtime, 'node_modules/@playwright/cli/skills')), false);
  assert.equal(fs.statSync(path.join(isolated.root, 'repo')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(isolated.root, 'repo/browser')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(paths.root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(runtime, 'node_modules/@playwright/cli/playwright-cli.js')).mode & 0o777, 0o600);
});

test('missing, current, idempotent install, update-missing, update/no-update, leases, and uninstall are exact', async () => {
  const current = fixture();
  const missing = state();
  assert.equal(companionStatus({ env: missing.env, current: current.current }).state, 'missing');
  await assert.rejects(updateCompanion({ env: missing.env, current: current.current, download: current.download }), (error) => expectCode(error, 'COMPANION_UPDATE_MISSING'));
  assert.equal(fs.existsSync(path.join(missing.root, 'repo/browser/companion')), false);
  const installed = await installCompanion({ env: missing.env, current: current.current, download: current.download });
  assertSchemaValid(installed);
  assert.equal(installed.before_state, 'missing');
  assert.equal(installed.after_state, 'current');
  assert.equal(installed.session_cleanup_count, 0);
  const monotonicTicks = [0, 300_001];
  const unchanged = await installCompanion({
    env: missing.env,
    current: current.current,
    download: async () => { throw new Error('idempotent install downloaded'); },
    monotonicNow: () => monotonicTicks.shift(),
  });
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.duration_ms, 300_001);
  assertSchemaValid(unchanged);

  const updateState = state();
  const old = fixture({ version: '0.1.14', payload: 'old' });
  await installCompanion({ env: updateState.env, current: old.current, download: old.download });
  const store = inspectStore(updateState.env);
  const oldActive = readActive(store);
  const leasedSession = writeManagedLease(store, 'leased-session', oldActive, 'a'.repeat(32));
  const updated = await updateCompanion({ env: updateState.env, current: current.current, download: current.download });
  assert.equal(updated.status, 'updated');
  assertSchemaValid(updated);
  assert.equal(updated.previous_version, '0.1.14');
  assert.equal(fs.readdirSync(store.paths.versions).length, 2, 'leased immutable version must remain');
  const noUpdate = await updateCompanion({
    env: updateState.env,
    current: current.current,
    download: async () => { throw new Error('no-update downloaded'); },
  });
  assert.equal(noUpdate.status, 'unchanged');
  assertSchemaValid(noUpdate);
  await assert.rejects(uninstallCompanion({ env: updateState.env, current: current.current }), (error) => expectCode(error, 'COMPANION_LEASES_ACTIVE'));
  removeManagedLease(store, leasedSession);
  const uninstalled = await uninstallCompanion({ env: updateState.env, current: current.current });
  assert.equal(uninstalled.status, 'uninstalled');
  assertSchemaValid(uninstalled);
  assert.equal(fs.existsSync(store.paths.root), false);
  assert.equal(fs.statSync(store.paths.modeRoot).isDirectory(), true);
  assert.equal(fs.statSync(store.paths.browser).isDirectory(), true);
  assert.equal(companionStatus({ env: updateState.env, current: current.current }).state, 'missing');
  const absent = await uninstallCompanion({ env: updateState.env, current: current.current });
  assert.equal(absent.status, 'already_absent');
  assertSchemaValid(absent);
  assert.equal(fs.existsSync(store.paths.root), false);

  const updateAvailableState = state();
  await installCompanion({ env: updateAvailableState.env, current: old.current, download: old.download });
  const oldView = companionStatus({ env: updateAvailableState.env, current: current.current });
  assert.equal(oldView.state, 'update_available');
  const removedOld = await uninstallCompanion({ env: updateAvailableState.env, current: current.current });
  assert.equal(removedOld.active_version, null);
  assert.equal(removedOld.previous_version, old.current.descriptor.version);
  assert.equal(removedOld.descriptor_sha256, oldView.installed_descriptor_sha256);
  assert.equal(removedOld.closure_sha256, oldView.closure_sha256);
  assertSchemaValid(removedOld);

  const cleanupFailureState = state();
  await installCompanion({ env: cleanupFailureState.env, current: current.current, download: current.download });
  const interruptedRemoval = await uninstallCompanion({
    env: cleanupFailureState.env,
    current: current.current,
    hooks: { beforeStoreRemovalCleanup: () => { throw new Error('store removal interruption'); } },
  });
  assert.equal(interruptedRemoval.status, 'uninstalled');
  assert.equal(interruptedRemoval.recovery_pending, true);
  assert.equal(interruptedRemoval.after_state, 'partial');
  assert.equal(companionStatus({ env: cleanupFailureState.env, current: current.current }).state, 'partial');
  const recoveredRemoval = await uninstallCompanion({ env: cleanupFailureState.env, current: current.current });
  assert.equal(recoveredRemoval.before_state, 'partial');
  assert.equal(recoveredRemoval.after_state, 'missing');
  assert.equal(recoveredRemoval.descriptor_sha256, interruptedRemoval.descriptor_sha256);
  assert.equal(recoveredRemoval.closure_sha256, interruptedRemoval.closure_sha256);
  assertSchemaValid(recoveredRemoval);
});

test('integrity, traversal, exact entrypoint, dependency, lifecycle, and preactivation failures preserve the active pointer', async () => {
  const isolated = state();
  const old = fixture({ version: '0.1.14', payload: 'old' });
  await installCompanion({ env: isolated.env, current: old.current, download: old.download });
  const activePath = inspectStore(isolated.env).paths.active;
  const before = fs.readFileSync(activePath, 'utf8');

  const badIntegrity = fixture({ version: '0.1.15' });
  badIntegrity.current.descriptor.packages[0].integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  const badCurrent = { ...badIntegrity.current, digest: descriptorDigest(badIntegrity.current.descriptor) };
  await assert.rejects(updateCompanion({ env: isolated.env, current: badCurrent, download: badIntegrity.download }), (error) => expectCode(error, 'COMPANION_INTEGRITY_MISMATCH'));
  assert.equal(fs.readFileSync(activePath, 'utf8'), before);

  for (const [options, code] of [
    [{ version: '0.1.16', traversal: true }, 'COMPANION_ARCHIVE_INVALID'],
    [{ version: '0.1.16', special: true }, 'COMPANION_ARCHIVE_INVALID'],
    [{ version: '0.1.16', missingEntrypoint: true }, 'COMPANION_PACKAGE_INVALID'],
    [{ version: '0.1.16', badDependency: true }, 'COMPANION_PACKAGE_INVALID'],
    [{ version: '0.1.16', lifecycleScript: true }, 'COMPANION_PACKAGE_INVALID'],
    [{ version: '0.1.16', swappedPackageIdentity: true }, 'COMPANION_PACKAGE_INVALID'],
    [{ version: '0.1.16', duplicatePackageIdentity: true }, 'COMPANION_PACKAGE_INVALID'],
  ]) {
    const next = fixture(options);
    await assert.rejects(updateCompanion({ env: isolated.env, current: next.current, download: next.download }), (error) => expectCode(error, code));
    assert.equal(fs.readFileSync(activePath, 'utf8'), before);
  }
  const next = fixture({ version: '0.1.16' });
  await assert.rejects(updateCompanion({
    env: isolated.env,
    current: next.current,
    download: next.download,
    hooks: { beforeActivation: () => { throw new Error('activation seam'); } },
  }), (error) => expectCode(error, 'COMPANION_ACTIVATION_FAILED'));
  assert.equal(fs.readFileSync(activePath, 'utf8'), before);

  const published = fixture({ version: '0.1.17' });
  await assert.rejects(updateCompanion({
    env: isolated.env,
    current: published.current,
    download: published.download,
    hooks: { afterVersionPublication: () => { throw new Error('publication seam'); } },
  }), (error) => expectCode(error, 'COMPANION_ACTIVATION_FAILED'));
  assert.equal(fs.readFileSync(activePath, 'utf8'), before);
  assert.equal(companionStatus({ env: isolated.env, current: published.current }).state, 'partial');
});

test('immutable version collisions require the staged closure and post-commit cleanup is non-authoritative', async () => {
  const isolated = state();
  const current = fixture();
  await installCompanion({ env: isolated.env, current: current.current, download: current.download });
  const store = inspectStore(isolated.env);
  const active = readActive(store);
  const versionRoot = path.join(store.paths.versions, active.version_key);
  fs.writeFileSync(path.join(versionRoot, 'node_modules/@playwright/cli/playwright-cli.js'), 'different self-consistent tree\n');
  fs.chmodSync(path.join(versionRoot, 'node_modules/@playwright/cli/playwright-cli.js'), 0o600);
  writePrivateRecordAtomic(path.join(versionRoot, 'inventory.json'), buildPackageInventory(versionRoot, current.current.descriptor));
  const stage = createStage(store);
  for (const pkg of current.current.descriptor.packages) {
    const inspected = inspectTarball(current.archives.get(pkg.name), pkg, current.current.descriptor.limits);
    materializePackage(stage, pkg, inspected.entries);
  }
  const validated = finalizeStage(stage, current.current.descriptor, current.current.digest);
  assert.throws(() => activateStage(store, stage, validated), (error) => expectCode(error, 'COMPANION_ACTIVATION_FAILED'));
  cleanupStage(store, stage);

  const cleanupState = state();
  const receipt = await installCompanion({
    env: cleanupState.env,
    current: current.current,
    download: current.download,
    hooks: { beforePostActivationCleanup: () => { throw new Error('cleanup seam'); } },
  });
  assert.equal(receipt.status, 'installed');
  assert.equal(receipt.recovery_pending, true);
  assert.equal(receipt.after_state, 'partial');
  assert.equal(companionStatus({ env: cleanupState.env, current: current.current }).state, 'partial');
  const repairedInstall = await installCompanion({
    env: cleanupState.env,
    current: current.current,
    download: async () => { throw new Error('partial repair downloaded'); },
  });
  assert.equal(repairedInstall.status, 'unchanged');
  assert.equal(repairedInstall.before_state, 'partial');
  assert.equal(repairedInstall.after_state, 'current');

  const supersededState = state();
  const old = fixture({ version: '0.1.14', payload: 'superseded' });
  await installCompanion({ env: supersededState.env, current: old.current, download: old.download });
  const updated = await updateCompanion({
    env: supersededState.env,
    current: current.current,
    download: current.download,
    hooks: { beforeSupersededCleanup: () => { throw new Error('superseded cleanup seam'); } },
  });
  assert.equal(updated.recovery_pending, true);
  assert.equal(updated.after_state, 'partial');
  assert.equal(companionStatus({ env: supersededState.env, current: current.current }).state, 'partial');
  assert.equal(fs.readdirSync(inspectStore(supersededState.env).paths.versions).length, 2);
  const repairedUpdate = await updateCompanion({
    env: supersededState.env,
    current: current.current,
    download: async () => { throw new Error('partial repair downloaded'); },
  });
  assert.equal(repairedUpdate.status, 'unchanged');
  assert.equal(repairedUpdate.before_state, 'partial');
  assert.equal(repairedUpdate.after_state, 'current');

  const activeSyncState = state();
  await installCompanion({ env: activeSyncState.env, current: old.current, download: old.download });
  const committed = await updateCompanion({
    env: activeSyncState.env,
    current: current.current,
    download: current.download,
    hooks: { afterActiveRename: () => { throw new Error('active fsync interruption'); } },
  });
  assert.equal(committed.status, 'updated');
  assert.equal(committed.recovery_pending, true);
  assert.equal(committed.after_state, 'partial');
  assert.equal(companionStatus({ env: activeSyncState.env, current: current.current }).state, 'partial');
  const repairedCommitted = await updateCompanion({
    env: activeSyncState.env, current: current.current,
    download: async () => { throw new Error('committed pointer repair downloaded'); },
  });
  assert.equal(repairedCommitted.before_state, 'partial');
  assert.equal(repairedCommitted.after_state, 'current');
});

test('symlink, private-mode, owner-sentinel, active lock, and exact stale-lock boundaries fail closed', async () => {
  const current = fixture();
  const linked = state({ sharedParents: true });
  const external = temporaryRoot('aos-browser-companion-external-');
  fs.symlinkSync(external, path.join(linked.root, 'repo/browser/companion'));
  assert.equal(companionStatus({ env: linked.env, current: current.current }).state, 'blocked');

  const missingLinkedAncestor = state();
  fs.symlinkSync(external, path.join(missingLinkedAncestor.root, 'repo'));
  assert.equal(companionStatus({ env: missingLinkedAncestor.env, current: current.current }).state, 'blocked');
  const driftedAncestor = state({ sharedParents: true });
  fs.chmodSync(path.join(driftedAncestor.root, 'repo/browser'), 0o777);
  assert.equal(companionStatus({ env: driftedAncestor.env, current: current.current }).state, 'blocked');

  const drifted = state();
  await installCompanion({ env: drifted.env, current: current.current, download: current.download });
  const driftStore = inspectStore(drifted.env);
  fs.chmodSync(driftStore.paths.root, 0o755);
  assert.equal(companionStatus({ env: drifted.env, current: current.current }).state, 'blocked');

  const unowned = state();
  await installCompanion({ env: unowned.env, current: current.current, download: current.download });
  const unownedStore = inspectStore(unowned.env);
  writePrivateRecordAtomic(unownedStore.paths.owner, { ...unownedStore.owner, uid: (unownedStore.owner.uid ?? 0) + 1 });
  assert.equal(companionStatus({ env: unowned.env, current: current.current }).state, 'blocked');

  const locked = state();
  const held = acquireStoreLock(locked.env);
  assert.equal(companionStatus({ env: locked.env, current: current.current }).state, 'blocked');
  assert.throws(() => acquireStoreLock(locked.env), (error) => expectCode(error, 'COMPANION_STORE_BUSY'));
  const store = held.store;
  held.release();
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const deadPid = child.pid;
  await collectChild(child);
  fs.mkdirSync(store.paths.lock, { mode: 0o700 });
  writePrivateRecordAtomic(path.join(store.paths.lock, 'owner.json'), {
    schema_version: 'aos.browser.companion.lock-owner.v1',
    store_id: store.owner.store_id,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    pid: deadPid,
    token: 'b'.repeat(32),
  });
  let contender;
  assert.throws(() => acquireStoreLock(locked.env, {
    hooks: {
      afterRecoveryClaim: () => {
        assert.equal(companionStatus({ env: locked.env, current: current.current }).state, 'partial');
      },
      beforeRetryAcquire: () => {
        contender = acquireStoreLock(locked.env);
      },
    },
  }), (error) => expectCode(error, 'COMPANION_STORE_BUSY'));
  assert.ok(contender);
  assert.equal(companionStatus({ env: locked.env, current: current.current }).state, 'blocked');
  contender.release();

  fs.mkdirSync(store.paths.lockRecovery, { mode: 0o700 });
  assert.equal(companionStatus({ env: locked.env, current: current.current }).state, 'partial');
  const recoveredEmpty = acquireStoreLock(locked.env);
  recoveredEmpty.release();

  const interruptedRelease = acquireStoreLock(locked.env, {
    hooks: { afterLockOwnerCleanup: () => { throw new Error('release cleanup interruption'); } },
  });
  assert.equal(interruptedRelease.release().recovery_pending, true);
  assert.equal(companionStatus({ env: locked.env, current: current.current }).state, 'partial');
  const afterEmptyRecovery = acquireStoreLock(locked.env);
  afterEmptyRecovery.release();
});

test('owner bootstrap converges and retirement preserves nested and root symlink targets', async () => {
  const isolated = state();
  const moduleURL = pathToFileURL(path.join(repoRoot, 'scripts/lib/browser-companion/store-paths.mjs')).href;
  const program = `import { ensureStore } from ${JSON.stringify(moduleURL)}; process.stdout.write(ensureStore(process.env).owner.store_id);`;
  const children = [0, 1].map(() => spawn(process.execPath, ['--input-type=module', '-e', program], {
    env: isolated.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const storeIDs = await Promise.all(children.map(collectChild));
  assert.equal(storeIDs[0], storeIDs[1]);
  const store = ensureStore(isolated.env);
  assert.equal(store.owner.store_id, storeIDs[0]);

  const external = temporaryRoot('aos-browser-companion-retirement-target-');
  fs.writeFileSync(path.join(external, 'preserved.txt'), 'preserved\n');
  const nested = createStage(store);
  retireManagedPath(store, nested.root, 'stage', {
    beforeRemove: (quarantine) => {
      fs.rmdirSync(path.join(quarantine, 'temp'));
      fs.symlinkSync(external, path.join(quarantine, 'temp'));
    },
  });
  assert.equal(fs.readFileSync(path.join(external, 'preserved.txt'), 'utf8'), 'preserved\n');

  const rootSwap = createStage(store);
  assert.throws(() => retireManagedPath(store, rootSwap.root, 'stage', {
    beforeRemove: (quarantine) => {
      fs.rmSync(quarantine, { recursive: true });
      fs.symlinkSync(external, quarantine);
    },
  }), (error) => expectCode(error, 'COMPANION_STORE_BLOCKED'));
  assert.equal(fs.readFileSync(path.join(external, 'preserved.txt'), 'utf8'), 'preserved\n');
  const swappedRetirement = recoveryState(store).retired[0];
  fs.unlinkSync(path.join(store.paths.retired, swappedRetirement));

  const interrupted = createStage(store);
  assert.throws(() => retireManagedPath(store, interrupted.root, 'stage', {
    beforeRemove: () => { throw new Error('retirement interruption'); },
  }), (error) => expectCode(error, 'COMPANION_STORE_CORRUPT'));
  assert.equal(recoveryState(store).retired.length, 1);
  assert.equal(companionStatus({ env: isolated.env, current: fixture().current }).state, 'partial');
  cleanupRecoveryState(store);
  assert.equal(companionStatus({ env: isolated.env, current: fixture().current }).state, 'missing');
  fs.writeFileSync(path.join(store.paths.pending, `.record-${process.pid}-${'a'.repeat(16)}.tmp`), '{}\n', { mode: 0o600 });
  assert.equal(companionStatus({ env: isolated.env, current: fixture().current }).state, 'partial');
  cleanupRecoveryState(store);
  assert.equal(companionStatus({ env: isolated.env, current: fixture().current }).state, 'missing');
});

test('one transition version keeps the sixteen-version stable boundary recoverable', async () => {
  const isolated = state();
  let activeFixture;
  for (let index = 0; index < 16; index += 1) {
    activeFixture = fixture({ version: `0.1.${index}`, payload: `boundary-${index}` });
    if (index === 0) await installCompanion({ env: isolated.env, current: activeFixture.current, download: activeFixture.download });
    else await updateCompanion({ env: isolated.env, current: activeFixture.current, download: activeFixture.download });
    if (index < 15) {
      const store = inspectStore(isolated.env);
      const active = readActive(store);
      writeManagedLease(store, `lease-${index}`, active, index.toString(16).padStart(32, '0'));
    }
  }
  const next = fixture({ version: '0.1.16', payload: 'transition' });
  await assert.rejects(updateCompanion({
    env: isolated.env,
    current: next.current,
    download: next.download,
    hooks: { afterVersionPublication: () => { throw new Error('transition interruption'); } },
  }), (error) => expectCode(error, 'COMPANION_ACTIVATION_FAILED'));
  const interruptedStore = inspectStore(isolated.env);
  assert.equal(fs.readdirSync(interruptedStore.paths.versions).length, 17);
  assert.equal(companionStatus({ env: isolated.env, current: next.current }).state, 'partial');
  const recovered = await updateCompanion({ env: isolated.env, current: next.current, download: next.download });
  assert.equal(recovered.before_state, 'partial');
  assert.equal(recovered.after_state, 'current');
  assert.equal(fs.readdirSync(inspectStore(isolated.env).paths.versions).length, 16);
  assertSchemaValid(recovered);
  const fullStore = inspectStore(isolated.env);
  const fullActive = readActive(fullStore);
  writeManagedLease(fullStore, 'lease-15', fullActive, 'f'.repeat(32));
  const overflow = fixture({ version: '0.1.17' });
  await assert.rejects(updateCompanion({
    env: isolated.env,
    current: overflow.current,
    download: async () => { throw new Error('capacity preflight downloaded'); },
  }), (error) => expectCode(error, 'COMPANION_LEASES_ACTIVE'));
  assert.deepEqual(readActive(inspectStore(isolated.env)), fullActive);
});
