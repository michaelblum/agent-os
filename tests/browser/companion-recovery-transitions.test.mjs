import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

import { validateDescriptor } from '../../scripts/lib/browser-companion/descriptor.mjs';
import {
  companionStatus, installCompanion, uninstallCompanion, updateCompanion,
} from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import { acquireRemovalClaim } from '../../scripts/lib/browser-companion/store-removal-claim.mjs';
import { ensureRemovalJournal } from '../../scripts/lib/browser-companion/store-removal.mjs';
import {
  ensureStore, inspectStore, writePrivateRecordAtomic,
} from '../../scripts/lib/browser-companion/store-paths.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceDescriptor = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifests/companions/playwright-cli-v1.json'), 'utf8'));
const resultSchema = path.join(repoRoot, 'shared/schemas/aos-browser-companion-result-v1.schema.json');
const roots = new Set();
const TIMEOUT_MS = 5_000;

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-browser-companion-recovery-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function writeString(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'ascii');
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, '0');
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function tarball(entries) {
  const chunks = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes);
    chunks.push(tarHeader(entry.name, bytes.length), bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(chunks));
}

function packageManifest(name, cliVersion) {
  if (name === '@playwright/cli') return {
    name, version: cliVersion, engines: { node: '>=18' }, scripts: { test: 'playwright test' },
    dependencies: { playwright: '1.62.0-alpha-2026-06-29', 'playwright-core': '1.62.0-alpha-2026-06-29' },
    bin: { 'playwright-cli': 'playwright-cli.js' },
  };
  if (name === 'playwright') return {
    name, version: '1.62.0-alpha-2026-06-29', engines: { node: '>=18' },
    dependencies: { 'playwright-core': '1.62.0-alpha-2026-06-29' },
    optionalDependencies: { fsevents: '2.3.2' }, bin: { playwright: 'cli.js' },
  };
  return {
    name, version: '1.62.0-alpha-2026-06-29', engines: { node: '>=18' },
    bin: { 'playwright-core': 'cli.js' },
  };
}

function fixture(version = '0.1.15') {
  const descriptor = structuredClone(sourceDescriptor);
  descriptor.version = version;
  descriptor.packages[0].version = version;
  descriptor.packages[0].tarball = `https://registry.npmjs.org/@playwright/cli/-/cli-${version}.tgz`;
  const archives = new Map();
  for (const pkg of descriptor.packages) {
    const entrypoint = Object.values(pkg.bin)[0];
    const archive = tarball([
      { name: 'package/package.json', bytes: JSON.stringify(packageManifest(pkg.name, version)) },
      { name: `package/${entrypoint}`, bytes: `#!/usr/bin/env node\n// ${pkg.name}\n` },
    ]);
    pkg.integrity = `sha512-${crypto.createHash('sha512').update(archive).digest('base64')}`;
    archives.set(pkg.name, archive);
  }
  return {
    current: validateDescriptor(descriptor),
    download: async ({ packageName }) => archives.get(packageName),
  };
}

function assertSchema(receipt) {
  const result = spawnSync('python3', ['-c', `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding='utf-8'))
errors = list(Draft202012Validator(schema).iter_errors(json.load(sys.stdin)))
sys.exit(1 if errors else 0)
`, resultSchema], { input: JSON.stringify(receipt), encoding: 'utf8', timeout: 5_000 });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

async function waitForFile(file) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('removal contender did not reach its checkpoint');
}

function waitForFileSync(file) {
  const wait = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + TIMEOUT_MS;
  while (!fs.existsSync(file) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
  if (!fs.existsSync(file)) throw new Error('removal contender did not crash at its checkpoint');
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('removal contender timed out')); }, TIMEOUT_MS);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`removal contender failed: ${stderr}`));
    });
  });
}

