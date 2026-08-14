import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import { validateVersionDirectory, versionKey } from './store-package.mjs';
import {
  assertPrivateDirectory,
  inspectStore,
  lstatOptional,
  readPrivateRecord,
} from './store-paths.mjs';
import {
  cleanupRecoveryState,
  recoveryState,
  retireManagedPath,
} from './store-retirement.mjs';
import { inspectRemovalState } from './store-removal.mjs';
import { inspectStoreLockState } from './store-lock-state.mjs';

const ACTIVE_SCHEMA = 'aos.browser.companion-active.v1';
const ACTIVE_KEYS = ['schema_version', 'version_key', 'version', 'descriptor_sha256', 'closure_sha256'];
const LEASE_SCHEMA = 'aos.browser.companion-lease.v1';
const LEASE_KEYS = ['schema_version', 'session_id', 'generation', 'version_key', 'descriptor_sha256'];
const SAFE_LEASE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.json$/u;
const SAFE_VERSION = /^[0-9A-Za-z.-]+-[a-f0-9]{64}$/u;
const ROOT_ENTRIES = new Set([
  '.bootstrap', '.lock', '.lock-recovery', '.pending', '.retired', '.staging',
  'active.json', 'leases', 'owner.json', 'versions',
]);
const MAX_STABLE_VERSIONS = 16;
const MAX_TRANSITION_VERSIONS = MAX_STABLE_VERSIONS + 1;
const MAX_LEASES = 128;
const MAX_STAGES = 8;

function exactKeys(value, keys, code, label) {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(code, `${label} shape differs`);
  }
}

function directoryEntries(directory, maximum, label) {
  assertPrivateDirectory(directory, label);
  const entries = fs.readdirSync(directory);
  if (entries.length > maximum) fail('COMPANION_STORE_CORRUPT', `${label} exceeds its entry limit`);
  return entries.sort();
}

function validateRootLayout(store) {
  for (const entry of fs.readdirSync(store.paths.root)) {
    if (!ROOT_ENTRIES.has(entry)) fail('COMPANION_STORE_CORRUPT', 'companion store contains an unexpected entry');
  }
}

export function readActive(store) {
  const active = readPrivateRecord(store.paths.active);
  if (!active) return null;
  exactKeys(active, ACTIVE_KEYS, 'COMPANION_STORE_CORRUPT', 'active pointer');
  if (
    active.schema_version !== ACTIVE_SCHEMA
    || !SAFE_VERSION.test(active.version_key ?? '')
    || !/^[a-f0-9]{64}$/u.test(active.descriptor_sha256 ?? '')
    || !/^[a-f0-9]{64}$/u.test(active.closure_sha256 ?? '')
    || versionKey(active.version, active.descriptor_sha256) !== active.version_key
  ) {
    fail('COMPANION_STORE_CORRUPT', 'active pointer identity differs');
  }
  return active;
}

function validateVersions(store) {
  const keys = directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions');
  const versions = new Map();
  for (const key of keys) {
    if (!SAFE_VERSION.test(key)) fail('COMPANION_STORE_CORRUPT', 'immutable version key is invalid');
    const root = path.join(store.paths.versions, key);
    const validated = validateVersionDirectory(root);
    if (versionKey(validated.version, validated.descriptor_sha256) !== key) {
      fail('COMPANION_STORE_CORRUPT', 'immutable version identity differs');
    }
    versions.set(key, validated);
  }
  return versions;
}

export function listManagedLeases(store) {
  const leases = [];
  for (const filename of directoryEntries(store.paths.leases, MAX_LEASES, 'leases')) {
    if (!SAFE_LEASE.test(filename)) fail('COMPANION_STORE_CORRUPT', 'managed lease filename is invalid');
    const lease = readPrivateRecord(path.join(store.paths.leases, filename));
    exactKeys(lease, LEASE_KEYS, 'COMPANION_STORE_CORRUPT', 'managed lease');
    if (
      lease.schema_version !== LEASE_SCHEMA
      || `${lease.session_id}.json` !== filename
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(lease.session_id ?? '')
      || !/^[a-f0-9]{32}$/u.test(lease.generation ?? '')
      || !SAFE_VERSION.test(lease.version_key ?? '')
      || !/^[a-f0-9]{64}$/u.test(lease.descriptor_sha256 ?? '')
    ) {
      fail('COMPANION_STORE_CORRUPT', 'managed lease identity differs');
    }
    leases.push(lease);
  }
  return leases;
}

