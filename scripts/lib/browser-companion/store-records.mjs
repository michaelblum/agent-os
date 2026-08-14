import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  MAX_PUBLICATION_TEMPS,
  isExclusivePublicationPurpose,
  isExclusivePublicationTemp,
  reserveExclusivePublicationSlot,
} from './store-publication-slots.mjs';

export const DIRECTORY_MODE = 0o700;
export const RECORD_MODE = 0o600;
export const MAX_RECORD_BYTES = 256 * 1024;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const O_DIRECTORY = fs.constants.O_DIRECTORY ?? 0;
const PUBLICATION_OBSERVE_MS = 2_000;

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

export function lstatOptional(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail('COMPANION_STORE_BLOCKED', `cannot inspect ${file}`, { cause: error });
  }
}

export function assertPrivateDirectory(file, label = 'store directory') {
  const info = lstatOptional(file);
  if (!info) fail('COMPANION_STORE_CORRUPT', `${label} is missing`);
  if (info.isSymbolicLink()) fail('COMPANION_STORE_BLOCKED', `${label} is a symlink`);
  if (!info.isDirectory()) fail('COMPANION_STORE_BLOCKED', `${label} is not a directory`);
  const uid = currentUid();
  if ((info.mode & 0o777) !== DIRECTORY_MODE || (uid !== null && info.uid !== uid)) {
    fail('COMPANION_STORE_BLOCKED', `${label} ownership or mode differs`);
  }
  return info;
}

export function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | O_DIRECTORY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const info = fs.fstatSync(descriptor);
    if (!info.isDirectory()) fail('COMPANION_STORE_BLOCKED', 'durability target is not a directory');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_CORRUPT', 'directory durability sync failed', { cause: error });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readRecordIdentity(file, before, { maxBytes, code, accessCode, links }) {
  const uid = currentUid();
  if (
    before.isSymbolicLink() || !before.isFile() || !links.has(before.nlink)
    || (before.mode & 0o777) !== RECORD_MODE || (uid !== null && before.uid !== uid)
  ) fail(accessCode, 'private record ownership, mode, or type differs');
  if (before.size <= 0 || before.size > maxBytes) fail(code, 'private record size is invalid');
  let descriptor;
  let parsing = false;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(descriptor);
    if (
      !opened.isFile() || !links.has(opened.nlink) || opened.dev !== before.dev
      || opened.ino !== before.ino || opened.size !== before.size || opened.nlink !== before.nlink
    ) fail(accessCode, 'private record changed during open');
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== opened.size) fail(accessCode, 'private record changed during read');
    const after = fs.lstatSync(file);
    if (
      !after.isFile() || after.isSymbolicLink() || !links.has(after.nlink)
      || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || after.nlink !== opened.nlink
    ) fail(accessCode, 'private record path changed during read');
    parsing = true;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail(parsing ? code : accessCode, 'private record is unreadable', { cause: error });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readPrivateRecord(file, { maxBytes = MAX_RECORD_BYTES, code = 'COMPANION_STORE_CORRUPT', accessCode = code } = {}) {
  const before = lstatOptional(file);
  if (!before) return null;
  return readRecordIdentity(file, before, { maxBytes, code, accessCode, links: new Set([1]) });
}

function serializedRecord(value) {
  return `${JSON.stringify(value)}\n`;
}