test('empty lock phases recover and release cleanup residue produces truthful install and update receipts', async () => {
  const empty = isolated();
  const emptyStore = ensureStore(empty.env);
  fs.mkdirSync(emptyStore.paths.lock, { mode: 0o700 });
  assert.equal(companionStatus({ env: empty.env, repoRoot }).state, 'partial');
  const recovered = acquireStoreLock(empty.env);
  recovered.release();

  const raced = isolated();
  let racedPaths;
  assert.throws(() => acquireStoreLock(raced.env, {
    hooks: { afterLockDirectoryCreate: () => {
      racedPaths = inspectStore(raced.env).paths;
      fs.mkdirSync(racedPaths.lockRecovery, { mode: 0o700 });
    } },
  }), { code: 'COMPANION_STORE_BUSY' });
  assert.equal(companionStatus({ env: raced.env, repoRoot }).state, 'partial');
  const racedRecovery = acquireStoreLock(raced.env);
  racedRecovery.release();

  const current = fixture();
  const installState = isolated();
  const installed = await installCompanion({
    env: installState.env, current: current.current, download: current.download,
    hooks: { afterLockOwnerCleanup: () => { throw new Error('release interrupted'); } },
  });
  assert.equal(installed.status, 'installed');
  assert.equal(installed.after_state, 'partial');
  assert.equal(installed.recovery_pending, true);
  assertSchema(installed);
  assert.equal(companionStatus({ env: installState.env, current: current.current }).state, 'partial');

  const removedRecovery = isolated();
  const fullyReleased = await installCompanion({
    env: removedRecovery.env, current: current.current, download: current.download,
    hooks: { afterLockRecoveryRemoval: () => { throw new Error('lock parent fsync interrupted'); } },
  });
  assert.equal(fullyReleased.after_state, 'current');
  assert.equal(fullyReleased.recovery_pending, false);
  assert.equal(companionStatus({ env: removedRecovery.env, current: current.current }).state, 'current');

  const updateState = isolated();
  const old = fixture('0.1.14');
  await installCompanion({ env: updateState.env, current: old.current, download: old.download });
  const updated = await updateCompanion({
    env: updateState.env, current: current.current, download: current.download,
    hooks: { afterLockOwnerCleanup: () => { throw new Error('release interrupted'); } },
  });
  assert.equal(updated.status, 'updated');
  assert.equal(updated.after_state, 'partial');
  assert.equal(updated.recovery_pending, true);
  assertSchema(updated);
});

test('activation intent cleanup reports observed presence after injected unlink boundaries', async () => {
  const current = fixture();
  const absent = isolated();
  const committed = await installCompanion({
    env: absent.env, current: current.current, download: current.download,
    hooks: { afterActivationIntentUnlink: () => { throw new Error('intent fsync interrupted'); } },
  });
  assert.equal(committed.after_state, 'current');
  assert.equal(committed.recovery_pending, false);
  assert.equal(companionStatus({ env: absent.env, current: current.current }).state, 'current');

  const present = isolated();
  const pending = await installCompanion({
    env: present.env, current: current.current, download: current.download,
    hooks: { beforeActivationIntentUnlink: () => { throw new Error('intent unlink interrupted'); } },
  });
  assert.equal(pending.after_state, 'partial');
  assert.equal(pending.recovery_pending, true);
  assert.equal(companionStatus({ env: present.env, current: current.current }).state, 'partial');
});

