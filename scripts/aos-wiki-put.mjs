#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 1024;
const LOCK_STALE_AFTER_MS = 30_000;
const NO_FOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class WikiPutError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details = {}) {
  throw new WikiPutError(message, code, details);
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function modeRoot() {
  return path.join(stateRoot(), runtimeMode());
}

function wikiRoot() {
  return path.join(modeRoot(), 'wiki');
}

function aosPath() {
  return process.env.AOS_PATH || path.join(process.cwd(), 'aos');
}

function printHelp() {
  process.stdout.write([
    'Usage: aos wiki put <path> --stdin --if-match <sha256|none> [--json]',
    '',
    'Conditionally create or update one canonical Markdown page from stdin.',
    'Use --if-match none to create and the current SHA-256 to update.',
    '',
  ].join('\n'));
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };

  let relativePath = null;
  let fromStdin = false;
  let ifMatch = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--stdin') {
      if (fromStdin) fail('Duplicate argument: --stdin', 'DUPLICATE_ARG');
      fromStdin = true;
      continue;
    }
    if (arg === '--json') {
      if (json) fail('Duplicate argument: --json', 'DUPLICATE_ARG');
      json = true;
      continue;
    }
    if (arg === '--if-match') {
      if (ifMatch !== null) fail('Duplicate argument: --if-match', 'DUPLICATE_ARG');
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        fail('wiki put requires a value for --if-match', 'MISSING_ARG');
      }
      ifMatch = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    if (relativePath !== null) fail(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
    relativePath = arg;
  }

  if (!relativePath) {
    fail('wiki put requires <path>. Usage: aos wiki put <path> --stdin --if-match <sha256|none>', 'MISSING_ARG');
  }
  if (!fromStdin) fail('wiki put requires --stdin', 'MISSING_ARG');
  if (ifMatch === null) fail('wiki put requires --if-match <sha256|none>', 'MISSING_ARG');
  if (ifMatch !== 'none' && !SHA256_PATTERN.test(ifMatch)) {
    fail('--if-match must be none or a lowercase SHA-256 digest', 'WIKI_INVALID_MATCH');
  }
  return { help: false, ifMatch, json, relativePath: canonicalWikiPath(relativePath) };
}

function canonicalWikiPath(value) {
  if (
    value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > MAX_PATH_BYTES
    || value.normalize('NFC') !== value
    || value.startsWith('/')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
    || path.posix.normalize(value) !== value
  ) {
    fail('Wiki path must be a canonical relative Markdown path', 'WIKI_INVALID_PATH');
  }
  const segments = value.split('/');
  if (
    segments.length === 0
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    || !segments.at(-1)?.endsWith('.md')
    || segments.at(-1) === '.md'
  ) {
    fail('Wiki path must be a canonical relative Markdown path', 'WIKI_INVALID_PATH');
  }
  return value;
}

async function readBoundedStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_INPUT_BYTES) {
      fail(`Wiki input exceeds the ${MAX_INPUT_BYTES}-byte limit`, 'WIKI_INPUT_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  const content = Buffer.concat(chunks, bytes);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    fail('Wiki input must be valid UTF-8', 'WIKI_INVALID_CONTENT');
  }
  return content;
}

function ensureDirectory(directory, label) {
  try {
    fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  } catch (error) {
    throw normalizeFilesystemError(error);
  }
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    throw normalizeFilesystemError(error);
  }
  if (stat.isSymbolicLink()) fail(`${label} must not be a symlink`, 'WIKI_SYMLINK');
  if (!stat.isDirectory()) fail(`${label} must be a directory`, 'WIKI_INVALID_PATH');
}

