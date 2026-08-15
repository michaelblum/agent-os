import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  isExclusivePublicationTemp,
  lstatOptional,
  readPrivateRecord,
  writePrivateRecordAtomic,
} from './store-paths.mjs';
import { isSessionCreateIntentName } from './session-intent.mjs';
import { isEvidenceAckName } from './session-evidence-ack.mjs';
import { isGuardianOutcomeName } from './worker-guardian-outcome.mjs';

const MAX_RECOVERY_ENTRIES = 384;
const SAFE_PENDING_RECORD = /^\.record-[0-9]+-[a-f0-9]{16}\.tmp$/u;
const SAFE_ACTIVATION_INTENT = /^activation-[0-9]+-[a-f0-9]{24}\.json$/u;
const SAFE_PENDING = /^(?:\.record-[0-9]+-[a-f0-9]{16}\.tmp|\.publish-(?:store-owner|lock-owner|removal-claim|guardian-record|guardian-outcome)-slot-[0-7]\.tmp|activation-[0-9]+-[a-f0-9]{24}\.json|session-create-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-[a-f0-9]{32}\.json|guardian-outcome-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-[a-f0-9]{32}-[a-f0-9]{32}\.json|evidence-ack-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-[a-f0-9]{32}-[a-f0-9]{32}\.json)$/u;
const SAFE_RETIRED = /^retired-(?:active|stage|version)-[0-9]+-[a-f0-9]{24}$/u;
const ACTIVATION_SCHEMA = 'aos.browser.companion-activation-intent.v1';
const ACTIVATION_KEYS = ['schema_version', 'store_id', 'previous_active', 'next_active'];

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function boundedEntries(directory, pattern, label) {
  assertPrivateDirectory(directory, label);
  const entries = fs.readdirSync(directory).sort();
  if (entries.length > MAX_RECOVERY_ENTRIES || entries.some((entry) => !pattern.test(entry))) {
    fail('COMPANION_STORE_CORRUPT', `${label} layout differs`);
  }
  return entries;
}

function assertRetirable(target) {
  const info = lstatOptional(target);
  if (!info) return null;
  const uid = currentUid();
  if (info.isSymbolicLink() || (uid !== null && info.uid !== uid)) {
    fail('COMPANION_STORE_BLOCKED', 'managed retirement target is linked or unowned');
  }
  if (info.isDirectory()) {
    if ((info.mode & 0o777) !== DIRECTORY_MODE) fail('COMPANION_STORE_BLOCKED', 'managed retirement directory mode differs');
  } else if (info.isFile()) {
    if (info.nlink !== 1 || (info.mode & 0o777) !== RECORD_MODE) fail('COMPANION_STORE_BLOCKED', 'managed retirement file mode differs');
  } else {
    fail('COMPANION_STORE_BLOCKED', 'managed retirement target type differs');
  }
  return info;
}

function sameRetirementIdentity(before, after) {
  return before.dev === after.dev
    && before.ino === after.ino
    && before.uid === after.uid
    && (before.mode & 0o777) === (after.mode & 0o777)
    && before.isDirectory() === after.isDirectory()
    && before.isFile() === after.isFile()
    && before.nlink === after.nlink;
}

export function removeQuarantined(target, options = {}) {
  const before = assertRetirable(target);
  if (!before) return false;
  options.beforeRemove?.(target);
  const after = assertRetirable(target);
  if (!after || !sameRetirementIdentity(before, after)) {
    fail('COMPANION_STORE_BLOCKED', 'managed quarantine identity changed before cleanup');
  }
  fs.rmSync(target, { recursive: true, force: false, maxRetries: 0 });
  fsyncDirectory(path.dirname(target));
  return true;
}

