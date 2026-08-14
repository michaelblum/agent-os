import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertNoLifecycleScripts,
  descriptorDigest,
  packagePath,
  validateDescriptor,
} from './descriptor.mjs';
import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  RECORD_MODE,
  assertPrivateDirectory,
  lstatOptional,
  readPrivateRecord,
} from './store-paths.mjs';

const INVENTORY_SCHEMA = 'aos.browser.companion-inventory.v1';
const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function exactObject(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) fail('COMPANION_PACKAGE_INVALID', `${label} differs`);
}

function readStoredFile(file, budget) {
  const before = lstatOptional(file);
  const uid = currentUid();
  if (!before || before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== RECORD_MODE || (uid !== null && before.uid !== uid)) {
    fail('COMPANION_PACKAGE_INVALID', 'stored package file type, mode, or owner differs');
  }
  budget.files += 1;
  budget.bytes += before.size;
  if (budget.files > budget.maxFiles || budget.bytes > budget.maxBytes) {
    fail('COMPANION_PACKAGE_INVALID', 'stored package closure exceeds its budget');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(descriptor);
    if (opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size || !opened.isFile()) {
      fail('COMPANION_PACKAGE_INVALID', 'stored package file changed during validation');
    }
    const bytes = fs.readFileSync(descriptor);
    if (bytes.length !== opened.size) fail('COMPANION_PACKAGE_INVALID', 'stored package file changed during read');
    const after = fs.lstatSync(file);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
      fail('COMPANION_PACKAGE_INVALID', 'stored package path changed during read');
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function packageTree(packageRoot, descriptor) {
  const budget = {
    files: 0,
    bytes: 0,
    maxFiles: descriptor.limits.max_extracted_files,
    maxBytes: descriptor.limits.max_extracted_bytes,
  };
  const hash = crypto.createHash('sha256');
  function visit(directory, relative = '') {
    assertPrivateDirectory(directory, 'stored package directory');
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const itemRelative = path.posix.join(relative, entry.name);
      const absolute = path.join(directory, entry.name);
      const info = lstatOptional(absolute);
      if (!info || info.isSymbolicLink()) fail('COMPANION_PACKAGE_INVALID', 'stored package contains a link');
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') fail('COMPANION_PACKAGE_INVALID', 'stored package contains a nested dependency tree');
        hash.update(`d\0${itemRelative}\0${DIRECTORY_MODE}\0`);
        visit(absolute, itemRelative);
      } else if (entry.isFile()) {
        const bytes = readStoredFile(absolute, budget);
        hash.update(`f\0${itemRelative}\0${RECORD_MODE}\0${bytes.length}\0`);
        hash.update(bytes);
        hash.update('\0');
      } else {
        fail('COMPANION_PACKAGE_INVALID', 'stored package contains a special entry');
      }
    }
  }
  visit(packageRoot);
  return Object.freeze({
    file_count: budget.files,
    total_bytes: budget.bytes,
    tree_sha256: hash.digest('hex'),
  });
}

function readManifest(packageRoot, descriptor, packageDescriptor) {
  const budget = { files: 0, bytes: 0, maxFiles: 1, maxBytes: 256 * 1024 };
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readStoredFile(path.join(packageRoot, 'package.json'), budget)));
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_PACKAGE_INVALID', 'package manifest is invalid', { cause: error });
  }
  if (
    manifest.name !== packageDescriptor.name
    || manifest.version !== packageDescriptor.version
    || manifest.engines?.node !== descriptor.node
  ) {
    fail('COMPANION_PACKAGE_INVALID', 'package manifest identity differs');
  }
  exactObject(manifest.dependencies ?? {}, packageDescriptor.dependencies, `${manifest.name} dependencies`);
  exactObject(manifest.optionalDependencies ?? {}, packageDescriptor.optional_dependencies, `${manifest.name} optional dependencies`);
  exactObject(manifest.bin ?? {}, packageDescriptor.bin, `${manifest.name} bin`);
  assertNoLifecycleScripts(manifest, manifest.name);
  return manifest;
}

function exactNodeModulesLayout(nodeModules) {
  assertPrivateDirectory(nodeModules, 'node_modules');
  const top = fs.readdirSync(nodeModules).sort();
  exactObject(top, ['@playwright', 'playwright', 'playwright-core'], 'package closure');
  const scope = path.join(nodeModules, '@playwright');
  assertPrivateDirectory(scope, 'package scope');
  exactObject(fs.readdirSync(scope), ['cli'], 'scoped package closure');
}

export function buildPackageInventory(runtimeRoot, descriptor) {
  const nodeModules = path.join(runtimeRoot, 'node_modules');
  exactNodeModulesLayout(nodeModules);
  const packages = [];
  let files = 0;
  let bytes = 0;
  for (const packageDescriptor of descriptor.packages) {
    const root = path.join(nodeModules, packagePath(packageDescriptor.name));
    assertPrivateDirectory(root, 'package root');
    const manifest = readManifest(root, descriptor, packageDescriptor);
    const tree = packageTree(root, descriptor);
    files += tree.file_count;
    bytes += tree.total_bytes;
    packages.push({ name: packageDescriptor.name, version: packageDescriptor.version, ...tree });
  }
  if (files > descriptor.limits.max_extracted_files || bytes > descriptor.limits.max_extracted_bytes) {
    fail('COMPANION_PACKAGE_INVALID', 'package closure exceeds descriptor limits');
  }
  const material = { schema_version: INVENTORY_SCHEMA, packages };
  return Object.freeze({
    ...material,
    closure_sha256: crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex'),
  });
}

export function versionKey(version, descriptorSha256) {
  if (!/^[0-9A-Za-z.-]+$/u.test(version) || !/^[a-f0-9]{64}$/u.test(descriptorSha256)) {
    fail('COMPANION_DESCRIPTOR_INVALID', 'version activation key is invalid');
  }
  return `${version}-${descriptorSha256}`;
}

export function validateVersionDirectory(versionRoot, expected = {}) {
  assertPrivateDirectory(versionRoot, 'immutable version');
  exactObject(fs.readdirSync(versionRoot).sort(), ['descriptor.json', 'inventory.json', 'node_modules'], 'immutable version layout');
  const descriptor = readPrivateRecord(path.join(versionRoot, 'descriptor.json'));
  const validated = validateDescriptor(descriptor);
  if (expected.descriptorSha256 && validated.digest !== expected.descriptorSha256) {
    fail('COMPANION_PACKAGE_INVALID', 'activated descriptor digest differs');
  }
  const storedInventory = readPrivateRecord(path.join(versionRoot, 'inventory.json'));
  const currentInventory = buildPackageInventory(versionRoot, descriptor);
  exactObject(storedInventory, currentInventory, 'package inventory');
  const entrypoint = path.join(versionRoot, ...descriptor.entrypoint.split('/'));
  const entryInfo = lstatOptional(entrypoint);
  if (!entryInfo || !entryInfo.isFile() || entryInfo.isSymbolicLink() || (entryInfo.mode & 0o777) !== RECORD_MODE) {
    fail('COMPANION_PACKAGE_INVALID', 'package entrypoint differs');
  }
  return Object.freeze({
    descriptor,
    descriptor_sha256: descriptorDigest(descriptor),
    closure_sha256: currentInventory.closure_sha256,
    version: descriptor.version,
  });
}
