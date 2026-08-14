import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  fsyncDirectory,
  inspectExclusiveRecordPublication,
  isExclusivePublicationTemp,
  lstatOptional,
  publishExclusivePrivateRecord,
  readPrivateRecord,
  recoverExclusiveRecordPublication,
} from './store-paths.mjs';

const CLAIM_SCHEMA = 'aos.browser.companion-removal-claim.v1';
const CLAIM_KEYS = ['schema_version', 'store_id', 'uid', 'pid', 'token'];
export const CLAIM_FILE = 'recovery.json';
export const STALE_CLAIM_FILE = 'recovery-stale.json';

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function deadPid(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function claimPath(marker, stale = false) {
  return path.join(marker, stale ? STALE_CLAIM_FILE : CLAIM_FILE);
}

function validateClaim(value, storeId) {
  if (
    !value
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...CLAIM_KEYS].sort())
    || value.schema_version !== CLAIM_SCHEMA
    || !/^[a-f0-9]{32}$/u.test(value.store_id ?? '')
    || value.store_id !== storeId
    || value.uid !== currentUid()
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || !/^[a-f0-9]{32}$/u.test(value.token ?? '')
  ) fail('COMPANION_STORE_BLOCKED', 'removal recovery claim differs');
  return Object.freeze(value);
}

function readClaim(marker, storeId, stale = false) {
  return validateClaim(readPrivateRecord(claimPath(marker, stale), {
    accessCode: 'COMPANION_STORE_BLOCKED',
  }), storeId);
}

function publicationOptions(marker, storeId, hooks = {}) {
  return {
    pendingDirectory: marker,
    purpose: 'removal-claim',
    code: 'COMPANION_STORE_BUSY',
    accessCode: 'COMPANION_STORE_BLOCKED',
    validate: (owner) => validateClaim(owner, storeId),
    hooks: {
      beforeReserve: hooks.beforeRemovalClaimReserve,
      beforeWrite: hooks.beforeRemovalClaimWrite,
      beforeLink: hooks.beforeRemovalClaimLink,
      afterLink: hooks.afterRemovalClaimLink,
      afterTempUnlink: hooks.afterRemovalClaimTempUnlink,
    },
  };
}

function unlinkDeadClaim(marker, storeId, stale) {
  const file = claimPath(marker, stale);
  if (!lstatOptional(file)) return;
  const before = fs.lstatSync(file);
  const owner = readClaim(marker, storeId, stale);
  if (!deadPid(owner.pid)) fail('COMPANION_STORE_BUSY', 'removal recovery claim is active');
  const after = fs.lstatSync(file);
  if (after.dev !== before.dev || after.ino !== before.ino) fail('COMPANION_STORE_BUSY', 'removal recovery claim changed');
  fs.unlinkSync(file);
  fsyncDirectory(marker);
}

function publishClaim(marker, storeId, options = {}) {
  const owner = {
    schema_version: CLAIM_SCHEMA,
    store_id: storeId,
    uid: currentUid(),
    pid: process.pid,
    token: crypto.randomBytes(16).toString('hex'),
  };
  return publishExclusivePrivateRecord(
    claimPath(marker), owner, publicationOptions(marker, storeId, options.hooks),
  ).value;
}

export function inspectRemovalClaims(marker, storeId, { allowMissing = true, nonAuthoritative = false } = {}) {
  const publication = inspectExclusiveRecordPublication(
    claimPath(marker), publicationOptions(marker, storeId),
  );
  const claim = publication.value;
  const stale = lstatOptional(claimPath(marker, true)) ? readClaim(marker, storeId, true) : null;
  if (claim && stale) fail('COMPANION_STORE_CORRUPT', 'multiple removal recovery claims exist');
  if (stale && !nonAuthoritative && !deadPid(stale.pid)) fail('COMPANION_STORE_BUSY', 'stale removal recovery claim is active');
  if (!allowMissing && !claim) fail('COMPANION_STORE_CORRUPT', 'removal recovery claim is missing');
  return Object.freeze({ claim, stale, recovery_pending: publication.recovery_pending });
}

export function acquireRemovalClaim(marker, storeId, options = {}) {
  recoverExclusiveRecordPublication(claimPath(marker), publicationOptions(marker, storeId));
  unlinkDeadClaim(marker, storeId, true);
  if (lstatOptional(claimPath(marker))) {
    const before = fs.lstatSync(claimPath(marker));
    const owner = readClaim(marker, storeId);
    if (!deadPid(owner.pid)) fail('COMPANION_STORE_BUSY', 'removal recovery claim is active');
    try {
      fs.renameSync(claimPath(marker), claimPath(marker, true));
      const moved = fs.lstatSync(claimPath(marker, true));
      if (moved.dev !== before.dev || moved.ino !== before.ino) fail('COMPANION_STORE_BUSY', 'stale removal claim identity differs');
      fsyncDirectory(marker);
    } catch (error) {
      if (error?.code?.startsWith?.('COMPANION_')) throw error;
      fail('COMPANION_STORE_BUSY', 'removal recovery claim was acquired concurrently', { cause: error });
    }
    unlinkDeadClaim(marker, storeId, true);
  }
  return publishClaim(marker, storeId, options);
}

export function isRemovalClaimPublicationTemp(name) {
  return isExclusivePublicationTemp(name, 'removal-claim');
}

export function releaseRemovalClaim(marker, storeId, expectedOwner) {
  if (!lstatOptional(claimPath(marker))) return;
  const before = fs.lstatSync(claimPath(marker));
  const owner = readClaim(marker, storeId);
  if (JSON.stringify(owner) !== JSON.stringify(expectedOwner)) fail('COMPANION_STORE_BUSY', 'removal recovery token differs');
  const after = fs.lstatSync(claimPath(marker));
  if (after.dev !== before.dev || after.ino !== before.ino) fail('COMPANION_STORE_BUSY', 'removal recovery claim changed');
  fs.unlinkSync(claimPath(marker));
  fsyncDirectory(marker);
}
