import fs from 'node:fs';
import path from 'node:path';

const PROFILE_NAME = /^(?:Default|Profile [1-9][0-9]{0,2})$/u;
const EXTENSION_NAME = /^[a-p]{32}$/u;
const EXTENSION_VERSION = /^[0-9]+(?:\.[0-9]+){1,5}(?:_[0-9]+)?$/u;
const MAX_ROOT_ENTRIES = 128;
const MAX_PROFILES = 32;
const MAX_EXTENSION_ENTRIES = 256;
const MAX_EXTENSION_VERSIONS = 16;
const MAX_VERSION_TREE_ENTRIES = 4096;
const MAX_MANIFEST_BYTES = 256 * 1024;
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

class ScanChanged extends Error {}

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function identity(info) {
  return Object.freeze({
    dev: String(info.dev), ino: String(info.ino), size: info.size,
    mode: info.mode & 0o777, uid: info.uid, nlink: info.nlink,
    mtime_ms: String(info.mtimeMs), ctime_ms: String(info.ctimeMs),
    kind: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
  });
}

function sameIdentity(left, right) {
  return JSON.stringify(identity(left)) === JSON.stringify(identity(right));
}

function optionalInfo(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function ordinary(file, kind) {
  const info = fs.lstatSync(file);
  const uid = currentUid();
  const expected = kind === 'directory' ? info.isDirectory() : info.isFile();
  if (!expected || info.isSymbolicLink() || (info.mode & 0o022) !== 0
    || (kind === 'file' && info.nlink !== 1) || (uid !== null && info.uid !== uid)) {
    throw new Error('unsafe extension profile entry');
  }
  if (kind === 'directory' && fs.realpathSync(file) !== path.resolve(file)) {
    throw new Error('linked extension profile ancestry');
  }
  return info;
}

function boundedNames(directory, maximum) {
  const names = fs.readdirSync(directory).sort();
  if (names.length > maximum) throw new Error('extension profile entry limit exceeded');
  return names;
}

function readManifest(file) {
  const before = ordinary(file, 'file');
  if (before.size > MAX_MANIFEST_BYTES) throw new Error('extension manifest exceeds limit');
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(descriptor);
    if (!sameIdentity(before, opened)) throw new ScanChanged('manifest changed');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.lstatSync(file);
    if (bytes.length !== opened.size || !sameIdentity(opened, after)) throw new ScanChanged('manifest changed');
    return Object.freeze({
      identity: identity(after),
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    });
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function scanVersionTree(root) {
  const rootBefore = ordinary(root, 'directory');
  const entries = [];
  function visit(directory, relative = '') {
    for (const name of boundedNames(directory, MAX_VERSION_TREE_ENTRIES)) {
      const item = path.join(directory, name);
      const info = fs.lstatSync(item);
      const kind = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other';
      const checked = ordinary(item, kind);
      entries.push(Object.freeze({ name: path.posix.join(relative, name), ...identity(checked) }));
      if (entries.length > MAX_VERSION_TREE_ENTRIES) throw new Error('extension version tree exceeds limit');
      if (kind === 'directory') visit(item, path.posix.join(relative, name));
    }
  }
  visit(root);
  const rootAfter = ordinary(root, 'directory');
  if (!sameIdentity(rootBefore, rootAfter)) throw new ScanChanged('extension version changed');
  return Object.freeze({ identity: identity(rootAfter), entries });
}

function scanPinnedExtension(extensionRoot) {
  const before = ordinary(extensionRoot, 'directory');
  const versions = boundedNames(extensionRoot, MAX_EXTENSION_VERSIONS);
  if (versions.length === 0) return Object.freeze({ identity: identity(before), versions: [], installed: false });
  if (versions.some((name) => !EXTENSION_VERSION.test(name))) throw new Error('extension version layout differs');
  const results = versions.map((versionName) => {
    const versionRoot = path.join(extensionRoot, versionName);
    const tree = scanVersionTree(versionRoot);
    const manifest = readManifest(path.join(versionRoot, 'manifest.json'));
    const declared = String(manifest.value?.version ?? '');
    if ((manifest.value?.manifest_version !== 2 && manifest.value?.manifest_version !== 3)
      || declared !== versionName.replace(/_[0-9]+$/u, '')
      || typeof manifest.value?.name !== 'string' || manifest.value.name.length === 0) {
      throw new Error('extension manifest identity differs');
    }
    return Object.freeze({ name: versionName, tree, manifest: manifest.identity, declared });
  });
  const after = ordinary(extensionRoot, 'directory');
  if (!sameIdentity(before, after)) throw new ScanChanged('extension root changed');
  return Object.freeze({ identity: identity(after), versions: results, installed: true });
}

export function scanExtensionTree(userDataDir, extensionId) {
  const rootInfo = optionalInfo(userDataDir);
  if (!rootInfo) return Object.freeze({ exists: false, installed: false });
  const rootBefore = ordinary(userDataDir, 'directory');
  const rootNames = boundedNames(userDataDir, MAX_ROOT_ENTRIES);
  const profiles = rootNames.filter((name) => PROFILE_NAME.test(name));
  if (profiles.length > MAX_PROFILES) throw new Error('extension profile count exceeds limit');
  let installed = false;
  const results = profiles.map((name) => {
    const profile = path.join(userDataDir, name);
    const profileBefore = ordinary(profile, 'directory');
    const extensions = path.join(profile, 'Extensions');
    if (!optionalInfo(extensions)) return Object.freeze({ name, identity: identity(profileBefore), extensions: null });
    const extensionsBefore = ordinary(extensions, 'directory');
    const extensionNames = boundedNames(extensions, MAX_EXTENSION_ENTRIES);
    if (extensionNames.some((entry) => !EXTENSION_NAME.test(entry))) throw new Error('extension directory layout differs');
    const pinned = extensionNames.includes(extensionId)
      ? scanPinnedExtension(path.join(extensions, extensionId)) : null;
    installed ||= pinned?.installed === true;
    const extensionsAfter = ordinary(extensions, 'directory');
    const profileAfter = ordinary(profile, 'directory');
    if (!sameIdentity(extensionsBefore, extensionsAfter) || !sameIdentity(profileBefore, profileAfter)) {
      throw new ScanChanged('extension profile changed');
    }
    return Object.freeze({
      name, identity: identity(profileAfter),
      extensions: Object.freeze({ identity: identity(extensionsAfter), names: extensionNames, pinned }),
    });
  });
  const rootAfter = ordinary(userDataDir, 'directory');
  if (!sameIdentity(rootBefore, rootAfter)) throw new ScanChanged('Chrome root changed');
  return Object.freeze({ exists: true, installed, identity: identity(rootAfter), names: rootNames, profiles: results });
}

export function stableExtensionTree(userDataDir, extensionId, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const first = scanExtensionTree(userDataDir, extensionId);
      options.afterScan?.(attempt, first);
      const second = scanExtensionTree(userDataDir, extensionId);
      if (JSON.stringify(first) === JSON.stringify(second)) return first;
    } catch (error) {
      if (!(error instanceof ScanChanged) && error?.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('extension profile did not stabilize');
}