function writePendingRecord(pending, value) {
  assertPrivateDirectory(pending, 'record pending directory');
  const temp = path.join(pending, `.record-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, RECORD_MODE);
    fs.writeFileSync(descriptor, serializedRecord(value));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    return temp;
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temp); } catch {}
    fail('COMPANION_STORE_CORRUPT', 'private record staging failed', { cause: error });
  }
}

export function writePrivateRecordAtomic(file, value, options = {}) {
  const parent = path.dirname(file);
  assertPrivateDirectory(parent, 'record parent');
  const storePending = path.basename(parent) === 'leases'
    ? path.join(path.dirname(parent), '.pending')
    : path.join(parent, '.pending');
  const pending = options.pendingDirectory ?? (lstatOptional(storePending) ? storePending : parent);
  const temp = writePendingRecord(pending, value);
  let committed = false;
  try {
    fs.renameSync(temp, file);
    committed = true;
    options.afterRename?.();
    fsyncDirectory(parent);
    if (pending !== parent) fsyncDirectory(pending);
    return Object.freeze({ committed: true, recovery_pending: false });
  } catch (error) {
    if (!committed) {
      try { fs.unlinkSync(temp); } catch {}
    }
    if (committed && options.returnCommittedFailure === true) {
      return Object.freeze({ committed: true, recovery_pending: true });
    }
    fail('COMPANION_STORE_CORRUPT', 'private record publication failed', { cause: error });
  }
}

export { isExclusivePublicationTemp };

function publicationTemps(pending, purpose, accessCode) {
  if (!isExclusivePublicationPurpose(purpose)) fail('COMPANION_STORE_CORRUPT', 'private publication purpose differs');
  assertPrivateDirectory(pending, 'record pending directory');
  const names = fs.readdirSync(pending).filter((name) => isExclusivePublicationTemp(name, purpose)).sort();
  if (names.length > MAX_PUBLICATION_TEMPS) fail('COMPANION_STORE_CORRUPT', 'private publication residue exceeds its limit');
  const uid = currentUid();
  return names.flatMap((name) => {
    const file = path.join(pending, name);
    const info = lstatOptional(file);
    if (!info) return [];
    if (
      info.isSymbolicLink() || !info.isFile() || ![1, 2].includes(info.nlink)
      || (info.mode & 0o777) !== RECORD_MODE || (uid !== null && info.uid !== uid)
      || info.size > MAX_RECORD_BYTES
    ) fail(accessCode, 'private publication residue differs');
    return [Object.freeze({ file, info })];
  });
}

export function inspectExclusiveRecordPublication(file, options) {
  const {
    pendingDirectory, purpose, validate = (value) => value,
    code = 'COMPANION_STORE_CORRUPT', accessCode = code,
  } = options;
  const temps = publicationTemps(pendingDirectory, purpose, accessCode);
  const before = lstatOptional(file);
  if (!before) {
    if (temps.some(({ info }) => info.nlink !== 1)) fail(accessCode, 'orphan publication residue has extra links');
    return Object.freeze({ value: null, recovery_pending: temps.length > 0, pair: null, orphans: temps });
  }
  const value = validate(readRecordIdentity(file, before, {
    maxBytes: MAX_RECORD_BYTES, code, accessCode, links: new Set([1, 2]),
  }));
  if (before.nlink === 1) {
    if (temps.some(({ info }) => info.dev === before.dev && info.ino === before.ino)) {
      fail(accessCode, 'single-link publication still has a pending alias');
    }
    return Object.freeze({ value, recovery_pending: temps.length > 0, pair: null, orphans: temps });
  }
  if (before.nlink !== 2) fail(accessCode, 'private publication link count differs');
  const pairs = temps.filter(({ info }) => info.dev === before.dev && info.ino === before.ino && info.nlink === 2);
  if (pairs.length !== 1) fail(accessCode, 'private publication pair differs');
  return Object.freeze({
    value, recovery_pending: true, pair: pairs[0],
    orphans: temps.filter(({ file: temp }) => temp !== pairs[0].file),
  });
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.uid === right.uid && left.nlink === right.nlink
    && (left.mode & 0o777) === (right.mode & 0o777) && left.isFile() === right.isFile();
}

function removePublicationTemp(entry) {
  const after = lstatOptional(entry.file);
  if (!after) return;
  if (!sameFile(entry.info, after) || after.nlink !== 1 || after.size > MAX_RECORD_BYTES) {
    fail('COMPANION_STORE_BLOCKED', 'publication residue changed before cleanup');
  }
  try {
    fs.unlinkSync(entry.file);
  } catch (error) {
    if (error?.code !== 'ENOENT') fail('COMPANION_STORE_BLOCKED', 'publication residue cleanup failed', { cause: error });
  }
}

export function recoverExclusiveRecordPublication(file, options) {
  let recoveryError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      let state = inspectExclusiveRecordPublication(file, options);
      if (!state.value) return state;
      if (state.pair) {
        const finalBefore = fs.lstatSync(file);
        const tempBefore = fs.lstatSync(state.pair.file);
        if (
          finalBefore.dev !== tempBefore.dev || finalBefore.ino !== tempBefore.ino
          || finalBefore.nlink !== 2 || !sameFile(state.pair.info, tempBefore)
          || state.pair.info.size !== tempBefore.size
        ) fail(options.accessCode ?? options.code ?? 'COMPANION_STORE_CORRUPT', 'publication pair changed before recovery');
        fs.unlinkSync(state.pair.file);
        fsyncDirectory(options.pendingDirectory);
        fsyncDirectory(path.dirname(file));
        state = inspectExclusiveRecordPublication(file, options);
      }
      for (const orphan of state.orphans) removePublicationTemp(orphan);
      if (state.orphans.length > 0) fsyncDirectory(options.pendingDirectory);
      return inspectExclusiveRecordPublication(file, options);
    } catch (error) {
      recoveryError = error;
    }
  }
  if (recoveryError?.code?.startsWith?.('COMPANION_')) throw recoveryError;
  fail(options.accessCode ?? options.code ?? 'COMPANION_STORE_CORRUPT', 'publication recovery did not stabilize', { cause: recoveryError });
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (count <= 0) fail('COMPANION_STORE_CORRUPT', 'private publication write made no progress');
    offset += count;
  }
}

function observeAcceptedRecord(file, inspectOptions) {
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + PUBLICATION_OBSERVE_MS;
  while (Date.now() < deadline) {
    const observed = recoverExclusiveRecordPublication(file, inspectOptions);
    if (observed.value) return observed.value;
    Atomics.wait(waitArray, 0, 0, 10);
  }
  fail('COMPANION_STORE_BUSY', 'private publication residue capacity is exhausted');
}

export function publishExclusivePrivateRecord(file, value, options) {
  const { pendingDirectory, purpose, validate = (candidate) => candidate } = options;
  const code = options.code ?? 'COMPANION_STORE_BLOCKED';
  const inspectOptions = { pendingDirectory, purpose, validate, code, accessCode: options.accessCode ?? code };
  const existing = recoverExclusiveRecordPublication(file, inspectOptions);
  if (existing.value) {
    if (options.acceptExisting) return Object.freeze({ value: existing.value, published: false });
    fail(code, 'private record already exists');
  }
  const bytes = Buffer.from(serializedRecord(value));
  let descriptor;
  let temp;
  try {
    options.hooks?.beforeReserve?.();
    const reserved = reserveExclusivePublicationSlot(
      pendingDirectory, purpose,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW,
      RECORD_MODE,
    );
    if (!reserved) {
      if (options.acceptExisting) return Object.freeze({ value: observeAcceptedRecord(file, inspectOptions), published: false });
      fail('COMPANION_STORE_BUSY', 'private publication residue capacity is exhausted');
    }
    ({ file: temp, descriptor } = reserved);
    options.hooks?.beforeWrite?.({ descriptor, bytes, temp });
    writeAll(descriptor, bytes);
    const staged = fs.fstatSync(descriptor);
    if (!staged.isFile() || staged.nlink !== 1 || staged.size !== bytes.length) fail(code, 'private publication staging differs');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(pendingDirectory);
    options.hooks?.beforeLink?.({ temp, file });
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const raced = recoverExclusiveRecordPublication(file, inspectOptions);
        if (raced.value && options.acceptExisting) return Object.freeze({ value: raced.value, published: false });
        fail(code, 'private record publication lost contention');
      }
      if (error?.code !== 'EEXIST') throw error;
      const raced = recoverExclusiveRecordPublication(file, inspectOptions);
      if (options.acceptExisting && raced.value) return Object.freeze({ value: raced.value, published: false });
      fail(code, 'private record publication lost contention');
    }
    fsyncDirectory(path.dirname(file));
    options.hooks?.afterLink?.({ temp, file });
    const finalInfo = fs.lstatSync(file);
    const tempInfo = fs.lstatSync(temp);
    if (finalInfo.dev !== tempInfo.dev || finalInfo.ino !== tempInfo.ino || finalInfo.nlink !== 2 || tempInfo.nlink !== 2) {
      fail(code, 'private publication pair identity differs');
    }
    fs.unlinkSync(temp);
    options.hooks?.afterTempUnlink?.({ temp, file });
    fsyncDirectory(pendingDirectory);
    const published = recoverExclusiveRecordPublication(file, inspectOptions);
    if (published.recovery_pending || JSON.stringify(published.value) !== JSON.stringify(validate(value))) {
      fail(code, 'private record publication readback differs');
    }
    return Object.freeze({ value: published.value, published: true });
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      const observed = recoverExclusiveRecordPublication(file, inspectOptions);
      if (
        !observed.recovery_pending && observed.value
        && (options.acceptExisting || JSON.stringify(observed.value) === JSON.stringify(validate(value)))
      ) {
        return Object.freeze({ value: observed.value, published: true });
      }
    } catch {}
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail(code, 'private record exclusive publication failed', { cause: error });
  }
}