test('empty removal intent, live journal retry, serialized recovery, and completion faults stay coherent', async () => {
  const empty = isolated();
  await assert.rejects(uninstallCompanion({
    env: empty.env, repoRoot,
    hooks: { afterRemovalMarkerCreate: () => { throw new Error('marker creation interrupted'); } },
  }));
  assert.equal(companionStatus({ env: empty.env, repoRoot }).state, 'partial');
  await assert.rejects(installCompanion({ env: empty.env, repoRoot }), { code: 'COMPANION_STORE_BLOCKED' });
  await assert.rejects(updateCompanion({ env: empty.env, repoRoot }), { code: 'COMPANION_STORE_BLOCKED' });
  const resumedEmpty = await uninstallCompanion({ env: empty.env, repoRoot });
  assert.equal(resumedEmpty.status, 'uninstalled');
  assert.equal(resumedEmpty.before_state, 'partial');

  const intent = isolated();
  await assert.rejects(uninstallCompanion({
    env: intent.env, repoRoot,
    hooks: { afterRemovalJournal: () => { throw new Error('journaled pre-retirement interruption'); } },
  }));
  assert.equal(companionStatus({ env: intent.env, repoRoot }).state, 'partial');
  const resumedIntent = await uninstallCompanion({ env: intent.env, repoRoot });
  assert.equal(resumedIntent.status, 'uninstalled');
  assert.equal(resumedIntent.before_state, 'partial');

  const serialized = isolated();
  const serializedStore = ensureStore(serialized.env);
  const serializedJournal = ensureRemovalJournal(serializedStore, { state: 'missing', validated: null });
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 5_000 });
  assert.equal(dead.status, 0);
  writePrivateRecordAtomic(path.join(serializedStore.paths.removal, 'recovery.json'), {
    schema_version: 'aos.browser.companion-removal-claim.v1',
    store_id: serializedStore.owner.store_id,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    pid: dead.pid,
    token: 'c'.repeat(32),
  }, { pendingDirectory: serializedStore.paths.removal });
  const serializedReceipt = await uninstallCompanion({
    env: serialized.env, repoRoot,
    hooks: { afterRemovalClaim: () => {
      assert.throws(() => acquireRemovalClaim(serializedStore.paths.removal, serializedJournal.store_id), { code: 'COMPANION_STORE_BUSY' });
    } },
  });
  assert.equal(serializedReceipt.after_state, 'missing');

  const pendingCleanup = isolated();
  const partial = await uninstallCompanion({
    env: pendingCleanup.env, repoRoot,
    hooks: { beforeRemovalMarkerRetirement: () => { throw new Error('marker retirement interrupted'); } },
  });
  assert.equal(partial.status, 'uninstalled');
  assert.equal(partial.after_state, 'partial');
  assert.equal(companionStatus({ env: pendingCleanup.env, repoRoot }).state, 'partial');
  await assert.rejects(uninstallCompanion({
    env: pendingCleanup.env, repoRoot,
    hooks: { beforeRemovalClaimLink: () => { throw new Error('cleanup claim pre-link interruption'); } },
  }), { code: 'COMPANION_STORE_BUSY' });
  assert.equal(companionStatus({ env: pendingCleanup.env, repoRoot }).state, 'partial');
  const completed = await uninstallCompanion({ env: pendingCleanup.env, repoRoot });
  assert.equal(completed.before_state, 'partial');
  assert.equal(completed.after_state, 'missing');

  const carried = isolated();
  const carriedStore = ensureStore(carried.env);
  const carriedJournal = ensureRemovalJournal(carriedStore, { state: 'missing', validated: null });
  const ready = path.join(carried.root, 'contender-ready');
  const release = path.join(carried.root, 'contender-release');
  const crashed = path.join(carried.root, 'contender-crashed');
  const claimURL = pathToFileURL(path.join(repoRoot, 'scripts/lib/browser-companion/store-removal-claim.mjs')).href;
  const contender = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { acquireRemovalClaim } from ${JSON.stringify(claimURL)};
    const wait = new Int32Array(new SharedArrayBuffer(4));
    acquireRemovalClaim(process.env.MARKER, process.env.STORE_ID, { hooks: {
      beforeRemovalClaimReserve() {
        fs.writeFileSync(process.env.READY, 'ready\\n', { mode: 0o600, flag: 'wx' });
        while (!fs.existsSync(process.env.RELEASE)) Atomics.wait(wait, 0, 0, 10);
      },
      beforeRemovalClaimWrite() {
        fs.writeFileSync(process.env.CRASHED, 'crashed\\n', { mode: 0o600, flag: 'wx' });
        process.exit(0);
      },
    } });
  `], {
    env: {
      ...carried.env, MARKER: carriedStore.paths.removal, STORE_ID: carriedJournal.store_id,
      READY: ready, RELEASE: release, CRASHED: crashed,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const contenderDone = collectChild(contender);
  await waitForFile(ready);
  const carriedReceipt = await uninstallCompanion({
    env: carried.env, repoRoot,
    hooks: {
      afterRemovalClaim: () => {
        fs.writeFileSync(release, 'release\n', { mode: 0o600, flag: 'wx' });
        waitForFileSync(crashed);
      },
      beforeCompletedRemovalCleanup: () => { throw new Error('leave verified tombstone'); },
    },
  });
  await contenderDone;
  assert.equal(carriedReceipt.after_state, 'missing');
  const completedMarker = `${carriedStore.paths.removal}-complete`;
  assert.equal(fs.readdirSync(completedMarker).some((entry) => /^\.publish-removal-claim-slot-[0-7]\.tmp$/u.test(entry)), true);
  const carriedCleanup = await uninstallCompanion({ env: carried.env, repoRoot });
  assert.equal(carriedCleanup.after_state, 'missing');
  assert.equal(fs.existsSync(completedMarker), false);

  const fsyncFault = isolated();
  const absent = await uninstallCompanion({
    env: fsyncFault.env, repoRoot,
    hooks: {
      afterRemovalMarkerRetirement: () => { throw new Error('browser fsync interrupted'); },
      beforeCompletedRemovalCleanup: () => { throw new Error('completed cleanup interrupted'); },
    },
  });
  assert.equal(absent.status, 'already_absent');
  assert.equal(absent.after_state, 'missing');
  assert.equal(absent.recovery_pending, false);
  assert.equal(companionStatus({ env: fsyncFault.env, repoRoot }).state, 'missing');
  assert.equal(fs.existsSync(path.join(fsyncFault.root, 'repo/browser/.companion-removal-complete')), true);
});