function exactActivationIntent(store, file) {
  const intent = readPrivateRecord(file);
  if (
    !intent
    || JSON.stringify(Object.keys(intent).sort()) !== JSON.stringify([...ACTIVATION_KEYS].sort())
    || intent.schema_version !== ACTIVATION_SCHEMA
    || intent.store_id !== store.owner.store_id
    || !intent.next_active
  ) {
    fail('COMPANION_STORE_CORRUPT', 'activation intent shape differs');
  }
  const active = readPrivateRecord(store.paths.active);
  if (JSON.stringify(active) !== JSON.stringify(intent.previous_active) && JSON.stringify(active) !== JSON.stringify(intent.next_active)) {
    fail('COMPANION_STORE_CORRUPT', 'activation intent does not bind the active pointer');
  }
  return intent;
}

export function createActivationIntent(store, previousActive, nextActive) {
  const file = path.join(
    store.paths.pending,
    `activation-${process.pid}-${crypto.randomBytes(12).toString('hex')}.json`,
  );
  writePrivateRecordAtomic(file, {
    schema_version: ACTIVATION_SCHEMA,
    store_id: store.owner.store_id,
    previous_active: previousActive,
    next_active: nextActive,
  }, { pendingDirectory: store.paths.pending });
  return file;
}

export function clearActivationIntent(store, file, options = {}) {
  if (path.dirname(file) !== store.paths.pending || !SAFE_ACTIVATION_INTENT.test(path.basename(file))) {
    fail('COMPANION_STORE_BLOCKED', 'activation intent path differs');
  }
  exactActivationIntent(store, file);
  try {
    options.hooks?.beforeActivationIntentUnlink?.();
    fs.unlinkSync(file);
    options.hooks?.afterActivationIntentUnlink?.();
    fsyncDirectory(store.paths.pending);
  } catch {
    if (lstatOptional(file)) {
      exactActivationIntent(store, file);
      return Object.freeze({ recovery_pending: true });
    }
  }
  return Object.freeze({ recovery_pending: false });
}

export function recoveryState(store) {
  const pending = boundedEntries(store.paths.pending, SAFE_PENDING, 'pending records');
  const retired = boundedEntries(store.paths.retired, SAFE_RETIRED, 'retired state');
  return Object.freeze({ pending, retired, hasRecovery: pending.length > 0 || retired.length > 0 });
}

export function cleanupRecoveryState(store) {
  const recovery = recoveryState(store);
  for (const entry of recovery.pending) {
    if (isSessionCreateIntentName(entry) || isGuardianOutcomeName(entry) || isEvidenceAckName(entry)) {
      fail('COMPANION_LEASES_ACTIVE', 'managed session recovery blocks package cleanup');
    }
    const target = path.join(store.paths.pending, entry);
    if (SAFE_PENDING_RECORD.test(entry) || isExclusivePublicationTemp(entry)) removeQuarantined(target);
    else clearActivationIntent(store, target);
  }
  for (const entry of recovery.retired) {
    removeQuarantined(path.join(store.paths.retired, entry));
  }
}

export function retireManagedPath(store, target, kind, options = {}) {
  if (!['active', 'stage', 'version'].includes(kind)) fail('COMPANION_STORE_CORRUPT', 'managed retirement kind differs');
  const expectedParent = kind === 'active'
    ? store.paths.root
    : kind === 'stage'
      ? store.paths.staging
      : store.paths.versions;
  if (path.dirname(target) !== expectedParent || (kind === 'active' && target !== store.paths.active)) {
    fail('COMPANION_STORE_BLOCKED', 'managed retirement target escapes its owned live directory');
  }
  const info = assertRetirable(target);
  if (!info) return false;
  assertPrivateDirectory(store.paths.retired, 'retired state');
  const retired = path.join(
    store.paths.retired,
    `retired-${kind}-${process.pid}-${crypto.randomBytes(12).toString('hex')}`,
  );
  try {
    fs.renameSync(target, retired);
    const moved = fs.lstatSync(retired);
    if (moved.dev !== info.dev || moved.ino !== info.ino) {
      fail('COMPANION_STORE_CORRUPT', 'retired state identity differs');
    }
    fsyncDirectory(path.dirname(target));
    fsyncDirectory(store.paths.retired);
    removeQuarantined(retired, options);
    return true;
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_CORRUPT', 'managed retirement cleanup is incomplete', { cause: error });
  }
}
