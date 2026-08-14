import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { companionStatus } from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import {
  acquireRemovalClaim, inspectRemovalClaims, releaseRemovalClaim,
} from '../../scripts/lib/browser-companion/store-removal-claim.mjs';
import { ensureRemovalJournal } from '../../scripts/lib/browser-companion/store-removal.mjs';
import {
  ensureStore, inspectStore, storePaths,
} from '../../scripts/lib/browser-companion/store-paths.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots = new Set();
const TIMEOUT_MS = 5_000;

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-browser-companion-authority-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

function nestedState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-browser-companion-authority-'));
  roots.add(root);
  const stateRoot = path.join(root, 'nested', 'state', 'root');
  return { root, stateRoot, env: { ...process.env, AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' } };
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function publicationTemps(directory, purpose) {
  if (!fs.existsSync(directory)) return [];
  const pattern = new RegExp(`^\\.publish-${purpose}-slot-[0-7]\\.tmp$`, 'u');
  return fs.readdirSync(directory).filter((entry) => pattern.test(entry)).sort();
}

async function waitForSlotCount(directory, purpose, count) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (publicationTemps(directory, purpose).length === count) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`publication slot count did not reach ${count}`);
}

function shortWriteAndStop({ descriptor, bytes }) {
  fs.writeSync(descriptor, bytes.subarray(0, Math.min(7, bytes.length)));
  throw new Error('simulated short write interruption');
}

function assertFinalRecord(file) {
  const info = fs.lstatSync(file);
  assert.equal(info.isFile(), true);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(info.nlink, 1);
  assert.equal(info.mode & 0o777, 0o600);
}

function runCrashProgram(moduleFile, source, env) {
  const moduleURL = pathToFileURL(path.join(repoRoot, moduleFile)).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source(moduleURL)], {
    env, encoding: 'utf8', timeout: TIMEOUT_MS,
  });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

function collectChild(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('authority publication child timed out'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`authority publication child failed: ${stderr}`));
      else resolve(stdout);
    });
  });
}

