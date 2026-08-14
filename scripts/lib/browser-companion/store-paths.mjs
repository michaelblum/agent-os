import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  inspectExclusiveRecordPublication,
  isExclusivePublicationTemp,
  lstatOptional,
  publishExclusivePrivateRecord,
  readPrivateRecord,
  recoverExclusiveRecordPublication,
  writePrivateRecordAtomic,
} from './store-records.mjs';

export {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  inspectExclusiveRecordPublication,
  isExclusivePublicationTemp,
  lstatOptional,
  publishExclusivePrivateRecord,
  readPrivateRecord,
  recoverExclusiveRecordPublication,
  writePrivateRecordAtomic,
};
const OWNER_SCHEMA = 'aos.browser.companion.owner.v1';
const OWNER_KEYS = ['schema_version', 'runtime_mode', 'state_root_sha256', 'mode_root_dev', 'mode_root_ino', 'store_id', 'uid'];

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runtimeMode(env) {
  return env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

function stateRoot(env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config', 'aos'));
}

export function storePaths(env = process.env) {
  const state = stateRoot(env);
  const mode = runtimeMode(env);
  const modeRoot = path.join(state, mode);
  const browser = path.join(modeRoot, 'browser');
  const root = path.join(browser, 'companion');
  const removal = path.join(browser, '.companion-removal');
  return Object.freeze({
    stateRoot: state,
    mode,
    modeRoot,
    browser,
    root,
    owner: path.join(root, 'owner.json'),
    active: path.join(root, 'active.json'),
    versions: path.join(root, 'versions'),
    leases: path.join(root, 'leases'),
    staging: path.join(root, '.staging'),
    pending: path.join(root, '.pending'),
    retired: path.join(root, '.retired'),
    bootstrap: path.join(root, '.bootstrap'),
    lock: path.join(root, '.lock'),
    lockRecovery: path.join(root, '.lock-recovery'),
    removal,
    removalJournal: path.join(removal, 'journal.json'),
    removalStore: path.join(removal, 'store'),
  });
}

function assertSharedDirectory(file, label) {
  const info = lstatOptional(file);
  if (!info) fail('COMPANION_STORE_CORRUPT', `${label} is missing`);
  const uid = currentUid();
  if (info.isSymbolicLink() || !info.isDirectory() || (uid !== null && info.uid !== uid) || (info.mode & 0o022) !== 0) {
    fail('COMPANION_STORE_BLOCKED', `${label} is not an owner-controlled real directory`);
  }
  return info;
}

function ensurePrivateDirectory(file, label) {
  const before = lstatOptional(file);
  if (!before) {
    try {
      fs.mkdirSync(file, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (error?.code !== 'EEXIST') fail('COMPANION_STORE_BLOCKED', `cannot create ${label}`, { cause: error });
    }
  }
  return assertPrivateDirectory(file, label);
}

function ensureSharedDirectory(file, label, parent, afterCreate) {
  const before = lstatOptional(file);
  if (!before) {
    try {
      fs.mkdirSync(file, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (error?.code !== 'EEXIST') fail('COMPANION_STORE_BLOCKED', `cannot create ${label}`, { cause: error });
    }
  }
  const info = assertSharedDirectory(file, label);
  if (!before) {
    fsyncDirectory(parent);
    afterCreate?.();
  }
  return info;
}

function createStateRoot(paths, hooks) {
  const components = [];
  let existing = paths.stateRoot;
  while (!lstatOptional(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) fail('COMPANION_STORE_BLOCKED', 'state root has no existing ancestor');
    components.unshift(path.basename(existing));
    existing = parent;
  }
  let parent;
  try {
    parent = fs.realpathSync(existing);
    if (!fs.lstatSync(parent).isDirectory()) fail('COMPANION_STORE_BLOCKED', 'state root ancestor is not a directory');
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_BLOCKED', 'state root ancestor cannot be resolved', { cause: error });
  }
  for (const component of components) {
    const child = path.join(parent, component);
    try {
      fs.mkdirSync(child, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (error?.code !== 'EEXIST') fail('COMPANION_STORE_BLOCKED', 'state root component cannot be created', { cause: error });
    }
    assertSharedDirectory(child, 'state root component');
    fsyncDirectory(parent);
    parent = fs.realpathSync(child);
  }
  hooks?.afterStateRootCreate?.();
}

function inspectStateRoot(paths, create, hooks = {}) {
  let info = lstatOptional(paths.stateRoot);
  if (!info && create) {
    createStateRoot(paths, hooks);
    info = lstatOptional(paths.stateRoot);
  }
  if (!info) return null;
  if (info.isSymbolicLink() || !info.isDirectory()) fail('COMPANION_STORE_BLOCKED', 'state root is not a real directory');
  const uid = currentUid();
  if ((uid !== null && info.uid !== uid) || (info.mode & 0o022) !== 0) {
    fail('COMPANION_STORE_BLOCKED', 'state root is not owner controlled');
  }
  return fs.realpathSync(paths.stateRoot);
}

function expectedOwner(paths, modeInfo, stateReal, storeId) {
  return {
    schema_version: OWNER_SCHEMA,
    runtime_mode: paths.mode,
    state_root_sha256: sha256(stateReal),
    mode_root_dev: String(modeInfo.dev),
    mode_root_ino: String(modeInfo.ino),
    store_id: storeId,
    uid: currentUid(),
  };
}

function validateOwner(paths, owner, modeInfo, stateReal) {
  if (!owner || JSON.stringify(Object.keys(owner).sort()) !== JSON.stringify([...OWNER_KEYS].sort())) {
    fail('COMPANION_STORE_CORRUPT', 'owner sentinel shape differs');
  }
  const expected = expectedOwner(paths, modeInfo, stateReal, owner.store_id);
  if (!/^[a-f0-9]{32}$/u.test(owner.store_id ?? '') || JSON.stringify(owner) !== JSON.stringify(expected)) {
    fail('COMPANION_STORE_BLOCKED', 'owner sentinel identity differs');
  }
  return Object.freeze(owner);
}

export function inspectStore(env = process.env) {
  const paths = storePaths(env);
  const stateReal = inspectStateRoot(paths, false);
  if (!stateReal) return Object.freeze({ exists: false, paths });
  if (!lstatOptional(paths.modeRoot)) return Object.freeze({ exists: false, paths });
  assertSharedDirectory(paths.modeRoot, 'mode root');
  if (!lstatOptional(paths.browser)) return Object.freeze({ exists: false, paths });
  assertSharedDirectory(paths.browser, 'browser store');
  const removal = lstatOptional(paths.removal);
  if (removal) assertPrivateDirectory(paths.removal, 'companion removal state');
  if (!lstatOptional(paths.root)) {
    return Object.freeze({
      exists: false,
      paths,
      removal: removal ? (lstatOptional(paths.removalStore) ? 'retired' : 'cleanup') : null,
    });
  }
  if (removal && lstatOptional(paths.removalStore)) {
    fail('COMPANION_STORE_BLOCKED', 'canonical and retired companion stores overlap');
  }
  assertPrivateDirectory(paths.root, 'companion store');
  if (!lstatOptional(paths.bootstrap) && !lstatOptional(paths.owner)) {
    if (fs.readdirSync(paths.root).length !== 0) {
      if (!lstatOptional(paths.bootstrap) && !lstatOptional(paths.owner)) {
        fail('COMPANION_STORE_CORRUPT', 'ownerless companion store layout differs');
      }
    } else {
      return Object.freeze({ exists: false, paths, bootstrap: true, removal: removal ? 'intent' : null });
    }
  }
  if (lstatOptional(paths.bootstrap)) {
    assertPrivateDirectory(paths.bootstrap, 'companion owner bootstrap');
    if (lstatOptional(paths.pending)) {
      inspectExclusiveRecordPublication(paths.owner, {
        pendingDirectory: paths.pending,
        purpose: 'store-owner',
        validate: (owner) => validateOwner(paths, owner, fs.lstatSync(paths.modeRoot), stateReal),
      });
    } else if (lstatOptional(paths.owner)) {
      fail('COMPANION_STORE_CORRUPT', 'owner publication lacks its pending directory');
    }
    return Object.freeze({ exists: false, paths, bootstrap: true, removal: removal ? 'intent' : null });
  }
  const owner = validateOwner(paths, readPrivateRecord(paths.owner), fs.lstatSync(paths.modeRoot), stateReal);
  return Object.freeze({ exists: true, paths, owner, removal: removal ? 'intent' : null });
}

function joinOwnerBootstrap(paths) {
  if (lstatOptional(paths.bootstrap) || lstatOptional(paths.owner)) return;
  const entries = fs.readdirSync(paths.root);
  if (entries.length > 0) {
    if (lstatOptional(paths.bootstrap) || lstatOptional(paths.owner)) return;
    fail('COMPANION_STORE_CORRUPT', 'ownerless companion store layout differs');
  }
  try {
    fs.mkdirSync(paths.bootstrap, { mode: DIRECTORY_MODE });
  } catch (error) {
    if (error?.code !== 'EEXIST') fail('COMPANION_STORE_BLOCKED', 'owner bootstrap cannot be created', { cause: error });
  }
  assertPrivateDirectory(paths.bootstrap, 'companion owner bootstrap');
  fsyncDirectory(paths.root);
}

export function ensureStore(env = process.env, options = {}) {
  const paths = storePaths(env);
  const stateReal = inspectStateRoot(paths, true, options.hooks);
  const modeInfo = ensureSharedDirectory(
    paths.modeRoot, 'mode root', stateReal, options.hooks?.afterModeRootCreate,
  );
  ensureSharedDirectory(
    paths.browser, 'browser store', fs.realpathSync(paths.modeRoot), options.hooks?.afterBrowserCreate,
  );
  const removal = lstatOptional(paths.removal);
  if (removal && (!options.allowRemovalIntent || lstatOptional(paths.removalStore))) {
    fail('COMPANION_STORE_BUSY', 'companion store removal is incomplete');
  }
  const rootBefore = lstatOptional(paths.root);
  ensurePrivateDirectory(paths.root, 'companion store');
  if (!rootBefore) {
    fsyncDirectory(paths.browser);
    options.hooks?.afterStoreRootCreate?.();
  }
  joinOwnerBootstrap(paths);
  for (const [directory, label] of [
    [paths.versions, 'versions'], [paths.leases, 'leases'], [paths.staging, 'staging'],
    [paths.pending, 'pending records'], [paths.retired, 'retired state'],
  ]) {
    ensurePrivateDirectory(directory, label);
  }
  if (lstatOptional(paths.bootstrap)) {
    assertPrivateDirectory(paths.bootstrap, 'companion owner bootstrap');
    const publication = publishExclusivePrivateRecord(
      paths.owner,
      expectedOwner(paths, modeInfo, stateReal, crypto.randomBytes(16).toString('hex')),
      {
        pendingDirectory: paths.pending,
        purpose: 'store-owner',
        validate: (owner) => validateOwner(paths, owner, modeInfo, stateReal),
        acceptExisting: true,
        code: 'COMPANION_STORE_BLOCKED',
        hooks: {
          beforeWrite: options.hooks?.beforeStoreOwnerWrite,
          beforeLink: options.hooks?.beforeStoreOwnerLink,
          afterLink: options.hooks?.afterStoreOwnerLink,
          afterTempUnlink: options.hooks?.afterStoreOwnerTempUnlink,
        },
      },
    );
    validateOwner(paths, publication.value, modeInfo, stateReal);
    try { fs.rmdirSync(paths.bootstrap); } catch (error) {
      if (error?.code !== 'ENOENT') fail('COMPANION_STORE_BLOCKED', 'owner bootstrap retirement failed', { cause: error });
    }
    fsyncDirectory(paths.root);
  }
  const owner = validateOwner(paths, readPrivateRecord(paths.owner), modeInfo, stateReal);
  return Object.freeze({ exists: true, paths, owner });
}
