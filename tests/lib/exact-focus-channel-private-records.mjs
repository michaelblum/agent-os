import fs from 'node:fs';
import path from 'node:path';
import {
  FIXTURE_RESULT_MAX_BYTES,
  ProofError,
  fail,
  fixtureMetadataFromResultBytes,
} from './exact-focus-channel-native-proof-model.mjs';

export const DAEMON_IDENTITY_MAX_BYTES = 8_192;
export const UNRELATED_CHANNEL_DIGESTS_MAX_BYTES = 65_536;
export const CLOSE_ACK_MAX_BYTES = 128;
export const FIXTURE_CLEANUP_MAX_BYTES = 256;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function readBoundedRegularFile(file, maximumBytes, errorCode,
  unavailableCode = errorCode, afterFstat = null) {
  fail(Number.isSafeInteger(maximumBytes) && maximumBytes > 0, errorCode);
  const noFollow = fs.constants.O_NOFOLLOW;
  const nonBlock = fs.constants.O_NONBLOCK;
  const closeOnExec = Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
  fail(Number.isInteger(noFollow) && noFollow !== 0, errorCode);
  fail(Number.isInteger(nonBlock) && nonBlock !== 0, errorCode);
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow | nonBlock | closeOnExec);
    const metadata = fs.fstatSync(descriptor);
    fail(metadata.isFile() && metadata.size >= 1 && metadata.size <= maximumBytes
      && (metadata.mode & 0o777) === 0o600, errorCode);
    if (afterFstat !== null) { fail(typeof afterFstat === 'function', errorCode); afterFstat(); }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      fail(count > 0, errorCode);
      offset += count;
    }
    const trailingByte = Buffer.alloc(1);
    fail(fs.readSync(descriptor, trailingByte, 0, 1, bytes.length) === 0, errorCode);
    fail(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes), errorCode);
    return bytes;
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError(unavailableCode);
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

function readPrivateProofJSONLine(file, maximumBytes, errorCode,
  unavailableCode = errorCode, afterFstat = null) {
  const bytes = readBoundedRegularFile(file, maximumBytes, errorCode, unavailableCode, afterFstat);
  const text = bytes.toString('utf8');
  fail(text.endsWith('\n') && !text.slice(0, -1).includes('\n') && !text.includes('\r'), errorCode);
  return bytes;
}

function parsePrivateProofJSON(file, maximumBytes, errorCode, unavailableCode, afterFstat) {
  const bytes = readPrivateProofJSONLine(file, maximumBytes, errorCode, unavailableCode, afterFstat);
  try { return JSON.parse(bytes.subarray(0, -1).toString('utf8')); } catch {
    throw new ProofError(errorCode);
  }
}

export function parseFixtureResultFile(file) {
  return fixtureMetadataFromResultBytes(
    readPrivateProofJSONLine(file, FIXTURE_RESULT_MAX_BYTES, 'FIXTURE_METADATA_INVALID'),
  );
}

function validBinaryIdentity(value) {
  return exactKeys(value, ['dev', 'ino', 'mode', 'mtime_ms', 'sha256', 'size'])
    && ['dev', 'ino', 'mode', 'size'].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)
    && Number.isFinite(value.mtime_ms) && value.mtime_ms >= 0
    && /^[a-f0-9]{64}$/u.test(value.sha256);
}

function validDaemonIdentity(value) {
  return exactKeys(value, ['binary_identity', 'binary_path', 'build_source_fingerprint',
    'daemon_pid', 'repo_revision', 'service_pid'])
    && typeof value.binary_path === 'string'
    && path.isAbsolute(value.binary_path) && !value.binary_path.includes('\0')
    && validBinaryIdentity(value.binary_identity)
    && /^[a-f0-9]{64}$/u.test(value.build_source_fingerprint)
    && /^[a-f0-9]{40}$/u.test(value.repo_revision)
    && Number.isSafeInteger(value.daemon_pid) && value.daemon_pid > 1
    && Number.isSafeInteger(value.service_pid) && value.service_pid > 1;
}

export function parseDaemonIdentityFile(file, afterFstat = null) {
  const value = parsePrivateProofJSON(file, DAEMON_IDENTITY_MAX_BYTES, 'DAEMON_IDENTITY_INVALID',
    'DAEMON_IDENTITY_UNAVAILABLE', afterFstat);
  fail(validDaemonIdentity(value), 'DAEMON_IDENTITY_INVALID');
  return value;
}

export function parseUnrelatedChannelDigestsFile(file, afterFstat = null) {
  const value = parsePrivateProofJSON(file, UNRELATED_CHANNEL_DIGESTS_MAX_BYTES,
    'UNRELATED_CHANNEL_DIGESTS_INVALID', 'UNRELATED_CHANNEL_DIGESTS_UNAVAILABLE', afterFstat);
  fail(Array.isArray(value) && value.every((digest) => /^[a-f0-9]{64}$/u.test(digest)),
    'UNRELATED_CHANNEL_DIGESTS_INVALID');
  return value;
}

