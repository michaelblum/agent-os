import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  lstatOptional,
  readPrivateRecord,
  writePrivateRecordAtomic,
} from './store-paths.mjs';
import { removeQuarantined } from './store-retirement.mjs';
import { validateVersionDirectory, versionKey } from './store-package.mjs';
import { sessionFail, validateSessionId, validateSessionRecord } from './session-model.mjs';

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const MAX_LEGACY_BYTES = 64 * 1024;

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function mkdirPrivate(directory) {
  if (!lstatOptional(directory)) fs.mkdirSync(directory, { mode: DIRECTORY_MODE });
  return assertPrivateDirectory(directory, 'managed session directory');
}

function workspaceDirectories(session) {
  const names = [
    '.playwright', 'daemon', 'sockets', 'server-registry', 'global-config',
    'output', 'temp', 'browser-cache', 'home',
  ];
  if (session.persistent) names.push('profile');
  return names.sort();
}

export function sessionRecordPath(store, sessionId) {
  return path.join(store.paths.leases, `${validateSessionId(sessionId)}.json`);
}

export function readSession(store, sessionId) {
  const file = sessionRecordPath(store, sessionId);
  const value = readPrivateRecord(file);
  return value ? validateSessionRecord(value, path.basename(file)) : null;
}

export function publishSession(store, record, options = {}) {
  const value = validateSessionRecord(record);
  const publication = writePrivateRecordAtomic(sessionRecordPath(store, value.session_id), value, {
    pendingDirectory: store.paths.pending,
    afterRename: options.afterRename,
    returnCommittedFailure: true,
  });
  const observed = readSession(store, value.session_id);
  if (JSON.stringify(observed) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_CORRUPT', 'managed session publication readback differs');
  }
  let recoveryPending = publication.recovery_pending;
  if (recoveryPending) {
    try {
      options.beforeReconcile?.();
      fsyncDirectory(store.paths.leases);
      fsyncDirectory(store.paths.pending);
      recoveryPending = false;
    } catch {}
  }
  return Object.freeze({ record: observed, recovery_pending: recoveryPending });
}

export function writeSession(store, record, options = {}) {
  return publishSession(store, record, options).record;
}

export function listSessions(store) {
  const filenames = fs.readdirSync(store.paths.leases).sort();
  if (filenames.length > 128) fail('COMPANION_STORE_CORRUPT', 'managed session limit is exceeded');
  return filenames.map((filename) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/u.test(filename)) {
      fail('COMPANION_STORE_CORRUPT', 'managed session filename differs');
    }
    return validateSessionRecord(readPrivateRecord(path.join(store.paths.leases, filename)), filename);
  });
}

function scanSessions(store) {
  const directory = assertPrivateDirectory(store.paths.leases, 'leases');
  const filenames = fs.readdirSync(store.paths.leases).sort();
  if (filenames.length > 128) sessionFail('COMPANION_STORE_CORRUPT', 'managed session limit is exceeded');
  const sessions = filenames.map((filename) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.json$/u.test(filename)) {
      sessionFail('COMPANION_STORE_CORRUPT', 'managed session filename differs');
    }
    const value = readPrivateRecord(path.join(store.paths.leases, filename));
    if (value === null) sessionFail('COMPANION_STORE_BUSY', 'managed session list changed during inspection');
    return validateSessionRecord(value, filename);
  });
  return Object.freeze({
    directory: Object.freeze({ dev: directory.dev, ino: directory.ino }),
    filenames,
    sessions,
    canonical: JSON.stringify(sessions),
  });
}

export function listSessionsReadOnly(store, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const before = scanSessions(store);
      options.afterScan?.(attempt, before);
      const after = scanSessions(store);
      if (before.directory.dev === after.directory.dev && before.directory.ino === after.directory.ino
        && JSON.stringify(before.filenames) === JSON.stringify(after.filenames)
        && before.canonical === after.canonical) return after.sessions;
    } catch (error) {
      if (error?.code !== 'COMPANION_STORE_BUSY' && error?.code !== 'ENOENT') throw error;
    }
  }
  sessionFail('COMPANION_STORE_BUSY', 'managed session list changed during inspection');
}

