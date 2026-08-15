import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { packagePath } from './descriptor.mjs';
import { fail } from './errors.mjs';
import { buildPackageInventory, validateVersionDirectory, versionKey } from './store-package.mjs';
import {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  lstatOptional,
  readPrivateRecord,
  writePrivateRecordAtomic,
} from './store-paths.mjs';
import {
  clearActivationIntent,
  createActivationIntent,
  retireManagedPath,
} from './store-retirement.mjs';
import { preflightVersionActivation } from './store-state.mjs';

const ACTIVE_SCHEMA = 'aos.browser.companion-active.v1';
const SAFE_SEGMENT = /^[A-Za-z0-9@._+-]+$/u;

function mkdirPrivate(directory) {
  const existing = lstatOptional(directory);
  if (!existing) fs.mkdirSync(directory, { mode: DIRECTORY_MODE });
  assertPrivateDirectory(directory, 'managed directory');
}

function safeChild(root, relative) {
  const parts = relative.split('/');
  if (parts.some((part) => !SAFE_SEGMENT.test(part) || part === '.' || part === '..')) {
    fail('COMPANION_ARCHIVE_INVALID', 'materialized archive path is unsafe');
  }
  const candidate = path.join(root, ...parts);
  if (!candidate.startsWith(`${root}${path.sep}`)) fail('COMPANION_ARCHIVE_INVALID', 'materialized archive escapes package root');
  return candidate;
}

function writePrivateFile(file, bytes) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), RECORD_MODE);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail('COMPANION_PACKAGE_INVALID', 'managed file write failed', { cause: error });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ensureParents(root, file) {
  const relative = path.relative(root, path.dirname(file));
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    mkdirPrivate(current);
  }
}

export function createStage(store) {
  const id = `stage-${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
  const root = path.join(store.paths.staging, id);
  mkdirPrivate(root);
  const paths = {
    root,
    archives: path.join(root, 'archives'),
    cache: path.join(root, 'cache'),
    temp: path.join(root, 'temp'),
    runtime: path.join(root, 'runtime'),
  };
  for (const directory of Object.values(paths).slice(1)) mkdirPrivate(directory);
  mkdirPrivate(path.join(paths.runtime, 'node_modules'));
  return Object.freeze(paths);
}

export function writeStageArchive(stage, index, bytes) {
  writePrivateFile(path.join(stage.archives, `${index}.tgz`), bytes);
}

export function materializePackage(stage, packageDescriptor, entries) {
  const packageRoot = path.join(stage.runtime, 'node_modules', packagePath(packageDescriptor.name));
  ensureParents(stage.runtime, packageRoot);
  mkdirPrivate(packageRoot);
  for (const entry of entries) {
    const destination = safeChild(packageRoot, entry.path);
    if (entry.type === 'directory') {
      ensureParents(packageRoot, destination);
      mkdirPrivate(destination);
    } else {
      ensureParents(packageRoot, destination);
      writePrivateFile(destination, entry.bytes);
    }
  }
}

export function finalizeStage(stage, descriptor, descriptorSha256) {
  const inventory = buildPackageInventory(stage.runtime, descriptor);
  writePrivateRecordAtomic(path.join(stage.runtime, 'descriptor.json'), descriptor);
  writePrivateRecordAtomic(path.join(stage.runtime, 'inventory.json'), inventory);
  const validated = validateVersionDirectory(stage.runtime, { descriptorSha256 });
  if (validated.closure_sha256 !== inventory.closure_sha256) {
    fail('COMPANION_PACKAGE_INVALID', 'staged closure digest differs');
  }
  return validated;
}

function fsyncVersionTree(directory) {
  assertPrivateDirectory(directory, 'version durability directory');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const info = lstatOptional(target);
    if (!info || info.isSymbolicLink()) fail('COMPANION_PACKAGE_INVALID', 'version durability tree contains a link');
    if (entry.isDirectory()) fsyncVersionTree(target);
    else if (!entry.isFile()) fail('COMPANION_PACKAGE_INVALID', 'version durability tree contains a special entry');
  }
  fsyncDirectory(directory);
}

export function activateStage(store, stage, validated, options = {}) {
  const key = versionKey(validated.version, validated.descriptor_sha256);
  preflightVersionActivation(store, key);
  const destination = path.join(store.paths.versions, key);
  const existing = lstatOptional(destination);
  if (existing) {
    const existingVersion = validateVersionDirectory(destination, { descriptorSha256: validated.descriptor_sha256 });
    if (existingVersion.closure_sha256 !== validated.closure_sha256) {
      fail('COMPANION_ACTIVATION_FAILED', 'existing immutable version closure differs');
    }
  } else {
    try {
      fsyncVersionTree(stage.runtime);
      const before = fs.lstatSync(stage.runtime);
      fs.renameSync(stage.runtime, destination);
      const after = fs.lstatSync(destination);
      if (after.dev !== before.dev || after.ino !== before.ino) {
        fail('COMPANION_ACTIVATION_FAILED', 'immutable version identity differs after publication');
      }
      fsyncDirectory(store.paths.versions);
    } catch (error) {
      if (error?.code?.startsWith?.('COMPANION_')) throw error;
      fail('COMPANION_ACTIVATION_FAILED', 'immutable version publication failed', { cause: error });
    }
  }
  if (options.hooks?.afterVersionPublication) {
    try {
      options.hooks.afterVersionPublication();
    } catch (error) {
      fail('COMPANION_ACTIVATION_FAILED', 'injected post-version publication failure', { cause: error });
    }
  }
  const nextActive = {
    schema_version: ACTIVE_SCHEMA,
    version_key: key,
    version: validated.version,
    descriptor_sha256: validated.descriptor_sha256,
    closure_sha256: validated.closure_sha256,
  };
  const intent = createActivationIntent(store, readPrivateRecord(store.paths.active), nextActive);
  let publication;
  try {
    publication = writePrivateRecordAtomic(store.paths.active, nextActive, {
      pendingDirectory: store.paths.pending,
      afterRename: options.hooks?.afterActiveRename,
      returnCommittedFailure: true,
    });
  } catch (error) {
    try { clearActivationIntent(store, intent); } catch {}
    throw error;
  }
  let recoveryPending = publication.recovery_pending;
  if (!recoveryPending) {
    try {
      recoveryPending = clearActivationIntent(store, intent, { hooks: options.hooks }).recovery_pending;
    } catch {
      recoveryPending = true;
    }
  }
  return Object.freeze({ key, ...validated, recovery_pending: recoveryPending });
}

export function cleanupStage(store, stage, options = {}) {
  retireManagedPath(store, stage.root, 'stage', options);
}