export function parseCloseAckFile(file, afterFstat = null) {
  const value = parsePrivateProofJSON(file, CLOSE_ACK_MAX_BYTES,
    'TARGET_CLOSE_INVALID', 'TARGET_CLOSE_INVALID', afterFstat);
  fail(exactKeys(value, ['status', 'target_window_removed']), 'TARGET_CLOSE_INVALID');
  fail(typeof value.target_window_removed === 'boolean', 'TARGET_CLOSE_INVALID');
  fail(value.status === 'ok' || value.status === 'failed', 'TARGET_CLOSE_INVALID');
  fail((value.status === 'ok') === value.target_window_removed, 'TARGET_CLOSE_INVALID');
  return value;
}

export function parseFixtureCleanupFile(file, afterFstat = null) {
  const value = parsePrivateProofJSON(file, FIXTURE_CLEANUP_MAX_BYTES,
    'FIXTURE_CLEANUP_INVALID', 'FIXTURE_CLEANUP_INVALID', afterFstat);
  const keys = ['fixture_windows_removed', 'sibling_window_removed', 'target_window_removed'];
  fail(exactKeys(value, keys), 'FIXTURE_CLEANUP_INVALID');
  fail(keys.every((key) => typeof value[key] === 'boolean'), 'FIXTURE_CLEANUP_INVALID');
  fail(value.fixture_windows_removed === (value.target_window_removed
    && value.sibling_window_removed), 'FIXTURE_CLEANUP_INVALID');
  return value;
}

function exactHeldDestination(file, descriptor, byteLength, mode) {
  const held = fs.fstatSync(descriptor, { bigint: true });
  const named = fs.lstatSync(file, { bigint: true });
  return held.isFile() && named.isFile()
    && held.dev === named.dev && held.ino === named.ino
    && held.nlink === 1n && named.nlink === 1n
    && held.size === BigInt(byteLength) && named.size === BigInt(byteLength)
    && (held.mode & 0o777n) === BigInt(mode) && (named.mode & 0o777n) === BigInt(mode);
}

function fsyncParentDirectory(file) {
  const closeOnExec = Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
  const directory = Number.isInteger(fs.constants.O_DIRECTORY) ? fs.constants.O_DIRECTORY : 0;
  let descriptor = null;
  try {
    descriptor = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | directory | closeOnExec);
    try { fs.fsyncSync(descriptor); } catch (error) {
      if (!['EINVAL', 'ENOTSUP'].includes(error?.code)) throw error;
    }
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

function writePrivateProofJSON(file, value, maximumBytes, errorCode, beforeReadiness = null) {
  fail(Number.isSafeInteger(maximumBytes) && maximumBytes > 0, errorCode);
  fail(beforeReadiness === null || typeof beforeReadiness === 'function', errorCode);
  let text;
  try { text = `${JSON.stringify(value)}\n`; } catch { throw new ProofError(errorCode); }
  const bytes = Buffer.from(text, 'utf8');
  fail(bytes.length >= 1 && bytes.length <= maximumBytes, errorCode);
  let descriptor = null;
  try {
    const noFollow = fs.constants.O_NOFOLLOW;
    const closeOnExec = Number.isInteger(fs.constants.O_CLOEXEC) ? fs.constants.O_CLOEXEC : 0;
    fail(Number.isInteger(noFollow) && noFollow !== 0, errorCode);
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      | noFollow | closeOnExec;
    descriptor = fs.openSync(file, flags, 0o000);
    fs.fchmodSync(descriptor, 0o000);
    fail(exactHeldDestination(file, descriptor, 0, 0o000), errorCode);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      fail(count > 0, errorCode);
      offset += count;
    }
    fail(exactHeldDestination(file, descriptor, bytes.length, 0o000), errorCode);
    fs.fsyncSync(descriptor);
    beforeReadiness?.();
    fail(exactHeldDestination(file, descriptor, bytes.length, 0o000), errorCode);
    fsyncParentDirectory(file);
    fail(exactHeldDestination(file, descriptor, bytes.length, 0o000), errorCode);
    fs.fchmodSync(descriptor, 0o600);
  } catch {
    throw new ProofError(errorCode);
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
  }
}

export function writeDaemonIdentity(file, identity, beforeReadiness = null) {
  fail(validDaemonIdentity(identity), 'DAEMON_IDENTITY_WRITE_FAILED');
  writePrivateProofJSON(file, identity, DAEMON_IDENTITY_MAX_BYTES,
    'DAEMON_IDENTITY_WRITE_FAILED', beforeReadiness);
}

export function writeUnrelatedChannelDigests(file, value, beforeReadiness = null) {
  fail(Array.isArray(value) && value.every((digest) => /^[a-f0-9]{64}$/u.test(digest)),
    'UNRELATED_CHANNEL_DIGESTS_WRITE_FAILED');
  writePrivateProofJSON(file, value, UNRELATED_CHANNEL_DIGESTS_MAX_BYTES,
    'UNRELATED_CHANNEL_DIGESTS_WRITE_FAILED', beforeReadiness);
}