export function createSessionWorkspace(store, record, options = {}) {
  const session = validateSessionRecord(record);
  const root = path.join(store.paths.workspaces, session.workspace);
  if (lstatOptional(root)) fail('COMPANION_STORE_CORRUPT', 'managed session workspace already exists');
  mkdirPrivate(root);
  for (const name of workspaceDirectories(session)) {
    mkdirPrivate(path.join(root, name));
    options.afterDirectory?.(name);
  }
  fsyncDirectory(root);
  fsyncDirectory(store.paths.workspaces);
  return root;
}

export function sessionWorkspace(store, record) {
  const session = validateSessionRecord(record);
  const root = path.join(store.paths.workspaces, session.workspace);
  assertPrivateDirectory(root, 'managed session workspace');
  const expected = workspaceDirectories(session);
  if (JSON.stringify(fs.readdirSync(root).sort()) !== JSON.stringify(expected)) {
    fail('COMPANION_STORE_CORRUPT', 'managed session workspace layout differs');
  }
  for (const name of expected) assertPrivateDirectory(path.join(root, name), 'managed session workspace directory');
  return root;
}

function preparedWorkspace(store, record, root) {
  const session = validateSessionRecord(record);
  const info = assertPrivateDirectory(root, 'prepared managed session workspace');
  const expected = new Set(workspaceDirectories(session));
  const entries = fs.readdirSync(root).sort();
  if (entries.some((name) => !expected.has(name))) {
    fail('COMPANION_STORE_CORRUPT', 'prepared session workspace layout differs');
  }
  for (const name of entries) {
    const directory = path.join(root, name);
    assertPrivateDirectory(directory, 'prepared session workspace directory');
    if (fs.readdirSync(directory).length !== 0) {
      fail('COMPANION_STORE_CORRUPT', 'prepared session workspace contains worker state');
    }
  }
  return info;
}

export function cleanupPreparedSessionWorkspace(store, record, options = {}) {
  const session = validateSessionRecord(record);
  const root = path.join(store.paths.workspaces, session.workspace);
  const retired = path.join(store.paths.sessionRetired, `prepared-session-${session.session_id}-${session.generation}`);
  try {
    if (lstatOptional(root) && lstatOptional(retired)) {
      fail('COMPANION_STORE_CORRUPT', 'prepared session workspace has two live names');
    }
    if (lstatOptional(root)) {
      const before = preparedWorkspace(store, session, root);
      fs.renameSync(root, retired);
      const after = preparedWorkspace(store, session, retired);
      if (before.dev !== after.dev || before.ino !== after.ino) {
        fail('COMPANION_STORE_CORRUPT', 'prepared session retirement identity differs');
      }
      fsyncDirectory(store.paths.workspaces);
      fsyncDirectory(store.paths.sessionRetired);
      options.afterWorkspaceRetire?.();
    }
    if (lstatOptional(retired)) {
      preparedWorkspace(store, session, retired);
      removeQuarantined(retired, { beforeRemove: options.beforeRemove });
      fsyncDirectory(store.paths.sessionRetired);
      options.afterWorkspaceRemove?.();
    }
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    return Object.freeze({ recovery_pending: true });
  }
  return Object.freeze({ recovery_pending: Boolean(lstatOptional(root) || lstatOptional(retired)) });
}

export function managedRuntimeBinding(store, record) {
  const session = validateSessionRecord(record);
  const versionRoot = path.join(store.paths.versions, session.version_key);
  assertPrivateDirectory(versionRoot, 'managed session version');
  const validated = validateVersionDirectory(versionRoot);
  if (validated.version !== session.version
    || validated.descriptor_sha256 !== session.descriptor_sha256
    || validated.closure_sha256 !== session.closure_sha256
    || validated.descriptor.entrypoint !== session.entrypoint
    || versionKey(validated.version, validated.descriptor_sha256) !== session.version_key) {
    fail('COMPANION_STORE_CORRUPT', 'managed runtime binding differs');
  }
  const entrypoint = path.join(versionRoot, ...session.entrypoint.split('/'));
  const relative = path.relative(versionRoot, entrypoint);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail('COMPANION_STORE_BLOCKED', 'managed entrypoint escapes version');
  const info = lstatOptional(entrypoint);
  if (!info || info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (currentUid() !== null && info.uid !== currentUid())) {
    fail('COMPANION_STORE_BLOCKED', 'managed entrypoint identity differs');
  }
  return Object.freeze({
    entrypoint,
    max_captured_output_bytes: validated.descriptor.limits.max_captured_output_bytes,
  });
}