test('store owner publication recovers orphan, pair, post-unlink, and contention phases', async () => {
  for (const [hook, expected, missing] of [
    ['afterStateRootCreate', (paths) => paths.stateRoot, (paths) => paths.modeRoot],
    ['afterModeRootCreate', (paths) => paths.modeRoot, (paths) => paths.browser],
    ['afterBrowserCreate', (paths) => paths.browser, (paths) => paths.root],
  ]) {
    const scaffold = nestedState();
    assert.throws(() => ensureStore(scaffold.env, {
      hooks: { [hook]: () => { throw new Error(`${hook} interruption`); } },
    }));
    const paths = storePaths(scaffold.env);
    assert.equal(fs.lstatSync(expected(paths)).isDirectory(), true);
    assert.equal(fs.existsSync(missing(paths)), false);
    assert.equal(companionStatus({ env: scaffold.env, repoRoot }).state, 'missing');
    ensureStore(scaffold.env);
  }

  const symlinked = nestedState();
  const realParent = path.join(symlinked.root, 'real-parent');
  const alias = path.join(symlinked.root, 'parent-alias');
  fs.mkdirSync(realParent, { mode: 0o700 });
  fs.symlinkSync(realParent, alias);
  symlinked.env.AOS_STATE_ROOT = path.join(alias, 'state', 'root');
  const symlinkedStore = ensureStore(symlinked.env);
  assert.equal(fs.realpathSync(symlinkedStore.paths.stateRoot).startsWith(fs.realpathSync(realParent)), true);

  const rootCrash = isolated();
  assert.throws(() => ensureStore(rootCrash.env, {
    hooks: { afterStoreRootCreate: () => { throw new Error('root creation interruption'); } },
  }));
  const rootCrashPaths = storePaths(rootCrash.env);
  assert.deepEqual(fs.readdirSync(rootCrashPaths.root), []);
  assert.equal(companionStatus({ env: rootCrash.env, repoRoot }).state, 'partial');
  ensureStore(rootCrash.env);

  const ownerlessExtra = isolated();
  assert.throws(() => ensureStore(ownerlessExtra.env, {
    hooks: { afterStoreRootCreate: () => { throw new Error('root creation interruption'); } },
  }));
  const ownerlessPaths = storePaths(ownerlessExtra.env);
  fs.mkdirSync(path.join(ownerlessPaths.root, 'unexpected'), { mode: 0o700 });
  assert.throws(() => ensureStore(ownerlessExtra.env), { code: 'COMPANION_STORE_CORRUPT' });
  assert.equal(companionStatus({ env: ownerlessExtra.env, repoRoot }).state, 'corrupt');

  const orphan = isolated();
  assert.throws(() => ensureStore(orphan.env, {
    hooks: { beforeStoreOwnerLink: () => { throw new Error('pre-link interruption'); } },
  }), { code: 'COMPANION_STORE_BLOCKED' });
  const orphanPaths = storePaths(orphan.env);
  assert.equal(companionStatus({ env: orphan.env, repoRoot }).state, 'partial');
  assert.equal(publicationTemps(orphanPaths.pending, 'store-owner').length, 1);
  const orphanRecovered = ensureStore(orphan.env);
  assertFinalRecord(orphanPaths.owner);
  assert.equal(publicationTemps(orphanPaths.pending, 'store-owner').length, 0);

  const pair = isolated();
  runCrashProgram('scripts/lib/browser-companion/store-paths.mjs', (moduleURL) => `
    import { ensureStore } from ${JSON.stringify(moduleURL)};
    ensureStore(process.env, { hooks: { afterStoreOwnerLink() { process.exit(0); } } });
  `, pair.env);
  const pairPaths = storePaths(pair.env);
  assert.equal(fs.lstatSync(pairPaths.owner).nlink, 2);
  assert.equal(companionStatus({ env: pair.env, repoRoot }).state, 'partial');
  const pairRecovered = ensureStore(pair.env);
  assertFinalRecord(pairPaths.owner);
  assert.equal(pairRecovered.owner.store_id.length, 32);

  const short = isolated();
  assert.throws(() => ensureStore(short.env, {
    hooks: { beforeStoreOwnerWrite: shortWriteAndStop },
  }), { code: 'COMPANION_STORE_BLOCKED' });
  assert.equal(companionStatus({ env: short.env, repoRoot }).state, 'partial');
  assert.equal(publicationTemps(storePaths(short.env).pending, 'store-owner').length, 1);
  ensureStore(short.env);

  const observed = isolated();
  const observedStore = ensureStore(observed.env, {
    hooks: { afterStoreOwnerTempUnlink: () => { throw new Error('pending fsync interruption'); } },
  });
  assertFinalRecord(observedStore.paths.owner);

  const cappedPair = isolated();
  for (let index = 0; index < 7; index += 1) {
    assert.throws(() => ensureStore(cappedPair.env, {
      hooks: { beforeStoreOwnerLink: () => { throw new Error('pre-link interruption'); } },
    }), { code: 'COMPANION_STORE_BLOCKED' });
  }
  runCrashProgram('scripts/lib/browser-companion/store-paths.mjs', (moduleURL) => `
    import { ensureStore } from ${JSON.stringify(moduleURL)};
    ensureStore(process.env, { hooks: { afterStoreOwnerLink() { process.exit(0); } } });
  `, cappedPair.env);
  const cappedPairPaths = storePaths(cappedPair.env);
  assert.equal(publicationTemps(cappedPairPaths.pending, 'store-owner').length, 8);
  assert.equal(fs.lstatSync(cappedPairPaths.owner).nlink, 2);
  ensureStore(cappedPair.env);
  assert.equal(publicationTemps(cappedPairPaths.pending, 'store-owner').length, 0);

  const exhausted = isolated();
  for (let index = 0; index < 8; index += 1) {
    assert.throws(() => ensureStore(exhausted.env, {
      hooks: { beforeStoreOwnerLink: () => { throw new Error('pre-link interruption'); } },
    }), { code: 'COMPANION_STORE_BLOCKED' });
  }
  assert.equal(companionStatus({ env: exhausted.env, repoRoot }).state, 'partial');
  assert.throws(() => ensureStore(exhausted.env), { code: 'COMPANION_STORE_BUSY' });
  assert.equal(publicationTemps(storePaths(exhausted.env).pending, 'store-owner').length, 8);

  const concurrent = isolated();
  const moduleURL = pathToFileURL(path.join(repoRoot, 'scripts/lib/browser-companion/store-paths.mjs')).href;
  const release = path.join(concurrent.root, 'release');
  const program = `
    import fs from 'node:fs';
    import { ensureStore } from ${JSON.stringify(moduleURL)};
    const wait = new Int32Array(new SharedArrayBuffer(4));
    const store = ensureStore(process.env, { hooks: { beforeStoreOwnerLink() {
      const deadline = Date.now() + 4_000;
      while (!fs.existsSync(process.env.RELEASE) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 10);
      if (!fs.existsSync(process.env.RELEASE)) throw new Error('publication barrier timed out');
    } } });
    process.stdout.write(store.owner.store_id);
  `;
  const children = Array.from({ length: 9 }, () => spawn(process.execPath, ['--input-type=module', '-e', program], {
    env: { ...concurrent.env, RELEASE: release }, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const concurrentPaths = storePaths(concurrent.env);
  await waitForSlotCount(concurrentPaths.pending, 'store-owner', 8);
  assert.equal(publicationTemps(concurrentPaths.pending, 'store-owner').length <= 8, true);
  fs.writeFileSync(release, 'release\n', { mode: 0o600, flag: 'wx' });
  const storeIDs = await Promise.all(children.map(collectChild));
  assert.equal(new Set(storeIDs).size, 1);
  assert.equal(publicationTemps(concurrentPaths.pending, 'store-owner').length, 0);
  assert.equal(orphanRecovered.owner.store_id.length, 32);

  const malformed = isolated();
  const malformedStore = ensureStore(malformed.env);
  fs.unlinkSync(malformedStore.paths.owner);
  fs.writeFileSync(malformedStore.paths.owner, '{}\n', { mode: 0o600, flag: 'wx' });
  fs.mkdirSync(malformedStore.paths.bootstrap, { mode: 0o700 });
  assert.throws(() => ensureStore(malformed.env), { code: 'COMPANION_STORE_CORRUPT' });
  assert.equal(fs.readFileSync(malformedStore.paths.owner, 'utf8'), '{}\n');
});

test('lock owner publication exposes and recovers short, orphan, pair, and post-unlink phases', () => {
  for (const [hook, callback] of [
    ['beforeLockOwnerWrite', shortWriteAndStop],
    ['beforeLockOwnerLink', () => { throw new Error('pre-link interruption'); }],
  ]) {
    const target = isolated();
    assert.throws(() => acquireStoreLock(target.env, { hooks: { [hook]: callback } }), {
      code: 'COMPANION_STORE_BUSY',
    });
    const paths = inspectStore(target.env).paths;
    assert.equal(companionStatus({ env: target.env, repoRoot }).state, 'partial');
    assert.equal(publicationTemps(paths.pending, 'lock-owner').length, 1);
    const recovered = acquireStoreLock(target.env);
    recovered.release();
    assert.equal(publicationTemps(paths.pending, 'lock-owner').length, 0);
  }

  const pair = isolated();
  runCrashProgram('scripts/lib/browser-companion/store-lock.mjs', (moduleURL) => `
    import { acquireStoreLock } from ${JSON.stringify(moduleURL)};
    acquireStoreLock(process.env, { hooks: { afterLockOwnerLink() { process.exit(0); } } });
  `, pair.env);
  const pairPaths = inspectStore(pair.env).paths;
  assert.equal(fs.lstatSync(path.join(pairPaths.lock, 'owner.json')).nlink, 2);
  assert.equal(companionStatus({ env: pair.env, repoRoot }).state, 'partial');
  const recoveredPair = acquireStoreLock(pair.env);
  assertFinalRecord(path.join(pairPaths.lock, 'owner.json'));
  recoveredPair.release();

  const observed = isolated();
  const lock = acquireStoreLock(observed.env, {
    hooks: { afterLockOwnerTempUnlink: () => { throw new Error('pending fsync interruption'); } },
  });
  assertFinalRecord(path.join(lock.store.paths.lock, 'owner.json'));
  lock.release();

  const malformed = isolated();
  const malformedStore = ensureStore(malformed.env);
  fs.mkdirSync(malformedStore.paths.lock, { mode: 0o700 });
  fs.writeFileSync(path.join(malformedStore.paths.lock, 'owner.json'), '{}\n', { mode: 0o600, flag: 'wx' });
  assert.throws(() => acquireStoreLock(malformed.env), { code: 'COMPANION_STORE_BLOCKED' });
  assert.equal(fs.readFileSync(path.join(malformedStore.paths.lock, 'owner.json'), 'utf8'), '{}\n');
});

test('removal claim publication recovers short, orphan, pair, and post-unlink phases and rejects malformed final', () => {
  for (const [hook, callback] of [
    ['beforeRemovalClaimWrite', shortWriteAndStop],
    ['beforeRemovalClaimLink', () => { throw new Error('pre-link interruption'); }],
  ]) {
    const target = isolated();
    const store = ensureStore(target.env);
    const journal = ensureRemovalJournal(store, { state: 'missing', validated: null });
    assert.throws(() => acquireRemovalClaim(store.paths.removal, journal.store_id, {
      hooks: { [hook]: callback },
    }), { code: 'COMPANION_STORE_BUSY' });
    assert.equal(inspectRemovalClaims(store.paths.removal, journal.store_id).recovery_pending, true);
    const claim = acquireRemovalClaim(store.paths.removal, journal.store_id);
    releaseRemovalClaim(store.paths.removal, journal.store_id, claim);
    assert.equal(publicationTemps(store.paths.removal, 'removal-claim').length, 0);
  }

  const pair = isolated();
  const pairStore = ensureStore(pair.env);
  const pairJournal = ensureRemovalJournal(pairStore, { state: 'missing', validated: null });
  runCrashProgram('scripts/lib/browser-companion/store-removal-claim.mjs', (moduleURL) => `
    import { acquireRemovalClaim } from ${JSON.stringify(moduleURL)};
    acquireRemovalClaim(process.env.MARKER, process.env.STORE_ID, { hooks: { afterRemovalClaimLink() { process.exit(0); } } });
  `, { ...pair.env, MARKER: pairStore.paths.removal, STORE_ID: pairJournal.store_id });
  assert.equal(fs.lstatSync(path.join(pairStore.paths.removal, 'recovery.json')).nlink, 2);
  assert.equal(inspectRemovalClaims(pairStore.paths.removal, pairJournal.store_id).recovery_pending, true);
  const recovered = acquireRemovalClaim(pairStore.paths.removal, pairJournal.store_id);
  assertFinalRecord(path.join(pairStore.paths.removal, 'recovery.json'));
  releaseRemovalClaim(pairStore.paths.removal, pairJournal.store_id, recovered);

  const observed = isolated();
  const observedStore = ensureStore(observed.env);
  const observedJournal = ensureRemovalJournal(observedStore, { state: 'missing', validated: null });
  const observedClaim = acquireRemovalClaim(observedStore.paths.removal, observedJournal.store_id, {
    hooks: { afterRemovalClaimTempUnlink: () => { throw new Error('pending fsync interruption'); } },
  });
  assertFinalRecord(path.join(observedStore.paths.removal, 'recovery.json'));
  releaseRemovalClaim(observedStore.paths.removal, observedJournal.store_id, observedClaim);

  const malformed = isolated();
  const malformedStore = ensureStore(malformed.env);
  const malformedJournal = ensureRemovalJournal(malformedStore, { state: 'missing', validated: null });
  fs.writeFileSync(path.join(malformedStore.paths.removal, 'recovery.json'), '{}\n', { mode: 0o600, flag: 'wx' });
  assert.throws(() => acquireRemovalClaim(malformedStore.paths.removal, malformedJournal.store_id), {
    code: 'COMPANION_STORE_BLOCKED',
  });
  assert.equal(fs.readFileSync(path.join(malformedStore.paths.removal, 'recovery.json'), 'utf8'), '{}\n');
});