export function inspectManagedState(env, currentDescriptorSha256, options = {}) {
  const store = inspectStore(env);
  const removal = inspectRemovalState(store);
  if (!store.exists) {
    return Object.freeze({
      state: removal || store.bootstrap ? 'partial' : 'missing',
      store: null,
      active: null,
      validated: null,
      removal: removal?.journal ?? null,
      removal_phase: removal?.phase ?? null,
    });
  }
  validateRootLayout(store);
  const missingRequired = [
    store.paths.versions, store.paths.leases, store.paths.staging, store.paths.pending, store.paths.retired,
  ]
    .filter((directory) => !lstatOptional(directory));
  if (missingRequired.length > 0) return Object.freeze({
    state: 'partial', store, active: null, validated: null, removal: removal?.journal ?? null,
    removal_phase: removal?.phase ?? null,
  });
  const lockState = inspectStoreLockState(store, options.heldLock);
  const stages = directoryEntries(store.paths.staging, MAX_STAGES, 'staging');
  const recovery = recoveryState(store);
  const versions = validateVersions(store);
  const leases = listManagedLeases(store);
  const active = readActive(store);
  if (!active) {
    return Object.freeze({
      state: !removal && !lockState.recovery_pending && stages.length === 0 && versions.size === 0 && leases.length === 0 && !recovery.hasRecovery
        ? 'missing'
        : 'partial',
      store,
      active: null,
      validated: null,
      removal: removal?.journal ?? null,
      removal_phase: removal?.phase ?? null,
    });
  }
  const validated = versions.get(active.version_key);
  if (!validated || validated.version !== active.version || validated.descriptor_sha256 !== active.descriptor_sha256 || validated.closure_sha256 !== active.closure_sha256) {
    fail('COMPANION_STORE_CORRUPT', 'active pointer does not match immutable package state');
  }
  for (const lease of leases) {
    const leasedVersion = versions.get(lease.version_key);
    if (!leasedVersion || leasedVersion.descriptor_sha256 !== lease.descriptor_sha256) {
      fail('COMPANION_STORE_CORRUPT', 'managed lease does not match immutable package state');
    }
  }
  const retained = new Set([active.version_key, ...leases.map((lease) => lease.version_key)]);
  if (retained.size > MAX_STABLE_VERSIONS) {
    fail('COMPANION_STORE_CORRUPT', 'stable immutable version capacity is exceeded');
  }
  const unretired = [...versions.keys()].some((key) => !retained.has(key));
  if (removal || lockState.recovery_pending || stages.length > 0 || recovery.hasRecovery || unretired) {
    return Object.freeze({ state: 'partial', store, active, validated, removal: removal?.journal ?? null, removal_phase: removal?.phase ?? null });
  }
  return Object.freeze({
    state: active.descriptor_sha256 === currentDescriptorSha256 ? 'current' : 'update_available',
    store,
    active,
    validated,
  });
}

export function preflightVersionActivation(store, newVersionKey) {
  const keys = directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions');
  if (keys.length > MAX_STABLE_VERSIONS && !keys.includes(newVersionKey)) {
    fail('COMPANION_STORE_CORRUPT', 'immutable version transition is already incomplete');
  }
  const stable = new Set([
    newVersionKey,
    ...listManagedLeases(store).map((lease) => lease.version_key),
  ]);
  if (stable.size > MAX_STABLE_VERSIONS) {
    fail('COMPANION_LEASES_ACTIVE', 'managed leases exceed stable version capacity');
  }
}

export function cleanupSupersededVersions(store, activeKey) {
  const retained = new Set([activeKey, ...listManagedLeases(store).map((lease) => lease.version_key)]);
  for (const key of directoryEntries(store.paths.versions, MAX_TRANSITION_VERSIONS, 'versions')) {
    if (!retained.has(key)) retireManagedPath(store, path.join(store.paths.versions, key), 'version');
  }
}

export function clearManagedPackageState(store) {
  if (listManagedLeases(store).length > 0) fail('COMPANION_LEASES_ACTIVE', 'managed leases block uninstall');
  cleanupRecoveryState(store);
  const activeInfo = lstatOptional(store.paths.active);
  if (activeInfo) retireManagedPath(store, store.paths.active, 'active');
  for (const directory of [store.paths.versions, store.paths.staging]) {
    const kind = directory === store.paths.versions ? 'version' : 'stage';
    const maximum = directory === store.paths.versions ? MAX_TRANSITION_VERSIONS : MAX_STAGES;
    for (const entry of directoryEntries(directory, maximum, 'managed state')) {
      retireManagedPath(store, path.join(directory, entry), kind);
    }
  }
}

export function clearStagingState(store) {
  for (const entry of directoryEntries(store.paths.staging, MAX_STAGES, 'staging')) {
    retireManagedPath(store, path.join(store.paths.staging, entry), 'stage');
  }
}

export { cleanupRecoveryState };
