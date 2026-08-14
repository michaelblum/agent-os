import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail } from './errors.mjs';

const DESCRIPTOR_SCHEMA = 'aos.browser.companion-descriptor.v1';
const PACKAGE_NAMES = Object.freeze(['@playwright/cli', 'playwright', 'playwright-core']);
const LIFECYCLE_SCRIPTS = new Set([
  'preinstall', 'install', 'postinstall', 'prepublish', 'prepublishOnly', 'prepare',
]);
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@._/+~-]+$/u;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u;

function assert(condition, message) {
  if (!condition) fail('COMPANION_DESCRIPTOR_INVALID', message);
}

function exactKeys(value, keys, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys differ`);
}

function exactStringMap(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    assert(typeof key === 'string' && key.length > 0, `${label} name is invalid`);
    assert(typeof item === 'string' && item.length > 0, `${label}.${key} is invalid`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function descriptorDigest(descriptor) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(descriptor))).digest('hex');
}

export function packagePath(name) {
  if (name === '@playwright/cli') return path.join('@playwright', 'cli');
  if (name === 'playwright' || name === 'playwright-core') return name;
  fail('COMPANION_DESCRIPTOR_INVALID', `unsupported package ${name}`);
}

export function validateDescriptor(value) {
  exactKeys(value, [
    '$schema', 'schema_version', 'id', 'version', 'node', 'entrypoint', 'limits', 'packages',
  ], 'descriptor');
  assert(value.schema_version === DESCRIPTOR_SCHEMA, 'descriptor schema is unsupported');
  assert(value.id === 'playwright-cli', 'descriptor id is unsupported');
  assert(VERSION.test(value.version), 'descriptor version is invalid');
  assert(value.node === '>=18', 'descriptor Node requirement must be exact');
  assert(SAFE_RELATIVE.test(value.entrypoint), 'descriptor entrypoint is unsafe');
  exactKeys(value.limits, [
    'package_count', 'max_tarball_bytes', 'max_download_bytes', 'max_extracted_files',
    'max_extracted_bytes', 'download_timeout_ms', 'max_captured_output_bytes',
  ], 'descriptor limits');
  for (const [key, limit] of Object.entries(value.limits)) {
    assert(Number.isSafeInteger(limit) && limit > 0, `descriptor limit ${key} is invalid`);
  }
  assert(value.limits.package_count === PACKAGE_NAMES.length, 'descriptor package count differs');
  assert(Array.isArray(value.packages) && value.packages.length === PACKAGE_NAMES.length, 'descriptor package closure differs');

  const byName = new Map();
  for (const [index, pkg] of value.packages.entries()) {
    exactKeys(pkg, [
      'name', 'version', 'tarball', 'integrity', 'dependencies', 'optional_dependencies',
      'bin', 'excluded_prefixes',
    ], `package ${index}`);
    assert(pkg.name === PACKAGE_NAMES[index], `package ${index} order differs`);
    assert(VERSION.test(pkg.version), `package ${pkg.name} version is invalid`);
    assert(typeof pkg.tarball === 'string' && pkg.tarball.startsWith('https://registry.npmjs.org/'), `package ${pkg.name} URL is invalid`);
    assert(!/[?#]/u.test(pkg.tarball) && !/(?:^|[-/])latest(?:[-/.]|$)/iu.test(pkg.tarball), `package ${pkg.name} URL is dynamic`);
    assert(SHA512_SRI.test(pkg.integrity), `package ${pkg.name} integrity is invalid`);
    exactStringMap(pkg.dependencies, `${pkg.name} dependencies`);
    exactStringMap(pkg.optional_dependencies, `${pkg.name} optional dependencies`);
    exactStringMap(pkg.bin, `${pkg.name} bin`);
    assert(Array.isArray(pkg.excluded_prefixes), `${pkg.name} exclusions are invalid`);
    for (const prefix of pkg.excluded_prefixes) {
      assert(typeof prefix === 'string' && prefix.endsWith('/') && SAFE_RELATIVE.test(prefix), `${pkg.name} exclusion is unsafe`);
    }
    byName.set(pkg.name, pkg);
  }
  assert(byName.get('@playwright/cli').version === value.version, 'descriptor root version differs');
  for (const pkg of value.packages) {
    for (const [dependency, version] of Object.entries(pkg.dependencies)) {
      assert(byName.get(dependency)?.version === version, `${pkg.name} dependency closure differs`);
    }
  }
  const expectedEntrypoint = path.posix.join('node_modules', '@playwright/cli', byName.get('@playwright/cli').bin['playwright-cli']);
  assert(value.entrypoint === expectedEntrypoint, 'descriptor entrypoint differs from package bin');
  return Object.freeze({ descriptor: value, digest: descriptorDigest(value), byName });
}

export function assertSupportedNode(descriptor, version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  if (!Number.isInteger(major) || major < Number(descriptor.node.slice(2))) {
    fail('COMPANION_NODE_UNSUPPORTED', `Node ${version} does not satisfy ${descriptor.node}`);
  }
}

export function assertNoLifecycleScripts(manifest, packageName) {
  const scripts = manifest?.scripts ?? {};
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    fail('COMPANION_PACKAGE_INVALID', `${packageName} scripts are invalid`);
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string' || !command) fail('COMPANION_PACKAGE_INVALID', `${packageName} script is invalid`);
    if (LIFECYCLE_SCRIPTS.has(name)) {
      fail('COMPANION_PACKAGE_INVALID', `${packageName} declares lifecycle script ${name}`);
    }
  }
}

export function sourceDescriptorPath(repoRoot = null) {
  const root = repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return path.join(root, 'manifests', 'companions', 'playwright-cli-v1.json');
}

export function loadSourceDescriptor(options = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(sourceDescriptorPath(options.repoRoot), 'utf8'));
  } catch (error) {
    fail('COMPANION_DESCRIPTOR_INVALID', 'source descriptor cannot be read', { cause: error });
  }
  return validateDescriptor(value);
}