export function managedEntrypoint(store, record) {
  return managedRuntimeBinding(store, record).entrypoint;
}

export function cleanupClosedSession(store, record, options = {}) {
  const session = validateSessionRecord(record);
  if (session.state !== 'closed') fail('COMPANION_STORE_CORRUPT', 'session is not cleanup-confirmed');
  const workspace = path.join(store.paths.workspaces, session.workspace);
  const retired = path.join(store.paths.sessionRetired, `retired-session-${session.session_id}-${session.generation}`);
  try {
    if (lstatOptional(workspace) && !lstatOptional(retired)) {
      const before = assertPrivateDirectory(workspace, 'managed session workspace');
      fs.renameSync(workspace, retired);
      const after = assertPrivateDirectory(retired, 'retired managed session');
      if (before.dev !== after.dev || before.ino !== after.ino) fail('COMPANION_STORE_CORRUPT', 'retired session identity differs');
      fsyncDirectory(store.paths.workspaces);
      fsyncDirectory(store.paths.sessionRetired);
    }
    if (lstatOptional(retired)) removeQuarantined(retired, { beforeRemove: options.beforeRemove });
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    if (lstatOptional(workspace)) sessionWorkspace(store, session);
    if (lstatOptional(retired)) assertPrivateDirectory(retired, 'retired managed session');
    return Object.freeze({ recovery_pending: true });
  }
  if (lstatOptional(workspace) || lstatOptional(retired)) return Object.freeze({ recovery_pending: true });
  const file = sessionRecordPath(store, session.session_id);
  const current = readSession(store, session.session_id);
  if (!current || current.generation !== session.generation || current.state !== 'closed') {
    fail('COMPANION_STORE_CORRUPT', 'cleanup-confirmed session record changed');
  }
  try {
    options.beforeRecordUnlink?.(file);
    fs.unlinkSync(file);
    options.afterRecordUnlink?.(file);
    fsyncDirectory(store.paths.leases);
    return Object.freeze({ recovery_pending: false });
  } catch {
    if (lstatOptional(file)) {
      const observed = readSession(store, session.session_id);
      if (!observed || observed.generation !== session.generation || observed.state !== 'closed') {
        fail('COMPANION_STORE_CORRUPT', 'cleanup-confirmed session record changed');
      }
      return Object.freeze({ recovery_pending: true });
    }
    try { fsyncDirectory(store.paths.leases); return Object.freeze({ recovery_pending: false }); } catch {}
    return Object.freeze({ recovery_pending: true });
  }
}

function inspectLegacyFile(file) {
  const before = lstatOptional(file);
  if (!before) return null;
  const uid = currentUid();
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (uid !== null && before.uid !== uid) || (before.mode & 0o022) !== 0 || before.size > MAX_LEGACY_BYTES) {
    throw Object.assign(new Error('legacy browser session state is not safely owned'), { code: 'BROWSER_SESSION_MIGRATION_REQUIRED' });
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || opened.nlink !== 1) throw new Error('legacy identity changed');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.lstatSync(file);
    if (bytes.length !== opened.size || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.nlink !== 1) throw new Error('legacy identity changed');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = raw.trim() === '' ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 0) throw new Error('legacy registry is nonempty');
    return Object.freeze({ info: after });
  } catch (error) {
    if (error?.code === 'BROWSER_SESSION_MIGRATION_REQUIRED') throw error;
    throw Object.assign(new Error('legacy browser session state requires migration'), { code: 'BROWSER_SESSION_MIGRATION_REQUIRED' });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function inspectLegacySessions(browserDirectory) {
  return inspectLegacyFile(path.join(browserDirectory, 'sessions.json')) !== null;
}

export function retireEmptyLegacySessions(store) {
  const file = path.join(store.paths.browser, 'sessions.json');
  const inspected = inspectLegacyFile(file);
  if (!inspected) return false;
  const current = fs.lstatSync(file);
  if (current.dev !== inspected.info.dev || current.ino !== inspected.info.ino || current.nlink !== 1) {
    throw Object.assign(new Error('legacy browser session state changed'), { code: 'BROWSER_SESSION_MIGRATION_REQUIRED' });
  }
  fs.unlinkSync(file);
  fsyncDirectory(store.paths.browser);
  return true;
}

export { RECORD_MODE };