function resolveWikiTarget(root, relativePath, createParents) {
  const targetPath = path.join(root, ...relativePath.split('/'));
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw normalizeFilesystemError(error);
    if (!createParents) return { parentExists: false, targetPath };
    ensureDirectory(root, 'Wiki root');
    rootStat = fs.lstatSync(root);
  }
  if (rootStat.isSymbolicLink()) fail('Wiki root must not be a symlink', 'WIKI_SYMLINK');
  if (!rootStat.isDirectory()) fail('Wiki root must be a directory', 'WIKI_INVALID_PATH');

  const parentSegments = relativePath.split('/').slice(0, -1);
  let current = root;
  for (const segment of parentSegments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw normalizeFilesystemError(error);
      if (!createParents) return { parentExists: false, targetPath };
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw normalizeFilesystemError(mkdirError);
      }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink()) fail('Wiki path must not traverse symlinks', 'WIKI_SYMLINK');
    if (!stat.isDirectory()) fail('Wiki parent must be a directory', 'WIKI_INVALID_PATH');
  }
  return { parentExists: true, targetPath };
}

function inspectTarget(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw normalizeFilesystemError(error);
  }
  if (stat.isSymbolicLink()) fail('Wiki target must not be a symlink', 'WIKI_SYMLINK');
  if (!stat.isFile()) fail('Wiki target must be a regular file', 'WIKI_INVALID_PATH');

  let descriptor;
  try {
    descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | NO_FOLLOW);
    const openStat = fs.fstatSync(descriptor);
    if (!openStat.isFile()) fail('Wiki target must be a regular file', 'WIKI_INVALID_PATH');
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const read = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (read === 0) break;
      bytes += read;
      hash.update(chunk.subarray(0, read));
    }
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) {
    if (error instanceof WikiPutError) throw error;
    if (error?.code === 'ELOOP') fail('Wiki target must not be a symlink', 'WIKI_SYMLINK');
    if (error?.code === 'ENOENT') return null;
    throw normalizeFilesystemError(error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function conflict(relativePath, ifMatch, current) {
  fail('Wiki page does not match the requested version', 'WIKI_CONFLICT', {
    actual_sha256: current?.sha256 ?? null,
    exists: current !== null,
    expected_sha256: ifMatch,
    path: relativePath,
  });
}

function verifyPrecondition(relativePath, ifMatch, current) {
  if (ifMatch === 'none') {
    if (current !== null) conflict(relativePath, ifMatch, current);
    return 'created';
  }
  if (current === null || current.sha256 !== ifMatch) conflict(relativePath, ifMatch, current);
  return 'updated';
}

function writeTemporaryFile(parent, basename, content) {
  const temporaryPath = path.join(parent, `.${basename}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`);
  let descriptor;
  let completed = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | NO_FOLLOW,
      0o600,
    );
    let offset = 0;
    while (offset < content.length) {
      const written = fs.writeSync(descriptor, content, offset, content.length - offset);
      if (written <= 0) fail('Wiki write made no forward progress', 'WIKI_PUT_FAILED');
      offset += written;
    }
    fs.fchmodSync(descriptor, 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    completed = true;
    return temporaryPath;
  } catch (error) {
    throw normalizeFilesystemError(error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (!completed) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the primary write error; owner-only temp cleanup is best effort.
      }
    }
  }
}

function commitWrite({ content, ifMatch, operation, relativePath, targetPath }) {
  const parent = path.dirname(targetPath);
  const temporaryPath = writeTemporaryFile(parent, path.basename(targetPath), content);
  try {
    const current = inspectTarget(targetPath);
    verifyPrecondition(relativePath, ifMatch, current);
    if (operation === 'created') {
      try {
        fs.linkSync(temporaryPath, targetPath);
      } catch (error) {
        if (error?.code === 'EEXIST') conflict(relativePath, ifMatch, inspectTarget(targetPath));
        throw normalizeFilesystemError(error);
      }
      fs.unlinkSync(temporaryPath);
    } else {
      fs.renameSync(temporaryPath, targetPath);
    }
    syncDirectory(parent);
  } finally {
    try {
      fs.unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw normalizeFilesystemError(error);
    }
  }
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP'].includes(error?.code)) throw normalizeFilesystemError(error);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function acquireLock() {
  const root = modeRoot();
  ensureDirectory(root, 'AOS mode root');
  const lockPath = path.join(root, '.wiki-put.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw normalizeFilesystemError(error);
      const stat = fs.lstatSync(lockPath);
      if (stat.isSymbolicLink()) fail('Wiki write lock must not be a symlink', 'WIKI_SYMLINK');
      if (!stat.isDirectory()) fail('Wiki write lock is invalid', 'WIKI_INVALID_PATH');
      if (attempt === 0 && removeStaleLock(lockPath, stat)) continue;
      fail('Another wiki put operation is active', 'WIKI_BUSY');
    }
    try {
      fs.writeFileSync(
        path.join(lockPath, 'owner.json'),
        `${JSON.stringify({ pid: process.pid, started_at_ms: Date.now() })}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      return lockRelease(lockPath);
    } catch (error) {
      fs.rmSync(lockPath, { force: true, recursive: true });
      throw normalizeFilesystemError(error);
    }
  }
  fail('Another wiki put operation is active', 'WIKI_BUSY');
}

function removeStaleLock(lockPath, stat) {
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    owner = null;
  }
  if (Number.isInteger(owner?.pid) && owner.pid > 0) {
    if (processIsAlive(owner.pid)) return false;
  } else if (Date.now() - stat.mtimeMs < LOCK_STALE_AFTER_MS) {
    return false;
  }
  fs.rmSync(lockPath, { force: true, recursive: true });
  return true;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function lockRelease(lockPath) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const [signal, handler] of handlers) process.off(signal, handler);
    try {
      const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
      if (owner?.pid === process.pid) fs.rmSync(lockPath, { force: true, recursive: true });
    } catch {
      // A missing or replaced lock is never removed without matching ownership.
    }
  };
  const handlers = new Map();
  for (const [signal, exitCode] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
    const handler = () => {
      release();
      process.exit(exitCode);
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return release;
}

function reindexCommittedWrite(relativePath, operation, sha256) {
  const result = spawnSync(aosPath(), ['wiki', 'reindex', '--json'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    fail('Wiki page was committed but reindexing failed', 'WIKI_REINDEX_FAILED', {
      committed: true,
      operation,
      path: relativePath,
      reindex_exit: result.status,
      sha256,
    });
  }
}

function normalizeFilesystemError(error) {
  if (error instanceof WikiPutError) return error;
  if (error?.code === 'ENOSPC') return new WikiPutError('Wiki write failed because storage is full', 'WIKI_NO_SPACE');
  if (error?.code === 'EACCES' || error?.code === 'EPERM') {
    return new WikiPutError('Wiki write permission was denied', 'WIKI_PERMISSION_DENIED');
  }
  return new WikiPutError('Wiki write failed', 'WIKI_PUT_FAILED', {
    ...(typeof error?.code === 'string' ? { system_code: error.code } : {}),
  });
}

function emitSuccess(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const verb = result.operation === 'created' ? 'Created' : 'Updated';
  process.stdout.write(`${verb} ${result.path} (${result.bytes} bytes, sha256 ${result.sha256})\n`);
}

function emitError(error) {
  const normalized = error instanceof WikiPutError ? error : normalizeFilesystemError(error);
  process.stderr.write(`${JSON.stringify({
    code: normalized.code,
    error: normalized.message,
    ...normalized.details,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const content = await readBoundedStdin();
  const release = acquireLock();
  try {
    const initialTarget = resolveWikiTarget(wikiRoot(), options.relativePath, false);
    const current = initialTarget.parentExists ? inspectTarget(initialTarget.targetPath) : null;
    const operation = verifyPrecondition(options.relativePath, options.ifMatch, current);
    const preparedTarget = resolveWikiTarget(wikiRoot(), options.relativePath, operation === 'created');
    if (!preparedTarget.parentExists) conflict(options.relativePath, options.ifMatch, null);
    const sha256 = createHash('sha256').update(content).digest('hex');
    commitWrite({
      content,
      ifMatch: options.ifMatch,
      operation,
      relativePath: options.relativePath,
      targetPath: preparedTarget.targetPath,
    });
    reindexCommittedWrite(options.relativePath, operation, sha256);
    emitSuccess({
      schema_version: 'aos.wiki.put-result.v1',
      status: 'ok',
      operation,
      path: options.relativePath,
      bytes: content.length,
      previous_sha256: current?.sha256 ?? null,
      sha256,
      reindexed: true,
    }, options.json);
  } finally {
    release();
  }
}

main().catch(emitError);
